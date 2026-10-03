-- Migration: 000004_fx_rates.sql
-- History of the National Bank's official rates (B2C-76, Р-71): salaries and payments in
-- foreign currency are converted by the rate of their own day. Adds only (Р-19).
-- A rate is not money: stored as published (tenge per one unit), never summed here.

CREATE TABLE IF NOT EXISTS app.fx_rates (
    day DATE NOT NULL,
    code TEXT NOT NULL,
    rate NUMERIC(12, 4) NOT NULL CHECK (rate > 0),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, code)
);

-- Days already asked of the bank: published = false is "asked, nothing published", so the
-- bank is not asked again for that day. A day with rates has published = true.
CREATE TABLE IF NOT EXISTS app.fx_days (
    day DATE PRIMARY KEY,
    published BOOLEAN NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
