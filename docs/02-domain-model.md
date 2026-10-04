# 02 — Domain Model

> The vocabulary, entities, state machines and **business rules** of HelpIn.
> Rules are numbered (`R-xx`, `K-xx`, `L-xx`) so that each one maps to at least one automated test.
> The concrete SQL lives in [`schema-draft.sql`](schema-draft.sql).

---

## 1. Ubiquitous language

Use these words in code, UI copy, and conversation. One word per concept.

| Term | Meaning | Not to be confused with |
|---|---|---|
| **Problem** | One user's report of something that needs solving. Owned by its **asker**. | A feed *post* |
| **Incident** | The real-world thing a problem is about. One or more problems + "same here" users. **The map shows incidents.** | A problem (1 incident : N problems) |
| **Kind** | `request` (personal, a neighbour can solve) or `issue` (shared/civic). See Theory §5. | Category |
| **Category** | What it's about: people, environment, roads, utilities, safety, or anything else (catalogue in §11). Sets the default kind and default urgency. | Kind |
| **Progress update** | A public post on a problem's tab saying what has changed and what is still needed ("Got the tools, still need one more person"). Posted mainly by the asker. | A chat message (private) |
| **Response clock** | Personal problems only: once the first helper offers, the raiser must respond (accept/decline, reply in chat, post an update, tap "Still need help", confirm) at least every **48 h**, or lose karma. | — |
| **Abandoned** | Terminal status for a personal problem that nobody (raiser or helpers) has updated for 48 h after help started. Removed from the map. | Withdrawn (honest, no penalty) |
| **Urgency** | `basic` · `medium` · `serious`. Always shown as a **label + icon + colour**, never colour alone. | Priority/ranking |
| **Area** | The public, approximate location of a problem: an H3 hexagon cell. | Exact location |
| **Help offer** | A helper saying "I can help" on a problem, optionally with a message. | A chat message |
| **Accept** | The asker accepts an offer, which opens a chat between them. | Credit |
| **Credit** | When confirming solved, the asker chooses which helpers actually helped. Credited helpers get karma. | Accept |
| **Same here** | A user marking themselves affected by an existing incident (mostly for issues). | Creating a duplicate problem |
| **Karma** | Reputation points, derived from the karma ledger. | Money (never) |
| **Post** | A normal social-feed photo post. Completely separate from problems. | Problem photo |
| **Launch area** | A configured region where HelpIn is open. | Area (a cell) |

---

## 2. Bounded contexts (modules)

The backend is a modular monolith (see Architecture §3). Each module owns its tables and talks to
other modules only through their public service interface or domain events, never by touching
another module's tables directly.

```mermaid
flowchart LR
  Identity[Identity & Profiles]
  Problems[Problems & Incidents]
  Help[Help & Resolution]
  Karma[Karma Ledger]
  Chat[Chat]
  Feed[Social Feed]
  Media[Media]
  Notify[Notifications]
  Safety[Safety & Moderation]
  Geo[Geo / Location Privacy]

  Problems --> Geo
  Problems --> Media
  Help --> Problems
  Help -- "ProblemSolved{credits}" --> Karma
  Help -- "OfferAccepted" --> Chat
  Problems -- "ProblemCreated" --> Notify
  Help -- events --> Notify
  Chat -- "MessageSent" --> Notify
  Feed --> Media
  Safety -. "can restrict/remove" .-> Problems & Help & Chat & Feed
  Identity --> Geo
```

| Module | Owns | Key commands |
|---|---|---|
| Identity & Profiles | users, profiles, push_subscriptions, blocks, notification prefs | signUp (phone or email), verifyPhone, updateProfile, setHomeArea, block, exportData, deleteAccount |
| Geo | H3 snapping, locality names, launch areas | snapToArea, localityFor, isInLaunchArea |
| Problems & Incidents | incidents, problems, problem_updates, problem_photos, incident_affected, private locations | createProblem, markSameHere, withdraw, postUpdate, responseSweep (system) |
| Help & Resolution | help_offers, resolution logic | offerHelp, acceptOffer, declineOffer, withdrawOffer, claimSolved, confirmSolved, confirmFixed (issues) |
| Karma | karma_entries, cached balances | awardForSolve, reverseEntry |
| Chat | conversations, participants, messages | openForOffer, sendMessage, shareExactLocation |
| Social Feed | posts, post_media, comments, reactions | createPost, comment, react |
| Media | media objects, processing pipeline | requestUpload, finalizeUpload |
| Notifications | notifications, push delivery, fan-out | (event consumers only) |
| Safety & Moderation | reports, moderation_actions, rate limits, trust levels | report, resolveReport, restrictUser |

---

## 3. Entity overview

```mermaid
erDiagram
  USER ||--|| PROFILE : has
  USER ||--o{ PUSH_SUBSCRIPTION : "web push (native later)"
  USER ||--o{ PROBLEM : asks
  INCIDENT ||--|{ PROBLEM : groups
  INCIDENT ||--o{ INCIDENT_AFFECTED : "same here"
  PROBLEM ||--o{ PROBLEM_UPDATE : "progress updates"
  PROBLEM ||--o| PROBLEM_PRIVATE_LOCATION : "exact point (private)"
  PROBLEM ||--o{ PROBLEM_PHOTO : documents
  PROBLEM_UPDATE ||--o{ PROBLEM_PHOTO : "may include"
  PROBLEM ||--o{ HELP_OFFER : receives
  USER ||--o{ HELP_OFFER : makes
  HELP_OFFER ||--o| CONVERSATION : "opens on accept"
  CONVERSATION ||--|{ CONVERSATION_PARTICIPANT : has
  CONVERSATION ||--o{ MESSAGE : contains
  USER ||--o{ KARMA_ENTRY : earns
  HELP_OFFER ||--o{ KARMA_ENTRY : "credited via"
  USER ||--o{ POST : authors
  POST ||--|{ POST_MEDIA : has
  POST ||--o{ COMMENT : has
  POST ||--o{ REACTION : has
  MEDIA ||--o| PROBLEM_PHOTO : "used as"
  MEDIA ||--o| POST_MEDIA : "used as"
  USER ||--o{ REPORT : files
  USER ||--o{ BLOCK : blocks
```

Notes on what changed from the original entity list, and why:

- **`solutions` + `problem_helpers` → one `help_offers` table.** A "solution" is just a helper's
  offer plus the conversation that follows. Two tables for one relationship invites
  inconsistency. Each helper has at most one offer per problem.
- **`incidents` added.** Every problem belongs to an incident from day one, even when the
  relationship is 1:1. That way AI clustering later is a background job that merges incidents,
  not a schema migration.
- **`problem_private_locations` split out.** The exact point lives in its own table that no
  public query ever joins. This is privacy by structure, not by discipline.
- **`media` added.** A single upload pipeline (EXIF stripping, resizing, moderation) serves problem
  photos, post photos, avatars and chat images. Usage is recorded in `problem_photos` and
  `post_media`, which keeps the two photo worlds separate.
- **`problem_updates` added.** A public progress timeline on each problem (§4.6). Update photos
  are problem photos, so they appear in the asker's *Problem photos* profile tab, never the feed.
- **`karma_transactions` → `karma_entries` (append-only ledger).**
- **`blocks`, `incident_affected`, `push_subscriptions`, `moderation_actions`, `appeals`, `outbox_events` added.**

---

## 4. State machines

### 4.1 Problem

```mermaid
stateDiagram-v2
  [*] --> open : createProblem
  open --> open : raiser response / helper update\n(personal: resets 48 h clock)
  open --> solved : confirmSolved (asker)\nor fixed-quorum (issue)
  open --> abandoned : personal only: nobody active 48 h\nafter help started (system)
  open --> expired : max lifetime reached (system)\nno penalty
  open --> withdrawn : withdraw (asker)\nno penalty
  open --> removed : moderator
  solved --> removed : moderator
  abandoned --> [*]
  expired --> [*]
  withdrawn --> [*]
  solved --> [*]
  removed --> [*]
```

"Being helped" is **not a status**. It's derived from the count of accepted offers and shown as a
badge ("2 helping"). Keeping it out of the state machine avoids states flapping when helpers come
and go.

| Rule | |
|---|---|
| **R-01** | A problem is created `open` with `max_life_at = now + max_lifetime(kind, urgency)` (R-57). Personal problems get a 48 h response clock once help starts (§4.7). |
| **R-02** | Only the asker can `withdraw`, post asker progress updates, or `confirmSolved`. |
| **R-03** | An open problem stays open until it's solved, withdrawn, removed for inactivity (personal problems only, R-56), or reaches its max lifetime. There's no manual "extend". |
| **R-04** | `solved`, `abandoned`, `expired`, `withdrawn`, `removed` are terminal. There's no reopen, so the user posts a new problem. This keeps karma consistent. |
| **R-05** | Terminal problems leave the active map immediately. They remain visible on the owner's profile and in solver history (except `removed`). |
| **R-06** | Every transition is written with an optimistic-concurrency check (`WHERE status = 'open'`). Double-taps and races can't double-solve or double-award. |
| **R-07** | Every command accepts an idempotency key. Replaying the same key returns the original result. |
| **R-08** | Response reminders, the penalty and removal for inactivity are defined in §4.7 (R-50…R-60). |

### 4.2 Help offer

```mermaid
stateDiagram-v2
  [*] --> offered : offerHelp (helper)
  offered --> accepted : acceptOffer (asker)
  offered --> declined : declineOffer (asker)
  offered --> withdrawn : withdrawOffer (helper)
  accepted --> withdrawn : withdrawOffer (helper)
  offered --> credited : confirmSolved credits it
  accepted --> credited : confirmSolved credits it
  offered --> closed : problem ends without credit
  accepted --> closed : problem ends without credit
  credited --> [*]
  declined --> [*]
  withdrawn --> [*]
  closed --> [*]
```

| Rule | |
|---|---|
| **R-10** | A user can't offer help on their own problem. |
| **R-11** | One offer per (problem, helper). Re-offering after `withdrawn` reuses the row and goes back to `offered`. A `declined` offer can't be re-offered. |
| **R-12** | Offers are only possible while the problem is `open`, and only if neither user has blocked the other. |
| **R-13** | `acceptOffer` creates the problem conversation (asker ↔ helper) and posts the offer's message as its first message. Before acceptance, the helper can't send further messages. Unwanted helpers therefore can't spam. |
| **R-14** | An accepted helper may `claimSolved` ("I think it's solved"). This doesn't change any state. It sets `claimed_solved_at` and sends the asker a one-tap confirm prompt. Reminders follow at +24 h and +72 h. |
| **R-15** | An offer can be **credited** from `offered` *or* `accepted`. Info-only help ("the water's back at 6") counts even if the asker never opened a chat. |
| **R-16** | When a problem reaches a terminal state, all non-terminal offers that weren't credited become `closed`. |

### 4.3 Confirm solved (the critical transaction)

`confirmSolved(problemId, creditedOfferIds[0..3], idempotencyKey)`, all in **one database
transaction**:

1. Lock the problem row; assert `status = 'open'` and caller is the asker (R-02, R-06).
2. Assert every credited offer belongs to this problem, isn't the asker's, and is in
   `offered|accepted` (R-15, K-03, K-04).
3. Problem → `solved`, `solved_at = now`. Incident status is recomputed (§4.5).
4. Credited offers → `credited`; others → `closed` (R-16).
5. For each credited offer, the Karma module computes the award (§6) and appends ledger entries.
6. Schedule deletion of the private exact location (L-07).
7. Append outbox events `ProblemSolved` and `HelperCredited×n` (these drive the push, the map
   refresh and the analytics events).

Zero credits is valid ("I solved it myself" / "it resolved on its own").

### 4.4 Issue resolution (kind = `issue`)

| Rule | |
|---|---|
| **R-20** | The reporter (asker) can `confirmSolved` exactly as in §4.3. |
| **R-21** | Users with an `incident_affected` row may tap **"Fixed now"**. When **3** distinct affected users (config) have confirmed within 48 h, the problem is `solved` with **no credits** by the system. |
| **R-22** | After a fixed-quorum solve, the reporter has **72 h** to credit helpers (`creditAfterSolve`). The same karma rules apply. |
| **R-23** | For issues, affected users and helpers with an offer may also post public progress updates ("Complaint filed, ref #123", "Water back on Block C"). See R-42. |

### 4.5 Incident

| Rule | |
|---|---|
| **R-30** | Creating a problem creates a new incident unless the user chose an existing nearby incident via "Same here" (in which case **no new problem is created**, only an `incident_affected` row). |
| **R-31** | Before creating, the client shows open incidents of the same category within the same area and its ring-1 neighbours ("Is it one of these?"). This manual deduplication is the MVP replacement for AI clustering, and every "same here" tap is a labelled training example. |
| **R-32** | Incident display fields (`affected_count`, `max_urgency`, `status`) are recomputed whenever a member problem or affected row changes. An incident is `open` while any member problem is open. |
| **R-33** | Map card prominence = f(affected_count, urgency). Implemented client-side from those two fields. |
| **R-34** (later) | Incident merge: re-point problems to the surviving incident, union affected users, write `incident_merges` (for audit/undo). No other table changes. |

### 4.6 Progress updates (the problem tab's timeline)

Helpers can only help well if they know the *current* state of a problem. A problem posted
yesterday may already be half solved, or the need may have changed. So every problem tab has a
public **progress timeline**, with the latest update pinned at the top.

```
┌ Need help moving a sofa to 3rd floor ─────────────── 🟡 Medium ┐
│ 📌 Latest · 2 h ago · 🟠 Partly solved                          │
│    "Got one person already. Need ONE more, after 6 pm."         │
│ ── Timeline ──                                                  │
│ 2 h ago  🟠 Partly solved  "Got one person already…"            │
│ 1 d ago  🔵 Still need help (one-tap)                           │
│ 1 d ago  ⚪ Posted                                               │
│ [ I can help ]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| Rule | |
|---|---|
| **R-40** | The asker can post a progress update on their open problem. An update has a **progress status**, optional text (≤ 500 chars) and up to 3 photos. Statuses: 🔵 *Still need help* · 🟢 *Making progress* · 🟠 *Partly solved* · 🟣 *Need has changed*. A *note* update (status unchanged) is also allowed. |
| **R-41** | The latest asker update is **pinned** at the top of the problem tab and summarised on the map card ("Updated 2 h ago · Partly solved"). The full timeline is visible to everyone who can see the problem. |
| **R-42** | Helpers with an offer may post progress updates on **any** problem, and on issues affected neighbours may too. Updates are labelled by role ("Helper", "Affected neighbour"). Helper updates keep a personal problem on the map (R-56) but don't count as the raiser's response (R-53). |
| **R-43** | Every asker update notifies helpers with an active offer (and, for issues, affected users). Notifications are batched at most once per 30 min per problem. |
| **R-44** | Update photos go through the media pipeline (EXIF stripped, L-08), belong to the problem, and appear in the asker's **Problem photos** profile tab. They never appear in the feed (F-03). |
| **R-45** | Updates are reportable (S-04). Rate limit: 10 updates per problem per day per author. |
| **R-46** | *Need has changed* requires text explaining the new need, so helpers aren't misled by the original description. The title and description stay as originally posted, and the timeline tells the story. |

### 4.7 Raiser response rule (accountability)

**Principle: once neighbours start helping, the raiser owes them a response.** Helpers give their
time, and a raiser who disappears wastes it and teaches helpers that the map can't be trusted.
**Honesty is never penalised, only silence is.** Withdrawing ("no longer needed", "solved
elsewhere") is always free.

| | 🙋 Personal problem (`request`) | 🌳 Community problem (`issue`) |
|---|---|---|
| Timer before anyone offers help | None | None |
| Timer after help starts | **48 h response clock** for the raiser | None |
| Penalty for silence | **Yes**: −5 karma (escalating) | **Never** |
| Removed for silence | Yes, if *nobody* (raiser or helpers) updates for 48 h | **Never**. Ends by solve, "Fixed now" quorum, withdraw, or max lifetime |
| Helpers' updates | Keep the tab on the map, but don't save the raiser from the penalty | Keep everyone informed |

How it plays out for a personal problem:

```mermaid
stateDiagram-v2
  direction LR
  [*] --> NoClock : posted
  NoClock --> Clock : first help offer arrives\n48 h clock starts
  Clock --> Clock : raiser responds\nclock resets to 48 h
  Clock --> Penalised : 48 h with no raiser response\n(reminders at 24 h and 44 h)\n−5 karma, once per problem
  Penalised --> Clock : raiser comes back and responds\n(penalty stays)
  Penalised --> Abandoned : no update from raiser OR helpers\nfor 48 h → removed from map
  Clock --> Abandoned : nobody active for 48 h
  Abandoned --> [*]
```

| Rule | |
|---|---|
| **R-50** | The response rule applies **only to personal problems** (`kind = request`). Community problems (`kind = issue`) never get a response clock, a penalty, or removal for silence (R-58). |
| **R-51** | **No help, no clock.** Until the first help offer arrives, there's no deadline and no penalty. The problem stays open until solved, withdrawn, or its max lifetime (R-57). |
| **R-52** | **The clock starts when the first help offer arrives:** `response_due_at = offer time + 48 h` (config: `response.window = 48h`). |
| **R-53** | **Raiser responses** (each resets `response_due_at = now + 48 h`): accepting or declining an offer, replying in a problem chat, posting a progress update, tapping **"Still need help"**, or confirming solved. Withdrawing ends the problem with no penalty. |
| **R-54** | **Reminders** (push + in-app, with one-tap *Still need help* · *It's solved* · *Withdraw*): at **24 h** without a response ("Bence offered to help 1 day ago and is waiting for you") and at **44 h** ("4 hours left before you lose 5 karma"). |
| **R-55** | **Penalty:** when `response_due_at` passes with no raiser response, the raiser gets the penalty (K-12), **at most once per problem**. Helpers with offers are told "The asker hasn't responded in 2 days". If the raiser comes back later, they can still respond, confirm and credit, but the penalty stays. |
| **R-56** | **Helpers keep the tab alive.** A personal problem stays on the map while *anyone* has been active in the last 48 h: a raiser response (R-53) or a public progress update from a helper with an offer (R-42). Helper chat messages don't count, because messaging an absent raiser shouldn't keep a ghost alive. If nobody has been active for 48 h, the problem becomes `abandoned` in one transaction: removed from the map, open offers → `closed`, helpers notified, exact-location purge scheduled (L-07), and the penalty applied if not already. |
| **R-57** | **Max lifetime** (no penalty): request basic **30 d** · medium **14 d** · serious **72 h**; issue basic **90 d** · medium **60 d** · serious **7 d**. Reaching it → `expired`, with a "Post again if you still need help" notice. |
| **R-58** | **Community problems carry no penalties and are never removed for silence.** If the raiser goes quiet, helpers and affected neighbours keep posting updates, and the issue ends when the raiser confirms, when 3 affected neighbours confirm "Fixed now" (R-21), when it's withdrawn, or at max lifetime. |
| **R-59** | **Exemptions:** no penalty if the problem was hidden by moderation during the window. A moderator can void a penalty caused by a system fault such as failed notifications (reversal entry, K-08). |
| **R-60** | **Visibility:** while the clock runs, the raiser sees a banner on their problem ("Reply within 18 h to keep your karma"). Helpers see "Updated 2 h ago" and "Asker last active 1 d ago", not the deadline. |

*Why this also fixes the confirmation problem:* the biggest risk in the core loop is askers who
get helped and then never tap "Confirm solved" (Theory §11). Once help has started, silence costs
the raiser karma, and the reminder that saves it offers **"It's solved"** as the one-tap answer.

---

## 5. Location privacy model

The most important privacy decisions in the product.

### 5.1 Why hexagon snapping, not random jitter

Random jitter (moving a pin by a random 200 m) **fails under repetition**. If someone posts 5
problems from home, averaging the jittered pins reveals their house. Snapping to a **fixed grid
cell** always gives the same answer for the same place, so there's nothing to average. HelpIn
uses Uber's **H3** hexagonal grid:

| H3 resolution | Avg cell area | Avg edge | Used for |
|---|---|---|---|
| 7 | ~5.2 km² | ~1.2 km | "Wider area" option; notification subscriptions; feed locality |
| **8** | **~0.74 km²** | **~460 m** | **Default public area for problems** |
| 9 | ~0.1 km² | ~175 m | Opt-in for `issue` kind only (public places like a pothole) |

### 5.2 Rules

| Rule | |
|---|---|
| **L-01** | Public area of a problem = its H3 cell at the chosen resolution. The public map position = **cell centre**, never the exact point. |
| **L-02** | Default resolution 8. The asker may choose 7 ("wider area"). Resolution 9 is offered **only for `kind = issue`**. Requests about a person's home must never be that precise. |
| **L-03** | The exact point (GPS or dropped pin) is optional. It's stored only in `problem_private_locations`, which **no public API query reads**. A contract test asserts no public response contains it. |
| **L-04** | The exact point is revealed only when the asker taps **"Share exact location"** in a problem chat. It appears as a location message visible only to that conversation's participants. |
| **L-05** | Users' home area (for notifications/feed) is stored as an **H3 res-7 cell only**. The server never stores a user's exact home. |
| **L-06** | Viewer location: the client converts its own GPS to the cells it needs and queries by cell/viewport. The API doesn't log viewer coordinates. |
| **L-07** | Exact problem locations, and location messages in chat, are **hard-deleted 7 days after the problem becomes terminal** (data minimisation). |
| **L-08** | All uploaded images have EXIF/XMP metadata stripped (including GPS) server-side **before** they're readable by anyone but the uploader. |
| **L-09** | Locality label ("Near Bartók Béla út, District XI") is reverse-geocoded from the **cell centre** and cached per cell. It never comes from the exact point. |
| **L-10** | Problems can only be created inside an enabled **launch area**. At launch, that's all of **Budapest** (every res-7 cell in the city, each tagged with its district). |

### 5.3 Visibility matrix

| Data | Any signed-in user | Accepted helper | Asker | Moderator |
|---|---|---|---|---|
| Category, kind, title, description, urgency | ✅ | ✅ | ✅ | ✅ |
| Area cell, locality label, cell centre | ✅ | ✅ | ✅ | ✅ |
| Problem photos (processed) | ✅ | ✅ | ✅ | ✅ |
| Asker display name, avatar, karma, neighbours helped | ✅ (hidden if anonymous) | ✅ (hidden if anonymous, unless revealed) | ✅ | ✅ |
| Real identity behind an anonymous problem | ❌ | only if the asker reveals it in chat (A-03) | ✅ | only when handling a report, audited (A-07) |
| Counts: affected, offers, helping | ✅ | ✅ | ✅ | ✅ |
| List of offers + helper profiles | ❌ | own only | ✅ | ✅ |
| Problem chat | ❌ | ✅ (own) | ✅ | only when reported |
| Exact location | ❌ | only if shared in chat | ✅ | only when reported, audited |
| Blocked users' content | hidden | — | — | ✅ |

Signed-out visitors see nothing except the onboarding screens, which also reduces scraping.

---

## 6. Karma rules

Karma lives in an **append-only ledger** (`karma_entries`). `profiles.karma_balance` and
`profiles.neighbours_helped` are caches, updated in the same transaction and rebuildable from the
ledger at any time.

| Rule | |
|---|---|
| **K-01** | Each credited helper gets **+10** per solved problem (config: `karma.solve_award`). Same amount for request and issue in MVP. |
| **K-02** | At most **3** helpers credited per problem. |
| **K-03** | A helper must have an offer on the problem, created before the solve. |
| **K-04** | The asker can never credit themselves. |
| **K-05** | **Pair cooldown:** if this asker credited this helper within the last 7 days, the entry is written with `amount = 0, reason = 'pair_cooldown'`. Solver history still records the help. |
| **K-06** | **Pair lifetime cap:** karma from a single asker to a single helper is capped at 50. Beyond that, `amount = 0, reason = 'pair_cap'`. |
| **K-07** | **Eligibility:** the helper must be phone-verified and the account ≥ 24 h old, otherwise `amount = 0, reason = 'ineligible_account'`. |
| **K-08** | Entries are never updated or deleted. A moderator reversal appends an entry with `amount = −original` and `reverses_entry_id`. An entry can be reversed at most once. |
| **K-09** | `neighbours_helped` = number of **distinct askers** who credited this helper (non-reversed entries, including zero-amount ones). |
| **K-10** | **Velocity flags** (no automatic penalty, these create a moderation item): > 5 credits between the same pair in 30 days; > 15 credits to one helper in 24 h; > 5 solved problems in 24 h by one asker crediting the same helper. |
| **K-11** | **Asker closing award:** when the asker confirms solved **and credits at least one helper whose award was non-zero**, the asker gets **+2 karma** (`reason = 'closing_award'`), once per problem. Max 5 closing awards per 7 days, same eligibility as K-07. Self-solved problems (no credits), fixed-quorum solves, and solves where every credit was zeroed by K-05/K-06 earn nothing. The aim is to reward closing the loop without making fake problems profitable. |
| **K-12** | **Silence penalty:** when the raiser of a **personal** problem misses the 48 h response window after help started (R-55), they get **−5 karma** (`reason = 'abandonment_penalty'`), at most once per problem. It **never applies to community problems**. Apart from this, karma only decreases through moderator actions (reversals K-08, fake-problem penalty K-16). Users can never take karma from each other, so there's no retaliation loop. |
| **K-13** | **Escalation:** 2nd penalty within 30 days = **−10**. 3rd within 30 days = **−10** and the raiser is put **on notice**: max 1 new problem per day for 14 days. |
| **K-14** | Karma **can go negative**, so the penalty means something even for new users. A new user starts at 0, and ignoring helpers on their first problem gives −5. |
| **K-15** | **Reliability** (shown on the profile next to karma): % of the user's personal problems in the last 90 days that received help, where the user never missed the 48 h response window. "Responds to helpers: 92%". Helpers can use it to judge whether an asker is worth their time. Shown once the user has ≥ 3 such problems. |
| **K-16** | **Fake-problem penalty:** when a moderator upholds a "fake problem" report (A-06), the asker gets **−20 karma** (`reason = 'fake_problem_penalty'`), once per problem, and loses anonymous posting for 90 days. A 2nd upheld fake problem within 180 days → account `restricted`. |

Later (not MVP): weighting by urgency/impact, badges ("First Help", "10 Neighbours", "Water
Warrior"), solver levels, streaks, and decay of inactive reputation.

---

## 7. Chat rules

| Rule | |
|---|---|
| **C-01** | Conversations exist only in the context of a problem (`problem_id` required in MVP). There are no user-to-user DMs. |
| **C-02** | A conversation is created by `acceptOffer` (R-13), with exactly two participants: asker and helper. |
| **C-03** | Messages can be sent while the problem is non-terminal and for **48 h after** it becomes terminal (to say thanks / arrange returning a ladder). After that the conversation is read-only. |
| **C-04** | If either participant blocks the other, the conversation becomes read-only immediately for both. |
| **C-05** | Message types: `text`, `image` (via the media pipeline), `location` (L-04), `system` (e.g. "Marked as solved"). |
| **C-06** | Any message can be reported. A report gives moderators access to that conversation, and the access is audited. |

---

## 8. Social feed rules

| Rule | |
|---|---|
| **F-01** | Posts have 1–10 photos and an optional caption. A post is tagged with the author's **res-7 area** at posting time. |
| **F-02** | The feed shows posts from the viewer's area and ring-1 neighbours, newest first. No ranking algorithm in MVP. |
| **F-03** | Posts never appear on the map, and problems never appear in the feed. Media used by a post can't be attached to a problem, and vice versa. |
| **F-04** | Profile has two separate tabs: **Posts** (from `post_media`) and **Problem photos** (from `problem_photos` of problems the user asked, excluding `removed`). |
| **F-05** | One reaction type ("❤️") in MVP. Comments are flat (no threads). |

---

## 9. Safety, trust levels & rate limits

### Trust levels (derived, not stored as a manual flag)

| Level | Condition | Effects |
|---|---|---|
| `new` | Account < 7 days **or** never credited | Lower rate limits; can't post `serious` urgency without phone verification |
| `member` | ≥ 7 days and phone-verified | Normal limits |
| `trusted` | `neighbours_helped ≥ 5` and no upheld reports in 90 d | Higher limits; "Trusted neighbour" badge (later) |
| `on_notice` | 3 silence penalties within 30 d (K-13) | Max 1 new problem per day for 14 days; can still help others |
| `restricted` | Set by moderator | Read-only; can't post, offer, or message |

### Default rate limits (config)

| Action | new | member / trusted |
|---|---|---|
| Create problem | 3 / day | 10 / day |
| `serious` problem | 1 / day | 3 / day |
| Help offers | 15 / day | 50 / day |
| Messages | 200 / day | 1000 / day |
| Posts | 3 / day | 10 / day |
| Reports | 10 / day | 20 / day |

### Safety rules

| Rule | |
|---|---|
| **S-01** | Users must be 18+ (self-declared at signup in MVP). |
| **S-02** | Selecting `serious` urgency shows a blocking interstitial: "HelpIn is not an emergency service. If anyone is in danger, call 112." (112 is the EU-wide emergency number), with a one-tap call button, before the problem can be posted. |
| **S-03** | Block is symmetric in effect: neither user sees the other's problems, offers, posts, comments, or messages. |
| **S-04** | Anything user-generated (problem, update, offer message, chat message, post, comment, profile) can be reported with a reason, including **"Fake problem"**. |
| **S-05** | Content auto-hides once it has ≥ 3 distinct reports from `member`+ users, pending moderator review. |
| **S-06** | Every moderator action (remove, restore, restrict, reverse karma, view private data) is written to `moderation_actions`, which is append-only. |
| **S-07** | Account deletion is available in-app (GDPR right to erasure). It deletes the profile, posts, media and private locations, anonymises problems/messages ("Deleted user"), and keeps karma ledger rows anonymised for integrity. |
| **S-08** | **Data export** is available in-app (GDPR right of access/portability): profile, problems, updates, offers, messages, posts, karma history, as a downloadable JSON/ZIP. |
| **S-10** | **Moderation response targets:** reports are reviewed within **24 h**, and within **2 h** for Serious problems. Serious reports alert the admin immediately. Admin and moderator accounts must use **two-factor authentication**. During the beta the founder is the sole admin (ADR-023). |
| **S-09** | **DSA notice & action:** when content is removed or an account is restricted, the affected user gets a **statement of reasons** (what, why, which rule, whether automated) and can **appeal** once. Appeals are reviewed by a different moderator where possible. |

---

## 10. Domain events (outbox)

Written in the same transaction as the state change, then consumed asynchronously
(see Architecture §6).

| Event | Consumers |
|---|---|
| `ProblemCreated` | Notifications (nearby fan-out), Analytics, (later) AI dedupe |
| `IncidentAffectedAdded` | Notifications (to reporter, batched), Incident recompute |
| `HelpOffered` | Notifications (to asker) |
| `OfferAccepted` | Chat (open conversation), Notifications (to helper) |
| `SolveClaimed` | Notifications (to asker, + reminder schedule) |
| `ProblemSolved` | Notifications (helpers + affected), Map cache, Location purge scheduler, Analytics |
| `HelperCredited` | Notifications ("You earned 10 karma"), Profile cache |
| `ProblemUpdated` | Notifications (helpers with offers, affected users; batched R-43), map card freshness |
| `ResponseDue` (24 h reminder / 44 h last call) | Notifications (raiser, with one-tap actions) |
| `RaiserPenalized` | Karma (K-12/K-13), Notifications (raiser + helpers) |
| `ProblemAbandoned` | Notifications (raiser + helpers), Location purge scheduler |
| `ProblemExpired` / `ProblemWithdrawn` | Notifications (helpers with offers), Location purge scheduler |
| `MessageSent` | Notifications (if recipient not active in that chat) |
| `ContentReported` | Moderation queue, auto-hide check (S-05) |
| `ContentRemoved` / `UserRestricted` | Notifications (statement of reasons, S-09), appeal window opens |
| `FakeProblemUpheld` | Karma (K-16), Identity (anonymous-posting ban), Notifications |
| `MediaUploaded` | Media pipeline (strip, resize, scan) |

---

## 11. Category catalogue: any problem can be posted

People can post **any** local problem: human, environmental, roads, utilities, safety, or
anything else. Categories are grouped so the create screen stays simple: pick a group, then a
category. Each category sets a default kind and urgency, and the user can change both.

| Group | Categories | Default kind | Examples |
|---|---|---|---|
| 🙋 **People** | Need a hand · Lost & found · Borrow / lend · Elderly & neighbour support · Pets & animals · Vehicle help · Advice & recommendations | request | Moving a sofa, lost keys, need a ladder, check on an elderly neighbour, stray dog injured, car won't start |
| 🌳 **Environment** | Garbage & dirty areas · Rivers, lakes & ponds · Parks & green spaces · Trees & plants · Air, smoke & noise · Water wastage | issue | Garbage dumped on an empty plot, polluted pond, broken park benches, fallen tree, burning waste, leaking pipe |
| 🛣️ **Roads & public spaces** | Roads & potholes · Streetlights · Drainage & sewage · Footpaths & public spaces · Traffic & parking | issue | Pothole, dark street, overflowing drain, blocked footpath |
| 💧 **Utilities** | Water supply · Power cuts · Gas · Internet / phone network | issue | No water since morning, area power cut |
| 🛡️ **Safety** | Safety concern (non-emergency) · Personal support | request | Unsafe dark lane, suspicious activity, someone needs support |
| ➕ **Other** | Anything else | user chooses | Anything that doesn't fit above |

Rules:

| Rule | |
|---|---|
| **CAT-01** | The catalogue is config (served by `/meta/config`), so categories can be added without an app release. |
| **CAT-02** | **Community tasks:** environment issues are often things neighbours *can* fix together (a park or pond clean-up drive). Helpers can offer ("I'll join the clean-up on Sunday"), and the reporter credits them on solve, exactly like a request. |
| **CAT-03** | **Personal support** shows helpline numbers (e.g. the EU emotional-support line **116 123**; verify the Hungarian numbers before launch) and a reminder not to share private details publicly. HelpIn connects neighbours; it doesn't replace professional, medical or emergency help. |
| **CAT-04** | **Not allowed in any category** (community guidelines): anything illegal, selling or advertising, political campaigning, accusations naming a private person, medical diagnosis requests, and **fake problems** (A-06). These are reportable and removed by moderation. |
| **CAT-05** | Every "Same here" and every category correction a user makes is kept as labelled data for future AI category suggestion and duplicate detection. |

---

## 12. Anonymous posting (accountable anonymity)

People can post a problem **anonymously**, for example a personal or sensitive problem, or a
safety concern they don't want their name on. Anonymity is **public-facing only**: HelpIn always
knows who posted, so every rule still applies and fake problems can be punished.

| Rule | |
|---|---|
| **A-01** | When creating a problem, the asker can choose **"Post anonymously"**. Publicly the asker appears as **"Anonymous neighbour"**: no name, avatar, profile link, karma or neighbours-helped count. Their **reliability %** is still shown, so helpers can judge whether they respond. |
| **A-02** | All normal rules apply to anonymous problems: phone-verified account, rate limits, the response rule and its penalty (R-50…R-60), the closing award (K-11), blocks, reports. |
| **A-03** | In chat, the accepted helper also sees "Anonymous neighbour", unless the asker taps **"Reveal my profile"** in that conversation. Revealing is per conversation and can't be undone. |
| **A-04** | Anonymous problems **never appear on the asker's public profile**: not in Problem photos, and not in their history as an asker. This prevents de-anonymisation. The asker sees them in their own private "My problems" list. Helpers still get normal credit and solver history for helping on them. |
| **A-05** | Anonymous posting isn't available to users who are `on_notice` (K-13) or have lost the privilege because of a fake problem (K-16). |
| **A-06** | **No fake problems.** Posting a problem that isn't real (made up, a prank, posted to farm karma, or to mislead neighbours) breaks the community guidelines, whether anonymous or not. Users report it with the reason **"Fake problem"**. If a moderator upholds it: the problem is removed, the asker gets a statement of reasons (S-09) and the fake-problem penalty (K-16). |
| **A-07** | Moderators can see the real author of an anonymous problem **only while handling a report about it**. Every such lookup is recorded in `moderation_actions` with a reason (S-06). |
| **A-08** | The location rules don't change: anonymous problems use the same hexagon area (L-01…L-10), and photos are EXIF-stripped (L-08). Location is often what identifies a person, so the "wider area" option is suggested when posting anonymously. |
