# Уборка React в Supabase и Vercel — шаги владельца (ML-12)

Когда: **в приёмке Блока 1, после деплоя и смоука**, с «да» владельца (Р-4, Р-15). Будильник базы к этому моменту
уже ходит в `/api/health` (ML-10) — `public.households` ему не нужна.

**Что удаляем — только React:** 5 таблиц и 9 функций схемы `public`, пользователей Supabase Auth, Edge Function
`fx-rate`, env Preview ветки `mgv-block-6-prod` в Vercel.
**Что не трогаем никогда:** схему `app` (данные приложения), сам проект Supabase — **ни паузы, ни удаления: это
прод-база.** Таблицы `app` ссылаются только на `app.users` (`backend/migrations/`), не на `auth.users` и не на
`public.*` — удаление их не задевает.

Агент секрет прод-базы не читает — команды запускаете вы, агент проверяет после (п. 5).

## 0. Подготовка (Windows PowerShell, корень репо)

Нужен запущенный Docker Desktop — `pg_dump`/`psql` берутся из образа `postgres:17`, ставить ничего не надо.
Строку подключения не печатать и не вставлять в чаты.

```powershell
# Строка — из memory/secrets/supabase-db.md (сессионная, порт 5432). Живёт только в этой консоли.
$db = '<строка из memory/secrets/supabase-db.md>'
New-Item -ItemType Directory -Force memory\secrets\backups
function pg { docker run --rm -i -v "${PWD}\memory\secrets\backups:/b" postgres:17 @args }
```

`memory/secrets/` — в `.gitignore`: бэкапы в git не попадут.

## 1. Бэкап (обязателен — без него дальше не идём)

```powershell
pg pg_dump --schema=public --no-owner -Fc -f /b/public-backup-2026-10.dump $db
pg psql $db -c "\copy (select id, email, created_at from auth.users) to '/b/auth-users-2026-10.csv' csv header"
(pg pg_restore --list /b/public-backup-2026-10.dump | Select-String 'TABLE DATA').Count
```

Ждём: последняя команда печатает **5** (данные пяти таблиц), файл `memory\secrets\backups\auth-users-2026-10.csv` не
пустой. Иначе — стоп, написать агенту.

## 2. Сверка `app` до удаления — записать числа

```powershell
$count = @'
select 'users', count(*) from app.users union all
select 'households', count(*) from app.households union all
select 'household_members', count(*) from app.household_members union all
select 'household_docs', count(*) from app.household_docs union all
select 'private_docs', count(*) from app.private_docs union all
select 'household_invites', count(*) from app.household_invites union all
select 'statement_uploads', count(*) from app.statement_uploads union all
select 'operations', count(*) from app.operations union all
select 'photos', count(*) from app.photos union all
select 'fx_rates', count(*) from app.fx_rates union all
select 'fx_days', count(*) from app.fx_days;
'@
$count | pg psql $db -At -f -
```

Сохранить вывод (11 строк) — в п. 4 он должен совпасть.

## 3. Удаление

**3.1. Таблицы и функции `public`** — одной транзакцией: ошибка → не удалится ничего. Сначала таблицы (с ними уходят
их политики, которые зовут функции), потом функции:

```powershell
@'
begin;
drop table public.household_invites, public.private_docs, public.household_docs,
           public.household_members, public.households cascade;
drop function public.my_households(), public.can_write(uuid),
              public.create_household(text, text), public.create_invite(uuid),
              public.join_household(text, text), public.pull_doc(uuid),
              public.push_doc(uuid, bigint, jsonb), public.push_private(uuid, bigint, jsonb),
              public.my_membership();
commit;
'@ | pg psql $db -v ON_ERROR_STOP=1 -f -
```

Ждём `DROP TABLE`, `DROP FUNCTION`, `COMMIT`. Ошибка «does not exist» — транзакция откатилась, не удалено ничего;
написать агенту (уберёт лишнее имя из списка).

**3.2. Пользователи Supabase Auth** — только **после** 3.1: `public.households.created_by` держал их
`ON DELETE RESTRICT`. Дашборд Supabase → Authentication → Users → выделить всех → Delete. Или командой:

```powershell
pg psql $db -v ON_ERROR_STOP=1 -c 'delete from auth.users;'
```

**3.3. Edge Function `fx-rate`:** дашборд Supabase → Edge Functions → `fx-rate` → ⋯ → Delete.

**3.4. Vercel:** проект `family-finance-ff` → Settings → Environment Variables → фильтр Preview → переменные с веткой
`mgv-block-6-prod` → Remove. Production-переменные не трогать.

## 4. Проверка

```powershell
$count | pg psql $db -At -f -                                      # числа — как в п. 2
curl.exe -fsS https://family-finance-ff.vercel.app/api/health      # {"status":"ok","db":"connected"}
Remove-Variable db
```

GitHub → Actions → «Будильник для базы» → Run workflow → зелёный. Открыть приложение на телефоне — данные на месте.

## 5. Что делает агент после

Сверяет ваши числа п. 2 и п. 4, `/api/health` → 200 и `db: connected`, логи Vercel Production за час — без ошибок
базы; пишет итог в SESSION.md (Приёмка) и `memory/STATE.md`.

## Откат

Таблицы и функции `public`: `pg pg_restore --no-owner -d $db /b/public-backup-2026-10.dump`. Пользователей Auth бэкап
не возвращает — только список адресов (React ими больше не пользуется).

---

*Проверка команд (ML-12):* SQL сверен с `supabase/migrations/20260907_init.sql` (в истории git до ML-11:
`git show 0e2a601:supabase/migrations/20260907_init.sql`) — имена и сигнатуры функций, `ON DELETE RESTRICT` на
`auth.users`, таблицы `app.*` — по `backend/migrations/`. **На одноразовом Postgres не проверено** — Docker-демон в
сессии исполнителя не был запущен; критику или приёмке — прогнать п. 1–3.1 на контейнере с этой миграцией (заглушки
`auth.users`, `auth.uid()`, роль `authenticated`).
