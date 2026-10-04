-- Keys the server generates for itself on first start (e.g. Web Push VAPID keys), so a fresh
-- deployment works without running a key generator by hand. Never exposed through the API.
CREATE TABLE app.server_keys (
  name       text PRIMARY KEY,
  value      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.server_keys ENABLE ROW LEVEL SECURITY;
