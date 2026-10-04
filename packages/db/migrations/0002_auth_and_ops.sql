-- =============================================================================
-- 0002 — Self-hosted auth, admin 2FA and small additions found while building.
--
-- ADR-029: HelpIn issues its own sessions (phone/email one-time codes through
-- pluggable SMS/email providers) instead of depending on Supabase Auth, so the
-- same API runs on any EU Postgres host. users.id is therefore generated here.
-- =============================================================================

SET search_path = app, public;

ALTER TABLE app.users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ADR-018: sign up with phone or email; phone verification is mandatory.
ALTER TABLE app.users
  ADD COLUMN phone_e164   text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN email        text UNIQUE CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN guidelines_accepted_at timestamptz,          -- onboarding: community guidelines
  ADD COLUMN onboarded_at timestamptz,                     -- onboarding finished
  ADD COLUMN last_seen_at timestamptz;                     -- R-60: "Asker last active 1 d ago"

-- One-time codes for login and phone verification. Codes are stored hashed.
CREATE TABLE app.otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL CHECK (channel IN ('sms', 'email')),
  destination  text NOT NULL,                              -- E.164 phone or lowercase email
  purpose      text NOT NULL CHECK (purpose IN ('login', 'verify_phone')),
  user_id      uuid REFERENCES app.users(id),              -- set for verify_phone
  code_hash    text NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_destination_idx ON app.otp_challenges (destination, created_at DESC);

-- Refresh-token sessions (access tokens are short-lived signed JWTs).
CREATE TABLE app.sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app.users(id),
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent         text,
  mfa_verified_at    timestamptz,                          -- S-10: admin actions need 2FA
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX sessions_user_idx ON app.sessions (user_id);

-- S-10: TOTP second factor for admins and moderators.
CREATE TABLE app.user_totp (
  user_id     uuid PRIMARY KEY REFERENCES app.users(id),
  secret      text NOT NULL,                               -- base32, encrypted at rest by the host
  enabled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- S-05 / R-59: moderation can hide a problem without ending it.
ALTER TABLE app.problems ADD COLUMN hidden_at timestamptz;

-- Rate limits keyed by something other than a user (e.g. OTP requests per phone/IP).
CREATE TABLE app.rate_limit_keys (
  key          text NOT NULL,
  action       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, action, window_start)
);

-- Thank-you post comments count and feed lookups by author/community are covered in 0001.
CREATE INDEX posts_visible_created_idx ON app.posts (created_at DESC) WHERE status = 'visible';

-- New tables follow the same defence-in-depth rule as 0001.
ALTER TABLE app.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rate_limit_keys ENABLE ROW LEVEL SECURITY;
