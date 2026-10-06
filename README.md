# HelpIn

**A social platform where Budapest's locals, newcomers and communities help one another.**

HelpIn is a hyperlocal, map-first social platform for **mutual help**. People post real-world
problems in an approximate area, from understanding a letter from the district office to a
polluted pond. Neighbours, whether locals or newcomers, offer help for free, and the asker confirms
when it's solved. Helpers earn karma. Around that loop sits a social layer: a local feed, thank-you
posts, and communities. HelpIn is **not** a gig or task marketplace: no prices, jobs or paid work.

**Launching in Budapest, Hungary · web app first (installable PWA), native apps later · English.**

> **Status:** the MVP is built: API, worker, Postgres schema and the web app, wired together.
> It's ready for a private beta once the production providers (SMS, email, storage, Web Push).
> are configured and the legal drafts are reviewed. See [what's left before launch](#before-a-public-launch).

## Run HelpIn locally

Requires **Node 22**, **pnpm 10** and **Postgres 16**.

```bash
pnpm install

# 1. A database and a user (once)
createuser -s helpin --pwprompt            # password: helpin
createdb -O helpin helpin
createdb -O helpin helpin_test             # for the API tests

# 2. Configuration (once)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. Schema + demo data
pnpm db:migrate
pnpm db:seed                               # a believable week in District XI

# 4. API (8787) + worker + web app (5173) together
pnpm dev
```

Open http://localhost:5173 and either **create an account** with the form (name, email,
password), or tap **"Use a code instead"** and sign in as a demo neighbour with a phone number
and the code **123456** (`AUTH_DEV_CODE`; the API also prints every code it "sends" to its log).
New accounts can explore right away; the app asks to verify a phone the first time you post a
problem or offer help (ADR-030).


| Phone | Who |
|---|---|
| `30 000 0001` | **Zsófi K.**, a local language buddy with karma and photo posts |
| `30 000 0002` | **Arjun S.**, a newcomer whose letter Zsófi helped with |
| `30 000 0003` | **Bence T.**, a cyclist who has offered to lend Wei a drill |
| `30 000 0005` | **Lili R.**, who organises the pond clean-ups |
| `30 000 0006` | **Olena K.**, chatting with Zsófi about a GP |
| `30 000 0007` | **Réka M.**, who reported the water outage and a lost cat |
| `30 000 0008` | **Wei L.**, waiting for a reply about the drill |

Any other number creates a new account and walks you through onboarding. To use the admin
area, put your email in `ADMIN_EMAILS` in `apps/api/.env`, sign in with that email, and set up
2FA when asked.

```bash
pnpm db:reset && pnpm db:seed          # start over (refuses to run in production)
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # what CI runs
node e2e/two-neighbours.mjs            # two browsers, real stack: offer → accept → live chat
```

### How it fits together

| Path | What it is |
|---|---|
| `apps/web` | React 19 + Vite PWA: TanStack Router & Query, Tailwind v4, MapLibre + H3, Web Push service worker |
| `apps/api` | Fastify 5 API (`src/server.ts`) and worker (`src/worker.ts`) in one package: modules for identity, problems, help, chat, media, social, notifications and safety |
| `apps/api/src/jobs` | Outbox dispatcher, event consumers (nearby alerts, karma, notifications, media processing) and scheduled jobs (response rule sweep, reminders, privacy purge) |
| `packages/domain` | The rulebook as pure functions (offers, response rule, karma, quorum), unit-tested without a database |
| `packages/db` | SQL migrations, the migration runner, generated Kysely types and the Budapest launch area |
| `packages/config` | Categories, karma and response-rule numbers, rate limits, languages (one source of truth) |
| `packages/contracts` | Zod schemas for every API shape; tests assert no public shape leaks an exact location, phone or email |
| `packages/geo` | H3 helpers: snapping a point to its public area, cells for the map |

Every write runs in one transaction: lock → decide (pure domain rule) → write → append outbox
events. The worker delivers events at least once to idempotent consumers. Realtime updates go
through `pg_notify` and a Server-Sent Events stream. Auth, storage and realtime are self-hosted
behind adapters ([ADR-029](docs/05-decisions.md)).

### Configuration

Everything is set through environment variables; [`apps/api/.env.example`](apps/api/.env.example)
documents each one. For production you need:

- `NODE_ENV=production`, a random `JWT_SECRET` of 32+ characters, and **no** `AUTH_DEV_CODE`
- `SMS_PROVIDER=twilio` (+ credentials)
- Email through **Brevo** and photos in **Cloudflare R2**: follow
  [docs/07-email-and-storage.md](docs/07-email-and-storage.md), then run
  `pnpm --filter @helpin/api check:providers -- --email you@example.com`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) for push
- `ADMIN_EMAILS` for the founder's account, `WEB_ORIGINS`, `PUBLIC_API_URL` and `WEB_URL`
- `VITE_API_URL` when building the web app

To put it online, see [docs/08-deploy.md](docs/08-deploy.md) (Render + Neon, one service). The API runs migrations on start. Run one API process per CPU behind HTTPS, and one or more
worker processes (jobs use leases, so extra workers are safe).

### Before a public launch

- **Untested against real services:** Brevo and R2 are tested against local stand-ins (an S3
  emulator and a TLS SMTP server); run `check:providers` once your accounts exist. Twilio and real
  Web Push delivery have only run against their development stand-ins.
- **Legal pages** (`/legal/*`) are drafts with placeholders for the operator's details; a lawyer
  should review them (ADR-019, ADR-025).
- **District tags** for the launch area are approximate (nearest district centre per H3 cell);
  replace them with official district boundaries before relying on district statistics.
- **Map tiles** come from OpenFreeMap; pick a production tile provider and add it to the privacy
  notice.

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
| 07 | [Email & photo storage](docs/07-email-and-storage.md) | Setting up Brevo and Cloudflare R2, step by step, and checking they work |
| 08 | [Deploying](docs/08-deploy.md) | Putting HelpIn online on Render + Neon (free tier), private test mode, installing on a phone |
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
