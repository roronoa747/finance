-- Migration: 000005_google_auth.sql
-- Sign-in with Google (B2C-22, Р-13, Р-25): a user may have no password and no household.
-- Existing users are linked by email on their first Google sign-in. Adds or relaxes only (Р-19).

ALTER TABLE app.users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE app.users ADD COLUMN IF NOT EXISTS google_sub TEXT NULL;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS display_name TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON app.users (google_sub);
