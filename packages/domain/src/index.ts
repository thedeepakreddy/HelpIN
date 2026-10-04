/**
 * HelpIn's business rules as pure functions (Architecture §3.2, "functional core"). No I/O:
 * services load snapshots, call these, then persist the decision in one transaction.
 * Rule IDs refer to docs/02-domain-model.md.
 */
import {
  ELIGIBILITY,
  FIXED_QUORUM,
  ISSUE_RESOLUTION,
  KARMA,
  MAX_LIFETIME_DAYS,
  ON_NOTICE,
  RELIABILITY,
  RESPONSE_RULE,
  type Kind,
  type ProblemStatus,
  type Urgency,
} from '@helpin/config';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ Errors */

export type DomainErrorCode =
  | 'NOT_ASKER'
  | 'PROBLEM_NOT_OPEN'
  | 'PROBLEM_NOT_SOLVED'
  | 'TOO_MANY_CREDITS'
  | 'DUPLICATE_CREDIT'
  | 'OFFER_NOT_ON_PROBLEM'
  | 'OFFER_NOT_CREDITABLE'
  | 'CREDIT_WINDOW_CLOSED'
  | 'ALREADY_CREDITED'
  | 'OWN_PROBLEM'
  | 'OFFER_EXISTS'
  | 'OFFER_DECLINED'
  | 'BLOCKED'
  | 'INVALID_STATE'
  | 'FORBIDDEN'
  | 'NOT_AN_ISSUE'
  | 'NOT_AFFECTED'
  | 'ON_NOTICE_LIMIT'
  | 'ANONYMOUS_NOT_ALLOWED';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const fail = (code: DomainErrorCode, message: string): never => {
  throw new DomainError(code, message);
};

/* ------------------------------------------------------------------ Snapshots */

export interface ProblemSnapshot {
  id: string;
  ownerId: string;
  kind: Kind;
  status: ProblemStatus;
  solvedVia?: 'asker' | 'fixed_quorum' | null;
  creditDeadline?: Date | null;
}

export type OfferStatus = 'offered' | 'accepted' | 'declined' | 'withdrawn' | 'credited' | 'closed';

export interface OfferSnapshot {
  id: string;
  problemId: string;
  helperId: string;
  status: OfferStatus;
  createdAt: Date;
}

/** What the karma rules need to know about one asker → helper pair (K-05, K-06, K-07). */
export interface HelperFacts {
  /** K-07: phone verified and account at least 24 h old. */
  eligible: boolean;
  /** K-05: last non-zero solve award from this asker to this helper. */
  lastPairAwardAt: Date | null;
  /** K-06: total karma this asker has given this helper so far. */
  pairTotal: number;
}

export interface AskerFacts {
  eligible: boolean;
  /** K-11: closing awards received in the last 7 days. */
  closingAwardsLast7Days: number;
}

export type CreditReason = 'solve_award' | 'pair_cooldown' | 'pair_cap' | 'ineligible_account';

export interface CreditDecision {
  offerId: string;
  helperId: string;
  amount: number;
  reason: CreditReason;
}

export interface SolveDecision {
  solvedVia: 'asker';
  credits: CreditDecision[];
  /** Non-terminal offers that were not credited (R-16). */
  closeOfferIds: string[];
  askerAward: { amount: number } | null;
}

/* ------------------------------------------------------------------ Eligibility */

/** K-07 (also used for K-11): phone verified and account at least 24 h old. */
export function isKarmaEligible(user: { phoneVerifiedAt: Date | null; createdAt: Date }, now: Date): boolean {
  return !!user.phoneVerifiedAt && now.getTime() - user.createdAt.getTime() >= ELIGIBILITY.minAccountAgeHours * HOUR;
}

/* ------------------------------------------------------------------ Karma (K-01…K-07) */

/** One helper's award for a solved problem. */
export function decideCredit(facts: HelperFacts | undefined, now: Date): { amount: number; reason: CreditReason } {
  if (!facts?.eligible) return { amount: 0, reason: 'ineligible_account' }; // K-07
  if (facts.lastPairAwardAt && now.getTime() - facts.lastPairAwardAt.getTime() < KARMA.pairCooldownDays * DAY) {
    return { amount: 0, reason: 'pair_cooldown' }; // K-05
  }
  if (facts.pairTotal + KARMA.solveAward > KARMA.pairLifetimeCap) return { amount: 0, reason: 'pair_cap' }; // K-06
  return { amount: KARMA.solveAward, reason: 'solve_award' }; // K-01
}

function validateCredits(problem: ProblemSnapshot, offers: OfferSnapshot[], creditedOfferIds: string[]): OfferSnapshot[] {
  if (creditedOfferIds.length > KARMA.maxCreditedHelpers) {
    fail('TOO_MANY_CREDITS', `You can credit up to ${KARMA.maxCreditedHelpers} people.`); // K-02
  }
  if (new Set(creditedOfferIds).size !== creditedOfferIds.length) fail('DUPLICATE_CREDIT', 'Each person can be credited once.');
  return creditedOfferIds.map((id) => {
    const offer = offers.find((o) => o.id === id);
    if (!offer || offer.problemId !== problem.id) return fail('OFFER_NOT_ON_PROBLEM', 'That person did not offer help on this problem.'); // K-03
    if (offer.helperId === problem.ownerId) return fail('FORBIDDEN', "You can't credit yourself."); // K-04
    if (offer.status !== 'offered' && offer.status !== 'accepted') {
      return fail('OFFER_NOT_CREDITABLE', 'This offer can no longer be credited.'); // R-15
    }
    return offer;
  });
}

/**
 * §4.3 Confirm solved: the asker closes the problem and credits up to 3 helpers.
 * R-02, R-06 (open only), R-15, R-16, K-01…K-07, K-11.
 */
export function decideConfirmSolved(input: {
  problem: ProblemSnapshot;
  callerId: string;
  offers: OfferSnapshot[];
  creditedOfferIds: string[];
  helperFacts: Map<string, HelperFacts>;
  asker: AskerFacts;
  now: Date;
}): SolveDecision {
  const { problem, callerId, offers, creditedOfferIds, helperFacts, asker, now } = input;
  if (problem.ownerId !== callerId) fail('NOT_ASKER', 'Only the asker can confirm this problem is solved.'); // R-02
  if (problem.status !== 'open') fail('PROBLEM_NOT_OPEN', 'This problem is already closed.'); // R-06
  const credited = validateCredits(problem, offers, creditedOfferIds);
  const credits = credited.map((o) => ({ offerId: o.id, helperId: o.helperId, ...decideCredit(helperFacts.get(o.helperId), now) }));
  const creditedIds = new Set(credited.map((o) => o.id));
  const closeOfferIds = offers.filter((o) => (o.status === 'offered' || o.status === 'accepted') && !creditedIds.has(o.id)).map((o) => o.id);
  // K-11: +2 only when at least one helper actually received karma, within the weekly cap.
  const someoneRewarded = credits.some((c) => c.amount > 0);
  const askerAward =
    someoneRewarded && asker.eligible && asker.closingAwardsLast7Days < KARMA.closingAwardWeeklyCap ? { amount: KARMA.closingAward } : null;
  return { solvedVia: 'asker', credits, closeOfferIds, askerAward };
}

/**
 * R-22: after a fixed-quorum solve, the reporter may credit helpers for 72 h. Same karma rules,
 * no closing award (K-11 excludes fixed-quorum solves).
 */
export function decideCreditAfterQuorum(input: {
  problem: ProblemSnapshot;
  callerId: string;
  offers: OfferSnapshot[];
  creditedOfferIds: string[];
  alreadyCredited: boolean;
  helperFacts: Map<string, HelperFacts>;
  now: Date;
}): CreditDecision[] {
  const { problem, callerId, now } = input;
  if (problem.ownerId !== callerId) fail('NOT_ASKER', 'Only the reporter can credit helpers.');
  if (problem.status !== 'solved' || problem.solvedVia !== 'fixed_quorum') fail('PROBLEM_NOT_SOLVED', 'Crediting after the fact is only for fixed issues.');
  if (input.alreadyCredited) fail('ALREADY_CREDITED', 'You already credited helpers for this problem.');
  if (!problem.creditDeadline || now > problem.creditDeadline) fail('CREDIT_WINDOW_CLOSED', 'The 72-hour window to credit helpers has passed.');
  // Offers were closed when the quorum solved the problem; they stay creditable here (R-22).
  const reopened = input.offers.map((o) => (o.status === 'closed' ? { ...o, status: 'offered' as const } : o));
  return validateCredits(problem, reopened, input.creditedOfferIds).map((o) => ({
    offerId: o.id,
    helperId: o.helperId,
    ...decideCredit(input.helperFacts.get(o.helperId), now),
  }));
}

/* ------------------------------------------------------------------ Help offers (R-10…R-16) */

export function assertCanOffer(input: {
  problem: ProblemSnapshot;
  helperId: string;
  existing: OfferSnapshot | null;
  blockedEitherWay: boolean;
}): 'create' | 'reuse' {
  const { problem, helperId, existing } = input;
  if (problem.ownerId === helperId) fail('OWN_PROBLEM', "You can't offer help on your own problem."); // R-10
  if (problem.status !== 'open') fail('PROBLEM_NOT_OPEN', 'This problem is already closed.'); // R-12
  if (input.blockedEitherWay) fail('BLOCKED', "You can't offer help here."); // R-12, S-03
  if (!existing) return 'create';
  if (existing.status === 'declined') fail('OFFER_DECLINED', 'The asker chose other helpers for this one.'); // R-11
  if (existing.status === 'withdrawn') return 'reuse'; // R-11
  return fail('OFFER_EXISTS', "You've already offered to help.");
}

type OfferAction = 'accept' | 'decline' | 'withdraw' | 'claim_solved';

/** Who may move an offer, and from which state. */
export function assertOfferTransition(input: {
  action: OfferAction;
  offer: OfferSnapshot;
  problem: ProblemSnapshot;
  callerId: string;
}): void {
  const { action, offer, problem, callerId } = input;
  const isAsker = callerId === problem.ownerId;
  const isHelper = callerId === offer.helperId;
  switch (action) {
    case 'accept':
    case 'decline':
      if (!isAsker) fail('NOT_ASKER', 'Only the asker can do this.');
      if (problem.status !== 'open') fail('PROBLEM_NOT_OPEN', 'This problem is already closed.');
      if (offer.status !== 'offered') fail('INVALID_STATE', `This offer can no longer be ${action === 'accept' ? 'accepted' : 'declined'}.`);
      return;
    case 'withdraw':
      if (!isHelper) fail('FORBIDDEN', 'Not your offer.');
      if (offer.status !== 'offered' && offer.status !== 'accepted') fail('INVALID_STATE', 'This offer can no longer be withdrawn.');
      return;
    case 'claim_solved':
      if (!isHelper || offer.status !== 'accepted') fail('FORBIDDEN', 'Only an accepted helper can do this.'); // R-14
      if (problem.status !== 'open') fail('PROBLEM_NOT_OPEN', 'This problem is already closed.');
      return;
  }
}

/* ------------------------------------------------------------------ Lifetimes & response rule */

/** R-57: when a problem expires without penalty. */
export function maxLifeAt(kind: Kind, urgency: Urgency, createdAt: Date): Date {
  return new Date(createdAt.getTime() + MAX_LIFETIME_DAYS[kind][urgency] * DAY);
}

/** R-52 / R-53: the deadline after the first offer or any raiser response. */
export function nextResponseDue(from: Date): Date {
  return new Date(from.getTime() + RESPONSE_RULE.windowHours * HOUR);
}

/** R-52: the clock starts with the first help offer, personal problems only (R-50). */
export function responseDueOnOffer(problem: { kind: Kind; responseDueAt: Date | null }, now: Date): Date | null {
  if (problem.kind !== 'request') return null;
  return problem.responseDueAt ?? nextResponseDue(now);
}

export interface SweepProblem {
  kind: Kind;
  status: ProblemStatus;
  responseDueAt: Date | null;
  reminderStage: number;
  lastActivityAt: Date;
  penalizedAt: Date | null;
  maxLifeAt: Date;
  /** R-59: hidden by moderation during the window → no penalty. */
  hidden: boolean;
}

export interface SweepDecision {
  reminder: 1 | 2 | null;
  penalty: { amount: number; putOnNotice: boolean } | null;
  terminal: 'abandoned' | 'expired' | null;
}

/** K-12 / K-13: penalty size given earlier penalties in the last 30 days. */
export function penaltyFor(previousPenaltiesIn30Days: number): { amount: number; putOnNotice: boolean } {
  const [first, second, third] = KARMA.abandonmentPenalties;
  if (previousPenaltiesIn30Days === 0) return { amount: first, putOnNotice: false };
  if (previousPenaltiesIn30Days === 1) return { amount: second, putOnNotice: false };
  return { amount: third, putOnNotice: true };
}

/**
 * The response sweep for one open problem (R-50…R-58, K-12, K-13). Runs every minute; each
 * decision is idempotent given the persisted reminder stage and penalized_at.
 */
export function decideSweep(p: SweepProblem, previousPenaltiesIn30Days: number, now: Date): SweepDecision {
  const none: SweepDecision = { reminder: null, penalty: null, terminal: null };
  if (p.status !== 'open') return none;
  const t = now.getTime();
  // R-57: max lifetime ends any problem, never with a penalty.
  if (t >= p.maxLifeAt.getTime()) return { ...none, terminal: 'expired' };
  // R-50 / R-58: community problems have no clock. R-51: no offer, no clock.
  if (p.kind !== 'request' || !p.responseDueAt) return none;

  const due = p.responseDueAt.getTime();
  const decision: SweepDecision = { ...none };
  const window = RESPONSE_RULE.windowHours * HOUR;
  const [firstReminder, secondReminder] = RESPONSE_RULE.reminderHours;
  const elapsed = t - (due - window);

  if (t >= due) {
    if (!p.penalizedAt && !p.hidden) decision.penalty = penaltyFor(previousPenaltiesIn30Days); // R-55, R-59
  } else if (elapsed >= secondReminder * HOUR && p.reminderStage < 2) {
    decision.reminder = 2; // R-54: "4 hours left"
  } else if (elapsed >= firstReminder * HOUR && p.reminderStage < 1) {
    decision.reminder = 1; // R-54: "waiting for you"
  }
  // R-56: nobody (raiser or helper updates) active for 48 h → abandoned.
  if (t - p.lastActivityAt.getTime() >= window) {
    decision.terminal = 'abandoned';
    decision.reminder = null;
    if (!p.penalizedAt && !p.hidden && !decision.penalty) decision.penalty = penaltyFor(previousPenaltiesIn30Days);
  }
  return decision;
}

/** K-13: how long someone stays on notice after a third penalty. */
export function onNoticeUntil(now: Date): Date {
  return new Date(now.getTime() + ON_NOTICE.durationDays * DAY);
}

/** K-13 / A-05: may this user post now? */
export function assertCanPost(input: {
  onNoticeUntil: Date | null;
  anonymousBannedUntil: Date | null;
  problemsLast24h: number;
  anonymous: boolean;
  now: Date;
}): void {
  const onNotice = !!input.onNoticeUntil && input.onNoticeUntil > input.now;
  if (onNotice && input.problemsLast24h >= ON_NOTICE.problemsPerDay) {
    fail('ON_NOTICE_LIMIT', "You're on notice: one new problem per day for now.");
  }
  if (input.anonymous && (onNotice || (input.anonymousBannedUntil && input.anonymousBannedUntil > input.now))) {
    fail('ANONYMOUS_NOT_ALLOWED', "Anonymous posting isn't available on your account right now."); // A-05
  }
}

/* ------------------------------------------------------------------ Issues (R-21) */

/** R-21: does this "Fixed now" vote reach the quorum? Votes count only within the window. */
export function decideFixedNow(votes: Date[], now: Date): { solved: boolean; creditDeadline: Date | null } {
  const since = now.getTime() - ISSUE_RESOLUTION.fixedWindowHours * HOUR;
  const recent = votes.filter((v) => v.getTime() >= since).length;
  if (recent < FIXED_QUORUM) return { solved: false, creditDeadline: null };
  return { solved: true, creditDeadline: new Date(now.getTime() + ISSUE_RESOLUTION.creditAfterSolveHours * HOUR) };
}

/* ------------------------------------------------------------------ Reliability (K-15) */

/**
 * K-15: share of the user's recent personal problems that got help where they never missed the
 * response window. Null until there are enough such problems.
 */
export function reliability(problems: { gotHelp: boolean; penalized: boolean }[]): number | null {
  const helped = problems.filter((p) => p.gotHelp);
  if (helped.length < RELIABILITY.minProblems) return null;
  return helped.filter((p) => !p.penalized).length / helped.length;
}

/* ------------------------------------------------------------------ Chat (C-03, C-04) */

export function isConversationWritable(input: {
  problemStatus: ProblemStatus;
  problemClosedAt: Date | null;
  readOnlyAt: Date | null;
  blockedEitherWay: boolean;
  now: Date;
  graceHours: number;
}): boolean {
  if (input.readOnlyAt || input.blockedEitherWay) return false; // C-04
  if (input.problemStatus === 'open') return true;
  return !!input.problemClosedAt && input.now.getTime() - input.problemClosedAt.getTime() < input.graceHours * HOUR; // C-03
}
