-- Migration: 000009_push.sql
-- Bank pushes (бэклог «Apple Pay», Блок 2, Р-10, Р-23): how many pushes the server read as an
-- operation, read as not one (a decline, a code, an advert) and could not read — per Almaty day
-- and bank, for the admin's numbers. No person and no text (Р-11): only the counts. The
-- operations themselves live in app.operations (source 'push', 000008). Adds only.
-- Rollback (with the code only): DELETE FROM app.operations WHERE source = 'push';
-- DROP TABLE app.push_stats; DELETE FROM app.schema_migrations WHERE version = '000009_push.sql';
-- The first DELETE is optional: the code of Блок 1 reads push rows as phone operations; without
-- it the pushes already written stay in the people's weeks.

CREATE TABLE IF NOT EXISTS app.push_stats (
    day DATE NOT NULL,
    -- kaspi | freedom | halyk; unknown — the push named no bank the server knows.
    bank TEXT NOT NULL CHECK (bank IN ('kaspi', 'freedom', 'halyk', 'unknown')),
    parsed INT NOT NULL DEFAULT 0 CHECK (parsed >= 0),
    ignored INT NOT NULL DEFAULT 0 CHECK (ignored >= 0),
    unknown INT NOT NULL DEFAULT 0 CHECK (unknown >= 0),
    PRIMARY KEY (day, bank)
);
