# 05 — Decisions & Open Questions

> Architecture Decision Records (ADRs): what we chose, what we rejected, and why. When you change
> a decision, add a new ADR that supersedes the old one rather than editing history.

---

## 1. Decision log

### ADR-001 · Mobile framework: Expo (React Native + TypeScript)
- **Status:** Superseded by ADR-016 (web app first). Expo stays the likely choice for the later native apps.
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
- **Status:** Superseded by ADR-017 (MapLibre on the web)
- **Options:** react-native-maps · Mapbox · MapLibre + OSM tiles
- **Why:** zero-config in Expo, native map SDK loads are free, and familiar maps for users.
  Hexagons are plain polygons and work on any provider. Reverse geocoding is cached per H3 cell
  to keep API costs negligible.
- **Alternative kept open:** MapLibre if we need custom styling or want to avoid Google
  dependency. The map component is isolated behind `MapView` in the app.

### ADR-010 · Auth: phone OTP + Google/Apple sign-in
- **Status:** Superseded by ADR-018 (the India-specific notes below no longer apply)
- **Why:** phone numbers are the strongest cheap anti-sockpuppet signal (one account per number)
  and the norm for local apps ⚑. Social sign-in reduces signup friction. Apple sign-in is required
  on iOS if other social logins are offered. Phone verification is mandatory to earn karma or post
  `serious` problems.
- **Risk ⚑:** Indian SMS delivery requires DLT template registration through the SMS provider. Start
  that process early, because it takes time.

### ADR-011 · Feed: local, chronological, feature-flagged, after the core loop
- **Status:** Accepted; amended by founder decision Q6: the feed is **on** in the first beta
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
- **Decision:** people can post any local problem. Categories are grouped (Everyday help · Newcomers & language · Environment ·
  Roads & public spaces · Utilities · Safety · Other), config-driven, and each sets a default kind
  and urgency.
- **Why:** HelpIn covers human, environmental (dirty areas, rivers, ponds, parks) and
  infrastructure problems. Grouping keeps the create flow to two taps.

### ADR-016 · Web app first (React + Vite PWA); native apps later
- **Status:** Accepted (founder decision Q2)
- **Options:** Next.js · Expo for web (React Native Web) · **React + Vite single-page PWA**
- **Decision:** a React + Vite PWA, installable to the Home Screen. Native apps are planned after
  the web launch (Roadmap Phase 8).
- **Why:** everything is behind login, so server rendering/SEO adds nothing; the API already
  exists as its own service (Next.js would add a second server); a static site is cheap and
  instant to roll back; React + Vite gives the best web quality, especially for the map. The
  shared packages (`contracts`, `domain`, `geo`, `config`, `api-client`) carry over to the native
  apps unchanged.
- **Trade-off:** on iPhone, Web Push only works once the PWA is added to the Home Screen.
  Mitigated by a guided install step, email fallback, and native apps next.

### ADR-017 · Maps on the web: MapLibre GL JS + vector tiles
- **Status:** Accepted
- **Options:** Google Maps JavaScript API · Mapbox GL JS · **MapLibre GL JS** with a tile provider
- **Why:** open source with no per-map-load licence fee or lock-in. The tile provider (e.g.
  MapTiler, later self-hosted Protomaps) can be swapped without code changes. Hexagons are native
  fill layers. Reverse geocoding is cached per H3 cell, so its cost stays negligible.

### ADR-018 · Auth: sign up with phone or email; phone verification mandatory
- **Status:** Accepted (founder decision Q4). Supersedes ADR-010.
- **Decision:** users sign up and log in with **phone (SMS code) or email (email code)**. Every
  account **must verify a phone number** during onboarding, and a phone number can only belong
  to one account.
- **Why:** email signup lowers friction. Mandatory phone verification is the strongest cheap
  protection against fake accounts and karma farming, which matters even more now that anonymous
  posting is allowed.
- **Risks:** SMS cost and SMS-pumping fraud. Mitigated by a CAPTCHA before any SMS is sent,
  per-IP/number/country limits, EU numbers only at launch, and alerts on send spikes.

### ADR-019 · EU hosting and compliance built in (Budapest launch)
- **Status:** Accepted (founder decision Q1)
- **Decision:** all personal data is stored and processed in the EU (Supabase Frankfurt, EU
  hosting region, EU-region analytics/error tracking, DPAs with every processor). GDPR rights
  (export, delete) and DSA mechanisms (reporting, statement of reasons, appeals) are product
  features, not afterthoughts.
- **Why:** required by law for an EU launch, and cheaper to build in from day one than to
  retrofit.

### ADR-020 · Accountable anonymous posting
- **Status:** Accepted (founder decision Q3)
- **Decision:** problems can be posted anonymously. The asker is hidden from the public (and
  from helpers unless they choose to reveal themselves), but always known to HelpIn. Every rule
  still applies, and fake problems cost −20 karma and the anonymous-posting privilege
  (Domain §12).
- **Why:** lets people post sensitive or personal problems without exposing themselves, without
  creating an unaccountable channel for fake problems or abuse.

### ADR-021 · Askers earn a small closing award
- **Status:** Accepted (founder decision Q5). Replaces the original K-11 ("askers earn nothing").
- **Decision:** +2 karma to the asker for confirming solved with at least one credited helper
  whose award was non-zero; max 5 per 7 days.
- **Why:** rewards closing the loop. The conditions and cap make fake problems unprofitable,
  because a colluding pair is already zeroed by the pair rules (K-05/K-06), which also zeroes the
  asker's award.

### ADR-022 · Brand and language
- **Status:** Accepted (founder decisions Q7, Q8)
- **Decision:** the brand is spelled **HelpIn**. The UI launches in **English**, with every string
  an i18n key so Hungarian can be added next.

### ADR-023 · Moderation by the founder as sole admin (until funding)
- **Status:** Accepted (founder decision Q10)
- **Decision:** the founder is the only admin/moderator until HelpIn is funded and has a team and
  a company. The admin account is bootstrapped from a private server setting
  (`ADMIN_EMAILS` secret), **not** written in the repository.
- **Safeguards for a one-person moderation team:**
  - **Two-factor authentication required** on the admin account, because it can see the authors
    of anonymous problems.
  - Report targets: review within **24 h**, and within **2 h** for Serious problems. Serious
    reports trigger an immediate push/email to the admin.
  - **Auto-hide after 3 reports** (S-05) protects users when the admin is offline.
  - Every admin action is logged (S-06), which matters when one person holds all the power.
  - When volunteers or staff join later, they get the `moderator` role (no code changes).

### ADR-024 · City-wide launch across all of Budapest
- **Status:** Accepted (founder decision Q14). Replaces the "one district first" recommendation.
- **Decision:** HelpIn opens in **all 23 districts of Budapest** at once. The launch area
  `budapest` is the set of all res-7 cells covering the city, each tagged with its district.
- **Risk (Theory §4):** helpers spread thin across a whole city means many problems get no offer,
  which is the most common way hyperlocal apps fail.
- **How the plan adapts, "one city, many small networks":**
  1. **Liquidity is measured per district**, not just city-wide (`metrics_liquidity_by_district`).
  2. **Seed hubs:** founding-helper recruitment and launch marketing concentrate on a few dense
     hubs first (university areas in XI, VIII–IX; dense inner districts V–VII, XIII), then spread.
  3. **Wider alerts where it's sparse:** if a problem has few eligible helpers nearby, the second
     notification wave reaches users who allow a wider alert radius (ring 2, ~4 km).
  4. **Honest empty states** per district, with an "invite neighbours" prompt.
  5. **District leaderboard of solved problems** (later) to create friendly local pride.

### ADR-025 · Legal operator: the founder as an individual (until full release)
- **Status:** Accepted (founder decision Q15)
- **Decision:** until the full release, the founder operates HelpIn as an individual and is named
  as the data controller (GDPR), in the imprint, and as the DSA contact.
- **Recommendations:** use a **dedicated contact address** (e.g. on HelpIn's own domain) rather
  than a personal inbox for the public imprint and DSA contact. Get a lawyer to confirm the
  obligations of an individual operator in Hungary. When a company is founded, it takes over as
  controller and users are informed (privacy notice update).

### ADR-026 · Positioning: a social platform for mutual help, not a gig marketplace
- **Status:** Accepted (founder direction)
- **Decision:** HelpIn is a social platform where **locals, newcomers/immigrants and
  communities** help one another for free. It is not a task or jobs marketplace. Help is free by
  rule (CAT-06): no prices, paid work, jobs, selling, renting or ads.
- **Consequences:** a **Newcomers & language** category group; languages on profiles; communities;
  thank-you posts; scam protection; examples and copy always show mutual help (a letter
  translated, a pond cleaned), never errands-for-hire. The bottom tab "Feed" becomes
  **"Community"** (feed + communities).

### ADR-027 · Languages as a bridge
- **Status:** Accepted
- **Decision:** profiles list languages spoken; problems can name the language help needed;
  "Speaks your language" badges; language-based alerts. Machine translation (EU-hosted) comes
  after launch (LANG-05).
- **Why:** the language barrier is the biggest wall between newcomers and locals in Budapest. An
  English-only UI plus language matching works for launch; Hungarian UI and translation follow.

### ADR-028 · Communities and thank-you posts in the first release
- **Status:** Accepted
- **Decision:** communities (district, language & culture, students, civic, interest) with a
  feed, a Welcome thread and shared problems, created by the admin during the beta.
  **Membership is private by default** (GDPR special-category risk). Thank-you posts tag helpers
  only after they approve.
- **Why:** communities give newcomers an obvious first step and give existing groups a reason to
  move their mutual help onto HelpIn. Thank-you posts make helping visible and social.

---

## 2. Open questions for the founder

### Answered

| # | Question | Decision | Where it's applied |
|---|---|---|---|
| Q1 | Launch market | **Budapest, Hungary** | ADR-019, Theory §4, Architecture §13 |
| Q2 | Platforms | **Web app first**, native apps planned later | ADR-016, Roadmap Phase 8 |
| Q3 | Anonymous posting | **Yes**, following the community guidelines (no fake problems) | ADR-020, Domain §12 |
| Q4 | Signup & phone | Sign up with **phone or email**; **phone verification mandatory** | ADR-018 |
| Q5 | Asker karma | **Yes**, a little karma for closing a solved problem (+2) | ADR-021, K-11 |
| Q6 | Feed in first beta | **Yes** | ADR-011, Roadmap Phase 5 |
| Q7 | Launch language | **English** (Hungarian next) | ADR-022 |
| Q8 | Brand spelling | **HelpIn** | ADR-022 |
| Q9 | Team & budget | **Decide later** | — |
| Q11 | Response timer | Starts when people start helping; 2 days of raiser silence → penalty | R-51…R-55 |
| Q12 | Which problems get penalties | Only personal problems; community problems never | R-50, R-58, K-12 |
| Q13 | Helpers' updates | If helpers keep updating, the problem stays alive | R-42, R-56 |
| Q10 | Who reviews reports | **The founder, as sole admin**, until funding, a team and a company exist | ADR-023 |
| Q14 | First launch area | **All of Budapest** | ADR-024 |
| Q15 | Legal operator | **The founder as an individual**, until the full release | ADR-025 |

### Still open

**None. The plan is complete.** Team & budget (Q9) is deliberately deferred.
