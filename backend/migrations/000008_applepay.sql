-- Migration: 000008_applepay.sql
-- Apple Pay taps (бэклог «Apple Pay», Р-13, Р-13а, Р-14): operations from the phone live in
-- app.operations next to statement lines — the server writes them itself, the phone files
-- them into sections. A statement replaces a phone operation with a tombstone (deleted_at),
-- so the replacement reaches the second device through the updated_at cursor. Phone keys are
-- stored as SHA-256 only; the last tap body the server searched for the amount, or could not
-- read the amount of, is kept for admins only (≤ 2 KB, one row per person, cleared after
-- 24 h). Adds only (Р-19).
-- Rollback (with the code only): DELETE FROM app.operations WHERE source <> 'statement' OR
-- deleted_at IS NOT NULL; DROP TABLE app.wallet_debug; DROP TABLE app.phone_keys;
-- DROP INDEX app.operations_phone_idx; ALTER TABLE app.operations DROP CONSTRAINT
-- operations_fx_pair, DROP COLUMN source, DROP COLUMN occurred_at, DROP COLUMN fx_currency,
-- DROP COLUMN fx_amount, DROP COLUMN deleted_at; DELETE FROM app.schema_migrations WHERE
-- version = '000008_applepay.sql';
-- The first DELETE: without it the purchases a statement replaced come back alive (dropping
-- deleted_at unburies them), and the live phone purchases the old code doubles with the
-- statement. A phone that already pulled taps keeps them locally — on a morning rollback that
-- is only the smoke test's taps. The last DELETE: without it the runner skips this file on
-- the next deploy.

ALTER TABLE app.operations
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'statement' CHECK (source IN ('statement', 'tap', 'push')),
    -- The moment the server received a phone operation (statement lines have none).
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NULL,
    -- A foreign-currency purchase: amount stays 0 until the phone converts it (Р-15).
    ADD COLUMN IF NOT EXISTS fx_currency TEXT NULL CHECK (fx_currency IN ('USD', 'EUR', 'RUB', 'CNY')),
    -- Minor units (cents) of fx_currency.
    ADD COLUMN IF NOT EXISTS fx_amount BIGINT NULL CHECK (fx_amount > 0),
    -- Tombstone: set once, never cleared (a batch without "deleted" keeps it).
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE app.operations
    ADD CONSTRAINT operations_fx_pair CHECK ((fx_currency IS NULL) = (fx_amount IS NULL));

-- Repeats (2 minutes) and the daily limit of the phone endpoints.
CREATE INDEX IF NOT EXISTS operations_phone_idx ON app.operations (user_id, occurred_at) WHERE source <> 'statement';

-- One key per phone (≤ 5 per person, the repository drops the longest idle); only the hash is stored.
CREATE TABLE IF NOT EXISTS app.phone_keys (
    key_hash BYTEA PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS phone_keys_user_idx ON app.phone_keys (user_id);

-- The last tap body the server searched or could not read — admins only (Р-13а), to tune the parser.
CREATE TABLE IF NOT EXISTS app.wallet_debug (
    user_id UUID PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) <= 2048),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);
