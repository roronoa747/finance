-- Minimal copy of the React side of the live database for tests:
-- auth.users (only the columns transfer reads) and public tables from
-- supabase/migrations/20260907_init.sql without RLS, grants and functions.
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id                 uuid primary key,
  email              text,
  encrypted_password text,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Наша казна',
  created_by  uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  slot         text not null check (slot in ('a', 'b', 'c')),
  display_name text not null,
  role         text not null default 'member' check (role in ('member', 'viewer')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, slot)
);

create table public.household_docs (
  household_id uuid primary key references public.households (id) on delete cascade,
  rev          bigint not null default 1,
  data         jsonb  not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);

create table public.private_docs (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  rev          bigint not null default 1,
  data         jsonb  not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);
