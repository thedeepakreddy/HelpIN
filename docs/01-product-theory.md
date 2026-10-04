# 01 — Product Theory

> **Why HelpIn should exist, how it should work, and why it can fail.**
> This doc is the "why" behind every rule in [02 — Domain Model](02-domain-model.md) and every
> component in [03 — Architecture](03-architecture.md). If a later decision contradicts a
> principle here, change this doc first or change the decision.

---

## 1. Thesis

**HelpIn turns "someone near me has a problem" into "someone near me solved it", and makes that visible.**

The core loop. Everything else either feeds it or protects it:

```
 See a nearby problem → "I can help" → talk → solve → owner confirms → helper earns reputation
        ▲                                                                       │
        └──────────────── visible local reputation makes people help again ◄────┘
```

### What's actually new

In Budapest, local problems already get posted somewhere: district Facebook groups ("XI. kerület"
groups and the like), building (társasház) chats, WhatsApp/Messenger groups, civic reporting sites
such as Járókelő, or word of mouth. All of those are **conversation systems**. A
message is posted, scrolls away, and nobody knows whether it was resolved.

HelpIn is a **status system**. Every problem has:

| Property | Group chat | HelpIn |
|---|---|---|
| Location | Implicit ("near gate 2") | Explicit approximate area, on a map |
| Status | None | Open → Being helped → Solved / Expired |
| Closure | Lost in scroll | Owner confirms; pin disappears |
| Credit | "Thanks 🙏" | Karma + solver history, permanently attributed |
| Duplicates | 15 messages about the same outage | 1 incident with "15 affected" |
| Freshness | Old messages look as current as new ones | Raisers must answer helpers within 2 days; abandoned problems disappear |
| Reach | Only members of that group | Everyone nearby, including people not in the group |

**Closure is the product.** The map and the karma exist to make closure visible.

---

## 2. Roles (not personas)

The same person moves between all of these roles. Design for the role, not the demographic.

| Role | Does | Side of the market |
|---|---|---|
| **Asker** | Posts a problem, accepts help, confirms solved | Demand |
| **Helper** | Offers help, solves, earns karma | **Supply (the hard side)** |
| **Affected** | Says "same here" on an existing shared issue | Signal / demand |
| **Observer** | Browses map/feed, may become a helper later | Latent supply |
| **Moderator** | Reviews reports, removes content, restricts accounts | Safety |

Supply is always the constraint. Askers come easily because people always have problems. Helpers
have to be recruited, notified at the right moment, and rewarded. Most design effort should go to
the helper side.

---

## 3. Why would anyone help? (motivation model)

Neighbourly help is mostly **cheap for the helper and valuable to the asker**: lending a ladder,
telling someone the water is back at 6 pm, recognising a lost dog. The app's job is to:

1. **Lower the cost of helping.** One tap on "I can help". Information-only help counts.
   No forms, no commitment ceremony.
2. **Make help visible.** A thank-you, karma, solver history, "neighbours helped" count.
   Being recognised by your community is a stronger motivator than points.
3. **Reward outcomes, not activity.** Karma is earned when the *asker confirms* it worked.
   Commenting, offering, or posting earns nothing.
4. **Trigger reciprocity.** "Your neighbour Anna helped 12 people" signals a helping norm.
   Showing that norm makes people more likely to follow it.

### Why no money in the MVP

Paying for help **crowds out** intrinsic motivation (motivation-crowding effect). Once a favour has
a price, people start asking "is €5 worth my time?" instead of "it's my neighbour". If payments
ever arrive, they should be a **separate product surface** (paid tasks) with its own rules, and
must never be mixed into neighbourly help or its karma.

---

## 4. The hardest problem: local liquidity (cold start)

A hyperlocal network only works if **enough helpers exist inside the radius** when a problem is
posted. Network effects here are *local*:

- 100,000 users spread across a country → useless. Nobody is near anybody.
- 2,000 users in one neighbourhood → works.

### Liquidity definition (the metric that decides if HelpIn works)

> **Liquidity = % of open problems that receive ≥ 1 help offer within 2 hours** (non-emergency),
> measured per district.
> Launch target: **≥ 60%**. Below ~30% askers churn and never come back.

### Strategy

1. **Many small networks, one city.** HelpIn launches across **all of Budapest** at once (founder
   decision Q14). Because liquidity is local, Budapest is treated as many small networks, not one
   big one: liquidity is measured **per district**, and recruitment starts in a few dense seed
   hubs before spreading (see "Budapest launch" below). The launch area is an explicit config
   object in the system (Architecture §11), not an informal idea.
2. **Seed supply before demand.** Recruit "founding helpers" (20–50 per seed hub: university
   students, residents' association and civic volunteers, active members of district Facebook
   groups) *before* opening to askers. Give them a visible founding badge.
3. **Push notifications are the engine; the map is the view.** People rarely open a map
   spontaneously. They respond to *"Someone ~400 m from you needs a hand moving a sofa"*. Targeted,
   rate-limited, geo-scoped push is the most important liquidity mechanism. The original plan
   didn't have it at all.
4. **Single-player value for shared issues.** "Same here" on a water outage is useful even if
   nobody can fix it: you learn it's not just your flat, and the count grows. This gives early
   users a reason to open the app before helper density exists.
5. **Honest empty states.** "No open problems near you, which is good news. Invite neighbours so
   help is close when you need it." Never fake activity.
6. **Web first, so make installing easy.** HelpIn launches as a web app (PWA). Android and desktop
   browsers support push notifications directly, but iPhones only do once HelpIn is added to the
   Home Screen. Onboarding guides iPhone users through that, and email covers anyone without push.
   Native apps come after the web launch.

### Budapest launch

Launch market: **Budapest, Hungary**, with an **English** interface at first. That suits the
city's large international community: university students, expats and young professionals.
Hungarian follows as the first added language, because most residents, especially older people,
prefer Hungarian.

**Launch area: all 23 districts of Budapest** (founder decision Q14).

The risk is that helpers are spread too thin across a whole city, so many problems get no offer.
The plan counters it with **seed hubs**: founding-helper recruitment and launch marketing
concentrate on a few dense areas first, then spread outward.

| Seed hub | Why |
|---|---|
| **District XI (Újbuda)**, around the BME / ELTE Lágymányos campuses and Bartók Béla út | Thousands of students, many international and English-speaking; natural founding helpers |
| **Districts VIII–IX (Józsefváros / Ferencváros)**, around Corvinus, Semmelweis and Corvin-negyed | Dense, mixed residents and students, many internationals |
| **Districts V–VII and XIII (inner city)** | Budapest's densest residential areas, many expats and young professionals |

Rules for the city-wide launch:
- **Liquidity per district** is the main launch metric. A district counts as "healthy" at ≥ 60%.
- **Sparse areas get wider alerts:** if few helpers are near a problem, the second notification
  wave reaches users who allow a wider radius (~4 km).
- **Honest empty states** per district, with a strong "invite your neighbours" prompt.
- **Recruitment follows the data:** each week, push recruitment in the districts with the most
  unanswered problems.

---

## 5. Not all problems are the same: a taxonomy

The original plan assumes every problem is "owner posts → helper solves → owner confirms". That
fits personal requests but breaks for shared civic issues. A broken streetlight isn't fixed by a
neighbour, and 15 people are affected, so who confirms it's solved?

Two axes:

|                                  | **One person affected**                         | **Many people affected**                               |
|----------------------------------|-------------------------------------------------|--------------------------------------------------------|
| **A neighbour can solve it**     | **Request**: lost keys, need a ladder, car jump-start, pet found | Community task: fallen branch blocking lane, cleanup |
| **Needs an authority / service** | Advice: "who's a reliable plumber?"             | **Issue**: streetlight out, water outage, pothole, drain overflow |

This becomes a first-class field: **`kind = request | issue`**.

| | **Request** | **Issue** |
|---|---|---|
| Default categories | People: need a hand, lost & found, borrow/lend, elderly support, pets, vehicle help | Environment (garbage, rivers/lakes/ponds, parks, trees, pollution), roads & public spaces, utilities |
| Value to users | Someone actually solves it | Aggregation ("23 affected"), status updates, collective pressure |
| Who confirms solved | The asker | The original reporter, **or** ≥ 3 affected users confirming "fixed", **or** auto-expire |
| Karma | Helpers credited by the asker | Helpers who contributed (e.g. filed the complaint, posted the fix ETA), credited by the reporter. MVP: same flat amount. |
| Duplicates | Rare | **Common**, so this is where incident grouping matters |

The category sets the default `kind`, and the user can override it. Both kinds share one state
machine (see Domain Model §4), so this costs very little to build but avoids a redesign later.

**Any problem can be posted:** human problems, environmental problems (dirty areas, local rivers,
ponds, lakes, parks), road problems, utilities, safety, or anything else. The full catalogue is in
Domain Model §11. Environmental problems are often **community tasks**: a pond can't be cleaned
by one person, but ten neighbours on a Sunday can. HelpIn should make organising that as easy as
asking for a ladder.

---

## 5b. Live problems: progress updates and asker accountability

A map of problems is only useful if the problems on it are **real and current**. Two things make
that true:

1. **Progress updates.** The asker posts updates on the problem's tab ("Got one person, need one
   more after 6 pm"; "Need has changed: now need a plumber, not tools"). Helpers can see exactly
   what is still needed before they offer, so less help is wasted and more problems get solved.
2. **Accountability.** Once neighbours start helping a **personal** problem, the raiser owes them
   a response. If the raiser stays silent for **2 days** after help started, they **lose karma**.
   If nobody (raiser or helpers) updates the problem for 2 days, it's also removed from the map.
   Without this, the map fills with ghosts: problems already solved, or no longer needed, that
   helpers waste time on until they stop trusting the app.

The rule is designed to be **fair**:
- **No help, no clock.** Nobody is penalised before anyone has offered to help.
- **Silence is penalised, honesty never is.** Withdrawing ("no longer needed") is always free.
- Reminders at 24 h and 44 h come before any penalty, each with one-tap answers: *Still need help*
  · *It's solved* · *Withdraw*. Replying to a helper in chat also counts.
- **Helpers keep it alive.** If helpers keep posting updates, the problem stays on the map even
  while the raiser is quiet. The raiser still loses karma for ignoring them.
- **Community problems carry no penalties.** Nobody should be punished for reporting a polluted
  pond or a broken road. Those stay open until fixed (raiser confirms, or 3 affected neighbours
  confirm "Fixed now"), withdrawn, or their maximum lifetime ends.

This also fixes the biggest weakness of the core loop. Askers who got help but never tap
"Confirm solved" now have a reason to: the reminder offers *It's solved* as the easiest answer.
Exact rules: Domain Model §4.6–4.7.

---

## 6. Karma theory

Karma is a **public signal of trustworthy helpfulness**. To mean anything it must be:

1. **Earned by outcomes.** Only the asker's confirmation creates karma.
2. **Hard to fake.**
3. **Legible.** Users understand why they got it.
4. **Not convertible to money** (MVP).

### The threat: Goodhart's law

Once karma is a target, people optimise for karma instead of help:

| Attack | Example | Mitigation |
|---|---|---|
| **Collusion farming** | Two friends post fake problems and confirm each other | Pair cap: the same asker→helper pair earns karma at most once per 7 days, and lifetime karma from one asker is capped. Velocity flags go to moderation. |
| **Sockpuppets** | One person with 5 accounts | Phone verification required to earn karma; new accounts (< 24 h) can't earn; one account per phone number |
| **Confirmation pressure** | "Confirm or I won't help next time" | Askers can report a helper; confirmation is private until done; users can never give each other negative karma (so no retaliation loop) |
| **Ghost problems** | Asker gets help, then disappears without confirming | Response rule (personal problems): 2 days of silence after help started → system karma penalty (−5, escalating); removed if nobody is active. This is the only karma loss besides moderator reversals. |
| **Credit grabbing** | Helper claims solved when they didn't help | Only the asker chooses who to credit; helpers can only *suggest* |
| **Low-effort spam** | Offering help on everything | Offering earns nothing; only confirmed outcomes do |

### What to display publicly

- **Karma points**: the headline number. It can go negative through abandonment penalties.
- **Reliability**: "Responds to helpers: 92%", how reliably the user answers people who offer
  help. It's the asker-side trust signal.
- **"Neighbours helped"**: the count of *unique* people helped. It's much harder to farm than raw
  karma and is the more honest trust signal.
- **Solver history**: the list of solved problems (category, area, date), not the private details.

**Askers earn a little too:** +2 karma for closing the loop (confirming solved and crediting a
helper), capped at 5 per week, so fake problems never pay. Helpers earn +10, because helping
is the scarce thing.

Karma is stored as an **append-only ledger**. The balance is derived from it. Every award can be
reversed by a compensating entry, such as after a fraud finding (see Domain Model §6).

---

## 7. Trust & safety theory

This app connects strangers **in the physical world**, so the possible harms are physical too:
stalking, harassment, unsafe meetups, scams (e.g. fake "lost pet reward" schemes), false
emergencies, misinformation about civic issues.

Safety principles:

1. **Area, not address.** Public problems show an approximate area (a hexagonal cell roughly
   0.7 km² by default), never a point. See Domain Model §5.
2. **Progressive disclosure.** Exact location is shared only by the asker's explicit action, only
   with an accepted helper, inside chat, and it's deleted after closure.
3. **No cold DMs.** Chat exists only in the context of a problem (helper ↔ asker). Nobody can
   message an arbitrary user. This removes most harassment vectors.
4. **Friction proportional to risk.** New accounts get lower rate limits. Emergency posts show a
   "call 112 first" interstitial and require a verified phone.
5. **Strip hidden data.** Photo EXIF metadata (including GPS) is removed server-side before any
   photo is visible. Without this, a "private" problem photo leaks the exact location.
6. **Safety ships with the feature it protects.** Report/block must exist before any
   user-generated content reaches other users. The original plan put moderation in Phase 8,
   which is too late. The EU Digital Services Act also requires an easy reporting mechanism, a reason given for removals, and an appeal path.
7. **HelpIn is not an emergency service**, and the UI must say so wherever urgency is "Serious".

Launch market: **Budapest, Hungary (EU)**. 112 is the EU-wide emergency number.

---

## 8. The social feed: role and guardrails

**Why have a feed at all?** Most people have a real problem only a few times a month, so the
problem loop alone doesn't give a reason to open the app daily. A local photo feed gives a
low-stakes habit and builds a sense of "my neighbourhood". That makes people more willing to help
when a problem does show up.

**Why it's dangerous:** feeds are addictive by design and can easily become the whole product.
At that point HelpIn is just another Instagram clone that loses to Instagram.

Guardrails:

1. **Problems is the default tab.** The app always opens on the map.
2. **Feed is local and chronological.** No algorithmic ranking or infinite engagement
   optimisation in the MVP.
3. **Hard separation.** Problem photos belong to problems; feed photos belong to posts. Different
   tables, different storage buckets, different profile tabs. Nothing can be cross-posted.
4. **The Create screen forks clearly:** "Report a problem" (primary, large) vs "Share a post"
   (secondary).
5. **A guardrail metric:** the share of weekly active users who view or act on a problem. If feed
   usage grows while that share falls, stop and revisit.
6. **Ship it after the core loop is proven** (see Roadmap Phase 5).

---

## 9. Product principles (decision rules)

When in doubt, apply these in order:

1. **Closure over conversation.** Prefer features that move a problem to Solved.
2. **Area, not address.** Default to less location precision.
3. **Outcomes earn reputation; activity doesn't.**
4. **One tap to help.** Every extra step on the helper side costs liquidity.
5. **Notifications are the engine, the map is the view.**
6. **Safety ships with the feature, not after it.**
7. **Model for clustering on day one, automate it later.** Every problem belongs to an incident
   from the start, so AI grouping later is a background job, not a migration.
8. **Problems first, feed second.**
9. **Help deserves a response.** Once someone offers help, the raiser answers within 2 days.
   Community problems are exempt.

---

## 10. Success metrics

**North-star metric: confirmed solves per week, per district.**

| Type | Metric | Launch target |
|---|---|---|
| Liquidity | % problems with ≥ 1 offer within 2 h | ≥ 60% |
| Liquidity | Median time to first offer | < 30 min |
| Outcome | Solve rate (% solved before expiry) | ≥ 40% |
| Outcome | Confirmation rate (helper marked done → asker confirmed) | ≥ 70% |
| Supply | % of WAU who offered help at least once (30 d) | ≥ 15% |
| Supply | Repeat helpers (helped ≥ 2 times in 30 d) | Growing week over week |
| Guardrail | Reports per 100 problems | < 3 |
| Guardrail | Notification opt-out rate | < 10% |
| Guardrail | Share of WAU touching Problems (vs only Feed) | ≥ 70% |

These are hypotheses for the Budapest launch, measured per district. Recalibrate after 4 weeks of real data.

---

## 11. Key risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Not enough helpers nearby (cold start), made worse by a city-wide launch | High | Fatal | Seed hubs, founding helpers, liquidity tracked per district, wider second-wave alerts in sparse areas, push engine, single-player value for issues |
| Web push weak on iPhone (needs Home Screen install) | High | High | Guided "Add to Home Screen" step, email fallback, track push opt-in per platform, native apps next |
| English-only UI limits reach among Hungarian residents | High | Medium | Start where English works (students, internationals); all strings i18n-ready; Hungarian as the first added language |
| Anonymous posting used for fake problems or abuse | Medium | Medium | Accountable anonymity (HelpIn knows the author), "Fake problem" reports, −20 karma and loss of anonymous posting, restriction on repeat |
| Askers don't confirm, so the loop never closes | High | High | 2-day response rule with penalty; reminders offer one-tap "It's solved"; helper "I think it's solved" nudge |
| Map fills with stale problems | High | High | Personal problems with no activity for 2 days after help started are removed; "Updated 2 h ago" freshness on every card |
| Penalty feels unfair, so people stop posting | Medium | Medium | No clock until help starts; withdraw is always free; reminders at 24 h and 44 h; community problems exempt; small first penalty; moderator can void |
| Feed eats the product | Medium | High | §8 guardrails, ship feed later |
| Safety incident (stalking/harassment) | Low–Medium | Fatal for trust | Area-only location, no cold DMs, EXIF stripping, block/report from day one, 18+ only |
| Karma farming | Medium | Medium | §6 mitigations, ledger reversibility |
| False emergencies / panic | Medium | High | Verified-only emergency posts, interstitial, rapid moderation |
| Notification fatigue | Medium | High | Per-user daily caps, radius & category controls, quiet hours |
| Civic issues never "close" | High | Medium | Issue-kind resolution rules (affected-user confirmation, auto-expiry) |

---

## 12. Explicitly NOT in the MVP

Payments · AI clustering (use a manual "Same issue" button instead, which also produces labelled
training data for later) · algorithmic feed · stories/reels · open DMs · business/brand accounts ·
integrations with civic authorities · native iOS/Android apps (web first; native planned next) ·
multiple languages (English only, but i18n-ready
strings from day one).
