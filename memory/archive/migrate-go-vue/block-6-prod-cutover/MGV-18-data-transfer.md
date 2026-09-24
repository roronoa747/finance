# MGV-18 — Перенос данных Supabase → `app` и обратный скрипт (бэкенд)

Блок 6 · MVP · Репо/каталог: `backend/` · Зависит от: MGV-15 · Роли: все (данные семьи)

## Контекст (что уже есть)

- Источник (живой проект Supabase `tpkyopaovfdkcmdhauws`, та же база, что и цель — Р-7):
  - `auth.users` — `id uuid`, `email`, `encrypted_password` (bcrypt `$2a$…`, совместим с
    `golang.org/x/crypto/bcrypt`), `deleted_at`.
  - `public.households`, `public.household_members`, `public.household_docs`,
    `public.private_docs`, `public.household_invites` — схема `supabase/migrations/20260907_init.sql`;
    колонки совпадают с Go (`backend/migrations/000001_init.sql`), отличие — FK на `auth.users`
    вместо `app.users`.
- Цель — схема `app` после MGV-15: те же пять таблиц + `app.users(id, email, password_hash, created_at)`.
  Go нормализует email в нижний регистр при входе (`handlers/auth.go`, `repository/user_repo.go`).
- Запрос «данные целы» из `NEXT.md` (сверка по `household_docs`):
  ```sql
  select rev, updated_at,
    jsonb_path_query_array(data,'$.people[*].name') as names,
    jsonb_path_query_array(data,'$.people[*].salary') as salaries,
    jsonb_path_query_array(data,'$.people[*].onboardedAt') as onboarded,
    jsonb_array_length(data->'goals') as goals,
    jsonb_array_length(data->'obligations') as obligations,
    jsonb_path_query_array(data,'$.credits[*].name') as credits
  from public.household_docs;
  ```
- PG-тесты: `backend/internal/testdb` (`TEST_DATABASE_URL`, база стирается, `-p 1`).
- Подключение к живой базе — строка из `memory/secrets/` (сессионное, 5432; нужен доступ к
  схеме `auth` — у роли `postgres` есть).

## Задача

1. **`backend/cmd/transfer`** — одна команда, два направления, всё в одной транзакции:
   - `forward` (Р-8, Р-14): `auth.users` (не удалённые) → `app.users` (`id`, `lower(email)`,
     `encrypted_password` → `password_hash`, `created_at`); затем пять таблиц `public` → `app`
     с сохранением UUID, `rev`, `data`, `updated_*`, слотов и ролей. Пустая цель — обычный
     прогон; непустая — только с флагом `-replace` (очистка `app.*` в той же транзакции:
     репетиция и финальная копия идут одной командой). Пользователь без пароля — в отчёт.
   - `back` (Р-9, откат): `app.household_docs` и `app.private_docs` → `public` (`data`, `rev`,
     `updated_at`) для существующих строк; пользователи/семьи, которых нет в источнике, —
     предупреждение и отказ без `-force`. Больше ничего не пишет.
   - `-dry-run` — всё то же, в конце `ROLLBACK` (так откат репетируется на живой базе,
     не трогая React).
2. **Сверка** после записи (до `COMMIT`): запрос «данные целы» по обеим схемам + `rev` каждой
   строки `private_docs` (Р-14) + счётчики строк пяти таблиц и пользователей. Расхождение →
   `ROLLBACK` и ненулевой код выхода. Отчёт — в stdout; **email и содержимое документов в
   отчёт не выводятся** (только `id`, `rev`, счётчики и поля запроса «данные целы»).
3. Строка запуска в README бэкенда (с именем переменной подключения, без значения).

## Тесты

- PG-тест (`-run Postgres`): тестовая база с заглушкой `auth.users` и таблицами `public`
  по `supabase/migrations/20260907_init.sql` (минимально — нужные колонки, без RLS/функций) +
  схема `app` по миграциям Go. Сценарии:
  - `forward` на двух пользователях и одной семье: строки и `rev` совпали, сверка зелёная;
    **вход через `handlers` Go по старому паролю** (хеш сделан bcrypt `$2a$`) → 200 и токен.
  - повторный `forward` без `-replace` → отказ; с `-replace` → тот же результат.
  - `back`: правка документа в `app` (rev+1) → после `back` `public` содержит новый `data` и `rev`.
  - `-dry-run` ничего не меняет ни в `app`, ни в `public`.
  - искусственное расхождение (подменить сверку/данные) → ненулевой код, изменений нет.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` — зелёные.
- `TEST_DATABASE_URL=<одноразовая БД> go test -p 1 -count=1 -run Postgres ./...` — зелёные.
- `go run ./cmd/transfer forward -dry-run` против живой базы (с согласия владельца, Р-12)
  отрабатывает, сверка зелёная, в `app` ничего не осталось. Реальная запись — в MGV-19.

## Вне скоупа

- Перенос сессий Supabase и кэша React в `localStorage` (Р-15).
- Удаление таблиц `public` и пользователей `auth.users` — хвост уборки после cutover.
- Перенос в другой проект/хостинг (Р-6).
