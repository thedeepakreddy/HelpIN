import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUTO_HIDE_REPORTS, FAKE_PROBLEM, KARMA, RATE_LIMITS } from '@helpin/config';
import { AdminDecisionSchema, ReportInputSchema, type AdminAppeal, type AdminMetrics, type AdminReport } from '@helpin/contracts';
import { sql, type Tx } from '@helpin/db';
import { requireStaff, requireUser } from '../platform/auth';
import { DAY, now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { ApiError, badRequest, conflict, notFound } from '../platform/errors';
import { parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { publish } from '../platform/realtime';
import { onProblemTerminal, refreshKarmaCaches, touchProblem } from './problems';
import { TYPE_COLOR } from './social';

type TargetType = AdminReport['targetType'];

/** Who wrote a piece of content (server-side only; used for blocks, decisions and appeals). */
async function targetAuthor(db: Ctx['db'] | Tx, type: TargetType, id: string): Promise<string | null> {
  if (type !== 'help_offer' && type !== 'message' && !z.uuid().safeParse(id).success) return null;
  switch (type) {
    case 'problem':
      return (await db.selectFrom('problems').select('owner_id as a').where('id', '=', id).executeTakeFirst())?.a ?? null;
    case 'problem_update':
      return (await db.selectFrom('problem_updates').select('author_id as a').where('id', '=', id).executeTakeFirst())?.a ?? null;
    case 'help_offer':
      return z.uuid().safeParse(id).success ? ((await db.selectFrom('help_offers').select('helper_id as a').where('id', '=', id).executeTakeFirst())?.a ?? null) : null;
    case 'message':
      return Number.isInteger(Number(id)) ? ((await db.selectFrom('messages').select('sender_id as a').where('id', '=', Number(id)).executeTakeFirst())?.a ?? null) : null;
    case 'post':
      return (await db.selectFrom('posts').select('author_id as a').where('id', '=', id).executeTakeFirst())?.a ?? null;
    case 'comment':
      return (await db.selectFrom('comments').select('author_id as a').where('id', '=', id).executeTakeFirst())?.a ?? null;
    case 'user':
      return (await db.selectFrom('users').select('id as a').where('id', '=', id).executeTakeFirst())?.a ?? null;
    case 'community':
      return null;
  }
}

/** S-05 / restore: hide or show a piece of content without deciding on it. */
async function setHidden(tx: Tx, type: TargetType, id: string, hidden: boolean) {
  const status = hidden ? 'hidden' : 'visible';
  const from = hidden ? 'visible' : 'hidden';
  switch (type) {
    case 'problem':
      await tx.updateTable('problems').set({ hidden_at: hidden ? now() : null }).where('id', '=', id).execute();
      break;
    case 'problem_update':
      await tx.updateTable('problem_updates').set({ status }).where('id', '=', id).where('status', '=', from).execute();
      break;
    case 'message':
      await tx.updateTable('messages').set({ status }).where('id', '=', Number(id)).where('status', '=', from).execute();
      break;
    case 'post':
      await tx.updateTable('posts').set({ status }).where('id', '=', id).where('status', '=', from).execute();
      break;
    case 'comment':
      await tx.updateTable('comments').set({ status }).where('id', '=', id).where('status', '=', from).execute();
      break;
    default:
      break;
  }
}

async function removeContent(tx: Tx, type: TargetType, id: string) {
  switch (type) {
    case 'problem': {
      const p = await tx.selectFrom('problems').select(['incident_id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) return;
      const t = now();
      if (p.status === 'open') {
        await tx.updateTable('problems').set({ status: 'removed', closed_at: t }).where('id', '=', id).execute();
      } else {
        // Already terminal: keep closed_at, but take it off profiles and history (R-05).
        await tx.updateTable('problems').set({ status: 'removed' }).where('id', '=', id).execute();
      }
      await onProblemTerminal(tx, id, p.incident_id);
      await appendEvent(tx, { type: 'ProblemClosed', problemId: id, status: 'removed' });
      break;
    }
    case 'problem_update':
      await tx.updateTable('problem_updates').set({ status: 'removed' }).where('id', '=', id).execute();
      break;
    case 'help_offer':
      await tx.updateTable('help_offers').set({ message: null }).where('id', '=', id).execute();
      break;
    case 'message':
      await tx.updateTable('messages').set({ status: 'removed' }).where('id', '=', Number(id)).execute();
      break;
    case 'post':
      await tx.updateTable('posts').set({ status: 'removed' }).where('id', '=', id).execute();
      break;
    case 'comment':
      await tx.updateTable('comments').set({ status: 'removed' }).where('id', '=', id).execute();
      break;
    default:
      break;
  }
}

async function preview(ctx: Ctx, type: TargetType, id: string): Promise<AdminReport['preview']> {
  const empty = { title: 'Unavailable', body: null, authorId: null, hidden: false, link: null };
  switch (type) {
    case 'problem': {
      const p = await ctx.db.selectFrom('problems').select(['title', 'description', 'owner_id', 'is_anonymous', 'hidden_at', 'status']).where('id', '=', id).executeTakeFirst();
      // A-07: the author of an anonymous problem is revealed only on request, and logged.
      return p ? { title: p.title, body: p.description, authorId: p.is_anonymous ? null : p.owner_id, hidden: !!p.hidden_at || p.status === 'removed', link: `/p/${id}` } : empty;
    }
    case 'problem_update': {
      const u = await ctx.db.selectFrom('problem_updates').select(['body', 'author_id', 'status', 'problem_id']).where('id', '=', id).executeTakeFirst();
      return u ? { title: 'Progress update', body: u.body, authorId: u.author_id, hidden: u.status !== 'visible', link: `/p/${u.problem_id}` } : empty;
    }
    case 'help_offer': {
      const o = await ctx.db.selectFrom('help_offers').select(['message', 'helper_id', 'problem_id']).where('id', '=', id).executeTakeFirst();
      return o ? { title: 'Offer to help', body: o.message, authorId: o.helper_id, hidden: false, link: `/p/${o.problem_id}` } : empty;
    }
    case 'message': {
      // C-06: a report gives moderators access to that message; the access is audited.
      const m = await ctx.db.selectFrom('messages').select(['body', 'type', 'sender_id', 'status']).where('id', '=', Number(id)).executeTakeFirst();
      return m ? { title: `Chat message (${m.type})`, body: m.body, authorId: m.sender_id, hidden: m.status !== 'visible', link: null } : empty;
    }
    case 'post': {
      const p = await ctx.db.selectFrom('posts').select(['caption', 'author_id', 'status', 'kind']).where('id', '=', id).executeTakeFirst();
      return p ? { title: `Post (${p.kind})`, body: p.caption, authorId: p.author_id, hidden: p.status !== 'visible', link: '/community' } : empty;
    }
    case 'comment': {
      const c = await ctx.db.selectFrom('comments').select(['body', 'author_id', 'status']).where('id', '=', id).executeTakeFirst();
      return c ? { title: 'Comment', body: c.body, authorId: c.author_id, hidden: c.status !== 'visible', link: null } : empty;
    }
    case 'user': {
      const u = await ctx.db.selectFrom('profiles').select(['display_name', 'bio']).where('user_id', '=', id).executeTakeFirst();
      return u ? { title: `Profile: ${u.display_name}`, body: u.bio, authorId: id, hidden: false, link: `/u/${id}` } : empty;
    }
    case 'community': {
      const c = await ctx.db.selectFrom('communities').select(['name', 'description']).where('id', '=', id).executeTakeFirst();
      return c ? { title: `Community: ${c.name}`, body: c.description, authorId: null, hidden: false, link: null } : empty;
    }
  }
}

async function logAction(
  tx: Tx | Ctx['db'],
  a: { moderatorId: string; action: string; targetType: string; targetId: string; reportId?: string | null; reason: string; statement?: string | null; affectedUserId?: string | null },
) {
  const row = await tx
    .insertInto('moderation_actions')
    .values({
      moderator_id: a.moderatorId,
      action: a.action,
      target_type: a.targetType,
      target_id: a.targetId,
      report_id: a.reportId ?? null,
      reason: a.reason,
      statement_of_reasons: a.statement ?? null,
      affected_user_id: a.affectedUserId ?? null,
      created_at: now(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** K-16 / A-06: the fake-problem penalty and its consequences. */
async function applyFakeProblemPenalty(tx: Tx, problemId: string, userId: string) {
  const t = now();
  await tx
    .insertInto('karma_entries')
    .values({ user_id: userId, amount: KARMA.fakeProblemPenalty, reason: 'fake_problem_penalty', problem_id: problemId, created_at: t })
    .onConflict((oc) => oc.column('problem_id').where('reason', '=', 'fake_problem_penalty').doNothing())
    .execute();
  const recent = await tx
    .selectFrom('karma_entries')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('user_id', '=', userId)
    .where('reason', '=', 'fake_problem_penalty')
    .where('created_at', '>', new Date(t.getTime() - FAKE_PROBLEM.restrictWindowDays * DAY))
    .executeTakeFirst();
  await tx
    .updateTable('users')
    .set({ anonymous_banned_until: new Date(t.getTime() + FAKE_PROBLEM.anonymousBanDays * DAY), ...((recent?.n ?? 0) >= 2 ? { status: 'restricted' } : {}) })
    .where('id', '=', userId)
    .execute();
  await refreshKarmaCaches(tx, [userId]);
}

export function safetyRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- Reports (S-04, S-05)
  app.post('/v1/reports', async (req) => {
    const user = await requireUser(ctx, req);
    const input = parse(ReportInputSchema, req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'report', RATE_LIMITS.report);
    const author = await targetAuthor(ctx.db, input.targetType, input.targetId);
    if (!author && input.targetType !== 'community') throw notFound('That content');
    if (author === user.id) throw badRequest('VALIDATION', "You can't report yourself.");
    await ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('reports')
        .values({ reporter_id: user.id, target_type: input.targetType, target_id: input.targetId, reason: input.reason, details: input.details, created_at: now() })
        .onConflict((oc) => oc.columns(['reporter_id', 'target_type', 'target_id']).doNothing())
        .execute();
      const count = await tx
        .selectFrom('reports as r')
        .innerJoin('users as u', 'u.id', 'r.reporter_id')
        .select(sql<number>`count(DISTINCT r.reporter_id)::int`.as('n'))
        .where('r.target_type', '=', input.targetType)
        .where('r.target_id', '=', input.targetId)
        .where('r.status', '=', 'open')
        .where('u.phone_verified_at', 'is not', null)
        .executeTakeFirst();
      if ((count?.n ?? 0) >= AUTO_HIDE_REPORTS) {
        await setHidden(tx, input.targetType, input.targetId, true);
        await logAction(tx, { moderatorId: user.id, action: 'hide', targetType: input.targetType, targetId: input.targetId, reason: `Auto-hidden after ${AUTO_HIDE_REPORTS} reports`, affectedUserId: author });
        if (input.targetType === 'problem') await touchProblem(tx, input.targetId);
      }
      // S-10: serious problems and danger reports alert the admin immediately.
      const serious =
        input.reason === 'dangerous' ||
        (input.targetType === 'problem' && (await tx.selectFrom('problems').select('urgency').where('id', '=', input.targetId).executeTakeFirst())?.urgency === 'serious');
      if (serious) {
        const staff = await tx.selectFrom('users').select('id').where('role', 'in', ['admin', 'moderator']).execute();
        for (const s of staff) {
          await tx
            .insertInto('notifications')
            .values({ user_id: s.id, type: 'system', payload: JSON.stringify({ title: 'Serious report needs review', body: `Reason: ${input.reason.replace('_', ' ')}`, link: '/admin' }), created_at: now() })
            .execute();
        }
        await publish(tx, staff.map((s) => s.id), { type: 'notification' });
      }
    });
    return { ok: true };
  });

  // ---- Blocks (S-03, C-04)
  app.post('/v1/blocks', async (req) => {
    const user = await requireUser(ctx, req);
    const body = parse(z.object({ userId: z.uuid().optional(), problemId: z.uuid().optional(), conversationId: z.uuid().optional() }), req.body);
    let target: string | null = body.userId ?? null;
    let viaAnonymous = false;
    if (body.problemId) {
      const p = await ctx.db.selectFrom('problems').select(['owner_id', 'is_anonymous']).where('id', '=', body.problemId).executeTakeFirst();
      target = p?.owner_id ?? null;
      viaAnonymous = !!p?.is_anonymous;
    }
    if (body.conversationId) {
      const c = await ctx.db
        .selectFrom('conversations as c')
        .innerJoin('problems as p', 'p.id', 'c.problem_id')
        .innerJoin('help_offers as o', 'o.id', 'c.help_offer_id')
        .innerJoin('conversation_participants as cp', 'cp.conversation_id', 'c.id')
        .select(['p.owner_id', 'p.is_anonymous', 'o.helper_id'])
        .where('c.id', '=', body.conversationId)
        .where('cp.user_id', '=', user.id)
        .executeTakeFirst();
      if (c) {
        target = c.owner_id === user.id ? c.helper_id : c.owner_id;
        viaAnonymous = c.owner_id !== user.id && c.is_anonymous;
      }
    }
    if (!target) throw notFound('That person');
    if (target === user.id) throw badRequest('VALIDATION', "You can't block yourself.");
    await ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('blocks')
        .values({ blocker_id: user.id, blocked_id: target!, via_anonymous: viaAnonymous, created_at: now() })
        .onConflict((oc) => oc.columns(['blocker_id', 'blocked_id']).doNothing())
        .execute();
      await publish(tx, [user.id, target!], { type: 'conversation' });
    });
    return { ok: true };
  });

  app.delete('/v1/blocks/:userId', async (req) => {
    const user = await requireUser(ctx, req);
    const { userId } = parse(z.object({ userId: z.uuid() }), req.params);
    await ctx.db.deleteFrom('blocks').where('blocker_id', '=', user.id).where('blocked_id', '=', userId).execute();
    return { ok: true };
  });

  app.get('/v1/me/blocks', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const rows = await ctx.db
      .selectFrom('blocks as b')
      .leftJoin('profiles as p', 'p.user_id', 'b.blocked_id')
      .select(['b.blocked_id', 'b.via_anonymous', 'b.created_at', 'p.display_name'])
      .where('b.blocker_id', '=', user.id)
      .orderBy('b.created_at', 'desc')
      .execute();
    return rows.map((r) => ({ userId: r.blocked_id, displayName: r.via_anonymous ? 'Anonymous neighbour' : (r.display_name ?? 'Neighbour'), createdAt: r.created_at.toISOString() }));
  });

  // ---- DSA: statements of reasons and appeals (S-09)
  app.post('/v1/appeals', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const body = parse(z.object({ moderationActionId: z.number().int(), body: z.string().trim().min(1).max(2000) }), req.body);
    const action = await ctx.db.selectFrom('moderation_actions').select(['id', 'affected_user_id']).where('id', '=', body.moderationActionId).executeTakeFirst();
    if (!action || action.affected_user_id !== user.id) throw notFound('That decision');
    try {
      await ctx.db.insertInto('appeals').values({ user_id: user.id, moderation_action_id: action.id, body: body.body, created_at: now() }).execute();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('ALREADY_APPEALED', 'You already appealed this decision.');
      throw e;
    }
    return { ok: true };
  });

  /* ---------------------------------------------------------------- Admin (ADR-023, S-10) */

  app.get('/v1/admin/reports', async (req) => {
    await requireStaff(ctx, req);
    const { status } = parse(z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open') }), req.query);
    const rows = await ctx.db
      .selectFrom('reports as r')
      .innerJoin('profiles as p', 'p.user_id', 'r.reporter_id')
      .select(['r.id', 'r.target_type', 'r.target_id', 'r.reason', 'r.details', 'r.created_at', 'r.status', 'p.display_name'])
      .where('r.status', '=', status)
      .orderBy('r.created_at', 'desc')
      .limit(200)
      .execute();
    // One row per target (the latest report), with how many reports it has.
    const seen = new Map<string, (typeof rows)[number] & { n: number }>();
    for (const r of rows) {
      const key = `${r.target_type}:${r.target_id}`;
      const prev = seen.get(key);
      if (prev) prev.n++;
      else seen.set(key, { ...r, n: 1 });
    }
    const out: AdminReport[] = [];
    for (const r of seen.values()) {
      const pv = await preview(ctx, r.target_type as TargetType, r.target_id);
      const serious =
        r.reason === 'dangerous' ||
        (r.target_type === 'problem' && (await ctx.db.selectFrom('problems').select('urgency').where('id', '=', r.target_id).executeTakeFirst())?.urgency === 'serious');
      out.push({
        id: r.id,
        targetType: r.target_type as TargetType,
        targetId: r.target_id,
        reason: r.reason as AdminReport['reason'],
        details: r.details,
        reporterName: r.display_name,
        createdAt: r.created_at.toISOString(),
        status: r.status as AdminReport['status'],
        reportCount: r.n,
        serious,
        preview: pv,
      });
    }
    return out.sort((a, b) => Number(b.serious) - Number(a.serious) || b.reportCount - a.reportCount);
  });

  // A-07: reveal the author of an anonymous problem while handling its report (audited).
  app.post('/v1/admin/reports/:id/reveal', async (req) => {
    const staff = await requireStaff(ctx, req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const report = await ctx.db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
    if (!report || report.target_type !== 'problem') throw notFound('That report');
    const owner = await targetAuthor(ctx.db, 'problem', report.target_id);
    await logAction(ctx.db, { moderatorId: staff.id, action: 'reveal_anonymous_author', targetType: 'problem', targetId: report.target_id, reportId: id, reason: 'Handling a report' });
    const p = owner ? await ctx.db.selectFrom('profiles').select('display_name').where('user_id', '=', owner).executeTakeFirst() : null;
    return { userId: owner, displayName: p?.display_name ?? null };
  });

  app.post('/v1/admin/reports/:id/decide', async (req) => {
    const staff = await requireStaff(ctx, req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const d = parse(AdminDecisionSchema, req.body);
    const report = await ctx.db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
    if (!report) throw notFound('That report');
    const type = report.target_type as TargetType;
    if (d.action === 'fake_problem' && type !== 'problem') throw badRequest('VALIDATION', 'Fake-problem penalties apply to problems only.');
    await ctx.db.transaction().execute(async (tx) => {
      const author = await targetAuthor(tx, type, report.target_id);
      const t = now();
      let actionId: number | null = null;
      if (d.action === 'dismiss' || d.action === 'restore') {
        await setHidden(tx, type, report.target_id, false);
        await logAction(tx, { moderatorId: staff.id, action: d.action === 'dismiss' ? 'dismiss_report' : 'restore', targetType: type, targetId: report.target_id, reportId: id, reason: d.reason, affectedUserId: author });
      } else if (d.action === 'restrict_user') {
        if (!author) throw badRequest('VALIDATION', 'No author to restrict.');
        await tx.updateTable('users').set({ status: 'restricted' }).where('id', '=', author).where('status', '=', 'active').execute();
        actionId = await logAction(tx, { moderatorId: staff.id, action: 'restrict_user', targetType: 'user', targetId: author, reportId: id, reason: d.reason, statement: d.statement, affectedUserId: author });
      } else {
        await removeContent(tx, type, report.target_id);
        if (d.action === 'fake_problem' && author) await applyFakeProblemPenalty(tx, report.target_id, author);
        actionId = await logAction(tx, {
          moderatorId: staff.id,
          action: d.action === 'fake_problem' ? 'fake_problem_penalty' : 'remove',
          targetType: type,
          targetId: report.target_id,
          reportId: id,
          reason: d.reason,
          statement: d.statement,
          affectedUserId: author,
        });
      }
      await tx
        .updateTable('reports')
        .set({ status: d.action === 'dismiss' || d.action === 'restore' ? 'dismissed' : 'actioned', resolved_at: t, resolved_by: staff.id })
        .where('target_type', '=', report.target_type)
        .where('target_id', '=', report.target_id)
        .where('status', '=', 'open')
        .execute();
      if (actionId && author) await appendEvent(tx, { type: 'ContentRemoved', moderationActionId: actionId, userId: author });
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/:action', async (req) => {
    const staff = await requireStaff(ctx, req, 'admin');
    const { id, action } = parse(z.object({ id: z.uuid(), action: z.enum(['restrict', 'unrestrict']) }), req.params);
    const { reason, statement } = parse(z.object({ reason: z.string().min(3), statement: z.string().nullable().default(null) }), req.body);
    await ctx.db.transaction().execute(async (tx) => {
      await tx.updateTable('users').set({ status: action === 'restrict' ? 'restricted' : 'active' }).where('id', '=', id).where('status', '!=', 'deleted').execute();
      const actionId = await logAction(tx, { moderatorId: staff.id, action: `${action}_user`, targetType: 'user', targetId: id, reason, statement, affectedUserId: id });
      if (action === 'restrict') await appendEvent(tx, { type: 'ContentRemoved', moderationActionId: actionId, userId: id });
    });
    return { ok: true };
  });

  // K-08: reversal = a new entry with the opposite amount; at most once per entry.
  app.post('/v1/admin/karma/:entryId/reverse', async (req) => {
    const staff = await requireStaff(ctx, req, 'admin');
    const { entryId } = parse(z.object({ entryId: z.coerce.number().int() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const e = await tx.selectFrom('karma_entries').selectAll().where('id', '=', entryId).executeTakeFirst();
      if (!e) throw notFound('That karma entry');
      if (e.reason === 'reversal') throw badRequest('VALIDATION', "Reversals can't be reversed.");
      try {
        await tx
          .insertInto('karma_entries')
          .values({ user_id: e.user_id, source_user_id: e.source_user_id, amount: -e.amount, reason: 'reversal', problem_id: e.problem_id, reverses_entry_id: e.id, created_at: now() })
          .execute();
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw conflict('ALREADY_REVERSED', 'That entry was already reversed.');
        throw err;
      }
      await refreshKarmaCaches(tx, [e.user_id]);
      await logAction(tx, { moderatorId: staff.id, action: 'reverse_karma', targetType: 'karma_entry', targetId: String(e.id), reason, affectedUserId: e.user_id });
      await appendEvent(tx, { type: 'KarmaReversed', entryId: e.id, userId: e.user_id });
    });
    return { ok: true };
  });

  app.get('/v1/admin/users', async (req) => {
    await requireStaff(ctx, req);
    const { q } = parse(z.object({ q: z.string().min(2) }), req.query);
    const like = `%${q.toLowerCase()}%`;
    const rows = await ctx.db
      .selectFrom('users as u')
      .leftJoin('profiles as p', 'p.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.phone_e164', 'u.status', 'u.role', 'u.created_at', 'p.display_name', 'p.karma_balance'])
      .where((eb) => eb.or([eb(sql`lower(p.display_name)`, 'like', like), eb('u.email', 'like', like), eb('u.phone_e164', 'like', `%${q.replace(/\D/g, '')}%`)]))
      .limit(30)
      .execute();
    return rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, phone: r.phone_e164, status: r.status, role: r.role, karma: r.karma_balance ?? 0, createdAt: r.created_at.toISOString() }));
  });

  app.get('/v1/admin/users/:id/karma', async (req) => {
    await requireStaff(ctx, req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const rows = await ctx.db.selectFrom('karma_entries').selectAll().where('user_id', '=', id).orderBy('id', 'desc').limit(100).execute();
    return rows.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, problemId: r.problem_id, createdAt: r.created_at.toISOString(), reversed: !!r.reverses_entry_id }));
  });

  app.get('/v1/admin/appeals', async (req) => {
    await requireStaff(ctx, req);
    const rows = await ctx.db
      .selectFrom('appeals as a')
      .innerJoin('moderation_actions as m', 'm.id', 'a.moderation_action_id')
      .leftJoin('profiles as p', 'p.user_id', 'a.user_id')
      .select(['a.id', 'a.body', 'a.created_at', 'a.status', 'p.display_name', 'm.id as action_id', 'm.action', 'm.target_type', 'm.target_id', 'm.reason', 'm.statement_of_reasons'])
      .orderBy('a.created_at', 'desc')
      .limit(100)
      .execute();
    return rows.map(
      (r): AdminAppeal => ({
        id: r.id,
        userName: r.display_name ?? 'Neighbour',
        body: r.body,
        createdAt: r.created_at.toISOString(),
        status: r.status as AdminAppeal['status'],
        action: { id: r.action_id, action: r.action, targetType: r.target_type, targetId: r.target_id, reason: r.reason, statement: r.statement_of_reasons },
      }),
    );
  });

  app.post('/v1/admin/appeals/:id/decide', async (req) => {
    const staff = await requireStaff(ctx, req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { decision, note } = parse(z.object({ decision: z.enum(['upheld', 'overturned']), note: z.string().min(3).max(2000) }), req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const a = await tx.selectFrom('appeals as a').innerJoin('moderation_actions as m', 'm.id', 'a.moderation_action_id').selectAll('a').select(['m.action', 'm.target_type', 'm.target_id', 'm.moderator_id']).where('a.id', '=', id).executeTakeFirst();
      if (!a) throw notFound('That appeal');
      if (a.status !== 'open') throw new ApiError(409, 'ALREADY_DECIDED', 'This appeal was already decided.');
      // S-09: appeals go to a different moderator where possible; with one admin it's logged.
      await tx.updateTable('appeals').set({ status: decision, decided_by: staff.id, decided_at: now() }).where('id', '=', id).execute();
      if (decision === 'overturned') {
        if (a.action === 'restrict_user') await tx.updateTable('users').set({ status: 'active' }).where('id', '=', a.target_id).execute();
        else if (a.target_type !== 'problem') await setHidden(tx, a.target_type as TargetType, a.target_id, false);
        if (a.target_type !== 'problem' && ['post', 'comment', 'problem_update', 'message'].includes(a.target_type)) {
          const restore = { status: 'visible' } as const;
          if (a.target_type === 'post') await tx.updateTable('posts').set(restore).where('id', '=', a.target_id).execute();
          if (a.target_type === 'comment') await tx.updateTable('comments').set(restore).where('id', '=', a.target_id).execute();
          if (a.target_type === 'problem_update') await tx.updateTable('problem_updates').set(restore).where('id', '=', a.target_id).execute();
          if (a.target_type === 'message') await tx.updateTable('messages').set(restore).where('id', '=', Number(a.target_id)).execute();
        }
        if (a.action === 'fake_problem_penalty') {
          const e = await tx.selectFrom('karma_entries').select(['id', 'user_id', 'amount']).where('problem_id', '=', a.target_id).where('reason', '=', 'fake_problem_penalty').executeTakeFirst();
          if (e) {
            await tx.insertInto('karma_entries').values({ user_id: e.user_id, amount: -e.amount, reason: 'reversal', problem_id: a.target_id, reverses_entry_id: e.id, created_at: now() }).onConflict((oc) => oc.column('reverses_entry_id').doNothing()).execute();
            await tx.updateTable('users').set({ anonymous_banned_until: null }).where('id', '=', e.user_id).execute();
            await refreshKarmaCaches(tx, [e.user_id]);
          }
        }
      }
      await logAction(tx, { moderatorId: staff.id, action: decision === 'overturned' ? 'restore' : 'dismiss_report', targetType: a.target_type, targetId: a.target_id, reason: `Appeal ${decision}: ${note}`, affectedUserId: a.user_id });
      await tx
        .insertInto('notifications')
        .values({
          user_id: a.user_id,
          type: 'system',
          payload: JSON.stringify({ title: decision === 'overturned' ? 'Your appeal was accepted' : 'Your appeal was reviewed', body: note, link: '/notifications' }),
          created_at: now(),
        })
        .execute();
      await publish(tx, [a.user_id], { type: 'notification' });
    });
    return { ok: true };
  });

  app.get('/v1/admin/metrics', async (req) => {
    await requireStaff(ctx, req);
    const [byDistrict, solve, users, open, reports, appeals, flags] = await Promise.all([
      ctx.db.selectFrom('metrics_liquidity_by_district').selectAll().orderBy('week', 'desc').limit(100).execute(),
      ctx.db.selectFrom('metrics_solve_rate_weekly').selectAll().orderBy('week', 'desc').limit(12).execute(),
      ctx.db.selectFrom('users').select(sql<number>`count(*)::int`.as('n')).where('status', '!=', 'deleted').executeTakeFirst(),
      ctx.db.selectFrom('problems').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'open').executeTakeFirst(),
      ctx.db.selectFrom('reports').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'open').executeTakeFirst(),
      ctx.db.selectFrom('appeals').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'open').executeTakeFirst(),
      velocityFlags(ctx),
    ]);
    return {
      liquidityByDistrict: byDistrict.map((r) => ({ district: r.district ?? '', week: (r.week as Date).toISOString(), problems: Number(r.problems ?? 0), liquidityPct: r.liquidity_pct === null ? null : Number(r.liquidity_pct) })),
      solveRate: solve.map((r) => ({
        week: (r.week as Date).toISOString(),
        closed: Number(r.closed ?? 0),
        solved: Number(r.solved ?? 0),
        solveRatePct: r.solve_rate_pct === null ? null : Number(r.solve_rate_pct),
        abandonmentRatePct: r.abandonment_rate_pct === null ? null : Number(r.abandonment_rate_pct),
      })),
      totals: { users: users?.n ?? 0, openProblems: open?.n ?? 0, openReports: reports?.n ?? 0, openAppeals: appeals?.n ?? 0, flags: flags.length },
    } satisfies AdminMetrics;
  });

  app.get('/v1/admin/flags', async (req) => {
    await requireStaff(ctx, req);
    return velocityFlags(ctx);
  });

  // COM-02: communities are created by the admin during the beta.
  app.post('/v1/admin/communities', async (req) => {
    const staff = await requireStaff(ctx, req, 'admin');
    const body = parse(
      z.object({
        name: z.string().trim().min(3).max(80),
        slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
        type: z.enum(['district', 'language_culture', 'students', 'civic_environment', 'interest']),
        description: z.string().max(1000),
        rules: z.string().max(2000).nullable(),
        requestId: z.uuid().optional(),
      }),
      req.body,
    );
    const row = await ctx.db.transaction().execute(async (tx) => {
      const c = await tx
        .insertInto('communities')
        .values({ name: body.name, slug: body.slug, type: body.type, description: body.description, rules: body.rules, created_by: staff.id, created_at: now() })
        .returning(['id', 'slug', 'name', 'type'])
        .executeTakeFirstOrThrow();
      if (body.requestId) await tx.updateTable('community_requests').set({ status: 'created' }).where('id', '=', body.requestId).execute();
      return c;
    });
    return { ...row, color: TYPE_COLOR[row.type] ?? 'brand' };
  });

  app.get('/v1/admin/community-requests', async (req) => {
    await requireStaff(ctx, req);
    const rows = await ctx.db
      .selectFrom('community_requests as r')
      .leftJoin('profiles as p', 'p.user_id', 'r.requester_id')
      .select(['r.id', 'r.name', 'r.type', 'r.reason', 'r.status', 'r.created_at', 'p.display_name'])
      .where('r.status', '=', 'open')
      .orderBy('r.created_at', 'desc')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, reason: r.reason, requester: r.display_name ?? 'Neighbour', createdAt: r.created_at.toISOString() }));
  });

}

/** K-10: suspicious karma patterns become moderation items, never automatic penalties. */
export async function velocityFlags(ctx: Ctx) {
  const t = now();
  const [pairs, helpers] = await Promise.all([
    sql<{ source_user_id: string; user_id: string; n: number }>`
      SELECT source_user_id, user_id, count(*)::int AS n FROM app.karma_entries
      WHERE reason IN ('solve_award','pair_cooldown','pair_cap','ineligible_account') AND created_at > ${new Date(t.getTime() - 30 * DAY)}
      GROUP BY 1, 2 HAVING count(*) > 5`.execute(ctx.db),
    sql<{ user_id: string; n: number }>`
      SELECT user_id, count(*)::int AS n FROM app.karma_entries
      WHERE reason = 'solve_award' AND created_at > ${new Date(t.getTime() - DAY)}
      GROUP BY 1 HAVING count(*) > 15`.execute(ctx.db),
  ]);
  return [
    ...pairs.rows.map((r) => ({ kind: 'pair_30d' as const, askerId: r.source_user_id, helperId: r.user_id, count: r.n })),
    ...helpers.rows.map((r) => ({ kind: 'helper_24h' as const, askerId: null, helperId: r.user_id, count: r.n })),
  ];
}
