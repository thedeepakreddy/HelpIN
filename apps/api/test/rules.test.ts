import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/platform/clock';
import { responseSweep } from '../src/jobs/cron';
import { H, SPOT, harness, problemInput, type Harness, type TestUser } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

async function sweepAt(hours: number, from: number) {
  void from;
  clock.advance(hours * H);
  await responseSweep(h.ctx);
  await h.drain();
}

async function setup() {
  const asker = await h.user('Asker');
  const helper = await h.user('Helper');
  const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
  await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: 'I have a ladder' });
  return { asker, helper, id: p.id as string };
}

const notesOf = async (u: TestUser) => (await h.req(u, 'GET', '/v1/me/notifications')).body as { type: string; title: string }[];
const problem = async (u: TestUser, id: string) => (await h.req(u, 'GET', `/v1/problems/${id}`)).body;

describe('raiser response rule (R-50…R-58, K-12, K-13)', () => {
  it('no offer, no clock: nothing ever happens before max lifetime (R-51)', async () => {
    const asker = await h.user('Asker');
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
    for (let i = 0; i < 10; i++) await sweepAt(48, 0);
    expect((await problem(asker, p.id)).status).toBe('open');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(0);
  });

  it('reminders at 24 h and 44 h, then −5 and abandoned at 48 h', async () => {
    const { asker, helper, id } = await setup();
    await sweepAt(23, 0);
    expect((await notesOf(asker)).filter((n) => n.type === 'response_due')).toHaveLength(0);
    await sweepAt(1, 0); // 24 h
    expect((await notesOf(asker)).filter((n) => n.type === 'response_due')).toHaveLength(1);
    await sweepAt(1, 0); // still only one
    expect((await notesOf(asker)).filter((n) => n.type === 'response_due')).toHaveLength(1);
    await sweepAt(19, 0); // 44 h
    const reminders = (await notesOf(asker)).filter((n) => n.type === 'response_due');
    expect(reminders).toHaveLength(2);
    expect(reminders[0]!.title).toBe('4 hours left before you lose 5 karma');
    await sweepAt(4, 0); // 48 h
    const p = await problem(asker, id);
    expect(p.status).toBe('abandoned');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(-5); // K-14: can go negative
    expect((await notesOf(asker)).some((n) => n.type === 'penalty')).toBe(true);
    expect((await notesOf(helper)).some((n) => n.title === "The asker hasn't responded in 2 days")).toBe(true);
    // Penalty at most once per problem.
    await sweepAt(48, 0);
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(-5);
  });

  it('any raiser response resets the clock (R-53)', async () => {
    const { asker, id } = await setup();
    await sweepAt(40, 0);
    await h.req(asker, 'POST', `/v1/problems/${id}/still-need-help`);
    await sweepAt(40, 0); // 80 h after the offer, 40 h after the response
    expect((await problem(asker, id)).status).toBe('open');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(0);
  });

  it('helper updates keep the problem alive, but the silent raiser is still penalised (R-56)', async () => {
    const { asker, helper, id } = await setup();
    await sweepAt(40, 0);
    await h.req(helper, 'POST', `/v1/problems/${id}/updates`, { progressStatus: 'making_progress', body: 'Dropping the ladder by tomorrow' });
    await sweepAt(8, 0); // 48 h: penalty, but still active
    expect((await problem(helper, id)).status).toBe('open');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(-5);
    await sweepAt(40, 0); // 48 h since the helper update → abandoned
    expect((await problem(helper, id)).status).toBe('abandoned');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(-5);
  });

  it('community problems never get a clock, penalty or removal for silence (R-58)', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput({ categoryId: 'streetlights', title: 'Three lamps are dark' }))).body;
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: 'I reported it too' });
    expect((await problem(asker, p.id)).responseDueAt).toBeNull();
    for (let i = 0; i < 5; i++) await sweepAt(48, 0);
    expect((await problem(asker, p.id)).status).toBe('open');
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(0);
  });

  it('withdrawing never penalises; max lifetime expires without penalty (R-57)', async () => {
    const { asker, id } = await setup();
    await sweepAt(30, 0);
    await h.req(asker, 'POST', `/v1/problems/${id}/withdraw`, { reason: 'No longer needed' });
    await sweepAt(48, 0);
    expect((await h.req(asker, 'GET', '/v1/me')).body.karma).toBe(0);

    const serious = (await h.req(asker, 'POST', '/v1/problems', problemInput({ urgency: 'serious', title: 'Need a ride to the pharmacy' }))).body;
    await sweepAt(73, 0);
    expect((await problem(asker, serious.id)).status).toBe('expired');
  });

  it('K-13: the third penalty in 30 days costs −10 and puts the raiser on notice', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    for (let i = 0; i < 3; i++) {
      const p = (await h.req(asker, 'POST', '/v1/problems', problemInput({ title: `Ladder ${i}` }))).body;
      await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
      await sweepAt(49, 0);
    }
    const me = (await h.req(asker, 'GET', '/v1/me')).body;
    expect(me.karma).toBe(-25);
    expect(me.onNoticeUntil).not.toBeNull();
    expect(me.canPostAnonymously).toBe(false);
    expect((await h.req(asker, 'POST', '/v1/problems', problemInput())).status).toBe(200);
    expect((await h.req(asker, 'POST', '/v1/problems', problemInput({ title: 'Another one' }))).body.error.code).toBe('ON_NOTICE_LIMIT');
  });
});

describe('community problems (R-21, R-22, R-30)', () => {
  it('"Same here" counts neighbours; three "Fixed now" votes solve it; the reporter can credit later', async () => {
    const reporter = await h.user('Réka');
    const helper = await h.user('Bence');
    const n = [await h.user('N1'), await h.user('N2'), await h.user('N3')];
    clock.advance(25 * H);
    const p = (await h.req(reporter, 'POST', '/v1/problems', problemInput({ categoryId: 'water_supply', urgency: 'medium', title: 'No water in our buildings' }))).body;
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: 'Calling the waterworks' });
    expect((await h.req(n[0]!, 'POST', `/v1/problems/${p.id}/fixed`)).body.error.code).toBe('NOT_AFFECTED');
    for (const u of n) await h.req(u, 'POST', `/v1/problems/${p.id}/affected`);
    expect((await problem(reporter, p.id)).affectedCount).toBe(4);
    await h.req(n[0]!, 'POST', `/v1/problems/${p.id}/fixed`);
    await h.req(n[1]!, 'POST', `/v1/problems/${p.id}/fixed`);
    expect((await problem(reporter, p.id)).status).toBe('open');
    const solved = (await h.req(n[2]!, 'POST', `/v1/problems/${p.id}/fixed`)).body;
    expect(solved.status).toBe('solved');
    const asReporter = await problem(reporter, p.id);
    expect(asReporter.creditUntil).not.toBeNull();
    const offerId = asReporter.offers[0]?.id ?? (await h.ctx.db.selectFrom('help_offers').select('id').where('problem_id', '=', p.id).executeTakeFirstOrThrow()).id;
    const credited = (await h.req(reporter, 'POST', `/v1/problems/${p.id}/credit`, { creditedOfferIds: [offerId] })).body;
    expect(credited).toMatchObject({ credited: 1, askerAward: 0 }); // K-11: no closing award for quorum solves
    expect((await h.req(helper, 'GET', '/v1/me')).body.karma).toBe(10);
    expect((await h.req(reporter, 'POST', `/v1/problems/${p.id}/credit`, { creditedOfferIds: [offerId] })).body.error.code).toBe('ALREADY_CREDITED');
  });

  it('"Same here" is only for community problems and not for your own', async () => {
    const reporter = await h.user('Réka');
    const p = (await h.req(reporter, 'POST', '/v1/problems', problemInput())).body;
    expect((await h.req(reporter, 'POST', `/v1/problems/${p.id}/affected`)).body.error.code).toBe('NOT_AN_ISSUE');
  });
});

describe('blocks (S-03, C-04, R-12)', () => {
  it('blocked users disappear from each other’s map, can’t offer, and chats become read-only', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: 'hi' });
    const offerId = (await problem(asker, p.id)).offers[0].id;
    const conv = (await h.req(asker, 'POST', `/v1/offers/${offerId}/accept`)).body.conversationId;
    await h.req(asker, 'POST', '/v1/blocks', { conversationId: conv });
    expect((await h.req(helper, 'POST', `/v1/conversations/${conv}/messages`, { type: 'text', body: 'hello?' })).body.error.code).toBe('CHAT_READ_ONLY');
    expect((await h.req(helper, 'GET', '/v1/conversations')).body[0].readOnly).toBe(true);
    expect((await h.req(helper, 'GET', `/v1/problems/${p.id}`)).status).toBe(404);
    expect((await h.req(helper, 'GET', '/v1/problems/nearby')).body).toHaveLength(0);
    const p2 = (await h.req(asker, 'POST', '/v1/problems', problemInput({ title: 'Another ladder' }))).body;
    expect((await h.req(helper, 'POST', `/v1/problems/${p2.id}/offers`, { message: null })).body.error.code).toBe('BLOCKED');
    expect((await h.req(asker, 'GET', '/v1/me/blocks')).body[0].displayName).toBe('Helper');
  });

  it('blocking from an anonymous problem never reveals the asker', async () => {
    const asker = await h.user('Secret Asker');
    const other = await h.user('Other');
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput({ anonymous: true }))).body;
    await h.req(other, 'POST', '/v1/blocks', { problemId: p.id });
    expect((await h.req(other, 'GET', '/v1/me/blocks')).body[0].displayName).toBe('Anonymous neighbour');
  });
});

describe('nearby alerts (§8.2)', () => {
  it('notifies neighbours in range, never the asker, blocked users or people outside their ring', async () => {
    const asker = await h.user('Asker');
    const near = await h.user('Near');
    const blocked = await h.user('Blocked');
    const far = await h.user('Far', { home: SPOT.rady });
    await h.req(far, 'PUT', '/v1/me/alert-prefs', { enabled: true, ring: 0, categories: [], minUrgency: 'basic', dailyCap: 5, quietStart: null, quietEnd: null, seriousInQuiet: false, emailDigest: true });
    await h.req(asker, 'POST', '/v1/blocks', { userId: blocked.id });
    await h.req(asker, 'POST', '/v1/problems', problemInput());
    await h.drain();
    expect((await notesOf(near)).map((n) => n.type)).toContain('nearby_problem');
    expect((await notesOf(blocked)).map((n) => n.type)).not.toContain('nearby_problem');
    expect((await notesOf(far)).map((n) => n.type)).not.toContain('nearby_problem');
    expect((await notesOf(asker)).map((n) => n.type)).not.toContain('nearby_problem');
  });

  it('respects the daily cap, but serious problems bypass it', async () => {
    const asker = await h.user('Asker');
    const near = await h.user('Near');
    await h.req(near, 'PUT', '/v1/me/alert-prefs', { enabled: true, ring: 1, categories: [], minUrgency: 'basic', dailyCap: 1, quietStart: null, quietEnd: null, seriousInQuiet: false, emailDigest: true });
    await h.req(asker, 'POST', '/v1/problems', problemInput({ title: 'One' }));
    await h.req(asker, 'POST', '/v1/problems', problemInput({ title: 'Two' }));
    await h.req(asker, 'POST', '/v1/problems', problemInput({ title: 'Three', urgency: 'serious' }));
    await h.drain();
    const nearby = (await notesOf(near)).filter((n) => n.type === 'nearby_problem');
    expect(nearby.map((n) => n.title).sort()).toEqual(['New nearby: One', 'Serious, nearby: Three']);
  });

  it('push goes to subscribed devices', async () => {
    const asker = await h.user('Asker');
    const near = await h.user('Near');
    await h.req(near, 'POST', '/v1/me/push-subscriptions', { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } });
    await h.req(asker, 'POST', '/v1/problems', problemInput());
    await h.drain();
    expect(h.push.sent.some((s) => s.endpoint === 'https://push.example/abc' && s.payload.title.startsWith('New nearby'))).toBe(true);
  });
});
