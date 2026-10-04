-- 0004 — Details found while building the safety module.
SET search_path = app, public;

-- A-04: a block made from an anonymous problem must never reveal who the asker was in the
-- blocker's block list.
ALTER TABLE app.blocks ADD COLUMN via_anonymous boolean NOT NULL DEFAULT false;

-- S-09: who a moderation decision affects (gets the statement of reasons and may appeal).
ALTER TABLE app.moderation_actions ADD COLUMN affected_user_id uuid REFERENCES app.users(id);
CREATE INDEX moderation_actions_affected_idx ON app.moderation_actions (affected_user_id);
