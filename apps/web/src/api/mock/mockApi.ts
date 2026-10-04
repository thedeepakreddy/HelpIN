import {
  CreateProblemInputSchema,
  PostUpdateInputSchema,
  type AppNotification,
  type Asker,
  type Community,
  type Conversation,
  type CreateProblemInput,
  type KarmaEntry,
  type MapResponse,
  type Me,
  type Message,
  type Offer,
  type Post,
  type PostUpdateInput,
  type ProblemCard,
  type ProblemDetail,
  type PublicUser,
  type ViewerRole,
} from '@helpin/contracts';
import { FIXED_QUORUM, KARMA, LIMITS, RESPONSE_RULE, URGENCY, findCategory } from '@helpin/config';
import {
  cellCenter,
  distanceMeters,
  isInLaunchArea,
  parentCell,
  resolutionForZoom,
  ringCells,
  snapToArea,
  type BBox,
  type LatLng,
} from '@helpin/geo';
import { ApiError, type ApiClient } from '../client';
import type { MockDb, NotificationRec, OfferRec, ProblemRec, UserRec } from './seed';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface MockOptions {
  latencyMs?: number;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

const SESSION_KEY = 'helpin.demo.session';
const DEMO_CODE = '123456';
const DEFAULT_DEMO_USER = 'u_zsofi';

export class MockApi implements ApiClient {
  private latency: number;
  private now: () => number;
  private storage: MockOptions['storage'];
  private currentUserId: string | null;
  private pendingContact: string | null = null;

  constructor(
    private db: MockDb,
    opts: MockOptions = {},
  ) {
    this.latency = opts.latencyMs ?? 180;
    this.now = opts.now ?? (() => Date.now());
    this.storage = opts.storage ?? null;
    this.currentUserId = this.storage?.getItem(SESSION_KEY) ?? null;
  }

  // ---------------------------------------------------------------- plumbing

  private async run<T>(fn: () => T): Promise<T> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
    return structuredClone(fn());
  }

  private id(prefix: string): string {
    this.db.seq += 1;
    return `${prefix}_${this.db.seq}`;
  }

  private uid(): string {
    if (!this.currentUserId) throw new ApiError('UNAUTHENTICATED', 'Please log in.');
    return this.currentUserId;
  }

  private user(id: string): UserRec {
    const u = this.db.users.find((x) => x.id === id);
    if (!u) throw new ApiError('NOT_FOUND', 'User not found.');
    return u;
  }

  private problem(id: string): ProblemRec {
    const p = this.db.problems.find((x) => x.id === id);
    if (!p) throw new ApiError('NOT_FOUND', 'Problem not found.');
    return p;
  }

  private offer(id: string): OfferRec {
    const o = this.db.offers.find((x) => x.id === id);
    if (!o) throw new ApiError('NOT_FOUND', 'Offer not found.');
    return o;
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  private notify(rec: Omit<NotificationRec, 'id' | 'createdAt' | 'read'>) {
    this.db.notifications.push({ ...rec, id: this.id('n'), createdAt: this.now(), read: false });
  }

  // ---------------------------------------------------------------- presenters (privacy boundary)

  private presentUser(u: UserRec): PublicUser {
    return {
      id: u.id,
      displayName: u.displayName,
      initials: u.initials,
      color: u.color,
      karma: u.karma,
      neighboursHelped: u.neighboursHelped,
      reliability: u.reliability,
      languages: u.languages,
      isNewcomer: u.isNewcomer,
      verified: true,
    };
  }

  private presentMe(u: UserRec): Me {
    return {
      ...this.presentUser(u),
      phoneVerified: true,
      bio: u.bio,
      memberSince: u.memberSince,
      postsCount: this.db.posts.filter((p) => p.authorId === u.id).length,
    };
  }

  private presentAsker(p: ProblemRec): Asker {
    const u = this.user(p.askerId);
    if (p.anonymous) return { anonymous: true, reliability: u.reliability };
    return { anonymous: false, user: this.presentUser(u) };
  }

  private presentCard(p: ProblemRec): ProblemCard {
    const area = snapToArea(p.exact, p.precision, p.kind);
    const offers = this.db.offers.filter((o) => o.problemId === p.id);
    const latest = [...p.updates].sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      id: p.id,
      incidentId: p.incidentId,
      title: p.title,
      categoryId: p.categoryId,
      kind: p.kind,
      urgency: p.urgency,
      status: p.status,
      area: {
        areaCell: area.areaCell,
        areaRes: area.areaRes,
        locality: p.locality,
        district: p.district,
        center: area.center,
      },
      languageNeeded: p.languageNeeded,
      createdAt: this.iso(p.createdAt),
      lastActivityAt: this.iso(p.lastActivityAt),
      latestProgress: latest?.progressStatus ?? null,
      helpingCount: offers.filter((o) => o.status === 'accepted').length,
      offersCount: offers.filter((o) => ['offered', 'accepted', 'credited'].includes(o.status)).length,
      affectedCount: p.kind === 'issue' ? p.affected.length + 1 : 0,
      photoCount: p.photoCount,
      asker: this.presentAsker(p),
    };
  }

  private viewerRole(p: ProblemRec, uid: string | null): ViewerRole {
    if (!uid) return 'visitor';
    if (p.askerId === uid) return 'asker';
    const mine = this.db.offers.find(
      (o) => o.problemId === p.id && o.helperId === uid && ['offered', 'accepted', 'credited'].includes(o.status),
    );
    if (mine?.status === 'accepted' || mine?.status === 'credited') return 'helper_accepted';
    if (mine?.status === 'offered') return 'helper_offered';
    if (p.kind === 'issue' && p.affected.includes(uid)) return 'affected';
    return 'visitor';
  }

  private presentOffer(o: OfferRec, askerId: string): Offer {
    const helper = this.user(o.helperId);
    const asker = this.user(askerId);
    return {
      id: o.id,
      problemId: o.problemId,
      helper: this.presentUser(helper),
      message: o.message,
      status: o.status,
      createdAt: this.iso(o.createdAt),
      claimedSolved: o.claimedSolved,
      conversationId: o.conversationId,
      sharesLanguage: helper.languages.some((l) => asker.languages.includes(l)),
    };
  }

  private presentDetail(p: ProblemRec): ProblemDetail {
    const uid = this.currentUserId;
    const role = this.viewerRole(p, uid);
    const offers = this.db.offers.filter((o) => o.problemId === p.id);
    const mine = uid ? offers.find((o) => o.helperId === uid) : undefined;
    return {
      ...this.presentCard(p),
      description: p.description,
      updates: [...p.updates]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((u) => ({
          id: u.id,
          authorRole: u.authorRole,
          authorName:
            u.authorRole === 'asker' && p.anonymous ? 'Anonymous neighbour' : this.user(u.authorId).displayName,
          progressStatus: u.progressStatus,
          body: u.body,
          createdAt: this.iso(u.createdAt),
        })),
      viewerRole: role,
      myOffer: mine ? this.presentOffer(mine, p.askerId) : null,
      responseDueAt: role === 'asker' && p.responseDueAt && p.status === 'open' ? this.iso(p.responseDueAt) : null,
      offers:
        role === 'asker'
          ? offers
              .filter((o) => ['offered', 'accepted', 'credited'].includes(o.status))
              .sort((a, b) => Number(b.status === 'accepted') - Number(a.status === 'accepted'))
              .map((o) => this.presentOffer(o, p.askerId))
          : [],
      creditedHelperNames: p.creditedHelperIds.map((id) => this.user(id).displayName),
      fixedVotes: p.fixedVotes.length,
    };
  }

  // ---------------------------------------------------------------- identity

  requestCode(contact: string) {
    return this.run(() => {
      const trimmed = contact.trim();
      if (trimmed.length < 5) throw new ApiError('VALIDATION', 'Enter a phone number or email.');
      this.pendingContact = trimmed;
      return { sentTo: trimmed };
    });
  }

  verifyCode(code: string) {
    return this.run(() => {
      if (!this.pendingContact) throw new ApiError('NO_PENDING_CODE', 'Request a code first.');
      if (code !== DEMO_CODE) throw new ApiError('CODE_MISMATCH', "That code didn't match.");
      const digits = this.pendingContact.replace(/\D/g, '');
      const match = this.db.users.find((u) => digits.length >= 9 && u.phone.endsWith(digits.slice(-9)));
      this.setSession(match?.id ?? DEFAULT_DEMO_USER);
      this.pendingContact = null;
      return this.presentMe(this.user(this.uid()));
    });
  }

  private setSession(userId: string | null) {
    this.currentUserId = userId;
    if (userId) this.storage?.setItem(SESSION_KEY, userId);
    else this.storage?.removeItem(SESSION_KEY);
  }

  getMe() {
    return this.run(() => (this.currentUserId ? this.presentMe(this.user(this.currentUserId)) : null));
  }

  logout() {
    return this.run(() => this.setSession(null));
  }

  switchDemoUser(userId: string) {
    return this.run(() => {
      this.user(userId);
      this.setSession(userId);
      return this.presentMe(this.user(userId));
    });
  }

  getUser(userId: string) {
    return this.run(() => this.presentUser(this.user(userId)));
  }

  getKarmaHistory() {
    return this.run((): KarmaEntry[] => {
      const uid = this.uid();
      return this.db.karma
        .filter((k) => k.userId === uid)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((k) => ({ id: k.id, amount: k.amount, reason: k.reason, label: k.label, createdAt: this.iso(k.createdAt) }));
    });
  }

  // ---------------------------------------------------------------- problems

  private openProblems() {
    return this.db.problems.filter((p) => p.status === 'open');
  }

  getMap(bbox: BBox, zoom: number) {
    return this.run((): MapResponse => {
      const [w, s, e, n] = bbox;
      const inView = this.openProblems()
        .map((p) => this.presentCard(p))
        .filter((c) => c.area.center.lng >= w && c.area.center.lng <= e && c.area.center.lat >= s && c.area.center.lat <= n);
      const res = resolutionForZoom(zoom);
      if (res === 8) {
        return {
          mode: 'incidents',
          problems: inView.sort((a, b) => URGENCY[b.urgency].order - URGENCY[a.urgency].order),
        };
      }
      const groups = new Map<string, { count: number; maxUrgency: ProblemCard['urgency'] }>();
      for (const c of inView) {
        const cell = parentCell(c.area.areaCell, res);
        const g = groups.get(cell) ?? { count: 0, maxUrgency: 'basic' as const };
        g.count += 1;
        if (URGENCY[c.urgency].order > URGENCY[g.maxUrgency].order) g.maxUrgency = c.urgency;
        groups.set(cell, g);
      }
      return {
        mode: 'clusters',
        clusters: [...groups].map(([cell, g]) => ({ cell, center: cellCenter(cell), count: g.count, maxUrgency: g.maxUrgency })),
      };
    });
  }

  listNearby(center: LatLng) {
    return this.run(() =>
      this.openProblems()
        .map((p) => this.presentCard(p))
        .sort(
          (a, b) =>
            URGENCY[b.urgency].order - URGENCY[a.urgency].order ||
            distanceMeters(center, a.area.center) - distanceMeters(center, b.area.center),
        ),
    );
  }

  /** R-31: similar open incidents in the same area + ring 1, same category. */
  similarOpen(categoryId: string, point: LatLng) {
    return this.run(() => {
      const home = snapToArea(point, 'wider', 'request').cellR7;
      const ring = new Set(ringCells(home, 1));
      return this.openProblems()
        .filter((p) => p.categoryId === categoryId)
        .map((p) => this.presentCard(p))
        .filter((c) => ring.has(parentCell(c.area.areaCell, 7)));
    });
  }

  getProblem(problemId: string) {
    return this.run(() => {
      const p = this.problem(problemId);
      if (p.status === 'removed') throw new ApiError('REMOVED', 'This problem was removed.');
      return this.presentDetail(p);
    });
  }

  myProblems() {
    return this.run(() => {
      const uid = this.uid();
      return this.db.problems
        .filter((p) => p.askerId === uid)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => this.presentCard(p));
    });
  }

  createProblem(input: CreateProblemInput) {
    return this.run(() => {
      const uid = this.uid();
      const parsed = CreateProblemInputSchema.safeParse(input);
      if (!parsed.success) throw new ApiError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
      const data = parsed.data;
      findCategory(data.categoryId);
      if (!isInLaunchArea(data.point)) {
        throw new ApiError('OUTSIDE_LAUNCH_AREA', 'HelpIn is only available in Budapest for now.');
      }
      snapToArea(data.point, data.precision, data.kind); // throws for exact + request (L-02)
      const now = this.now();
      const id = this.id('p');
      const rec: ProblemRec = {
        id,
        incidentId: this.id('i'),
        askerId: uid,
        anonymous: data.anonymous,
        title: data.title.trim(),
        description: data.description.trim(),
        categoryId: data.categoryId,
        kind: data.kind,
        urgency: data.urgency,
        status: 'open',
        exact: data.point,
        precision: data.precision,
        locality: 'Near you',
        district: 'XI',
        languageNeeded: data.languageNeeded,
        createdAt: now,
        lastActivityAt: now,
        lastRaiserResponseAt: null,
        responseDueAt: null,
        photoCount: data.photoCount,
        affected: [],
        fixedVotes: [],
        updates: [],
        creditedHelperIds: [],
      };
      this.db.problems.push(rec);
      return this.presentDetail(rec);
    });
  }

  /** R-53: any raiser response resets the 48 h clock (personal problems only). */
  private raiserResponded(p: ProblemRec) {
    const now = this.now();
    p.lastRaiserResponseAt = now;
    p.lastActivityAt = now;
    if (p.kind === 'request' && p.responseDueAt !== null) p.responseDueAt = now + RESPONSE_RULE.windowHours * HOUR;
  }

  private requireAsker(p: ProblemRec) {
    if (p.askerId !== this.uid()) throw new ApiError('FORBIDDEN', 'Only the asker can do this.');
  }

  private requireOpen(p: ProblemRec) {
    if (p.status !== 'open') throw new ApiError('PROBLEM_NOT_OPEN', 'This problem has already closed.');
  }

  postUpdate(problemId: string, input: PostUpdateInput) {
    return this.run(() => {
      const uid = this.uid();
      const p = this.problem(problemId);
      this.requireOpen(p);
      const parsed = PostUpdateInputSchema.safeParse(input);
      if (!parsed.success) throw new ApiError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid update');
      const role = this.viewerRole(p, uid);
      const authorRole =
        role === 'asker' ? 'asker' : role === 'helper_accepted' || role === 'helper_offered' ? 'helper' : role === 'affected' ? 'affected' : null;
      if (!authorRole) throw new ApiError('FORBIDDEN', 'Offer help first to post updates.');
      if (authorRole === 'affected' && p.kind !== 'issue') throw new ApiError('FORBIDDEN', 'Not allowed.');
      p.updates.push({
        id: this.id('up'),
        authorId: uid,
        authorRole,
        progressStatus: parsed.data.progressStatus,
        body: parsed.data.body?.trim() || null,
        createdAt: this.now(),
      });
      if (authorRole === 'asker') this.raiserResponded(p);
      else p.lastActivityAt = this.now(); // R-56: helper updates keep the tab alive
      return this.presentDetail(p);
    });
  }

  stillNeedHelp(problemId: string) {
    return this.postUpdate(problemId, { progressStatus: 'still_need_help', body: null });
  }

  withdrawProblem(problemId: string, reason: string) {
    return this.run(() => {
      const p = this.problem(problemId);
      this.requireAsker(p);
      this.requireOpen(p);
      p.status = 'withdrawn';
      p.updates.push({ id: this.id('up'), authorId: p.askerId, authorRole: 'asker', progressStatus: 'note', body: `Withdrawn: ${reason}`, createdAt: this.now() });
      for (const o of this.db.offers) if (o.problemId === p.id && ['offered', 'accepted'].includes(o.status)) o.status = 'closed';
      return this.presentDetail(p);
    });
  }

  confirmSolved(problemId: string, creditedOfferIds: string[]) {
    return this.run(() => {
      const uid = this.uid();
      const p = this.problem(problemId);
      this.requireAsker(p);
      this.requireOpen(p);
      if (creditedOfferIds.length > KARMA.maxCreditedHelpers) {
        throw new ApiError('TOO_MANY_CREDITS', `Credit at most ${KARMA.maxCreditedHelpers} helpers.`);
      }
      const credited = creditedOfferIds.map((id) => {
        const o = this.offer(id);
        if (o.problemId !== p.id || !['offered', 'accepted'].includes(o.status)) {
          throw new ApiError('INVALID_CREDIT', 'That helper cannot be credited.');
        }
        return o;
      });
      const now = this.now();
      p.status = 'solved';
      p.lastActivityAt = now;
      p.creditedHelperIds = credited.map((o) => o.helperId);
      let anyAward = false;
      for (const o of this.db.offers.filter((x) => x.problemId === p.id)) {
        if (credited.includes(o)) {
          o.status = 'credited';
          const recentPair = this.db.karma.some(
            (k) => k.userId === o.helperId && k.sourceUserId === uid && k.reason === 'solve_award' && now - k.createdAt < KARMA.pairCooldownDays * DAY,
          );
          const amount = recentPair ? 0 : KARMA.solveAward; // K-05
          if (amount > 0) anyAward = true;
          const helper = this.user(o.helperId);
          helper.karma += amount;
          helper.neighboursHelped += 1;
          this.db.karma.push({ id: this.id('k'), userId: helper.id, sourceUserId: uid, amount, reason: recentPair ? 'pair_cooldown' : 'solve_award', label: `Helped with "${p.title}"`, createdAt: now });
          this.notify({ userId: helper.id, type: 'karma', title: amount ? `+${amount} karma` : 'Thanks recorded', body: `${this.user(uid).displayName} confirmed you helped with "${p.title}"`, link: `/p/${p.id}`, problemId: p.id });
          if (o.conversationId) this.db.messages.push({ id: this.id('m'), conversationId: o.conversationId, senderId: null, type: 'system', body: 'Marked as solved. Thank you!', location: null, createdAt: now });
        } else if (['offered', 'accepted'].includes(o.status)) {
          o.status = 'closed';
        }
      }
      // K-11: small closing award, capped per week, only when a helper earned karma.
      let askerAward = 0;
      const weekAwards = this.db.karma.filter((k) => k.userId === uid && k.reason === 'closing_award' && now - k.createdAt < 7 * DAY).length;
      if (anyAward && weekAwards < KARMA.closingAwardWeeklyCap) {
        askerAward = KARMA.closingAward;
        this.user(uid).karma += askerAward;
        this.db.karma.push({ id: this.id('k'), userId: uid, amount: askerAward, reason: 'closing_award', label: `Closed "${p.title}"`, createdAt: now });
      }
      return { problem: this.presentDetail(p), credited: credited.length, askerAward };
    });
  }

  markSameHere(problemId: string, on: boolean) {
    return this.run(() => {
      const uid = this.uid();
      const p = this.problem(problemId);
      this.requireOpen(p);
      if (p.kind !== 'issue') throw new ApiError('NOT_AN_ISSUE', '"Same here" is for community problems.');
      if (p.askerId === uid) throw new ApiError('FORBIDDEN', 'You reported this one.');
      p.affected = p.affected.filter((x) => x !== uid);
      if (on) p.affected.push(uid);
      return this.presentDetail(p);
    });
  }

  /** R-21: three "Fixed now" votes from affected neighbours solve a community problem. */
  fixedNow(problemId: string) {
    return this.run(() => {
      const uid = this.uid();
      const p = this.problem(problemId);
      this.requireOpen(p);
      if (!p.affected.includes(uid)) throw new ApiError('FORBIDDEN', 'Only affected neighbours can confirm a fix.');
      if (!p.fixedVotes.includes(uid)) p.fixedVotes.push(uid);
      if (p.fixedVotes.length >= FIXED_QUORUM) {
        p.status = 'solved';
        for (const o of this.db.offers) if (o.problemId === p.id && ['offered', 'accepted'].includes(o.status)) o.status = 'closed';
      }
      return this.presentDetail(p);
    });
  }

  // ---------------------------------------------------------------- help offers

  offerHelp(problemId: string, message: string | null) {
    return this.run(() => {
      const uid = this.uid();
      const p = this.problem(problemId);
      this.requireOpen(p);
      if (p.askerId === uid) throw new ApiError('OWN_PROBLEM', "You can't offer help on your own problem."); // R-10
      if (message && message.length > LIMITS.offerMessage) throw new ApiError('VALIDATION', 'Message is too long.');
      const existing = this.db.offers.find((o) => o.problemId === p.id && o.helperId === uid);
      if (existing?.status === 'declined') throw new ApiError('OFFER_DECLINED', 'The asker declined your offer for this problem.');
      if (existing && existing.status !== 'withdrawn') throw new ApiError('OFFER_EXISTS', "You've already offered to help.");
      const now = this.now();
      if (existing) Object.assign(existing, { status: 'offered', message, createdAt: now }); // R-11 reuse
      else this.db.offers.push({ id: this.id('o'), problemId: p.id, helperId: uid, message, status: 'offered', createdAt: now, claimedSolved: false, conversationId: null });
      // R-52: the asker's 48 h clock starts with the first offer (personal problems only).
      if (p.kind === 'request' && p.responseDueAt === null) p.responseDueAt = now + RESPONSE_RULE.windowHours * HOUR;
      p.lastActivityAt = now;
      this.notify({ userId: p.askerId, type: 'offer_received', title: `${this.user(uid).displayName} can help with "${p.title}"`, body: message ?? 'Tap to see the offer', link: `/p/${p.id}`, problemId: p.id });
      return this.presentDetail(p);
    });
  }

  withdrawOffer(offerId: string) {
    return this.run(() => {
      const o = this.offer(offerId);
      if (o.helperId !== this.uid()) throw new ApiError('FORBIDDEN', 'Not your offer.');
      if (!['offered', 'accepted'].includes(o.status)) throw new ApiError('INVALID_STATE', 'This offer can no longer be withdrawn.');
      o.status = 'withdrawn';
      return this.presentDetail(this.problem(o.problemId));
    });
  }

  acceptOffer(offerId: string) {
    return this.run(() => {
      const o = this.offer(offerId);
      const p = this.problem(o.problemId);
      this.requireAsker(p);
      this.requireOpen(p);
      if (o.status !== 'offered') throw new ApiError('INVALID_STATE', 'This offer can no longer be accepted.');
      o.status = 'accepted';
      const conversationId = this.id('c'); // R-13 / C-02
      o.conversationId = conversationId;
      this.db.conversations.push({ id: conversationId, problemId: p.id, askerId: p.askerId, helperId: o.helperId, readOnly: false });
      const now = this.now();
      this.db.messages.push({ id: this.id('m'), conversationId, senderId: null, type: 'system', body: `${this.user(p.askerId).displayName} accepted ${this.user(o.helperId).displayName}'s offer to help`, location: null, createdAt: now });
      if (o.message) this.db.messages.push({ id: this.id('m'), conversationId, senderId: o.helperId, type: 'text', body: o.message, location: null, createdAt: now + 1 });
      this.raiserResponded(p);
      this.notify({ userId: o.helperId, type: 'offer_accepted', title: `${p.anonymous ? 'The asker' : this.user(p.askerId).displayName} accepted your help`, body: p.title, link: `/chat/${conversationId}`, problemId: p.id });
      return { problem: this.presentDetail(p), conversationId };
    });
  }

  declineOffer(offerId: string) {
    return this.run(() => {
      const o = this.offer(offerId);
      const p = this.problem(o.problemId);
      this.requireAsker(p);
      if (o.status !== 'offered') throw new ApiError('INVALID_STATE', 'This offer can no longer be declined.');
      o.status = 'declined';
      this.raiserResponded(p);
      return this.presentDetail(p);
    });
  }

  claimSolved(offerId: string) {
    return this.run(() => {
      const o = this.offer(offerId);
      const p = this.problem(o.problemId);
      if (o.helperId !== this.uid() || o.status !== 'accepted') throw new ApiError('FORBIDDEN', 'Only an accepted helper can do this.');
      this.requireOpen(p);
      o.claimedSolved = true;
      this.notify({ userId: p.askerId, type: 'solve_claimed', title: `${this.user(o.helperId).displayName} thinks your problem is solved`, body: p.title, link: `/p/${p.id}`, problemId: p.id });
      return this.presentDetail(p);
    });
  }

  // ---------------------------------------------------------------- chat

  private presentConversation(c: MockDb['conversations'][number]): Conversation {
    const uid = this.uid();
    const p = this.problem(c.problemId);
    const viewerIsAsker = c.askerId === uid;
    const msgs = this.db.messages.filter((m) => m.conversationId === c.id).sort((a, b) => a.createdAt - b.createdAt);
    const last = msgs[msgs.length - 1];
    let unread = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.senderId === uid) break;
      if (m.senderId) unread++;
    }
    const other: Asker = viewerIsAsker
      ? { anonymous: false, user: this.presentUser(this.user(c.helperId)) }
      : this.presentAsker(p);
    const summary = !last ? null : last.type === 'image' ? 'Photo' : last.type === 'location' ? 'Shared a location' : last.body;
    return {
      id: c.id,
      problemId: p.id,
      problemTitle: p.title,
      other,
      lastMessage: summary,
      lastAt: this.iso(last?.createdAt ?? p.createdAt),
      unread,
      readOnly: c.readOnly || (p.status !== 'open' && this.now() - p.lastActivityAt > 48 * HOUR),
      viewerIsAsker,
    };
  }

  private conversation(id: string) {
    const c = this.db.conversations.find((x) => x.id === id);
    const uid = this.uid();
    if (!c || (c.askerId !== uid && c.helperId !== uid)) throw new ApiError('NOT_FOUND', 'Conversation not found.');
    return c;
  }

  listConversations() {
    return this.run(() => {
      const uid = this.uid();
      return this.db.conversations
        .filter((c) => c.askerId === uid || c.helperId === uid)
        .map((c) => this.presentConversation(c))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    });
  }

  getConversation(conversationId: string) {
    return this.run(() => {
      const c = this.conversation(conversationId);
      const messages: Message[] = this.db.messages
        .filter((m) => m.conversationId === c.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => ({ id: m.id, conversationId: m.conversationId, senderId: m.senderId, type: m.type, body: m.body, location: m.location, createdAt: this.iso(m.createdAt) }));
      return { conversation: this.presentConversation(c), messages };
    });
  }

  sendMessage(conversationId: string, body: string) {
    return this.run((): Message => {
      const uid = this.uid();
      const c = this.conversation(conversationId);
      const text = body.trim();
      if (!text) throw new ApiError('VALIDATION', 'Message is empty.');
      if (text.length > LIMITS.message) throw new ApiError('VALIDATION', 'Message is too long.');
      if (this.presentConversation(c).readOnly) throw new ApiError('CHAT_READ_ONLY', 'This chat is closed.');
      const now = this.now();
      const m = { id: this.id('m'), conversationId: c.id, senderId: uid, type: 'text' as const, body: text, location: null, createdAt: now };
      this.db.messages.push(m);
      const p = this.problem(c.problemId);
      if (uid === p.askerId) this.raiserResponded(p); // R-53: chat replies count
      return { ...m, createdAt: this.iso(now) };
    });
  }

  /** L-04: only the asker can share the exact point, only inside the conversation. */
  shareLocation(conversationId: string) {
    return this.run((): Message => {
      const c = this.conversation(conversationId);
      const p = this.problem(c.problemId);
      this.requireAsker(p);
      const now = this.now();
      const m = { id: this.id('m'), conversationId: c.id, senderId: p.askerId, type: 'location' as const, body: 'Exact location', location: p.exact, createdAt: now };
      this.db.messages.push(m);
      this.raiserResponded(p);
      return { ...m, createdAt: this.iso(now) };
    });
  }

  // ---------------------------------------------------------------- social

  private presentPost(r: MockDb['posts'][number]): Post {
    const uid = this.currentUserId;
    const author = this.user(r.authorId);
    const community = r.communityId ? this.db.communities.find((c) => c.id === r.communityId) : undefined;
    const problem = r.problemId ? this.db.problems.find((p) => p.id === r.problemId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      author: { anonymous: false, user: this.presentUser(author) },
      community: community ? { id: community.id, name: community.name } : null,
      caption: r.caption,
      image: r.image,
      createdAt: this.iso(r.createdAt),
      likes: r.baseLikes + r.likedBy.length,
      liked: uid ? r.likedBy.includes(uid) : false,
      comments: r.comments,
      problem: problem ? { id: problem.id, title: problem.title } : null,
      thanked: r.thankedIds.map((id) => this.user(id).displayName),
      district: r.district,
    };
  }

  getFeed() {
    return this.run(() => [...this.db.posts].sort((a, b) => b.createdAt - a.createdAt).map((r) => this.presentPost(r)));
  }

  myPosts() {
    return this.run(() => {
      const uid = this.uid();
      return this.db.posts.filter((p) => p.authorId === uid).sort((a, b) => b.createdAt - a.createdAt).map((r) => this.presentPost(r));
    });
  }

  toggleLike(postId: string) {
    return this.run(() => {
      const uid = this.uid();
      const r = this.db.posts.find((p) => p.id === postId);
      if (!r) throw new ApiError('NOT_FOUND', 'Post not found.');
      r.likedBy = r.likedBy.includes(uid) ? r.likedBy.filter((x) => x !== uid) : [...r.likedBy, uid];
      return this.presentPost(r);
    });
  }

  private presentCommunity(c: MockDb['communities'][number]): Community {
    const uid = this.currentUserId;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description,
      memberCount: c.baseMembers + c.members.length,
      joined: uid ? c.members.includes(uid) : false,
      newPosts: c.newPosts,
      color: c.color,
    };
  }

  listCommunities() {
    return this.run(() => this.db.communities.map((c) => this.presentCommunity(c)));
  }

  toggleJoin(communityId: string) {
    return this.run(() => {
      const uid = this.uid();
      const c = this.db.communities.find((x) => x.id === communityId);
      if (!c) throw new ApiError('NOT_FOUND', 'Community not found.');
      c.members = c.members.includes(uid) ? c.members.filter((x) => x !== uid) : [...c.members, uid];
      return this.presentCommunity(c);
    });
  }

  // ---------------------------------------------------------------- notifications

  listNotifications() {
    return this.run((): AppNotification[] => {
      const uid = this.uid();
      return this.db.notifications
        .filter((n) => n.userId === uid)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, createdAt: this.iso(n.createdAt), read: n.read, link: n.link, problemId: n.problemId }));
    });
  }

  markAllRead() {
    return this.run(() => {
      const uid = this.uid();
      for (const n of this.db.notifications) if (n.userId === uid) n.read = true;
    });
  }
}
