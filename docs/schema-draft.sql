-- =============================================================================
-- HelpIn — schema draft (Postgres 16, no extensions required)
--
-- This is the starting point for migration 0001. Rule IDs (R-xx, K-xx, L-xx, ...)
-- refer to docs/02-domain-model.md.
--
-- Conventions
--   * All app tables live in schema `app`, which is NOT exposed through Supabase's
--     Data API. The API service is the only writer (ADR-002).
--   * Enumerations are text + CHECK (easier to evolve than Postgres enums).
--   * H3 cell ids are stored as 15-char lowercase hex text.
--   * Timestamps are timestamptz, UTC.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

CREATE DOMAIN app.h3_cell AS text CHECK (VALUE ~ '^[0-9a-f]{15}$');

-- -----------------------------------------------------------------------------
-- Identity & profiles
-- -----------------------------------------------------------------------------

CREATE TABLE app.users (
  id                 uuid PRIMARY KEY,                 -- = Supabase auth.users.id (JWT sub)
  role               text NOT NULL DEFAULT 'user'
                       CHECK (role IN ('user', 'moderator', 'admin')),
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'restricted', 'deleted')),
  phone_verified_at  timestamptz,                      -- ADR-018: mandatory to use the app
  adult_confirmed_at timestamptz,                      -- S-01
  on_notice_until    timestamptz,                      -- K-13: 1 problem/day while set
  anonymous_banned_until timestamptz,                  -- K-16 / A-05
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz                       -- S-07: row kept, PII scrubbed
);

CREATE TABLE app.media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES app.users(id),
  purpose        text NOT NULL
                   CHECK (purpose IN ('problem_photo', 'post_photo', 'avatar', 'chat_image',
                                      'community_cover')),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'ready', 'rejected', 'deleted')),
  content_type   text NOT NULL,
  bytes          integer NOT NULL CHECK (bytes > 0 AND bytes <= 10 * 1024 * 1024),
  width          integer,
  height         integer,
  blurhash       text,
  storage_prefix text,                                 -- media/{id}/ once processed
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);
CREATE INDEX media_pending_idx ON app.media (created_at) WHERE status IN ('pending', 'processing');

CREATE TABLE app.profiles (
  user_id           uuid PRIMARY KEY REFERENCES app.users(id),
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio               text CHECK (char_length(bio) <= 300),
  avatar_media_id   uuid REFERENCES app.media(id),
  home_cell_r7      app.h3_cell,                       -- L-05: res-7 cell only, never a point
  languages         text[] NOT NULL DEFAULT '{}',       -- LANG-01: e.g. {hu,en,uk}
  is_newcomer       boolean NOT NULL DEFAULT false,     -- "New to Budapest" badge (optional)
  karma_balance     integer NOT NULL DEFAULT 0,        -- cache of karma_entries (K-08)
  neighbours_helped integer NOT NULL DEFAULT 0,        -- cache (K-09)
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.alert_prefs (
  user_id               uuid PRIMARY KEY REFERENCES app.users(id),
  enabled               boolean NOT NULL DEFAULT true,
  ring                  smallint NOT NULL DEFAULT 1 CHECK (ring BETWEEN 0 AND 2),
  categories            text[] NOT NULL DEFAULT '{}',  -- empty = all categories
  min_urgency           text NOT NULL DEFAULT 'basic'
                          CHECK (min_urgency IN ('basic', 'medium', 'serious')),
  daily_cap             smallint NOT NULL DEFAULT 5 CHECK (daily_cap BETWEEN 0 AND 50),
  quiet_start           time,
  quiet_end             time,
  serious_in_quiet      boolean NOT NULL DEFAULT false,
  email_digest          boolean NOT NULL DEFAULT true,  -- nearby alerts by email when no push
  use_active_area       boolean NOT NULL DEFAULT false, -- opt-in "alerts where I am now"
  last_active_cell_r7   app.h3_cell,
  last_active_at        timestamptz
);
CREATE INDEX profiles_home_cell_idx ON app.profiles (home_cell_r7);
CREATE INDEX alert_prefs_active_cell_idx ON app.alert_prefs (last_active_cell_r7)
  WHERE use_active_area AND last_active_cell_r7 IS NOT NULL;

CREATE TABLE app.push_subscriptions (                   -- Web Push now, native push later
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app.users(id),
  kind         text NOT NULL CHECK (kind IN ('webpush', 'native')),
  endpoint     text NOT NULL UNIQUE,                    -- Web Push endpoint URL or native token
  keys         jsonb,                                   -- Web Push p256dh/auth keys
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'webpush' OR keys IS NOT NULL)
);
CREATE INDEX push_subscriptions_user_idx ON app.push_subscriptions (user_id);

CREATE TABLE app.blocks (                               -- S-03
  blocker_id uuid NOT NULL REFERENCES app.users(id),
  blocked_id uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON app.blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- Geo / launch areas
-- -----------------------------------------------------------------------------

CREATE TABLE app.launch_areas (
  id         text PRIMARY KEY,                         -- e.g. 'blr-indiranagar'
  name       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT false,
  flags      jsonb NOT NULL DEFAULT '{}',              -- per-area feature flags
  opened_at  timestamptz
);

CREATE TABLE app.launch_area_cells (                    -- L-10: area = set of res-7 cells
  launch_area_id text NOT NULL REFERENCES app.launch_areas(id),  -- e.g. 'budapest' (ADR-024)
  cell_r7        app.h3_cell NOT NULL,
  district       text NOT NULL,                          -- e.g. 'XI'; per-district metrics
  PRIMARY KEY (cell_r7, launch_area_id)
);

CREATE TABLE app.locality_cache (                       -- L-09: reverse geocode per cell centre
  cell       app.h3_cell PRIMARY KEY,
  locality   text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Problems & incidents
-- -----------------------------------------------------------------------------

CREATE TABLE app.incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('request', 'issue')),
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'solved', 'abandoned', 'expired', 'withdrawn',
                                     'removed', 'merged')),
  area_cell      app.h3_cell NOT NULL,
  area_res       smallint NOT NULL CHECK (area_res IN (7, 8, 9)),
  cell_r8        app.h3_cell,                           -- null when area_res = 7
  cell_r7        app.h3_cell NOT NULL,
  cell_r6        app.h3_cell NOT NULL,
  center_lat     double precision NOT NULL,             -- L-01: cell centre, never exact
  center_lng     double precision NOT NULL,
  locality       text,
  max_urgency    text NOT NULL CHECK (max_urgency IN ('basic', 'medium', 'serious')),
  affected_count integer NOT NULL DEFAULT 1,            -- R-32
  problem_count  integer NOT NULL DEFAULT 1,
  merged_into_id uuid REFERENCES app.incidents(id),     -- R-34 (later)
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
CREATE INDEX incidents_open_r8_idx ON app.incidents (cell_r8) WHERE status = 'open';
CREATE INDEX incidents_open_r7_idx ON app.incidents (cell_r7) WHERE status = 'open';
CREATE INDEX incidents_open_r6_idx ON app.incidents (cell_r6) WHERE status = 'open';
CREATE INDEX incidents_open_cat_idx ON app.incidents (cell_r7, category) WHERE status = 'open';

CREATE TABLE app.problems (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid NOT NULL REFERENCES app.incidents(id),
  owner_id        uuid NOT NULL REFERENCES app.users(id),
  category        text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('request', 'issue')),
  is_anonymous    boolean NOT NULL DEFAULT false,         -- A-01: hidden publicly, known to HelpIn
  language_needed text,                                   -- LANG-02: e.g. 'hu>en'
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  urgency         text NOT NULL CHECK (urgency IN ('basic', 'medium', 'serious')),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'solved', 'abandoned', 'expired', 'withdrawn',
                                      'removed')),
  area_cell       app.h3_cell NOT NULL,
  area_res        smallint NOT NULL CHECK (area_res IN (7, 8, 9)),
  cell_r8         app.h3_cell,
  cell_r7         app.h3_cell NOT NULL,
  cell_r6         app.h3_cell NOT NULL,
  center_lat      double precision NOT NULL,
  center_lng      double precision NOT NULL,
  launch_area_id  text NOT NULL REFERENCES app.launch_areas(id),
  -- Raiser response rule (§4.7) — personal problems only
  response_due_at  timestamptz,                           -- R-52: null until the first help offer
  reminder_stage   smallint NOT NULL DEFAULT 0            -- R-54: 0 none, 1 = 24 h sent,
                     CHECK (reminder_stage BETWEEN 0 AND 2), --   2 = 44 h sent; reset on response
  last_raiser_response_at timestamptz,                    -- R-53
  last_activity_at timestamptz NOT NULL DEFAULT now(),    -- R-56: raiser response or helper update
  penalized_at     timestamptz,                           -- R-55: at most once per problem
  max_life_at      timestamptz NOT NULL,                  -- R-57: expiry without penalty
  solved_at       timestamptz,
  solved_via      text CHECK (solved_via IN ('asker', 'fixed_quorum')),   -- R-20/R-21
  credit_deadline timestamptz,                           -- R-22
  closed_at       timestamptz,                           -- set on any terminal transition
  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (area_res <> 9 OR kind = 'issue'),               -- L-02
  CHECK (kind = 'request' OR (response_due_at IS NULL AND penalized_at IS NULL)), -- R-50, R-58
  CHECK ((area_res = 7) = (cell_r8 IS NULL)),
  CHECK (status <> 'solved' OR (solved_at IS NOT NULL AND solved_via IS NOT NULL)),
  CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX problems_incident_idx ON app.problems (incident_id);
CREATE INDEX problems_owner_idx ON app.problems (owner_id, created_at DESC);
CREATE INDEX problems_response_due_idx ON app.problems (response_due_at)
  WHERE status = 'open' AND response_due_at IS NOT NULL;
CREATE INDEX problems_inactivity_idx ON app.problems (last_activity_at)
  WHERE status = 'open' AND response_due_at IS NOT NULL;
CREATE INDEX problems_max_life_idx ON app.problems (max_life_at) WHERE status = 'open';

CREATE TABLE app.problem_private_locations (            -- L-03: never joined by public reads
  problem_id  uuid PRIMARY KEY REFERENCES app.problems(id) ON DELETE CASCADE,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m  real,
  purge_after timestamptz                               -- L-07: closed_at + 7 days
);
CREATE INDEX problem_private_locations_purge_idx
  ON app.problem_private_locations (purge_after) WHERE purge_after IS NOT NULL;

CREATE TABLE app.problem_updates (                      -- R-40..R-46: progress timeline
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id      uuid NOT NULL REFERENCES app.problems(id),
  author_id       uuid NOT NULL REFERENCES app.users(id),
  author_role     text NOT NULL CHECK (author_role IN ('asker', 'affected', 'helper')), -- R-42
  progress_status text NOT NULL CHECK (progress_status IN (
                    'still_need_help', 'making_progress', 'partly_solved', 'need_changed', 'note')),
  body            text CHECK (char_length(body) <= 500),
  status          text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (progress_status <> 'need_changed' OR coalesce(char_length(body), 0) > 0), -- R-46
  CHECK (progress_status <> 'note' OR coalesce(char_length(body), 0) > 0)
);
CREATE INDEX problem_updates_problem_idx ON app.problem_updates (problem_id, created_at DESC);

CREATE TABLE app.problem_photos (                       -- photos on the report and its updates
  media_id   uuid PRIMARY KEY REFERENCES app.media(id), -- a media item is used once (F-03)
  problem_id uuid NOT NULL REFERENCES app.problems(id),
  update_id  uuid REFERENCES app.problem_updates(id),   -- null = attached to the original report
  position   smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_photos_problem_idx ON app.problem_photos (problem_id, update_id, position);

CREATE TABLE app.incident_affected (                    -- "Same here" (R-30, R-31)
  incident_id        uuid NOT NULL REFERENCES app.incidents(id),
  user_id            uuid NOT NULL REFERENCES app.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  fixed_confirmed_at timestamptz,                       -- R-21 "Fixed now"
  PRIMARY KEY (incident_id, user_id)
);
CREATE INDEX incident_affected_user_idx ON app.incident_affected (user_id);

CREATE TABLE app.incident_merges (                      -- R-34 (later): audit / undo
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     uuid NOT NULL REFERENCES app.incidents(id),
  into_id     uuid NOT NULL REFERENCES app.incidents(id),
  merged_by   text NOT NULL CHECK (merged_by IN ('moderator', 'ai')),
  actor_id    uuid REFERENCES app.users(id),
  confidence  real,
  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);

-- -----------------------------------------------------------------------------
-- Help & resolution
-- -----------------------------------------------------------------------------

CREATE TABLE app.help_offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id        uuid NOT NULL REFERENCES app.problems(id),
  helper_id         uuid NOT NULL REFERENCES app.users(id),
  message           text CHECK (char_length(message) <= 500),
  status            text NOT NULL DEFAULT 'offered'
                      CHECK (status IN ('offered', 'accepted', 'declined', 'withdrawn',
                                        'credited', 'closed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  claimed_solved_at timestamptz,                         -- R-14
  resolved_at       timestamptz,                         -- credited / closed / declined / withdrawn
  UNIQUE (problem_id, helper_id)                         -- R-11
);
CREATE INDEX help_offers_helper_idx ON app.help_offers (helper_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Karma ledger (append-only, ADR-004)
-- -----------------------------------------------------------------------------

CREATE TABLE app.karma_entries (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES app.users(id),     -- who receives
  source_user_id    uuid REFERENCES app.users(id),              -- asker who credited
  amount            integer NOT NULL,
  reason            text NOT NULL CHECK (reason IN (
                      'solve_award',         -- K-01
                      'pair_cooldown',       -- K-05 (amount 0)
                      'pair_cap',            -- K-06 (amount 0)
                      'ineligible_account',  -- K-07 (amount 0)
                      'closing_award',       -- K-11: asker closed the loop (+2)
                      'abandonment_penalty', -- K-12/K-13: ignored helpers (amount < 0, system)
                      'fake_problem_penalty',-- K-16: moderator-upheld fake problem (−20)
                      'reversal'             -- K-08
                    )),
  problem_id        uuid REFERENCES app.problems(id),
  help_offer_id     uuid REFERENCES app.help_offers(id),
  reverses_entry_id bigint UNIQUE REFERENCES app.karma_entries(id), -- K-08: at most once
  created_at        timestamptz NOT NULL DEFAULT now(),

  CHECK (source_user_id IS NULL OR source_user_id <> user_id),       -- K-04
  CHECK ((reason = 'reversal') = (reverses_entry_id IS NOT NULL)),
  CHECK (reason NOT IN ('pair_cooldown', 'pair_cap', 'ineligible_account') OR amount = 0),
  CHECK (reason <> 'abandonment_penalty'
         OR (amount < 0 AND source_user_id IS NULL AND problem_id IS NOT NULL)),
  CHECK (reason <> 'solve_award' OR amount > 0),
  CHECK (reason <> 'closing_award'
         OR (amount > 0 AND source_user_id IS NULL AND problem_id IS NOT NULL)),
  CHECK (reason <> 'fake_problem_penalty'
         OR (amount < 0 AND source_user_id IS NULL AND problem_id IS NOT NULL))
);
CREATE UNIQUE INDEX karma_one_closing_award_per_problem_idx
  ON app.karma_entries (problem_id) WHERE reason = 'closing_award';
CREATE UNIQUE INDEX karma_one_fake_penalty_per_problem_idx
  ON app.karma_entries (problem_id) WHERE reason = 'fake_problem_penalty';
CREATE UNIQUE INDEX karma_one_penalty_per_problem_idx
  ON app.karma_entries (problem_id) WHERE reason = 'abandonment_penalty';
CREATE UNIQUE INDEX karma_one_award_per_offer_idx
  ON app.karma_entries (help_offer_id) WHERE reason <> 'reversal';   -- no double award (R-06)
CREATE INDEX karma_user_idx ON app.karma_entries (user_id, created_at DESC);
CREATE INDEX karma_pair_idx ON app.karma_entries (source_user_id, user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Chat (problem-scoped only, C-01)
-- -----------------------------------------------------------------------------

CREATE TABLE app.conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id    uuid NOT NULL REFERENCES app.problems(id),
  help_offer_id uuid NOT NULL UNIQUE REFERENCES app.help_offers(id),  -- C-02
  read_only_at  timestamptz,                                          -- C-03 / C-04
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_problem_idx ON app.conversations (problem_id);

CREATE TABLE app.conversation_participants (
  conversation_id      uuid NOT NULL REFERENCES app.conversations(id),
  user_id              uuid NOT NULL REFERENCES app.users(id),
  last_read_message_id bigint,
  identity_revealed_at timestamptz,                     -- A-03: anonymous asker revealed profile
  muted                boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_participants_user_idx ON app.conversation_participants (user_id);

CREATE TABLE app.messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- ordered cursor
  conversation_id uuid NOT NULL REFERENCES app.conversations(id),
  sender_id       uuid REFERENCES app.users(id),                    -- null for system
  type            text NOT NULL CHECK (type IN ('text', 'image', 'location', 'system')),
  body            text CHECK (char_length(body) <= 2000),
  media_id        uuid UNIQUE REFERENCES app.media(id),
  location_lat    double precision,
  location_lng    double precision,
  status          text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  purge_after     timestamptz,                                      -- L-07 for location messages
  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK ((type = 'system') = (sender_id IS NULL)),
  CHECK (type <> 'text' OR body IS NOT NULL),
  CHECK ((type = 'image') = (media_id IS NOT NULL)),
  CHECK ((type = 'location') = (location_lat IS NOT NULL AND location_lng IS NOT NULL))
);
CREATE INDEX messages_conversation_idx ON app.messages (conversation_id, id DESC);
CREATE INDEX messages_purge_idx ON app.messages (purge_after) WHERE purge_after IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Communities (§14)
-- -----------------------------------------------------------------------------

CREATE TABLE app.communities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 80),
  type           text NOT NULL CHECK (type IN ('district', 'language_culture', 'students',
                                               'civic_environment', 'interest')),
  description    text CHECK (char_length(description) <= 1000),
  rules          text CHECK (char_length(rules) <= 2000),
  cover_media_id uuid REFERENCES app.media(id),
  created_by     uuid NOT NULL REFERENCES app.users(id),  -- COM-02: admin during beta
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'removed')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.community_members (
  community_id    uuid NOT NULL REFERENCES app.communities(id),
  user_id         uuid NOT NULL REFERENCES app.users(id),
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator')),
  show_on_profile boolean NOT NULL DEFAULT false,         -- COM-06: private by default
  alerts          boolean NOT NULL DEFAULT false,         -- COM-03
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON app.community_members (user_id);

CREATE TABLE app.community_problem_shares (                -- COM-04
  community_id uuid NOT NULL REFERENCES app.communities(id),
  problem_id   uuid NOT NULL REFERENCES app.problems(id),
  shared_by    uuid NOT NULL REFERENCES app.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, problem_id)
);

CREATE TABLE app.community_requests (                      -- "Request a community"
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES app.users(id),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 80),
  type         text NOT NULL,
  reason       text CHECK (char_length(reason) <= 1000),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'created', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Social feed (separate from problems, F-03)
-- -----------------------------------------------------------------------------

CREATE TABLE app.posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id    uuid NOT NULL REFERENCES app.users(id),
  kind         text NOT NULL DEFAULT 'photo'
                 CHECK (kind IN ('photo', 'thank_you', 'welcome')),  -- F-01, F-06, COM-05
  caption      text CHECK (char_length(caption) <= 500),
  cell_r7      app.h3_cell NOT NULL,                     -- F-01
  community_id uuid REFERENCES app.communities(id),      -- optional: shared to one community
  problem_id   uuid REFERENCES app.problems(id),         -- thank-you posts link the solved problem
  status       text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'thank_you') = (problem_id IS NOT NULL)),
  CHECK (kind <> 'welcome' OR community_id IS NOT NULL)
);
CREATE INDEX posts_community_idx ON app.posts (community_id, created_at DESC)
  WHERE community_id IS NOT NULL AND status = 'visible';

CREATE TABLE app.post_tags (                               -- F-06: helpers approve their tag
  post_id    uuid NOT NULL REFERENCES app.posts(id),
  user_id    uuid NOT NULL REFERENCES app.users(id),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX posts_feed_idx ON app.posts (cell_r7, created_at DESC) WHERE status = 'visible';
CREATE INDEX posts_author_idx ON app.posts (author_id, created_at DESC);

CREATE TABLE app.post_media (
  post_id  uuid NOT NULL REFERENCES app.posts(id),
  media_id uuid NOT NULL UNIQUE REFERENCES app.media(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  PRIMARY KEY (post_id, position)
);

CREATE TABLE app.comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES app.posts(id),
  author_id  uuid NOT NULL REFERENCES app.users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  status     text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON app.comments (post_id, created_at);

CREATE TABLE app.reactions (                              -- F-05: one reaction type
  post_id    uuid NOT NULL REFERENCES app.posts(id),
  user_id    uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Safety & moderation
-- -----------------------------------------------------------------------------

CREATE TABLE app.reports (                                 -- S-04
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES app.users(id),
  target_type text NOT NULL CHECK (target_type IN (
                'problem', 'problem_update', 'help_offer', 'message',
                'post', 'comment', 'user', 'community')),
  target_id   text NOT NULL,
  reason      text NOT NULL CHECK (reason IN (
                'fake_problem', 'scam', 'paid_work', 'spam', 'harassment', 'dangerous', 'fraud', 'false_emergency',
                'inappropriate', 'privacy', 'other')),
  details     text CHECK (char_length(details) <= 1000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app.users(id),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_open_idx ON app.reports (created_at) WHERE status = 'open';
CREATE INDEX reports_target_idx ON app.reports (target_type, target_id);

CREATE TABLE app.moderation_actions (                       -- S-06: append-only
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  moderator_id uuid NOT NULL REFERENCES app.users(id),
  action       text NOT NULL CHECK (action IN (
                 'remove', 'restore', 'hide', 'restrict_user', 'unrestrict_user',
                 'reverse_karma', 'view_private_data', 'reveal_anonymous_author',
                 'fake_problem_penalty', 'merge_incidents', 'dismiss_report')),
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  report_id    uuid REFERENCES app.reports(id),
  reason       text NOT NULL,
  statement_of_reasons text,                             -- S-09 / DSA: sent to the affected user
  automated    boolean NOT NULL DEFAULT false,           -- DSA: was the decision automated?
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.appeals (                               -- S-09 / DSA: one appeal per decision
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES app.users(id),
  moderation_action_id bigint NOT NULL UNIQUE REFERENCES app.moderation_actions(id),
  body                 text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  decided_by           uuid REFERENCES app.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_at           timestamptz
);
CREATE INDEX appeals_open_idx ON app.appeals (created_at) WHERE status = 'open';

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

CREATE TABLE app.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id),
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  pushed     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON app.notifications (user_id, created_at DESC);
CREATE INDEX notifications_nearby_today_idx ON app.notifications (user_id, created_at)
  WHERE type = 'nearby_problem';                            -- daily cap check

-- -----------------------------------------------------------------------------
-- Platform: outbox, idempotency, rate limits, job leases
-- -----------------------------------------------------------------------------

CREATE TABLE app.outbox_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type            text NOT NULL,                     -- e.g. 'ProblemSolved'
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dead')),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX outbox_pending_idx ON app.outbox_events (next_attempt_at, id) WHERE status = 'pending';

CREATE TABLE app.outbox_deliveries (                   -- consumer idempotency
  event_id     bigint NOT NULL REFERENCES app.outbox_events(id) ON DELETE CASCADE,
  consumer     text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

CREATE TABLE app.idempotency_keys (                    -- R-07
  user_id      uuid NOT NULL REFERENCES app.users(id),
  key          text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 100),
  request_hash text NOT NULL,
  status_code  smallint,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE app.rate_limit_counters (
  user_id      uuid NOT NULL REFERENCES app.users(id),
  action       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action, window_start)
);

CREATE TABLE app.job_leases (                          -- single-runner cron jobs
  job_name     text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  locked_by    text NOT NULL
);

-- -----------------------------------------------------------------------------
-- Immutability guards (ADR-004, S-06)
-- -----------------------------------------------------------------------------

CREATE FUNCTION app.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER karma_entries_append_only
  BEFORE UPDATE OR DELETE ON app.karma_entries
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

CREATE TRIGGER moderation_actions_append_only
  BEFORE UPDATE OR DELETE ON app.moderation_actions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Defence in depth: enable RLS everywhere with no policies.
-- Supabase's `anon` / `authenticated` roles therefore can read nothing even if the
-- schema were exposed by mistake. The API connects with a role that owns the
-- tables or has BYPASSRLS.
-- -----------------------------------------------------------------------------

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA app FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA app FROM authenticated;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Product metrics (computed from the source of truth; Architecture §14)
-- -----------------------------------------------------------------------------

CREATE VIEW app.metrics_liquidity_daily AS          -- Theory §4: offer within 2 h
SELECT
  p.launch_area_id,
  date_trunc('day', p.created_at) AS day,
  count(*)                                           AS problems,
  count(*) FILTER (WHERE fo.first_offer_at <= p.created_at + interval '2 hours')
                                                     AS offered_within_2h,
  round(100.0 * count(*) FILTER (WHERE fo.first_offer_at <= p.created_at + interval '2 hours')
        / nullif(count(*), 0), 1)                    AS liquidity_pct,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY fo.first_offer_at - p.created_at)
                                                     AS median_time_to_first_offer
FROM app.problems p
LEFT JOIN LATERAL (
  SELECT min(o.created_at) AS first_offer_at FROM app.help_offers o WHERE o.problem_id = p.id
) fo ON true
WHERE p.urgency <> 'serious'
GROUP BY 1, 2;

CREATE VIEW app.metrics_liquidity_by_district AS     -- ADR-024: city-wide, measured per district
SELECT
  c.district,
  date_trunc('week', p.created_at)                   AS week,
  count(*)                                           AS problems,
  round(100.0 * count(*) FILTER (WHERE fo.first_offer_at <= p.created_at + interval '2 hours')
        / nullif(count(*), 0), 1)                    AS liquidity_pct
FROM app.problems p
JOIN app.launch_area_cells c
  ON c.cell_r7 = p.cell_r7 AND c.launch_area_id = p.launch_area_id
LEFT JOIN LATERAL (
  SELECT min(o.created_at) AS first_offer_at FROM app.help_offers o WHERE o.problem_id = p.id
) fo ON true
WHERE p.urgency <> 'serious'
GROUP BY 1, 2;

CREATE VIEW app.metrics_solve_rate_weekly AS
SELECT
  launch_area_id,
  date_trunc('week', created_at)                           AS week,
  count(*) FILTER (WHERE status <> 'open')                 AS closed,
  count(*) FILTER (WHERE status = 'solved')                AS solved,
  round(100.0 * count(*) FILTER (WHERE status = 'solved')
        / nullif(count(*) FILTER (WHERE status <> 'open'), 0), 1) AS solve_rate_pct,
  count(*) FILTER (WHERE status = 'abandoned')             AS abandoned,     -- ADR-014 guardrail
  round(100.0 * count(*) FILTER (WHERE status = 'abandoned')
        / nullif(count(*) FILTER (WHERE status <> 'open'), 0), 1) AS abandonment_rate_pct
FROM app.problems
GROUP BY 1, 2;
