-- Migration: 000003_photos.sql
-- Photos of goals and wishes (B2C-16, Р-9): compressed on the phone (~100 KB webp),
-- stored as bytes in Postgres, served by the API. Adds only (Р-19). A hidden photo
-- (surprise gift) is served to its author only — the handler checks user_id.

CREATE TABLE IF NOT EXISTS app.photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    hidden BOOLEAN NOT NULL DEFAULT false,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/webp', 'image/jpeg')),
    bytes BYTEA NOT NULL,
    size INT NOT NULL CHECK (size > 0 AND size <= 524288),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_household_idx ON app.photos (household_id);
-- Deleting a user cascades here (as in 000001/000002): an index keeps it off a full scan.
CREATE INDEX IF NOT EXISTS photos_user_idx ON app.photos (user_id);
