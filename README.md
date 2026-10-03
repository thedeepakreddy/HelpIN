# HelpIN

**See a nearby problem → help → solve it → earn reputation.**

HelpIN is a hyperlocal, map-first app where people post real-world problems in an approximate
area, neighbours offer help, and the person who asked confirms when it's solved. Solved problems
close automatically, and helpers earn karma. A separate local photo feed exists, but it stays
secondary to the problem-solving loop.

> **Status:** design phase. This repository currently holds the product theory and architecture
> the app will be built from. No application code yet.

## Documents

| # | Doc | What it answers |
|---|---|---|
| 01 | [Product Theory](docs/01-product-theory.md) | Why this should exist, why people help, cold start, problem taxonomy (requests vs issues), karma & safety theory, feed guardrails, metrics, risks |
| 02 | [Domain Model](docs/02-domain-model.md) | Vocabulary, modules, entities, state machines, and the numbered rulebook (`R-`, `K-`, `L-`, `C-`, `F-`, `S-`) |
| 03 | [Architecture](docs/03-architecture.md) | Stack, modular monolith, data layer, outbox/worker, media pipeline, notifications, realtime, API, mobile app, security, testing, deployment, scaling, extension points |
| 04 | [MVP Roadmap](docs/04-mvp-roadmap.md) | Revised build phases with exit criteria; Definition of Done mapped to tests |
| 05 | [Decisions & Open Questions](docs/05-decisions.md) | ADRs (what we chose and why) and the questions only the founder can answer |
| — | [schema-draft.sql](docs/schema-draft.sql) | Postgres schema, the starting point for migration 0001 (validated on Postgres 16) |

## The plan in one screen

- **Core loop:** Create problem → approximate area → photos → nearby map → *I can help* → chat →
  solution → asker confirms → auto-close → karma.
- **Two kinds of problems:** *requests* (a neighbour can solve it, the asker confirms) and
  *issues* (shared/civic, many affected, "Same here" + quorum resolution).
- **Incidents from day one:** the map shows incidents. Duplicates are grouped manually now
  ("Same here") and by AI later, without schema changes.
- **Privacy by structure:** public location is an H3 hexagon (~0.7 km²), the exact point sits in
  a separate private table and is purged after closure, and photo EXIF/GPS is stripped.
- **Karma:** outcome-based, append-only ledger, anti-farming rules, plus "neighbours helped" as
  the honest trust signal.
- **Notifications are the engine:** geo-targeted, rate-limited push to nearby helpers.
- **Stack:** Expo (React Native, TypeScript) · Fastify modular monolith + worker · Supabase
  (Postgres, Auth, Storage, Realtime) · shared `contracts` / `domain` / `geo` packages ·
  transactional outbox · Expo Push.
- **Launch:** one dense area first, founding helpers, expand only when liquidity ≥ 60%.

## Navigation

`Problems | Feed | ⊕ Create | Chat | Profile`, and the app always opens on **Problems**.
