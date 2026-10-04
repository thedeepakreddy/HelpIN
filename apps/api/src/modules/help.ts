import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS, RATE_LIMITS } from '@helpin/config';
import { assertCanOffer, assertOfferTransition, responseDueOnOffer, type OfferSnapshot, type ProblemSnapshot } from '@helpin/domain';
import { requireUser } from '../platform/auth';
import { now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { notFound } from '../platform/errors';
import { parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { publish } from '../platform/realtime';
import { CARD_COLUMNS, isBlockedEitherWay, presentCards, type CardRow } from '../views';
import { problemDetail, raiserResponded, systemMessage, touchProblem } from './problems';

type ProblemRow = { id: string; owner_id: string; kind: string; status: string };
type OfferRow = { id: string; problem_id: string; helper_id: string; status: string; created_at: Date };
const problemSnap = (p: ProblemRow): ProblemSnapshot => ({ id: p.id, ownerId: p.owner_id, kind: p.kind as ProblemSnapshot['kind'], status: p.status as ProblemSnapshot['status'] });
const offerSnap = (o: OfferRow): OfferSnapshot => ({ id: o.id, problemId: o.problem_id, helperId: o.helper_id, status: o.status as OfferSnapshot['status'], createdAt: o.created_at });

/** Help offers (R-10…R-16) and the conversation that opens on accept (R-13, C-02). */
export function helpRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/v1/problems/:id/offers', async (req) => {
    // Raising or helping with a problem needs a verified phone (it keeps neighbours safe).
    const user = await requireUser(ctx, req, { write: true, verified: true });
    const id = (req.params as { id: string }).id;
    const { message } = parse(z.object({ message: z.string().max(LIMITS.offerMessage).nullable() }), req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'offer', RATE_LIMITS.offerHelp);
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx
        .selectFrom('problems')
        .select(['id', 'owner_id', 'kind', 'status', 'response_due_at', 'hidden_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!p || p.hidden_at) throw notFound('That problem');
      const existing = await tx.selectFrom('help_offers').selectAll().where('problem_id', '=', id).where('helper_id', '=', user.id).executeTakeFirst();
      const mode = assertCanOffer({
        problem: problemSnap(p),
        helperId: user.id,
        existing: existing ? offerSnap(existing) : null,
        blockedEitherWay: await isBlockedEitherWay(ctx, user.id, p.owner_id),
      });
      const t = now();
      const text = message?.trim() || null;
      const offer =
        mode === 'reuse'
          ? await tx
              .updateTable('help_offers')
              .set({ status: 'offered', message: text, created_at: t, accepted_at: null, claimed_solved_at: null, resolved_at: null })
              .where('id', '=', existing!.id)
              .returning('id')
              .executeTakeFirstOrThrow()
          : await tx.insertInto('help_offers').values({ problem_id: id, helper_id: user.id, message: text, created_at: t }).returning('id').executeTakeFirstOrThrow();
      // R-52: the asker's clock starts with the first offer (personal problems only).
      if (p.response_due_at === null) {
        const due = responseDueOnOffer({ kind: p.kind as 'request' | 'issue', responseDueAt: null }, t);
        if (due) await tx.updateTable('problems').set({ response_due_at: due, reminder_stage: 0, last_activity_at: t }).where('id', '=', id).execute();
      }
      await appendEvent(tx, { type: 'HelpOffered', offerId: offer.id });
      await touchProblem(tx, id);
    });
    return problemDetail(ctx, id, user.id);
  });

  async function loadOffer(offerId: string) {
    if (!z.uuid().safeParse(offerId).success) throw notFound('That offer');
    const o = await ctx.db.selectFrom('help_offers').selectAll().where('id', '=', offerId).executeTakeFirst();
    if (!o) throw notFound('That offer');
    return o;
  }

  app.post('/v1/offers/:id/accept', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const offer = await loadOffer((req.params as { id: string }).id);
    const conversationId = await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status', 'is_anonymous']).where('id', '=', offer.problem_id).forUpdate().executeTakeFirstOrThrow();
      const o = await tx.selectFrom('help_offers').selectAll().where('id', '=', offer.id).forUpdate().executeTakeFirstOrThrow();
      assertOfferTransition({
        action: 'accept',
        offer: offerSnap(o),
        problem: problemSnap(p),
        callerId: user.id,
      });
      const t = now();
      await tx.updateTable('help_offers').set({ status: 'accepted', accepted_at: t }).where('id', '=', o.id).execute();
      const conv = await tx.insertInto('conversations').values({ problem_id: p.id, help_offer_id: o.id, created_at: t }).returning('id').executeTakeFirstOrThrow();
      await tx
        .insertInto('conversation_participants')
        .values([
          { conversation_id: conv.id, user_id: p.owner_id },
          { conversation_id: conv.id, user_id: o.helper_id },
        ])
        .execute();
      const names = await tx.selectFrom('profiles').select(['user_id', 'display_name']).where('user_id', 'in', [p.owner_id, o.helper_id]).execute();
      const name = (id: string) => names.find((n) => n.user_id === id)?.display_name ?? 'Neighbour';
      const asker = p.is_anonymous ? 'The asker' : name(p.owner_id);
      await tx.insertInto('messages').values({ conversation_id: conv.id, sender_id: null, type: 'system', body: `${asker} accepted ${name(o.helper_id)}'s offer to help`, created_at: t }).execute();
      // R-13: the offer's message becomes the first message of the chat.
      if (o.message) await tx.insertInto('messages').values({ conversation_id: conv.id, sender_id: o.helper_id, type: 'text', body: o.message, created_at: new Date(t.getTime() + 1) }).execute();
      await raiserResponded(tx, p.id); // R-53
      await appendEvent(tx, { type: 'OfferAccepted', offerId: o.id, conversationId: conv.id });
      await publish(tx, [p.owner_id, o.helper_id], { type: 'conversation', id: conv.id });
      await touchProblem(tx, p.id);
      return conv.id;
    });
    return { problem: await problemDetail(ctx, offer.problem_id, user.id), conversationId };
  });

  app.post('/v1/offers/:id/decline', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const offer = await loadOffer((req.params as { id: string }).id);
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status']).where('id', '=', offer.problem_id).forUpdate().executeTakeFirstOrThrow();
      assertOfferTransition({
        action: 'decline',
        offer: offerSnap(offer),
        problem: problemSnap(p),
        callerId: user.id,
      });
      await tx.updateTable('help_offers').set({ status: 'declined', resolved_at: now() }).where('id', '=', offer.id).where('status', '=', 'offered').execute();
      await raiserResponded(tx, p.id); // R-53
      await appendEvent(tx, { type: 'OfferDeclined', offerId: offer.id });
      await touchProblem(tx, p.id);
    });
    return problemDetail(ctx, offer.problem_id, user.id);
  });

  app.post('/v1/offers/:id/withdraw', async (req) => {
    const user = await requireUser(ctx, req);
    const offer = await loadOffer((req.params as { id: string }).id);
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status']).where('id', '=', offer.problem_id).executeTakeFirstOrThrow();
      assertOfferTransition({
        action: 'withdraw',
        offer: offerSnap(offer),
        problem: problemSnap(p),
        callerId: user.id,
      });
      const t = now();
      await tx.updateTable('help_offers').set({ status: 'withdrawn', resolved_at: t }).where('id', '=', offer.id).execute();
      const conv = await tx.selectFrom('conversations').select('id').where('help_offer_id', '=', offer.id).executeTakeFirst();
      if (conv) {
        await tx.insertInto('messages').values({ conversation_id: conv.id, sender_id: null, type: 'system', body: 'The helper withdrew their offer.', created_at: t }).execute();
        await tx.updateTable('conversations').set({ read_only_at: t }).where('id', '=', conv.id).execute();
      }
      await touchProblem(tx, p.id);
    });
    return problemDetail(ctx, offer.problem_id, user.id);
  });

  // R-14: "I think it's solved" changes nothing but prompts the asker.
  app.post('/v1/offers/:id/claim-solved', async (req) => {
    const user = await requireUser(ctx, req);
    const offer = await loadOffer((req.params as { id: string }).id);
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status']).where('id', '=', offer.problem_id).executeTakeFirstOrThrow();
      assertOfferTransition({
        action: 'claim_solved',
        offer: offerSnap(offer),
        problem: problemSnap(p),
        callerId: user.id,
      });
      await tx.updateTable('help_offers').set({ claimed_solved_at: now() }).where('id', '=', offer.id).execute();
      const conv = await tx.selectFrom('conversations').select('id').where('help_offer_id', '=', offer.id).executeTakeFirst();
      const name = await tx.selectFrom('profiles').select('display_name').where('user_id', '=', user.id).executeTakeFirst();
      if (conv) await systemMessage(tx, p.id, `${name?.display_name ?? 'Your helper'} thinks it's solved.`, conv.id);
      await appendEvent(tx, { type: 'SolveClaimed', offerId: offer.id });
      await touchProblem(tx, p.id);
    });
    return problemDetail(ctx, offer.problem_id, user.id);
  });

  app.get('/v1/me/offers', async (req) => {
    const user = await requireUser(ctx, req);
    const rows = await ctx.db
      .selectFrom('help_offers as o')
      .innerJoin('problems as p', 'p.id', 'o.problem_id')
      .select([...CARD_COLUMNS, 'o.status as offer_status'])
      .where('o.helper_id', '=', user.id)
      .where('p.hidden_at', 'is', null)
      .orderBy('o.created_at', 'desc')
      .limit(100)
      .execute();
    const cards = await presentCards(ctx, rows as unknown as CardRow[]);
    return cards.map((c, i) => ({ problem: c, offerStatus: rows[i]!.offer_status }));
  });
}
