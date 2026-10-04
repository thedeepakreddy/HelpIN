# HelpIn — MVP Product & Build Plan (v2)

> The complete plan in one document. It follows the structure of the original MVP plan, with every
> improvement built in. Each section links to the detailed doc behind it.
>
> **Status: planning.** Nothing gets built until this plan is agreed.
>
> **At a glance:** Budapest, Hungary · web app first (installable), native apps later · English ·
> brand **HelpIn**.

---

## 0. What's new in v2

### The 7 strengthenings

| # | Strengthening | What it means | Where |
|---|---|---|---|
| 1 | **Push notifications are the engine** | Nearby helpers get a targeted, rate-limited alert when a problem is posted ("Someone ~400 m away needs a hand"). People don't open maps spontaneously, so without this the map stays empty. | §6, [03 §8](03-architecture.md#8-notifications) |
| 2 | **Cold-start / launch strategy** | Launch across all of Budapest, run as many small networks: founding helpers recruited in seed hubs first, and success (≥ 60% of problems get a help offer within 2 h) measured per district. | §13, [01 §4](01-product-theory.md#4-the-hardest-problem-local-liquidity-cold-start) |
| 3 | **Requests vs issues** | *Requests* (a neighbour can solve it, the asker confirms) vs *issues* (shared/civic/environmental, many affected, "Same here", solved by the reporter or when 3 affected users confirm it's fixed). | §2, [01 §5](01-product-theory.md#5-not-all-problems-are-the-same-a-taxonomy) |
| 4 | **Incidents from day one + manual "Same here"** | Every problem belongs to an incident. Users group duplicates with "Same here" now, and AI does it later as a background job with no redesign. Every tap is training data. | §8, [02 §4.5](02-domain-model.md#45-incident) |
| 5 | **Privacy by structure** | Public location is a fixed hexagon area (~0.7 km²), never a pin. The exact point is in a separate private table, shared only by the asker in chat, and deleted after closure. Photo GPS/EXIF data is stripped. | §11, [02 §5](02-domain-model.md#5-location-privacy-model) |
| 6 | **Karma that can't be cheated** | Append-only ledger; only confirmed outcomes earn; limits on the same pair crediting each other; phone-verified accounts only; "neighbours helped" shown as the honest trust signal. | §7, [02 §6](02-domain-model.md#6-karma-rules) |
| 7 | **Chat and safety moved earlier** | Chat is part of the help loop (Phase 3, not 6). Report/block ships with every feature, not Phase 8. The EU Digital Services Act requires it. | §14, [04](04-mvp-roadmap.md) |

### New in v2 (founder additions)

| Addition | Summary | Where |
|---|---|---|
| **Progress updates** | The asker posts updates on the problem's tab (status + text + photos) so helpers know exactly what's still needed. The latest update is pinned. | §5, [02 §4.6](02-domain-model.md#46-progress-updates-the-problem-tabs-timeline) |
| **Respond or lose karma** | Once people start helping a **personal** problem, the raiser must respond within **2 days** or **gets negative karma points**. If nobody (raiser or helpers) updates it for 2 days, the tab is **automatically removed**. Helpers' updates keep it alive. **Community problems never get penalties.** | §5, [02 §4.7](02-domain-model.md#47-raiser-response-rule-accountability) |
| **Any problem can be posted** | Everyday help, newcomers & language help, environment (dirty areas, local rivers, lakes, ponds, parks, trees, pollution), roads and public spaces, utilities, safety, and anything else. | §2, [02 §11](02-domain-model.md#11-category-catalogue-any-problem-can-be-posted) |
| **Anonymous posting** | Problems can be posted anonymously ("Anonymous neighbour"). HelpIn still knows who posted, so the community guidelines apply. **Fake problems cost −20 karma** and the right to post anonymously. | §11, [02 §12](02-domain-model.md#12-anonymous-posting-accountable-anonymity) |
| **Askers earn a little karma** | **+2** for closing a solved problem (helpers still get +10). | §7 |

### New in v2.1: a social platform for mutual help

| Addition | Summary | Where |
|---|---|---|
| **Positioning** | A social platform for mutual help between locals, newcomers and communities, **not** a gig marketplace. Help is always free. | §1, [01 §0](01-product-theory.md#0-what-helpin-is-and-what-it-isnt) |
| **Newcomers & language** category group | Language & translation help, paperwork & official offices, finding services, settling in | §2 |
| **Languages** | Profiles show languages spoken; problems say which language help is needed; "Speaks your language" badges; translation later | §10b, [02 §13](02-domain-model.md#13-languages-bridging-newcomers-and-locals) |
| **Communities** | District, language & culture, student and civic communities with their own feed, welcome thread and shared problems. Membership private by default. | §10b, [02 §14](02-domain-model.md#14-communities) |
| **Thank-you posts** | After a solve, the asker can thank helpers publicly in the feed (helpers approve the tag) | §10 |
| **Scam protection** | No selling/renting/paid services; "never send money" warning in chats; "Scam" report reason | §11 |

### Founder decisions

| Topic | Decision |
|---|---|
| Launch market | **Budapest, Hungary** (EU, so GDPR + Digital Services Act apply) |
| Platform | **Web app first** (installable PWA); native iOS/Android apps planned later |
| Sign-up | **Phone or email**; **phone verification mandatory** for everyone |
| Feed | **In the first beta** |
| Language | **English** (Hungarian next) |
| Brand | **HelpIn** |
| Launch area | **All of Budapest** (23 districts), with seed hubs for recruitment |
| Moderation | **The founder is the sole admin** until funding, a team and a company exist (2FA required) |
| Legal operator | **The founder as an individual** until the full release |
| Team & budget | Decide later |

---

## 1. Core idea

**HelpIn is a social platform where people help one another**: locals, newcomers and immigrants,
and the communities they form in Budapest. People post **any real-world local problem** in an
approximate area, neighbours offer help **for free**, the asker keeps the problem updated, and
when it's solved the asker confirms it. The problem closes automatically and helpers earn karma.

**It is not a gig or task marketplace.** There are no prices, paid tasks, jobs, selling or
renting. Help is mutual, and it flows both ways between locals and newcomers.

| Who | Gets help with | Gives |
|---|---|---|
| **Newcomers & immigrants** | Language, Hungarian paperwork and offices, finding a doctor or school, settling in, everyday problems | Their skills and languages, everyday help, energy for community projects |
| **Locals** | Everyday problems, a stronger neighbourhood, fixing shared issues | Language, local know-how, a welcome |
| **Communities** | Organising, welcoming members, fixing shared problems together | Members who show up, local trust |

**Core loop:** see a nearby problem → I can help → talk → solve → asker confirms → helper earns
reputation.

HelpIn is a **status system**, not a conversation system. Every problem has a location, a live
status, a progress timeline and an ending. Group chats have none of these.
→ [01 — Product Theory](01-product-theory.md)

---

## 2. What can be posted

Anything local that needs solving:

| Group | Examples | Default kind |
|---|---|---|
| 🤝 Everyday help | Need a hand, lost & found, borrow/lend, elderly support, pets & animals, vehicle help, advice | Request |
| 🌍 Newcomers & language | Language & translation help, paperwork & official offices, finding a doctor/school/service, settling in & city know-how | Request |
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

HelpIn is a **web app** that works in any phone or desktop browser and can be **installed to the
Home Screen** like an app. On phones: bottom navigation **Problems | Community | ⊕ Create | Chat |
Profile**; on desktop the same items sit in a sidebar. It always opens on Problems.

### Problems (map)
- Problems appear as a **hexagon-shaped area**, never an exact pin (strengthening #5).
- Many reports of the same issue show as one **incident**. The card grows with the number of
  affected people.
- Urgency: **Basic · Medium · Serious**, always shown as label + icon + colour (accessible).
- Each card shows its **freshness and latest progress** ("Updated 2 h ago · Partly solved").
- Map ⇄ list toggle; filter by category and urgency.

### Problem tab (detail)
Description, photos, area, urgency, **pinned latest update + progress timeline**, offer count,
and the buttons **I can help** / **Same here**. The asker shows as their name, or as
"Anonymous neighbour" if they posted anonymously. The asker also sees offers, **Post update**,
**Still need help**, a "reply within X h" banner once helpers are waiting, and **Confirm solved**.

### Chat
Only between an asker and a helper they accepted, always tied to a problem. Nobody can message a
stranger cold. Text, photos, "share exact location" (asker only), and "reveal my profile" for
anonymous askers. Block and report on every chat.

### Profile
Karma (can be negative), **neighbours helped**, **reliability** ("Responds to helpers: 92%"), badges,
and three separate tabs: **Posts** (feed photos) · **Problem photos** (report + update photos) ·
**Solved history**. Anonymous problems never appear on a public profile.

### Community (feed + communities)
The **Feed**: a local, chronological feed of photo posts, thank-you posts celebrating helpers, and
posts from your communities. **Communities**: join district, language & culture, student or civic
communities, each with a Welcome thread and shared problems. Helping stays at the centre; the
social layer builds trust between locals and newcomers. Included in the first beta.
→ [03 §12 Web app](03-architecture.md#12-web-app-architecture) · full page & button spec: [06 — Pages, Components & Buttons](06-ui-spec.md)

---

## 4. Problem lifecycle

```
Create → pick group & category → "Is it one of these?" (Same here) → details → area (hexagon)
→ photos → urgency (Serious ⇒ "call 112 first") → appears on map → nearby helpers notified
→ I can help (2-day response timer starts for personal problems) → asker accepts → chat
→ asker and helpers post progress updates
→ helper: "I think it's solved" → asker confirms + credits helpers → Solved → off the map → karma
```

Ways a problem ends:

| End | When | Penalty? |
|---|---|---|
| ✅ Solved | Asker confirms (or 3 affected confirm for issues) | — (helpers earn karma) |
| ↩️ Withdrawn | Asker says no longer needed / solved elsewhere | **No**, honesty is free |
| ⏳ Expired | Maximum lifetime reached while asker stayed active | No |
| 🚫 Abandoned | Personal problem: nobody (raiser or helpers) updated it for 2 days after help started | Raiser gets **−5 karma** if they didn't respond (escalating) |
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

### Respond to your helpers (personal problems only)

Once someone offers to help, the raiser owes them a response.

| | 🙋 Personal problem | 🌳 Community problem |
|---|---|---|
| Before anyone offers help | No timer | No timer |
| After help starts | Raiser must respond at least every **2 days** | No timer |
| Raiser silent for 2 days | **−5 karma** (repeats: −10) | **Never penalised** |
| Removed from the map | Only if **nobody** (raiser or helpers) updates it for 2 days | **Never** for silence |

1. **No help, no clock.** The 2-day timer starts when the first helper offers.
2. **What counts as responding:** accepting or declining an offer, replying in chat, posting a
   progress update, the one-tap **"Still need help"**, or confirming solved. Each response resets
   the 2-day timer.
3. **Reminders** at 24 h ("Bence is waiting for you") and 44 h ("4 hours left before you lose 5
   karma"), each with one-tap *Still need help* · *It's solved* · *Withdraw*.
4. **2 days of silence → −5 karma**, once per problem. Helpers are told the asker hasn't responded.
5. **Helpers keep it alive.** If helpers keep posting updates, the problem stays on the map even
   while the raiser is silent (the raiser still loses the karma). If nobody updates for 2 days, the
   tab is **automatically removed**.
6. **Repeat offenders:** 2nd penalty in 30 days = −10. 3rd = −10 plus a limit of 1 new problem per
   day for 14 days.
7. **Community problems** (polluted pond, broken road, garbage) **never get penalties** and are
   never removed for silence. They end when the raiser confirms, when 3 affected neighbours
   confirm "Fixed now", when withdrawn, or at max lifetime (90 days for basic).
8. **Fairness:** withdrawing is always free; moderators can void a penalty caused by a system fault.

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
  "did it get solved?", +karma, and "a helper is waiting for you" reminders at 24 h and 44 h.
- **How they arrive (web app):** browser **push notifications** (Android, desktop, and iPhone once
  HelpIn is added to the Home Screen; onboarding guides iPhone users through this), with **email**
  as the fallback, plus an in-app inbox. This is the main limitation of going web-first, and the
  native apps will remove it.

→ [03 §8](03-architecture.md#8-notifications)

---

## 7. Karma (strengthening #6)

| Event | Karma |
|---|---|
| Asker confirms you helped solve their problem | **+10** (max 3 helpers credited per problem) |
| Same asker credits you again within 7 days | 0 (still in your history) |
| Account < 24 h old or phone not verified | 0 (still in your history) |
| You confirm your problem solved and credit a helper | **+2** (max 5 per week) |
| You ignore helpers on your personal problem for 2 days | **−5**, then −10 for repeats |
| A moderator confirms you posted a fake problem | **−20**, and no anonymous posting for 90 days |
| Anything on a community problem | Never negative |
| Moderator reverses fraud / voids an unfair penalty | Compensating entry |

- Only outcomes earn. Offering, posting and commenting earn nothing.
- Users can never take karma from each other (no retaliation). Karma only goes down through the
  system penalty for ignoring helpers, or a moderator's decision on a fake problem.
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

## 10. The social layer: feed, thank-yous and communities

The **Community** tab holds the feed and communities. The feed is local (your area +
neighbours) and chronological: photos + captions + ❤️ + comments, **thank-you posts** that
celebrate helpers, and posts from your communities. Guardrails:
Problems is always the default tab; posts never appear on the map; there's a per-area on/off
switch; and we track the share of users who still engage with problems. It's built after the core
loop and **included in the first beta**.

---

## 10b. Languages & communities

- **Languages:** every profile lists the languages its owner speaks. Problems can say which
  language help is needed ("Hungarian → English"), and cards show "Speaks your language". People
  can get alerts for problems needing a language they speak. One-tap translation comes after
  launch.
- **Communities:** district neighbours, language & culture communities, student groups, civic
  groups. Each has a feed, a pinned **Welcome thread** for newcomers, and problems shared to it.
  Communities are created by the admin during the beta. **Membership is private by default**,
  because belonging to a language, culture or religion-based community is sensitive personal data.

---

## 11. Privacy & safety (strengthening #5 and #7)

- **Area, not address:** a public hexagon of ~0.7 km² (wider optional; smaller only for public
  places on issues, like a pothole).
- **Exact location:** optional, private, shared only by the asker inside a chat, deleted 7 days
  after closure.
- **Photos:** GPS/EXIF removed before anyone else can see them.
- **No cold DMs.** Block hides everything both ways. Report works on every problem, update,
  offer, message, post, comment and user. Content is auto-hidden after 3 reports.
- **Serious urgency** shows "HelpIn is not an emergency service. Call 112" before posting.
- **Anonymous posting:** hidden from the public, never on the asker's profile, but always known
  to HelpIn. Moderators can see who posted only while handling a report, and every lookup is logged.
- **Phone verification for everyone:** one account per phone number, which stops fake accounts.
- **Help is free:** no paid work, jobs, prices, selling, renting or advertising (reportable).
- **Scam protection for newcomers:** chats warn "Never send money or ID documents to someone you
  met on HelpIn"; paperwork problems remind people to cover personal details in photos.
- 18+ only; community guidelines (no fake problems, illegal content, ads, or accusations against
  private people).
- **EU law:** GDPR (data stored in the EU, in-app data export and account deletion, privacy
  notice) and the Digital Services Act (easy reporting, a reason given when content is removed,
  and the right to appeal). A lawyer reviews this before launch.

→ [02 §5, §9](02-domain-model.md#5-location-privacy-model)

---

## 12. Technical architecture

| Layer | Choice |
|---|---|
| Web app | React + TypeScript + Vite, installable PWA, TanStack Router/Query, Tailwind + Radix, **MapLibre** maps, h3-js |
| Backend | Node 22 + Fastify **modular monolith** (API process + worker process, one codebase) |
| Platform | Supabase (EU, Frankfurt): Postgres 16, Auth (phone or email codes), Storage, Realtime |
| Shared code | `contracts` (zod), `domain` (pure rules), `geo` (H3), `config`, `api-client`, all reusable by the later native apps |
| Async | Transactional outbox in Postgres; cron for response sweeps, reminders, location purge |
| Notifications | Web Push (VAPID) + email fallback + in-app inbox |
| Quality | Vitest (one test per rule ID), real-Postgres integration tests, Playwright end-to-end (two users, mobile + desktop) |

Main data entities: users · profiles · alert_prefs · push_subscriptions · blocks · media · incidents ·
problems · problem_private_locations · **problem_updates** · problem_photos · incident_affected ·
help_offers · karma_entries · conversations · messages · posts · post_media ·
comments · reactions · reports · moderation_actions · appeals · notifications · outbox_events.

→ [03 — Architecture](03-architecture.md), [schema-draft.sql](schema-draft.sql)

---

## 13. Launch strategy (strengthening #2)

1. **Open across all of Budapest** (all 23 districts), but treat the city as **many small
   networks**: liquidity is measured **per district**.
2. **Recruit founding helpers in seed hubs first:** District XI (BME / ELTE campuses), VIII–IX
   (Corvinus, Semmelweis, Corvin-negyed), and the inner city (V–VII, XIII).
3. **Sparse areas get wider alerts:** if few helpers are near a problem, the second notification
   wave reaches people up to ~4 km away who allow it.
4. **Recruitment follows the data:** every week, focus on the districts with the most unanswered
   problems. A district is healthy when ≥ 60% of problems get an offer within 2 h.
5. Next city only when Budapest holds its targets (a config change, not a rebuild).

**North-star metric:** confirmed solves per week. Guardrails: abandonment rate, reports, feed
share, notification opt-outs.

---

## 14. Build order (strengthening #7)

| Phase | Scope |
|---|---|
| 0 | Foundations: repo, CI, shared packages, DB migrations, **web app shell (PWA)** |
| 1 | Identity: sign-up (phone or email), **phone verification**, notifications setup, profile, home area, alert prefs, block, data export, account deletion |
| 2 | Problems on the map: all categories, create flow (incl. **anonymous**), photos (EXIF stripped), hexagon map, problem tab, **progress updates**, Same here, report |
| 3 | **Help loop:** I can help, accept, chat, claim solved, confirm + credit, karma (+10 / +2), history, notifications |
| 4 | Liquidity & accountability: nearby alerts, **2-day response rule + penalty** (personal problems), issue quorum |
| 5 | Community tab: feed, thank-you posts, communities, languages on profiles, separated profile tabs |
| 6 | Safety, ops & EU readiness: admin console, fake-problem handling, DSA reasons & appeals, GDPR documents, metrics, load test, legal review |
| 7 | Closed beta (seed hubs) → open across all of Budapest |
| 8 | Native mobile apps (to be planned) |

Each phase has testable exit criteria → [04 — MVP Roadmap](04-mvp-roadmap.md)

---

## 15. Definition of Done (core MVP)

A user can:
1. Create an account with phone or email, and verify their phone
2. Open the map
3. See nearby active problems
4. Open a problem
5. See its approximate area, description, urgency, photos **and latest progress**
6. Offer help
7. Communicate with the asker
8. Provide a solution
9. Have it confirmed
10. See it close automatically
11. Receive karma (and the asker a little for closing)
12. See karma, reliability and history on their profile
13. Post ordinary photos to the feed
14. See feed photos and problem photos separated on their profile
15. *(asker)* Post progress updates that helpers see pinned on the tab
16. *(asker)* Once helpers offer on a personal problem, get reminded to respond, and lose karma
    after 2 days of silence. Community problems are never penalised.
17. Post any kind of local problem: people, environment, roads, utilities, safety, other
18. Get notified of new problems nearby, within their limits
19. Never see anyone's exact location unless it's shared with them in chat
20. Report or block anything and anyone (including "Fake problem"), export their data, and delete
    their account
21. Post a problem anonymously
22. Use HelpIn in any phone or desktop browser, install it to the Home Screen, and get push or
    email notifications
23. Show the languages they speak, and ask for help in a specific language
24. Join communities and share a problem with a community
25. Thank helpers publicly with a thank-you post (helpers approve the tag)

---

## 16. Decisions

**All planning decisions are made.** Team & budget is deliberately deferred.

| Role | Who |
|---|---|
| Admin / moderator | The founder (sole admin until funding; 2FA required; account set via a private server setting, not stored in the repo) |
| Legal operator, GDPR controller, DSA contact | The founder as an individual, until the full release |

→ Full decision log: [05 — Decisions](05-decisions.md)
