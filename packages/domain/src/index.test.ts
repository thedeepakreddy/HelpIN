import { describe, expect, it } from 'vitest';
import {
  DomainError,
  assertCanOffer,
  assertCanPost,
  assertOfferTransition,
  decideConfirmSolved,
  decideCredit,
  decideCreditAfterQuorum,
  decideFixedNow,
  decideSweep,
  isConversationWritable,
  isKarmaEligible,
  maxLifeAt,
  penaltyFor,
  reliability,
  responseDueOnOffer,
  type HelperFacts,
  type OfferSnapshot,
  type ProblemSnapshot,
  type SweepProblem,
} from './index';

const H = 3_600_000;
const D = 24 * H;
const NOW = new Date('2026-10-04T12:00:00Z');
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

const problem: ProblemSnapshot = { id: 'p1', ownerId: 'asker', kind: 'request', status: 'open' };
const offer = (id: string, helperId: string, status: OfferSnapshot['status'] = 'offered'): OfferSnapshot => ({
  id,
  problemId: 'p1',
  helperId,
  status,
  createdAt: at(-H),
});
const eligible: HelperFacts = { eligible: true, lastPairAwardAt: null, pairTotal: 0 };
const facts = (entries: [string, HelperFacts][] = []) => new Map<string, HelperFacts>(entries);

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('karma awards (K-01, K-05, K-06, K-07)', () => {
  it('K-01: +10 for an eligible helper', () => {
    expect(decideCredit(eligible, NOW)).toEqual({ amount: 10, reason: 'solve_award' });
  });
  it('K-07: ineligible accounts get a zero entry', () => {
    expect(decideCredit({ ...eligible, eligible: false }, NOW)).toEqual({ amount: 0, reason: 'ineligible_account' });
    expect(decideCredit(undefined, NOW).reason).toBe('ineligible_account');
  });
  it('K-05: same pair within 7 days earns nothing', () => {
    expect(decideCredit({ ...eligible, lastPairAwardAt: at(-6 * D) }, NOW)).toEqual({ amount: 0, reason: 'pair_cooldown' });
    expect(decideCredit({ ...eligible, lastPairAwardAt: at(-8 * D) }, NOW).amount).toBe(10);
  });
  it('K-06: pair lifetime cap of 50', () => {
    expect(decideCredit({ ...eligible, pairTotal: 40 }, NOW).amount).toBe(10);
    expect(decideCredit({ ...eligible, pairTotal: 50 }, NOW)).toEqual({ amount: 0, reason: 'pair_cap' });
  });
  it('K-07: eligibility needs a verified phone and 24 h of account age', () => {
    expect(isKarmaEligible({ phoneVerifiedAt: at(-D), createdAt: at(-25 * H) }, NOW)).toBe(true);
    expect(isKarmaEligible({ phoneVerifiedAt: at(-D), createdAt: at(-23 * H) }, NOW)).toBe(false);
    expect(isKarmaEligible({ phoneVerifiedAt: null, createdAt: at(-30 * D) }, NOW)).toBe(false);
  });
});

describe('confirm solved (§4.3)', () => {
  const offers = [offer('o1', 'h1', 'accepted'), offer('o2', 'h2'), offer('o3', 'h3'), offer('o4', 'h4', 'declined')];
  const base = {
    problem,
    callerId: 'asker',
    offers,
    helperFacts: facts([
      ['h1', eligible],
      ['h2', eligible],
      ['h3', eligible],
    ]),
    asker: { eligible: true, closingAwardsLast7Days: 0 },
    now: NOW,
  };

  it('credits the chosen helpers, closes the others (R-16) and awards the asker +2 (K-11)', () => {
    const d = decideConfirmSolved({ ...base, creditedOfferIds: ['o1', 'o2'] });
    expect(d.credits.map((c) => [c.offerId, c.amount])).toEqual([
      ['o1', 10],
      ['o2', 10],
    ]);
    expect(d.closeOfferIds).toEqual(['o3']);
    expect(d.askerAward).toEqual({ amount: 2 });
  });

  it('R-15: an offer that was never accepted can still be credited', () => {
    expect(decideConfirmSolved({ ...base, creditedOfferIds: ['o3'] }).credits[0]!.amount).toBe(10);
  });

  it('R-02: only the asker', () => {
    expect(code(() => decideConfirmSolved({ ...base, callerId: 'h1', creditedOfferIds: [] }))).toBe('NOT_ASKER');
  });

  it('R-06: never twice', () => {
    expect(code(() => decideConfirmSolved({ ...base, problem: { ...problem, status: 'solved' }, creditedOfferIds: [] }))).toBe('PROBLEM_NOT_OPEN');
  });

  it('K-02: at most 3 credits; no duplicates', () => {
    expect(code(() => decideConfirmSolved({ ...base, creditedOfferIds: ['o1', 'o2', 'o3', 'o4'] }))).toBe('TOO_MANY_CREDITS');
    expect(code(() => decideConfirmSolved({ ...base, creditedOfferIds: ['o1', 'o1'] }))).toBe('DUPLICATE_CREDIT');
  });

  it('K-03: only offers on this problem, and not declined ones', () => {
    expect(code(() => decideConfirmSolved({ ...base, creditedOfferIds: ['nope'] }))).toBe('OFFER_NOT_ON_PROBLEM');
    expect(code(() => decideConfirmSolved({ ...base, creditedOfferIds: ['o4'] }))).toBe('OFFER_NOT_CREDITABLE');
  });

  it('K-11: no closing award without a real (non-zero) credit, or over the weekly cap', () => {
    expect(decideConfirmSolved({ ...base, creditedOfferIds: [] }).askerAward).toBeNull();
    const cooled = facts([['h1', { ...eligible, lastPairAwardAt: at(-D) }]]);
    expect(decideConfirmSolved({ ...base, helperFacts: cooled, creditedOfferIds: ['o1'] }).askerAward).toBeNull();
    expect(decideConfirmSolved({ ...base, asker: { eligible: true, closingAwardsLast7Days: 5 }, creditedOfferIds: ['o1'] }).askerAward).toBeNull();
    expect(decideConfirmSolved({ ...base, asker: { eligible: false, closingAwardsLast7Days: 0 }, creditedOfferIds: ['o1'] }).askerAward).toBeNull();
  });
});

describe('credit after a fixed-quorum solve (R-22)', () => {
  const solved: ProblemSnapshot = { ...problem, kind: 'issue', status: 'solved', solvedVia: 'fixed_quorum', creditDeadline: at(10 * H) };
  const input = {
    problem: solved,
    callerId: 'asker',
    offers: [offer('o1', 'h1', 'closed')],
    creditedOfferIds: ['o1'],
    alreadyCredited: false,
    helperFacts: facts([['h1', eligible]]),
    now: NOW,
  };
  it('lets the reporter credit closed offers within 72 h', () => {
    expect(decideCreditAfterQuorum(input)[0]).toMatchObject({ offerId: 'o1', amount: 10 });
  });
  it('rejects after the window, twice, or for asker-solved problems', () => {
    expect(code(() => decideCreditAfterQuorum({ ...input, now: at(11 * H) }))).toBe('CREDIT_WINDOW_CLOSED');
    expect(code(() => decideCreditAfterQuorum({ ...input, alreadyCredited: true }))).toBe('ALREADY_CREDITED');
    expect(code(() => decideCreditAfterQuorum({ ...input, problem: { ...solved, solvedVia: 'asker' } }))).toBe('PROBLEM_NOT_SOLVED');
  });
});

describe('help offers (R-10…R-14)', () => {
  const can = (over: Partial<Parameters<typeof assertCanOffer>[0]>) =>
    code(() => assertCanOffer({ problem, helperId: 'h1', existing: null, blockedEitherWay: false, ...over }));
  it('R-10: not on your own problem', () => expect(can({ helperId: 'asker' })).toBe('OWN_PROBLEM'));
  it('R-12: only while open and not blocked', () => {
    expect(can({ problem: { ...problem, status: 'withdrawn' } })).toBe('PROBLEM_NOT_OPEN');
    expect(can({ blockedEitherWay: true })).toBe('BLOCKED');
  });
  it('R-11: one offer per helper; withdrawn offers are reused; declined ones are final', () => {
    expect(assertCanOffer({ problem, helperId: 'h1', existing: null, blockedEitherWay: false })).toBe('create');
    expect(assertCanOffer({ problem, helperId: 'h1', existing: offer('o1', 'h1', 'withdrawn'), blockedEitherWay: false })).toBe('reuse');
    expect(can({ existing: offer('o1', 'h1', 'offered') })).toBe('OFFER_EXISTS');
    expect(can({ existing: offer('o1', 'h1', 'declined') })).toBe('OFFER_DECLINED');
  });
  it('transitions check the caller and state', () => {
    const t = (action: Parameters<typeof assertOfferTransition>[0]['action'], callerId: string, status: OfferSnapshot['status'] = 'offered') =>
      code(() => assertOfferTransition({ action, offer: offer('o1', 'h1', status), problem, callerId }));
    expect(t('accept', 'asker')).toBeUndefined();
    expect(t('accept', 'h1')).toBe('NOT_ASKER');
    expect(t('accept', 'asker', 'accepted')).toBe('INVALID_STATE');
    expect(t('withdraw', 'h1', 'accepted')).toBeUndefined();
    expect(t('withdraw', 'h2')).toBe('FORBIDDEN');
    expect(t('claim_solved', 'h1')).toBe('FORBIDDEN'); // R-14: accepted helpers only
    expect(t('claim_solved', 'h1', 'accepted')).toBeUndefined();
  });
});

describe('response rule (R-50…R-58, K-12, K-13)', () => {
  const startedAt = at(0);
  const open = (over: Partial<SweepProblem> = {}): SweepProblem => ({
    kind: 'request',
    status: 'open',
    responseDueAt: at(48 * H),
    reminderStage: 0,
    lastActivityAt: startedAt,
    penalizedAt: null,
    maxLifeAt: at(30 * D),
    hidden: false,
    ...over,
  });
  const sweep = (p: SweepProblem, hours: number, prev = 0) => decideSweep(p, prev, at(hours * H));

  it('R-51: no offer, no clock, ever', () => {
    expect(sweep(open({ responseDueAt: null }), 400)).toEqual({ reminder: null, penalty: null, terminal: null });
  });
  it('R-52: the clock starts with the first offer, personal problems only', () => {
    expect(responseDueOnOffer({ kind: 'request', responseDueAt: null }, NOW)).toEqual(at(48 * H));
    expect(responseDueOnOffer({ kind: 'issue', responseDueAt: null }, NOW)).toBeNull();
    expect(responseDueOnOffer({ kind: 'request', responseDueAt: at(5 * H) }, NOW)).toEqual(at(5 * H));
  });
  it('R-54: reminders at 24 h and 44 h, once each', () => {
    expect(sweep(open(), 23).reminder).toBeNull();
    expect(sweep(open(), 24).reminder).toBe(1);
    expect(sweep(open({ reminderStage: 1 }), 30).reminder).toBeNull();
    expect(sweep(open({ reminderStage: 1 }), 44).reminder).toBe(2);
    expect(sweep(open({ reminderStage: 2 }), 46).reminder).toBeNull();
  });
  it('R-55 + R-56: silent raiser with no helper activity → penalty and abandoned at 48 h', () => {
    expect(sweep(open({ reminderStage: 2 }), 48)).toEqual({ reminder: null, penalty: { amount: -5, putOnNotice: false }, terminal: 'abandoned' });
  });
  it('R-56: helper updates keep the problem alive, but the raiser is still penalised once', () => {
    const p = open({ reminderStage: 2, lastActivityAt: at(40 * H) });
    expect(sweep(p, 48)).toEqual({ reminder: null, penalty: { amount: -5, putOnNotice: false }, terminal: null });
    expect(sweep({ ...p, penalizedAt: at(48 * H) }, 60).penalty).toBeNull();
    expect(sweep({ ...p, penalizedAt: at(48 * H) }, 88).terminal).toBe('abandoned');
  });
  it('R-58: community problems never get a penalty or removal for silence', () => {
    expect(sweep(open({ kind: 'issue', responseDueAt: null }), 400)).toEqual({ reminder: null, penalty: null, terminal: null });
  });
  it('R-57: max lifetime expires without penalty', () => {
    expect(sweep(open({ maxLifeAt: at(10 * H) }), 50)).toEqual({ reminder: null, penalty: null, terminal: 'expired' });
    expect(maxLifeAt('request', 'serious', NOW)).toEqual(at(3 * D));
    expect(maxLifeAt('issue', 'basic', NOW)).toEqual(at(90 * D));
  });
  it('R-59: no penalty while hidden by moderation', () => {
    expect(sweep(open({ hidden: true, lastActivityAt: at(47 * H) }), 48).penalty).toBeNull();
  });
  it('K-13: escalation −5, −10, −10 + on notice', () => {
    expect(penaltyFor(0)).toEqual({ amount: -5, putOnNotice: false });
    expect(penaltyFor(1)).toEqual({ amount: -10, putOnNotice: false });
    expect(penaltyFor(2)).toEqual({ amount: -10, putOnNotice: true });
  });
  it('K-13 / A-05: on notice limits posting and anonymity', () => {
    const base = { onNoticeUntil: at(D), anonymousBannedUntil: null, problemsLast24h: 0, anonymous: false, now: NOW };
    expect(code(() => assertCanPost(base))).toBeUndefined();
    expect(code(() => assertCanPost({ ...base, problemsLast24h: 1 }))).toBe('ON_NOTICE_LIMIT');
    expect(code(() => assertCanPost({ ...base, anonymous: true }))).toBe('ANONYMOUS_NOT_ALLOWED');
    expect(code(() => assertCanPost({ ...base, onNoticeUntil: null, anonymousBannedUntil: at(D), anonymous: true }))).toBe('ANONYMOUS_NOT_ALLOWED');
  });
});

describe('issues: fixed-now quorum (R-21)', () => {
  it('solves at 3 votes within 48 h', () => {
    expect(decideFixedNow([at(-H), at(-2 * H)], NOW).solved).toBe(false);
    const d = decideFixedNow([at(-H), at(-2 * H), NOW], NOW);
    expect(d.solved).toBe(true);
    expect(d.creditDeadline).toEqual(at(72 * H));
    expect(decideFixedNow([at(-50 * H), at(-H), NOW], NOW).solved).toBe(false);
  });
});

describe('reliability (K-15)', () => {
  it('needs 3 helped problems, then counts the ones never penalised', () => {
    expect(reliability([{ gotHelp: true, penalized: false }, { gotHelp: true, penalized: false }])).toBeNull();
    expect(
      reliability([
        { gotHelp: true, penalized: false },
        { gotHelp: true, penalized: true },
        { gotHelp: true, penalized: false },
        { gotHelp: true, penalized: false },
        { gotHelp: false, penalized: false },
      ]),
    ).toBe(0.75);
  });
});

describe('chat (C-03, C-04)', () => {
  const base = { problemStatus: 'open' as const, problemClosedAt: null, readOnlyAt: null, blockedEitherWay: false, now: NOW, graceHours: 48 };
  it('is writable while open and for 48 h after', () => {
    expect(isConversationWritable(base)).toBe(true);
    expect(isConversationWritable({ ...base, problemStatus: 'solved', problemClosedAt: at(-47 * H) })).toBe(true);
    expect(isConversationWritable({ ...base, problemStatus: 'solved', problemClosedAt: at(-49 * H) })).toBe(false);
  });
  it('is read-only after a block', () => {
    expect(isConversationWritable({ ...base, blockedEitherWay: true })).toBe(false);
  });
});
