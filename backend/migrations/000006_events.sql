-- Migration: 000006_events.sql
-- Retention events for the owner's numbers page (B2C-28, Р-16, Р-27): first-party, no free
-- text — a kind and a time. Adds only (Р-19). A deleted user's events stay anonymous
-- (user_id SET NULL); a deleted household takes its events along.

CREATE TABLE IF NOT EXISTS app.events (
    id BIGSERIAL PRIMARY KEY,
    household_id UUID NULL REFERENCES app.households(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('app_open', 'week_done', 'first_run_goal', 'first_run_done', 'push_open')),
    at TIMESTAMPTZ NOT NULL,
    -- The Almaty day of "at": app_open counts once a day per user.
    day DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_kind_at_idx ON app.events (kind, at);
CREATE INDEX IF NOT EXISTS events_household_at_idx ON app.events (household_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS events_app_open_daily_key ON app.events (user_id, day) WHERE kind = 'app_open';
