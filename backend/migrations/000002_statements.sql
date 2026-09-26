-- Migration: 000002_statements.sql
-- Bank statements (B2C-06, Р-21): a record of every upload (visible to the family)
-- and personal operations (visible to their owner only). Adds only (Р-19).
-- Text fields carry no account numbers or ID numbers (Р-23): the client strips
-- them, the handler rejects them, and the CHECKs below are the last line.

CREATE TABLE IF NOT EXISTS app.statement_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    bank TEXT NOT NULL CHECK (char_length(bank) BETWEEN 1 AND 32),
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    ops_count INT NOT NULL CHECK (ops_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS statement_uploads_household_idx ON app.statement_uploads (household_id, created_at);

CREATE TABLE IF NOT EXISTS app.operations (
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    id TEXT NOT NULL CHECK (id ~ '^[0-9a-f]{8,32}$'),
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    upload_id UUID REFERENCES app.statement_uploads(id) ON DELETE SET NULL,
    bank TEXT NOT NULL CHECK (char_length(bank) BETWEEN 1 AND 32),
    op_date DATE NOT NULL,
    amount BIGINT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('purchase', 'transfer-out', 'transfer-in', 'income', 'cash', 'fee', 'other')),
    merchant TEXT NOT NULL DEFAULT '' CHECK (char_length(merchant) <= 200 AND merchant !~ '[0-9]{6,}'),
    counterparty TEXT CHECK (char_length(counterparty) <= 200 AND counterparty !~ '[0-9]{6,}'),
    note TEXT CHECK (char_length(note) <= 200 AND note !~ '[0-9]{6,}'),
    category_id TEXT CHECK (char_length(category_id) <= 64),
    internal BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);

-- The client pulls its own operations by an updated_at cursor.
CREATE INDEX IF NOT EXISTS operations_user_updated_idx ON app.operations (user_id, updated_at, id);
