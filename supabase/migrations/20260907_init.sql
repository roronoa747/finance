-- Казна · начальная схема
--
-- Документная модель: состояние семьи хранится целиком одним JSON-документом,
-- у каждого участника дополнительно свой личный документ, который база
-- физически не отдаёт партнёру. Слияние делает клиент, сервер только следит
-- за версией и не даёт молча затереть чужую запись.

-- В Supabase расширения живут в схеме extensions, а функции ниже работают с
-- пустым search_path, поэтому все вызовы из pgcrypto пишутся с явной схемой.
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────── таблицы ───────────────────────────

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Наша казна',
  created_by  uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- слот определяет цвет участника в интерфейсе: a — синий, b — розовый, c — янтарь
  slot         text not null check (slot in ('a', 'b', 'c')),
  display_name text not null,
  role         text not null default 'member' check (role in ('member', 'viewer')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, slot)
);

-- Общая казна: один документ на семью.
create table if not exists public.household_docs (
  household_id uuid primary key references public.households (id) on delete cascade,
  rev          bigint not null default 1,
  data         jsonb  not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);

-- Личный кошелёк. Партнёр не увидит эту строку никогда: её отсекает RLS,
-- а не фильтр в интерфейсе. Это единственный способ сделать подарок сюрпризом.
create table if not exists public.private_docs (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  rev          bigint not null default 1,
  data         jsonb  not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);

create index if not exists household_members_user_idx on public.household_members (user_id);
create index if not exists household_invites_household_idx on public.household_invites (household_id);

-- ─────────────────────── вспомогательные функции ───────────────────────
--
-- Вынесены в SECURITY DEFINER намеренно. Если политика на household_members
-- начнёт сама читать household_members, Postgres уйдёт в рекурсию (42P17) и
-- приложение упадёт при первом же входе. Функция обходит RLS и разрывает цикл.

create or replace function public.my_households()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = (select auth.uid());
$$;

create or replace function public.can_write(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = hid
      and user_id = (select auth.uid())
      and role = 'member'
  );
$$;

-- ─────────────────────────── RLS ───────────────────────────

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_docs    enable row level security;
alter table public.private_docs      enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists households_read on public.households;
create policy households_read on public.households
  for select to authenticated
  using (id in (select public.my_households()));

drop policy if exists members_read on public.household_members;
create policy members_read on public.household_members
  for select to authenticated
  using (household_id in (select public.my_households()));

drop policy if exists docs_read on public.household_docs;
create policy docs_read on public.household_docs
  for select to authenticated
  using (household_id in (select public.my_households()));

-- Личный документ виден строго своему владельцу.
drop policy if exists private_own on public.private_docs;
create policy private_own on public.private_docs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists invites_read on public.household_invites;
create policy invites_read on public.household_invites
  for select to authenticated
  using (household_id in (select public.my_households()));

-- Записи в household_docs и household_members идут ТОЛЬКО через функции ниже,
-- поэтому прямых политик на insert/update/delete нет: клиенту они не нужны,
-- а их отсутствие исключает целый класс ошибок.

revoke all on public.household_docs from authenticated;
grant select on public.household_docs to authenticated;
revoke all on public.households from authenticated;
grant select on public.households to authenticated;
revoke all on public.household_members from authenticated;
grant select on public.household_members to authenticated;
revoke all on public.household_invites from authenticated;
grant select on public.household_invites to authenticated;

-- ─────────────────────── создание и вступление ───────────────────────

create or replace function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Требуется вход';
  end if;

  insert into public.households (name, created_by)
  values (coalesce(nullif(p_name, ''), 'Наша казна'), v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, slot, display_name)
  values (v_id, v_uid, 'a', coalesce(nullif(p_display_name, ''), 'Участник'));

  insert into public.household_docs (household_id, data, updated_by)
  values (v_id, '{}'::jsonb, v_uid);

  insert into public.private_docs (household_id, user_id, data)
  values (v_id, v_uid, '{}'::jsonb);

  return v_id;
end;
$$;

create or replace function public.create_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.can_write(hid) then
    raise exception 'Нет прав на приглашение';
  end if;

  -- Код короткий и читаемый вслух: его диктуют друг другу, а не пересылают.
  v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));

  insert into public.household_invites (code, household_id, created_by)
  values (v_code, hid, (select auth.uid()));

  return v_code;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_inv  public.household_invites%rowtype;
  v_slot text;
begin
  if v_uid is null then
    raise exception 'Требуется вход';
  end if;

  select * into v_inv
  from public.household_invites
  where code = upper(trim(p_code));

  if not found then
    raise exception 'Код не найден';
  end if;
  if v_inv.used_at is not null then
    raise exception 'Код уже использован';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Срок действия кода истёк';
  end if;

  -- Повторный вход в ту же семью не должен ломаться.
  if exists (
    select 1 from public.household_members
    where household_id = v_inv.household_id and user_id = v_uid
  ) then
    return v_inv.household_id;
  end if;

  select s into v_slot
  from unnest(array['a', 'b', 'c']) as s
  where s not in (
    select slot from public.household_members where household_id = v_inv.household_id
  )
  limit 1;

  if v_slot is null then
    raise exception 'В семье уже максимум участников';
  end if;

  insert into public.household_members (household_id, user_id, slot, display_name)
  values (v_inv.household_id, v_uid, v_slot, coalesce(nullif(p_display_name, ''), 'Участник'));

  insert into public.private_docs (household_id, user_id, data)
  values (v_inv.household_id, v_uid, '{}'::jsonb)
  on conflict do nothing;

  update public.household_invites
  set used_by = v_uid, used_at = now()
  where code = v_inv.code;

  return v_inv.household_id;
end;
$$;

-- ─────────────────────── чтение и запись документа ───────────────────────

create or replace function public.pull_doc(hid uuid)
returns table (rev bigint, data jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.rev, d.data, d.updated_at
  from public.household_docs d
  where d.household_id = hid
    and hid in (select public.my_households());
$$;

/*
  Оптимистичная запись. Клиент присылает версию, которую он видел.
  Если на сервере уже новее — запись НЕ применяется, а возвращается
  актуальный документ. Клиент сливает его со своим и пробует снова.
  Так конкурентная правка с двух телефонов не теряется молча.
*/
create or replace function public.push_doc(hid uuid, expected_rev bigint, new_data jsonb)
returns table (rev bigint, data jsonb, conflict boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev  bigint;
  v_data jsonb;
begin
  if not public.can_write(hid) then
    raise exception 'Нет прав на запись';
  end if;

  -- for update держит строку до конца транзакции: два одновременных push
  -- выстроятся в очередь, и второй увидит уже увеличенную версию.
  select d.rev, d.data into v_rev, v_data
  from public.household_docs d
  where d.household_id = hid
  for update;

  if v_rev is null then
    raise exception 'Семья не найдена';
  end if;

  if v_rev <> expected_rev then
    return query select v_rev, v_data, true;
    return;
  end if;

  update public.household_docs d
  set data = new_data,
      rev = d.rev + 1,
      updated_at = now(),
      updated_by = (select auth.uid())
  where d.household_id = hid
  returning d.rev, d.data into v_rev, v_data;

  return query select v_rev, v_data, false;
end;
$$;

create or replace function public.push_private(hid uuid, expected_rev bigint, new_data jsonb)
returns table (rev bigint, data jsonb, conflict boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev  bigint;
  v_data jsonb;
  v_uid  uuid := (select auth.uid());
begin
  select p.rev, p.data into v_rev, v_data
  from public.private_docs p
  where p.household_id = hid and p.user_id = v_uid
  for update;

  if v_rev is null then
    insert into public.private_docs (household_id, user_id, data)
    values (hid, v_uid, new_data)
    returning private_docs.rev, private_docs.data into v_rev, v_data;
    return query select v_rev, v_data, false;
    return;
  end if;

  if v_rev <> expected_rev then
    return query select v_rev, v_data, true;
    return;
  end if;

  update public.private_docs p
  set data = new_data, rev = p.rev + 1, updated_at = now()
  where p.household_id = hid and p.user_id = v_uid
  returning p.rev, p.data into v_rev, v_data;

  return query select v_rev, v_data, false;
end;
$$;

-- Кто в семье — для интерфейса.
create or replace function public.my_membership()
returns table (
  household_id uuid,
  household_name text,
  user_id uuid,
  slot text,
  display_name text,
  role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id, h.name, m.user_id, m.slot, m.display_name, m.role
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.household_id in (select public.my_households())
  order by m.slot;
$$;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_invite(uuid)          to authenticated;
grant execute on function public.join_household(text, text)   to authenticated;
grant execute on function public.pull_doc(uuid)               to authenticated;
grant execute on function public.push_doc(uuid, bigint, jsonb) to authenticated;
grant execute on function public.push_private(uuid, bigint, jsonb) to authenticated;
grant execute on function public.my_membership()              to authenticated;
grant execute on function public.my_households()              to authenticated;
grant execute on function public.can_write(uuid)              to authenticated;
