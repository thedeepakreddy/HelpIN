import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_PUBLIC_KEYS, MapResponseSchema, MeSchema, ProblemCardSchema, ProblemDetailSchema } from '@helpin/contracts';
import { latLngToCell } from 'h3-js';
import { clock, now } from '../src/platform/clock';
import { D, H, SPOT, harness, keyPaths, problemInput, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const BBOX = '18.95,47.40,19.15,47.55';

describe('sign in and onboarding (ADR-018)', () => {
  it('logs in with a phone code, and rejects wrong codes with tries left', async () => {
    const otp = await h.req(null, 'POST', '/v1/auth/otp', { channel: 'sms', destination: '30 123 4567' });
    expect(otp.status).toBe(200);
    expect(otp.body.sentTo).toBe('+36 30 *** **67');
    expect(h.ctx.sent.sms[0]!.to).toBe('+36301234567');
    const wrong = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: 'CODE_MISMATCH', details: { triesLeft: 4 } });
    const ok = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: otp.body.devCode });
    expect(ok.status).toBe(200);
    MeSchema.parse(ok.body.me);
    expect(ok.body.me.phoneVerified).toBe(true);
    expect(ok.body.me.onboarding.done).toBe(false);
    // Codes can't be reused.
    const again = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: otp.body.devCode });
    expect(again.body.error.code).toBe('NO_PENDING_CODE');
  });

  it('refresh tokens rotate', async () => {
    const otp = await h.req(null, 'POST', '/v1/auth/otp', { channel: 'email', destination: 'Arjun@Example.com' });
    const s = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: '123456' });
    const r1 = await h.req(null, 'POST', '/v1/auth/refresh', { refreshToken: s.body.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.body.refreshToken);
    expect((await h.req(null, 'POST', '/v1/auth/refresh', { refreshToken: s.body.refreshToken })).status).toBe(401);
  });

  it('email sign-ups must verify a phone; one account per number', async () => {
    const taken = await h.user('Zsófi', { phone: '+36301112233' });
    void taken;
    const otp = await h.req(null, 'POST', '/v1/auth/otp', { channel: 'email', destination: 'new@example.com' });
    const s = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: otp.body.devCode });
    const sid = (await h.ctx.db.selectFrom('sessions').select('id').where('user_id', '=', s.body.me.id).executeTakeFirstOrThrow()).id;
    const u = { id: s.body.me.id, sid, role: 'user' as const, mfa: false, name: 'New' };
    expect((await h.req(u, 'GET', `/v1/map?bbox=${BBOX}&zoom=14`)).body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect((await h.req(u, 'POST', '/v1/me/phone/otp', { phone: '+36301112233' })).body.error.code).toBe('PHONE_TAKEN');
    const ch = await h.req(u, 'POST', '/v1/me/phone/otp', { phone: '+36309998877' });
    const me = await h.req(u, 'POST', '/v1/me/phone/verify', { challengeId: ch.body.challengeId, code: ch.body.devCode });
    expect(me.body.phoneVerified).toBe(true);
    expect((await h.req(u, 'GET', `/v1/map?bbox=${BBOX}&zoom=14`)).body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  it('L-05: the home area is a res-7 cell inside Budapest, never a point', async () => {
    const u = await h.user('Zsófi');
    const me = (await h.req(u, 'GET', '/v1/me')).body;
    expect(me.onboarding.done).toBe(true);
    expect(me.homeCell).toBe(latLngToCell(SPOT.bartok.lat, SPOT.bartok.lng, 7));
    expect(me.homeDistrict).toBe('XI');
    const outside = await h.req(u, 'PUT', '/v1/me/home-area', { cell: latLngToCell(SPOT.vienna.lat, SPOT.vienna.lng, 7) });
    expect(outside.body.error.code).toBe('OUTSIDE_LAUNCH_AREA');
    const point = await h.req(u, 'PUT', '/v1/me/home-area', { cell: latLngToCell(SPOT.bartok.lat, SPOT.bartok.lng, 9) });
    expect(point.status).toBe(400);
  });

  it('ADR-023: ADMIN_EMAILS become admins on login', async () => {
    const otp = await h.req(null, 'POST', '/v1/auth/otp', { channel: 'email', destination: 'founder@helpin.test' });
    const s = await h.req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: otp.body.devCode });
    expect(s.body.me.role).toBe('admin');
  });
});

describe('privacy contract (L-01, L-03, A-01)', () => {
  it('no public response contains the exact point, contact details or owner ids', async () => {
    const asker = await h.user('Arjun', { languages: ['en', 'hi'] });
    const neighbour = await h.user('Zsófi');
    const created = await h.req(asker, 'POST', '/v1/problems', problemInput());
    expect(created.status).toBe(200);
    const id = created.body.id;
    const payloads = [
      (await h.req(neighbour, 'GET', `/v1/map?bbox=${BBOX}&zoom=14`)).body,
      (await h.req(neighbour, 'GET', '/v1/problems/nearby')).body,
      (await h.req(neighbour, 'GET', `/v1/problems/${id}`)).body,
      (await h.req(neighbour, 'GET', `/v1/problems/similar?cell=${latLngToCell(SPOT.bartok.lat, SPOT.bartok.lng, 7)}&category=borrow_lend`)).body,
    ];
    MapResponseSchema.parse(payloads[0]);
    ProblemDetailSchema.parse(payloads[2]);
    expect(payloads[0].problems).toHaveLength(1);
    for (const payload of payloads) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(String(SPOT.bartok.lat));
      expect(text).not.toContain(String(SPOT.bartok.lng));
      const paths = keyPaths(payload);
      for (const key of FORBIDDEN_PUBLIC_KEYS) expect(paths.some((p) => p.endsWith(`.${key}`))).toBe(false);
      expect(paths.filter((p) => p.endsWith('.lat')).every((p) => p.endsWith('center.lat'))).toBe(true);
    }
    // The exact point exists, but only in the private table.
    const priv = await h.ctx.db.selectFrom('problem_private_locations').selectAll().where('problem_id', '=', id).executeTakeFirst();
    expect(priv).toMatchObject({ lat: SPOT.bartok.lat, lng: SPOT.bartok.lng });
    expect(payloads[2].area.areaRes).toBe(8);
    expect(payloads[2].area.district).toBe('XI');
  });

  it('A-01 / A-04: anonymous askers are hidden everywhere public', async () => {
    const asker = await h.user('Olena');
    const neighbour = await h.user('Zsófi');
    const p = await h.req(asker, 'POST', '/v1/problems', problemInput({ anonymous: true, precision: 'wider', title: 'Lost grey cat near Gellért tér', categoryId: 'pets_animals' }));
    expect(p.status).toBe(200);
    const detail = (await h.req(neighbour, 'GET', `/v1/problems/${p.body.id}`)).body;
    expect(detail.asker).toEqual({ anonymous: true, reliability: null });
    expect(JSON.stringify(detail)).not.toContain('Olena');
    expect(JSON.stringify(detail)).not.toContain(asker.id);
    expect(detail.area.areaRes).toBe(7);
    expect((await h.req(neighbour, 'GET', `/v1/users/${asker.id}/problem-photos`)).body).toEqual([]);
    // The asker still sees it in their own list.
    expect((await h.req(asker, 'GET', '/v1/me/problems')).body).toHaveLength(1);
  });

  it('L-02 and L-10: exact spots only for community problems; Budapest only', async () => {
    const u = await h.user('Wei');
    expect((await h.req(u, 'POST', '/v1/problems', problemInput({ precision: 'exact' }))).body.error.code).toBe('EXACT_SPOT_ONLY_FOR_ISSUES');
    expect((await h.req(u, 'POST', '/v1/problems', problemInput({ point: SPOT.vienna }))).body.error.code).toBe('OUTSIDE_LAUNCH_AREA');
    const issue = await h.req(u, 'POST', '/v1/problems', problemInput({ categoryId: 'water_bodies', precision: 'exact', point: SPOT.pond, title: 'Plastic waste at the pond' }));
    expect(issue.body.kind).toBe('issue');
    expect(issue.body.area.areaRes).toBe(9);
  });
});

describe('the help loop (DoD 1–12)', () => {
  it('offer → accept → chat → claim → confirm → karma', async () => {
    const arjun = await h.user('Arjun Sharma', { languages: ['en', 'hi'] });
    const zsofi = await h.user('Zsófi Kovács', { languages: ['hu', 'en', 'de'] });
    const bence = await h.user('Bence Tóth');
    clock.advance(25 * H); // K-07: accounts must be 24 h old to earn karma

    const p = (await h.req(arjun, 'POST', '/v1/problems', problemInput({ categoryId: 'language_translation', languageNeeded: 'hu>en', title: 'Help reading a letter' }))).body;
    expect(p.viewerRole).toBe('asker');
    expect(p.responseDueAt).toBeNull(); // R-51: no offer, no clock

    // R-10: not on your own problem.
    expect((await h.req(arjun, 'POST', `/v1/problems/${p.id}/offers`, { message: null })).body.error.code).toBe('OWN_PROBLEM');
    const offered = (await h.req(zsofi, 'POST', `/v1/problems/${p.id}/offers`, { message: 'Hi! I can translate tonight.' })).body;
    expect(offered.viewerRole).toBe('helper_offered');
    expect((await h.req(zsofi, 'POST', `/v1/problems/${p.id}/offers`, { message: null })).body.error.code).toBe('OFFER_EXISTS');
    await h.req(bence, 'POST', `/v1/problems/${p.id}/offers`, { message: 'Happy to help too' });

    const asAsker = (await h.req(arjun, 'GET', `/v1/problems/${p.id}`)).body;
    expect(asAsker.offers).toHaveLength(2);
    expect(new Date(asAsker.responseDueAt).getTime()).toBe(Date.parse('2026-10-02T10:00:00Z') + 48 * H); // R-52
    const zOffer = asAsker.offers.find((o: { helper: { displayName: string } }) => o.helper.displayName === 'Zsófi Kovács');
    expect(zOffer.sharesLanguage).toBe(true);

    // Accept → conversation with the offer message first (R-13).
    const accepted = (await h.req(arjun, 'POST', `/v1/offers/${zOffer.id}/accept`)).body;
    const conv = (await h.req(zsofi, 'GET', `/v1/conversations/${accepted.conversationId}`)).body;
    expect(conv.messages.map((m: { type: string }) => m.type)).toEqual(['system', 'text']);
    expect(conv.messages[1].body).toBe('Hi! I can translate tonight.');

    // Chat both ways; the asker's reply resets the clock (R-53).
    clock.advance(10 * H);
    await h.req(zsofi, 'POST', `/v1/conversations/${accepted.conversationId}/messages`, { type: 'text', body: 'Send me page 2?' });
    await h.req(arjun, 'POST', `/v1/conversations/${accepted.conversationId}/messages`, { type: 'text', body: 'Here it is, thank you!' });
    const due = (await h.req(arjun, 'GET', `/v1/problems/${p.id}`)).body.responseDueAt;
    expect(new Date(due).getTime()).toBe(now().getTime() + 48 * H);
    const list = (await h.req(zsofi, 'GET', '/v1/conversations')).body;
    expect(list[0]).toMatchObject({ unread: 1, viewerIsAsker: false, lastMessage: 'Here it is, thank you!' });

    // L-04: share exact location into the chat (asker only).
    expect((await h.req(zsofi, 'POST', `/v1/conversations/${accepted.conversationId}/share-location`, {})).status).toBe(403);
    const loc = (await h.req(arjun, 'POST', `/v1/conversations/${accepted.conversationId}/share-location`, {})).body;
    expect(loc.location).toEqual(SPOT.bartok);

    // R-14 claim, then confirm with credits.
    await h.req(zsofi, 'POST', `/v1/offers/${zOffer.id}/claim-solved`);
    const result = (await h.req(arjun, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [zOffer.id] })).body;
    expect(result).toMatchObject({ credited: 1, askerAward: 2 });
    expect(result.problem.status).toBe('solved');
    expect(result.problem.creditedHelperNames).toEqual(['Zsófi Kovács']);

    // R-06: never twice.
    expect((await h.req(arjun, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [] })).body.error.code).toBe('PROBLEM_NOT_OPEN');

    // DoD 10–12: closed on the map; karma on the profile.
    expect((await h.req(bence, 'GET', `/v1/map?bbox=${BBOX}&zoom=14`)).body.problems).toHaveLength(0);
    const zMe = (await h.req(zsofi, 'GET', '/v1/me')).body;
    expect(zMe).toMatchObject({ karma: 10, neighboursHelped: 1 });
    expect((await h.req(arjun, 'GET', '/v1/me')).body.karma).toBe(2);
    expect((await h.req(zsofi, 'GET', '/v1/me/karma')).body[0]).toMatchObject({ amount: 10, reason: 'solve_award' });
    expect((await h.req(bence, 'GET', `/v1/users/${zsofi.id}/solver-history`)).body[0]).toMatchObject({ title: 'Help reading a letter', askerName: 'Arjun Sharma' });

    // R-16: Bence's offer closed; notifications were created for everyone involved.
    await h.drain();
    const bNotes = (await h.req(bence, 'GET', '/v1/me/notifications')).body;
    expect(bNotes.some((n: { type: string }) => n.type === 'problem_closed')).toBe(true);
    const zNotes = (await h.req(zsofi, 'GET', '/v1/me/notifications')).body.map((n: { type: string }) => n.type);
    expect(zNotes).toEqual(expect.arrayContaining(['offer_accepted', 'message', 'karma']));
  });

  it('R-06: ten parallel confirms succeed exactly once', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    clock.advance(25 * H);
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
    const offer = (await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null })).body;
    void offer;
    const offerId = (await h.req(asker, 'GET', `/v1/problems/${p.id}`)).body.offers[0].id;
    const results = await Promise.all(Array.from({ length: 10 }, () => h.req(asker, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [offerId] })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const entries = await h.ctx.db.selectFrom('karma_entries').selectAll().where('problem_id', '=', p.id).execute();
    expect(entries.map((e) => e.reason).sort()).toEqual(['closing_award', 'solve_award']);
    expect((await h.req(helper, 'GET', '/v1/me')).body.karma).toBe(10);
  });

  it('K-07: new accounts get a zero-karma thank-you; K-05: pair cooldown', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    const solveOnce = async (title: string) => {
      const p = (await h.req(asker, 'POST', '/v1/problems', problemInput({ title }))).body;
      await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
      const offerId = (await h.req(asker, 'GET', `/v1/problems/${p.id}`)).body.offers[0].id;
      return (await h.req(asker, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [offerId] })).body;
    };
    expect((await solveOnce('First ladder')).askerAward).toBe(0); // helper account < 24 h
    expect((await h.req(helper, 'GET', '/v1/me/karma')).body[0]).toMatchObject({ amount: 0, reason: 'ineligible_account' });
    clock.advance(25 * H);
    expect((await solveOnce('Second ladder')).askerAward).toBe(2);
    clock.advance(2 * D);
    expect((await solveOnce('Third ladder')).askerAward).toBe(0); // K-05: same pair within 7 days
    expect((await h.req(helper, 'GET', '/v1/me/karma')).body[0]).toMatchObject({ amount: 0, reason: 'pair_cooldown' });
    expect((await h.req(helper, 'GET', '/v1/me')).body).toMatchObject({ karma: 10, neighboursHelped: 1 });
  });

  it('R-07: replaying an Idempotency-Key returns the first result', async () => {
    const u = await h.user('Wei');
    const headers = { 'idempotency-key': 'create-ladder-0001' };
    const a = await h.req(u, 'POST', '/v1/problems', problemInput(), headers);
    const b = await h.req(u, 'POST', '/v1/problems', problemInput(), headers);
    expect(b.body.id).toBe(a.body.id);
    expect((await h.req(u, 'GET', '/v1/me/problems')).body).toHaveLength(1);
    const c = await h.req(u, 'POST', '/v1/problems', problemInput({ title: 'Something else' }), headers);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('progress updates (R-40…R-46) and withdraw (no penalty)', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    const visitor = await h.user('Visitor');
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
    expect((await h.req(visitor, 'POST', `/v1/problems/${p.id}/updates`, { progressStatus: 'note', body: 'hi' })).body.error.code).toBe('FORBIDDEN');
    expect((await h.req(asker, 'POST', `/v1/problems/${p.id}/updates`, { progressStatus: 'need_changed', body: '' })).status).toBe(400);
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
    const u1 = await h.req(asker, 'POST', `/v1/problems/${p.id}/updates`, { progressStatus: 'partly_solved', body: 'Found one ladder, need a second' });
    expect(u1.body.latestProgress).toBe('partly_solved');
    clock.advance(H);
    const u2 = await h.req(helper, 'POST', `/v1/problems/${p.id}/updates`, { progressStatus: 'making_progress', body: 'Bringing mine at 6' });
    expect(u2.body.updates[0]).toMatchObject({ authorRole: 'helper', authorName: 'Helper' });
    const card = (await h.req(visitor, 'GET', '/v1/problems/nearby')).body[0];
    ProblemCardSchema.parse(card);
    expect(card.latestProgress).toBe('partly_solved'); // R-41: the asker's latest update
    const w = (await h.req(asker, 'POST', `/v1/problems/${p.id}/withdraw`, { reason: 'Sorted it out' })).body;
    expect(w.status).toBe('withdrawn');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(0);
  });
});
