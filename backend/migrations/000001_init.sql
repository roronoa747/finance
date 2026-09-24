-- Migration: 000001_init.sql
-- Initial schema for Go backend (matching domain rules).
-- Every object lives in schema "app" (names are qualified, so no search_path is
-- needed): the shared Supabase database keeps the React tables of the same
-- names in "public".

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Наша казна',
    created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.household_members (
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK (slot IN ('a', 'b', 'c')),
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (household_id, user_id),
    UNIQUE (household_id, slot)
);

CREATE INDEX IF NOT EXISTS household_members_user_idx ON app.household_members (user_id);

CREATE TABLE IF NOT EXISTS app.household_docs (
    household_id UUID PRIMARY KEY REFERENCES app.households(id) ON DELETE CASCADE,
    rev BIGINT NOT NULL DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES app.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app.private_docs (
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    rev BIGINT NOT NULL DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.household_invites (
    code TEXT PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
    used_by UUID REFERENCES app.users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS household_invites_household_idx ON app.household_invites (household_id);
