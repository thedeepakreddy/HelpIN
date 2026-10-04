# HelpIN — MVP Product & Build Plan (v2)

> The complete plan in one document. It follows the structure of the original MVP plan, with every
> improvement built in. Each section links to the detailed doc behind it.
>
> **Status: planning.** Nothing gets built until this plan is agreed.

---

## 0. What's new in v2

### The 7 strengthenings

| # | Strengthening | What it means | Where |
|---|---|---|---|
| 1 | **Push notifications are the engine** | Nearby helpers get a targeted, rate-limited alert when a problem is posted ("Someone ~400 m away needs a hand"). People don't open maps spontaneously, so without this the map stays empty. | §6, [03 §8](03-architecture.md#8-notifications) |
| 2 | **Cold-start / launch strategy** | Launch in one dense area (society, campus, neighbourhood); recruit 20–50 founding helpers first; expand only when ≥ 60% of problems get a help offer within 2 h. | §13, [01 §4](01-product-theory.md#4-the-hardest-problem-local-liquidity-cold-start) |
| 3 | **Requests vs issues** | *Requests* (a neighbour can solve it, the asker confirms) vs *issues* (shared/civic/environmental, many affected, "Same here", solved by the reporter or when 3 affected users confirm it's fixed). | §2, [01 §5](01-product-theory.md#5-not-all-problems-are-the-same-a-taxonomy) |
| 4 | **Incidents from day one + manual "Same here"** | Every problem belongs to an incident. Users group duplicates with "Same here" now, and AI does it later as a background job with no redesign. Every tap is training data. | §8, [02 §4.5](02-domain-model.md#45-incident) |
| 5 | **Privacy by structure** | Public location is a fixed hexagon area (~0.7 km²), never a pin. The exact point is in a separate private table, shared only by the asker in chat, and deleted after closure. Photo GPS/EXIF data is stripped. | §11, [02 §5](02-domain-model.md#5-location-privacy-model) |
| 6 | **Karma that can't be cheated** | Append-only ledger; only confirmed outcomes earn; limits on the same pair crediting each other; phone-verified accounts only; "neighbours helped" shown as the honest trust signal. | §7, [02 §6](02-domain-model.md#6-karma-rules) |
| 7 | **Chat and safety moved earlier** | Chat is part of the help loop (Phase 3, not 6). Report/block ships with every feature, not Phase 8, and app stores require it. | §14, [04](04-mvp-roadmap.md) |

### New in v2 (founder additions)

| Addition | Summary | Where |
|---|---|---|
| **Progress updates** | The asker posts updates on the problem's tab (status + text + photos) so helpers know exactly what's still needed. The latest update is pinned. | §5, [02 §4.6](02-domain-model.md#46-progress-updates-the-problem-tabs-timeline) |
| **Stay active or lose it** | The asker must keep the problem updated. If they go silent past the deadline and a grace period, the tab is **automatically removed** and they **get negative karma points**. | §5, [02 §4.7](02-domain-model.md#47-asker-activity-rule-check-ins--abandonment) |
| **Any problem can be posted** | People problems, environment (dirty areas, local rivers, lakes, ponds, parks, trees, pollution), roads and public spaces, utilities, safety, and anything else. | §2, [02 §11](02-domain-model.md#11-category-catalogue-any-problem-can-be-posted) |

---

## 1. Core idea

A hyperlocal app where people post **any real-world local problem** in an approximate area,
nearby users offer help, the asker keeps the problem updated, and when it's solved the asker
confirms it. The problem closes automatically and successful helpers earn karma.

**Core loop:** see a nearby problem → I can help → talk → solve → asker confirms → helper earns
reputation.

HelpIN is a **status system**, not a conversation system. Every problem has a location, a live
status, a progress timeline and an ending. Group chats have none of these.
→ [01 — Product Theory](01-product-theory.md)

---

## 2. What can be posted

Anything local that needs solving:

| Group | Examples | Default kind |
|---|---|---|
| 🙋 People | Need a hand, lost & found, borrow/lend, elderly support, pets & animals, vehicle help, advice | Request |
| 🌳 Environment | Dirty areas & garbage, **local rivers, lakes & ponds**, **parks**, trees, smoke/noise, water wastage | Issue |
| 🛣️ Roads & public spaces | Potholes, streetlights, drainage, footpaths, traffic | Issue |
| 💧 Utilities | Water supply, power cuts, gas, network | Issue |
| 🛡️ Safety | Non-emergency safety concerns, personal support | Request |
| ➕ Other | Anything else | User chooses |

- **Request:** one person's problem that a neighbour can solve. The asker confirms solved.
- **Issue:** shared problem affecting many. Others tap "Same here". It's solved when the reporter
  confirms, or when 3 affected people confirm "Fixed now".
- **Community tasks** (e.g. a pond clean-up): helpers offer to join and the reporter credits them.

→ [02 §11 Category catalogue](02-domain-model.md#11-category-catalogue-any-problem-can-be-posted)

---

## 3. App structure

Bottom navigation: **Problems | Feed | ⊕ Create | Chat | Profile**. The app always opens on Problems.

### Problems (map)
- Problems appear as a **hexagon-shaped area**, never an exact pin (strengthening #5).
- Many reports of the same issue show as one **incident**. The card grows with the number of
  affected people.
- Urgency: **Basic · Medium · Serious**, always shown as label + icon + colour (accessible).
- Each card shows its **freshness and latest progress** ("Updated 2 h ago · Partly solved").
- Map ⇄ list toggle; filter by category and urgency.

### Problem tab (detail)
Description, photos, area, urgency, **pinned latest update + progress timeline**, offer count,
and the buttons **I can help** / **Same here**. The asker also sees offers, **Post update**,
**Still need help**, their check-in deadline, and **Confirm solved**.

### Chat
Only between an asker and a helper they accepted, always tied to a problem. Nobody can message a
stranger cold. Text, photos, and "share exact location" (asker only). Block and report on every chat.

### Profile
Karma (can be negative), **neighbours helped**, **reliability** ("Closes the loop: 92%"), badges,
and three separate tabs: **Posts** (feed photos) · **Problem photos** (report + update photos) ·
**Solved history**.

### Feed
A local, chronological photo feed (captions, ❤️, comments). It's secondary to problems and can be
switched off per area.
→ [03 §12 Mobile app](03-architecture.md#12-mobile-app-architecture)

---

## 4. Problem lifecycle

```
Create → pick group & category → "Is it one of these?" (Same here) → details → area (hexagon)
→ photos → urgency (Serious ⇒ "call 112 first") → appears on map → nearby helpers notified
→ I can help → asker accepts → chat → asker posts progress updates (check-ins)
→ helper: "I think it's solved" → asker confirms + credits helpers → Solved → off the map → karma
```

Ways a problem ends:

| End | When | Penalty? |
|---|---|---|
| ✅ Solved | Asker confirms (or 3 affected confirm for issues) | — (helpers earn karma) |
| ↩️ Withdrawn | Asker says no longer needed / solved elsewhere | **No**, honesty is free |
| ⏳ Expired | Maximum lifetime reached while asker stayed active | No |
| 🚫 Abandoned | Asker stopped updating: deadline + grace missed | **Yes: −5 karma** (escalating) |
| 🛑 Removed | Moderator removed it | Per moderation |

→ [02 §4 State machines](02-domain-model.md#4-state-machines)

---

## 5. Progress updates & staying active (new)

### Progress updates
The asker posts updates on the problem tab so helpers understand what's needed **right now**:

- **Status:** 🔵 Still need help · 🟢 Making progress · 🟠 Partly solved · 🟣 Need has changed (text
  required), or a plain note.
- **Text** (≤ 500 chars) and **up to 3 photos** (these go to the asker's Problem photos tab, never
  the feed).
- The latest update is **pinned** at the top and shown on the map card. The full timeline is below.
- Helpers who offered get notified (batched, at most every 30 min).
- On issues, affected neighbours and helpers can post updates too ("Complaint filed, ref #123").

### Stay active or lose it
The asker must keep their problem live:

| Kind | Basic | Medium | Serious |
|---|---|---|---|
| Request: update at least every | 72 h | 24 h | 6 h |
| Issue: update at least every | 7 days | 3 days | 12 h |

1. **Check-in** = any progress update, the one-tap **"Still need help"**, accepting an offer, or
   confirming solved. Each check-in resets the clock. Private chat messages don't count, because
   helpers on the map can't see them.
2. **Reminder** at 75% of the interval, then at the deadline. Each reminder has one-tap buttons:
   *Still need help* · *It's solved* · *Withdraw*.
3. **Grace period** (25% of the interval, 1–24 h) with a final warning: "This will be removed in
   6 h and you'll lose 5 karma."
4. Still silent → **tab automatically removed** from the map, helpers told, and the **asker gets
   −5 karma**.
5. **Repeat offenders:** 2nd abandonment in 30 days = −10. 3rd = −10 plus a limit of 1 new
   problem per day for 14 days.
6. **Fairness:** withdrawing is always free; moderators can void a penalty caused by a system
   fault; for issues where neighbours are still affected, one of them can take over as
   **steward** instead of the issue disappearing.

**Why this matters:** it keeps the map trustworthy, protects helpers' time, and solves the biggest
weakness of the loop. Askers who got help but forgot to confirm now have a reason to, and the
easiest button on the reminder is *It's solved*.
→ [02 §4.6–4.7](02-domain-model.md#46-progress-updates-the-problem-tabs-timeline)

---

## 6. Notifications: the engine (strengthening #1)

- **New problem nearby:** sent to users whose home area (or, if they opt in, current area) is
  within their chosen ring, matching their categories and minimum urgency. Default limit 5 per day
  (Serious bypasses it), with quiet hours. If there are many candidates, the system picks the
  closest and most active helpers first, then sends a second wave if nobody offers within 20 min.
- **Loop notifications:** offer received, offer accepted, new message, progress update,
  "did it get solved?", +karma, check-in reminders and final warning.

→ [03 §8](03-architecture.md#8-notifications)

---

## 7. Karma (strengthening #6)

| Event | Karma |
|---|---|
| Asker confirms you helped solve their problem | **+10** (max 3 helpers credited per problem) |
| Same asker credits you again within 7 days | 0 (still in your history) |
| Account < 24 h old or phone not verified | 0 (still in your history) |
| Your problem is abandoned (you stopped updating) | **−5**, then −10 for repeats |
| Moderator reverses fraud / voids an unfair penalty | Compensating entry |

- Only outcomes earn. Offering, posting and commenting earn nothing.
- Users can never take karma from each other (no retaliation). The only negative karma is the
  system's abandonment penalty.
- The profile shows **karma**, **neighbours helped** (unique people) and **reliability** (%).
- **No money** in the MVP. Paying for favours kills the neighbourly motivation.

→ [02 §6](02-domain-model.md#6-karma-rules), [01 §6](01-product-theory.md#6-karma-theory)

---

## 8. Duplicates & incidents (strengthening #4)

- Before posting, the app shows similar open problems nearby: **"Is it one of these?"** →
  **Same here** adds you as affected instead of creating a duplicate.
- The map shows incidents ("Water outage · 23 affected").
- Later: AI duplicate detection, clustering and category suggestions plug in as a background job.

---

## 9. Two kinds of photos (unchanged principle, now enforced technically)

| | Problem photos | Feed photos |
|---|---|---|
| Attached to | A problem report or its progress updates | A social post |
| Shown | Problem tab; profile → **Problem photos** | Feed; profile → **Posts** |
| Can cross over? | **Never.** Each upload is tagged with its purpose at upload time, and the system refuses to attach it anywhere else. | |

Both go through the same pipeline, which strips GPS/EXIF and resizes.

---

## 10. Social feed

Local (your area + neighbours), chronological, photos + captions + ❤️ + comments. Guardrails:
Problems is always the default tab; posts never appear on the map; there's a per-area on/off
switch; and we track the share of users who still engage with problems. It's built after the core
loop works.

---

## 11. Privacy & safety (strengthening #5 and #7)

- **Area, not address:** a public hexagon of ~0.7 km² (wider optional; smaller only for public
  places on issues, like a pothole).
- **Exact location:** optional, private, shared only by the asker inside a chat, deleted 7 days
  after closure.
- **Photos:** GPS/EXIF removed before anyone else can see them.
- **No cold DMs.** Block hides everything both ways. Report works on every problem, update,
  offer, message, post, comment and user. Content is auto-hidden after 3 reports.
- **Serious urgency** shows "HelpIN is not an emergency service. Call 112" ⚑ before posting.
- 18+ only; in-app account deletion; community guidelines (no illegal content, ads, accusations
  against private people).

→ [02 §5, §9](02-domain-model.md#5-location-privacy-model)

---

## 12. Technical architecture

| Layer | Choice |
|---|---|
| Mobile | Expo (React Native, TypeScript), Expo Router, TanStack Query, react-native-maps, h3-js |
| Backend | Node 22 + Fastify **modular monolith** (API process + worker process, one codebase) |
| Platform | Supabase: Postgres 16, Auth (phone OTP, Google, Apple), Storage, Realtime |
| Shared code | `contracts` (zod), `domain` (pure rules), `geo` (H3), `config` |
| Async | Transactional outbox in Postgres; cron for check-in sweeps, reminders, location purge |
| Push | Expo Push → FCM / APNs |
| Quality | Vitest (one test per rule ID), real-Postgres integration tests, Maestro end-to-end |

Main data entities: users · profiles · alert_prefs · devices · blocks · media · incidents ·
problems · problem_private_locations · **problem_updates** · problem_photos · incident_affected ·
steward_invites · help_offers · karma_entries · conversations · messages · posts · post_media ·
comments · reactions · reports · moderation_actions · notifications · outbox_events.

→ [03 — Architecture](03-architecture.md), [schema-draft.sql](schema-draft.sql)

---

## 13. Launch strategy (strengthening #2)

1. Pick **one dense launch area**.
2. Recruit **20–50 founding helpers** before opening to everyone.
3. Closed beta → open in that area once **≥ 60% of problems get an offer within 2 h** for 2 weeks.
4. Only then add the next area (a config change, not a rebuild).

**North-star metric:** confirmed solves per week. Guardrails: abandonment rate, reports, feed
share, notification opt-outs.

---

## 14. Build order (strengthening #7)

| Phase | Scope |
|---|---|
| 0 | Foundations: repo, CI, shared packages, DB migrations, app shell |
| 1 | Identity: sign-up, profile, home area, alert prefs, block, account deletion |
| 2 | Problems on the map: all categories, create flow, photos (EXIF stripped), hexagon map, problem tab, **progress updates**, Same here, report |
| 3 | **Help loop:** I can help, accept, chat, claim solved, confirm + credit, karma, history, push |
| 4 | Liquidity & accountability: nearby alerts, **check-in rule + abandonment penalty**, steward handover, issue quorum |
| 5 | Social feed and the separated profile tabs |
| 6 | Safety & ops: admin console, auto-hide, fraud flags, metrics, load test, store readiness |
| 7 | Launch in one area |

Each phase has testable exit criteria → [04 — MVP Roadmap](04-mvp-roadmap.md)

---

## 15. Definition of Done (core MVP)

A user can:
1. Create an account
2. Open the map
3. See nearby active problems
4. Open a problem
5. See its approximate area, description, urgency, photos **and latest progress**
6. Offer help
7. Communicate with the asker
8. Provide a solution
9. Have it confirmed
10. See it close automatically
11. Receive karma
12. See karma, reliability and history on their profile
13. Post ordinary photos to the feed
14. See feed photos and problem photos separated on their profile
15. *(asker)* Post progress updates that helpers see pinned on the tab
16. *(asker)* Get reminded to check in, and lose the tab + karma if they stay silent
17. Post any kind of local problem: people, environment, roads, utilities, safety, other
18. Get notified of new problems nearby, within their limits
19. Never see anyone's exact location unless it's shared with them in chat
20. Report or block anything and anyone, and delete their account

---

## 16. Decisions still needed from the founder

Market and first launch area · Android-first or both · phone OTP mandatory? · feed in first beta? ·
check-in intervals and penalty sizes · steward handover in v1? · and more.
→ [05 — Decisions §2](05-decisions.md#2-open-questions-for-the-founder)
