-- Accounts created with the sign-up form (email + password). Phone verification moves to the
-- moment someone raises or offers help on a problem; browsing and setup don't need it.
ALTER TABLE app.users
  ADD COLUMN password_hash     text,
  ADD COLUMN email_verified_at timestamptz;

-- Everyone who signed in with an email code so far has proven they own that address.
UPDATE app.users SET email_verified_at = created_at WHERE email IS NOT NULL;
