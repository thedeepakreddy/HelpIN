# 05 — Decisions & Open Questions

> Architecture Decision Records (ADRs): what we chose, what we rejected, and why. When you change
> a decision, add a new ADR that supersedes the old one rather than editing history.

---

## 1. Decision log

### ADR-001 · Mobile framework: Expo (React Native + TypeScript)
- **Status:** Accepted
- **Options:** Expo/React Native · Flutter · native Kotlin + Swift
- **Decision:** Expo.
- **Why:** one language (TypeScript) across app, API and shared packages (`contracts`, `domain`,
  `geo`); EAS Build/Update gives store builds and over-the-air JS fixes without a Mac-heavy
  workflow; mature libraries for maps, push, image picking; excellent AI-assistant fluency.
- **Trade-off:** slightly less native polish than Flutter or native. Irrelevant for this UI.

### ADR-002 · Backend shape: TypeScript modular monolith on managed Supabase
- **Status:** Accepted
- **Options:**
  1. *Pure Supabase*: client writes via PostgREST + RLS, logic in SQL functions / Edge Functions
  2. *Firebase*: Firestore + Cloud Functions
  3. **Modular monolith API (Fastify) + Supabase for Postgres/Auth/Storage/Realtime**
  4. Microservices
- **Decision:** Option 3.
- **Why:** the core loop is a set of **multi-row transactional state transitions** (solve →
  credit → ledger → events) with anti-abuse rules. That logic belongs in testable TypeScript (pure
  `domain` package) inside real SQL transactions, not scattered across RLS policies or a document
  store without joins. Supabase still removes the undifferentiated work (auth, OTP, storage,
  realtime, backups). Microservices would be pure overhead for a small team.
- **Trade-off:** we run one small service ourselves (API + worker). Clients can't use Supabase's
  auto-generated API, which is deliberate (privacy by structure).
- **Exit path:** it's all standard Postgres + Node. Supabase can be replaced piecewise (any
  Postgres host, S3, any OIDC auth) without touching domain code.

### ADR-003 · Location: H3 hexagon snapping; no PostGIS in the MVP
- **Status:** Accepted
- **Options:** random jitter · geohash · **H3** · PostGIS radius queries on exact points
- **Decision:** H3 cells (res 8 default, 7 wider, 9 issues-only). Exact points in a separate
  private table. Spatial queries are B-tree lookups on cell IDs.
- **Why:** deterministic snapping can't be averaged away the way jitter can (Domain §5.1);
  hexagons have uniform neighbours (clean "rings" for notifications); one mechanism serves
  privacy, map queries, notifications, feed areas and launch areas. Dropping PostGIS keeps the
  DB portable and simple.
- **Trade-off:** no arbitrary-polygon queries yet. Add PostGIS when a feature needs it.

### ADR-004 · Karma as an append-only ledger
- **Status:** Accepted
- **Decision:** `karma_entries` is insert-only. Balances are cached and rebuildable. Reversals are
  compensating entries.
- **Why:** full auditability for anti-fraud, safe reversals, and a complete history for future
  reputation algorithms. Zero-amount entries record "helped, but no points" cases (cooldowns),
  so solver history stays complete.

### ADR-005 · Incidents exist from day one
- **Status:** Accepted
- **Decision:** every problem belongs to an incident (1:1 by default). "Same here" attaches users
  to an incident without creating problems. The map renders incidents.
- **Why:** AI clustering later becomes "merge incidents" (a background job), not a data
  migration. Manual "same here" taps are labelled training data.

### ADR-006 · Async work via a Postgres transactional outbox (no Redis/queue service)
- **Status:** Accepted
- **Decision:** events are written in the command's transaction and drained by the worker with
  `FOR UPDATE SKIP LOCKED`. Consumers are idempotent.
- **Why:** guarantees "event exists iff state changed", with one fewer system to run. Postgres
  easily handles MVP volumes.
- **Revisit when:** sustained > ~50 events/s or a need for fan-out to many independent services.

### ADR-007 · Chat is problem-scoped only; Realtime is a hint
- **Status:** Accepted
- **Decision:** conversations require a problem and are opened by accepting an offer. There are no
  open DMs. Messages are written through the API; Supabase Realtime broadcast notifies clients,
  and clients heal gaps by refetching.
- **Why:** removes most harassment vectors (Theory §7), keeps chat tied to closure, and the API
  stays the single source of truth.

### ADR-008 · `help_offers` replaces `solutions` + `problem_helpers`
- **Status:** Accepted
- **Why:** one helper's involvement in one problem is one relationship with one lifecycle (offer
  → accept → credit). Splitting it into two tables invites contradictory states.

### ADR-009 · Maps: `react-native-maps` with Google (Android) / Apple (iOS)
- **Status:** Accepted (revisit if map styling or cost becomes an issue)
- **Options:** react-native-maps · Mapbox · MapLibre + OSM tiles
- **Why:** zero-config in Expo, native map SDK loads are free, and familiar maps for users.
  Hexagons are plain polygons and work on any provider. Reverse geocoding is cached per H3 cell
  to keep API costs negligible.
- **Alternative kept open:** MapLibre if we need custom styling or want to avoid Google
  dependency. The map component is isolated behind `MapView` in the app.

### ADR-010 · Auth: phone OTP + Google/Apple sign-in
- **Status:** Proposed (see open question Q4)
- **Why:** phone numbers are the strongest cheap anti-sockpuppet signal (one account per number)
  and the norm for local apps ⚑. Social sign-in reduces signup friction. Apple sign-in is required
  on iOS if other social logins are offered. Phone verification is mandatory to earn karma or post
  `serious` problems.
- **Risk ⚑:** Indian SMS delivery requires DLT template registration through the SMS provider. Start
  that process early, because it takes time.

### ADR-011 · Feed: local, chronological, feature-flagged, after the core loop
- **Status:** Accepted
- **Why:** protects the core product rule ("problems first") while still giving a daily habit.
  The flag allows launching an area without the feed if it distracts.

### ADR-012 · Shared contracts with zod
- **Status:** Accepted
- **Decision:** every API request/response is a zod schema in `packages/contracts`, used by the
  API for validation, by the app for forms/parsing, and by tests for the privacy check.
- **Why:** one definition, so client/server drift and accidental field leaks (exact location)
  become type and test failures.

### ADR-013 · Progress updates on every problem
- **Status:** Accepted (founder request)
- **Decision:** each problem has a public timeline of `problem_updates` (status + text + up to 3
  photos), with the latest asker update pinned on the tab and summarised on the map card. On
  issues, affected users and helpers can post too. This replaces the earlier issue-only
  `incident_updates`.
- **Why:** helpers need the *current* need, not the original description. One timeline for both
  kinds is simpler than two mechanisms.

### ADR-014 · Raiser response rule with silence penalty
- **Status:** Accepted (founder decisions Q11–Q13)
- **Decision:** for **personal** problems only, a 48 h response clock starts at the first help
  offer. Any raiser response resets it (accept/decline, chat reply, progress update, "Still need
  help", confirm). 48 h of silence → −5 karma (escalating), once per problem. Helper updates keep
  the problem on the map; if nobody is active for 48 h it's `abandoned` and removed. **Community
  problems never get penalties** and are never removed for silence. Withdraw is always free. This
  replaces fixed TTL + manual "extend", and the earlier steward-handover idea (no longer needed,
  because community problems aren't removed for silence).
- **Why:** keeps the map live, protects helpers' time, and gives askers a reason to confirm
  solved (the top risk to the core loop).
- **Trade-off:** a penalty can feel harsh and might discourage posting. Mitigations are
  reminders, one-tap answers, grace, free withdraw, a small first penalty, moderator voiding, and
  tracking abandonment rate and posting rate as guardrail metrics.
- **Note:** this is a *system* penalty. Users still can't give each other negative karma
  (anti-retaliation, Theory §6).

### ADR-015 · Open category catalogue in groups
- **Status:** Accepted (founder request)
- **Decision:** people can post any local problem. Categories are grouped (People · Environment ·
  Roads & public spaces · Utilities · Safety · Other), config-driven, and each sets a default kind
  and urgency.
- **Why:** HelpIN covers human, environmental (dirty areas, rivers, ponds, parks) and
  infrastructure problems. Grouping keeps the create flow to two taps.

---

## 2. Open questions for the founder

These change the plan. Everything else has a sensible default already chosen above.

| # | Question | Default if unanswered | Why it matters |
|---|---|---|---|
| **Q1** | **Launch market and the first launch area?** (a specific society, campus, or neighbourhood) | India; one dense neighbourhood or large gated community | Density strategy, SMS/DLT, emergency number, legal (DPDP), language |
| **Q2** | **Android-first beta, or both platforms from day one?** | Android-first closed beta, iOS at public launch (Expo builds both, so this is about testing effort and the Apple review timeline) | Beta speed |
| **Q3** | **Anonymous posting for sensitive problems?** (e.g. safety concerns) | No anonymity in MVP: display name shown | Safety vs. abuse; anonymity sharply increases moderation load |
| **Q4** | **Is phone OTP mandatory at signup**, or Google/Apple first with phone needed only to earn karma? | Google/Apple or phone to sign up; phone required to earn karma / post serious | Signup conversion vs. sockpuppet resistance |
| **Q5** | **Should askers get a little karma for confirming?** | No (K-11), measure confirmation rate first | Confirmation rate vs. farming risk |
| **Q6** | **Feed in the first beta, or only after the loop is proven?** | Built in Phase 5, flag **off** in the first beta, on once liquidity holds | Focus |
| **Q7** | **Launch language(s)?** | English UI, i18n-ready; add Hindi/regional next | Reach in the launch area |
| **Q8** | **Brand spelling:** "HelpIN", "Helpin", or "HelpIn"? | "HelpIN" in docs (repo name) | Store listing, logo, copy |
| **Q9** | **Team & budget:** solo founder + AI assistant? Any designer? | Solo + AI; design from a simple token system | Phase sizing, design-system effort |
| **Q10** | **Moderation staffing:** who reviews reports in the beta? | Founder, with a 24 h SLA, and 2 h for `serious` | Safety promises we can actually keep |
| ~~Q11~~ | ✅ **Answered:** the timer starts once people start helping. If the raiser doesn't respond for 2 days, the penalty applies. | → R-51…R-55 | |
| ~~Q12~~ | ✅ **Answered:** penalties apply only to personal problems. Community problems never get penalties. (Steward handover dropped as no longer needed.) | → R-50, R-58, K-12 | |
| ~~Q13~~ | ✅ **Answered:** if helpers keep updating, the problem stays alive (the raiser's penalty still applies if they ignore helpers). | → R-42, R-56 | |
