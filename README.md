# HelpIn

**A social platform where Budapest's locals, newcomers and communities help one another.**

HelpIn is a hyperlocal, map-first social platform for **mutual help**. People post real-world
problems in an approximate area, from understanding a letter from the district office to a
polluted pond. Neighbours, whether locals or newcomers, offer help for free, and the asker confirms
when it's solved. Helpers earn karma. Around that loop sits a social layer: a local feed, thank-you
posts, and communities. HelpIn is **not** a gig or task marketplace: no prices, jobs or paid work.

**Launching in Budapest, Hungary · web app first (installable PWA), native apps later · English.**

> **Status:** planning complete, all decisions made. This repository holds the plan, theory and
> architecture the app will be built from. No application code yet.

**Start here → [HelpIn MVP Plan v2](docs/00-helpin-plan.md)**, the complete plan in one document.

## Documents

| # | Doc | What it answers |
|---|---|---|
| 00 | [**MVP Plan v2**](docs/00-helpin-plan.md) | The whole plan in one place: the original plan + 7 strengthenings + progress updates, the 2-day response rule and open categories |
| 01 | [Product Theory](docs/01-product-theory.md) | Why this should exist, why people help, cold start, problem taxonomy (requests vs issues), karma & safety theory, feed guardrails, metrics, risks |
| 02 | [Domain Model](docs/02-domain-model.md) | Vocabulary, modules, entities, state machines, and the numbered rulebook (`R-`, `K-`, `L-`, `C-`, `F-`, `S-`) |
| 03 | [Architecture](docs/03-architecture.md) | Stack, modular monolith, data layer, outbox/worker, media pipeline, notifications, realtime, API, web app, security, testing, deployment, scaling, extension points |
| 04 | [MVP Roadmap](docs/04-mvp-roadmap.md) | Revised build phases with exit criteria; Definition of Done mapped to tests |
| 05 | [Decisions & Open Questions](docs/05-decisions.md) | ADRs (what we chose and why) and the questions only the founder can answer |
| 06 | [Pages, Components & Buttons](docs/06-ui-spec.md) | Every page and route, the shell layout, design tokens, the component library, every button (who sees it, what it does, which API), sheets, error messages, empty states |
| — | [schema-draft.sql](docs/schema-draft.sql) | Postgres schema, the starting point for migration 0001 (validated on Postgres 16) |

## The plan in one screen

- **Core loop:** Create problem → approximate area → photos → nearby map → *I can help* → chat →
  progress updates → solution → asker confirms → auto-close → karma.
- **Any problem:** people, environment (dirty areas, rivers, lakes, ponds, parks), roads,
  utilities, safety, or anything else.
- **Respond to your helpers:** once people start helping a personal problem, the raiser must
  respond within 2 days or lose karma. If nobody (raiser or helpers) updates it for 2 days, it's
  removed. Community problems are never penalised. Withdrawing is always free.
- **Two kinds of problems:** *requests* (a neighbour can solve it, the asker confirms) and
  *issues* (shared/civic, many affected, "Same here" + quorum resolution).
- **Incidents from day one:** the map shows incidents. Duplicates are grouped manually now
  ("Same here") and by AI later, without schema changes.
- **Privacy by structure:** public location is an H3 hexagon (~0.7 km²), the exact point sits in
  a separate private table and is purged after closure, and photo EXIF/GPS is stripped.
- **Karma:** outcome-based, append-only ledger, anti-farming rules, plus "neighbours helped" as
  the honest trust signal.
- **Anonymous posting:** allowed and accountable. Fake problems cost karma and the right to post
  anonymously.
- **Notifications are the engine:** geo-targeted, rate-limited Web Push (email fallback) to
  nearby helpers.
- **Stack:** React + Vite PWA with MapLibre · Fastify modular monolith + worker · Supabase in the
  EU (Postgres, Auth with phone/email codes, Storage, Realtime) · shared `contracts` / `domain` /
  `geo` / `api-client` packages · transactional outbox.
- **EU-ready:** GDPR (EU data residency, export, deletion) and Digital Services Act (reporting,
  statements of reasons, appeals).
- **Launch:** all of Budapest, run as many small networks: founding helpers recruited in seed
  hubs first, liquidity (≥ 60% of problems get an offer within 2 h) tracked per district.
- **Operated by** the founder (sole admin and legal operator) until funding and a company.

## Navigation

`Problems | Community | ⊕ Create | Chat | Profile` (bottom bar on phones, sidebar on desktop), and the
app always opens on **Problems**.
