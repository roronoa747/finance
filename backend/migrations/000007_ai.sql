-- Migration: 000007_ai.sql
-- AI helper (бэклог «ИИ», Р-7, Р-8, Р-15): the owner turns AI on per family in /admin; the
-- server counts each family's successful requests, tokens and cost per Almaty month. Only the
-- flag and the counters — no request, answer or picture is stored. Adds only (Р-19).
-- Rollback (with the code only): DROP TABLE app.ai_usage; ALTER TABLE app.households DROP COLUMN
-- ai_enabled; DELETE FROM app.schema_migrations WHERE version = '000007_ai.sql'; — without the last
-- one the runner skips this file on the next deploy and the admin AI endpoints answer 500.

ALTER TABLE app.households ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS app.ai_usage (
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    -- 'YYYY-MM' by Almaty (ai.MonthKey).
    month TEXT NOT NULL,
    requests INT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    -- Whole microdollars (ai.CostMicros).
    cost_micros BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (household_id, month)
);
