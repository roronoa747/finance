# B2C-06 — Go: таблицы операций и загрузок, ручки (бэкенд)

Блок 1 · MVP · Каталог: `backend/` (+ корневые `go.mod`/`go.sum`, если нужна зависимость — не ожидается) · Зависит от: B2C-02 (форма операции) · Роли: member (пишет и читает свои), viewer (только список загрузок), чужая семья — нет

## Контекст (что уже есть)

- Р-5, Р-21: операции — личные, на сервере без ФИО и номеров; таблицы `app.statement_uploads`
  (запись о загрузке видна семье) и `app.operations` (PK `(user_id, id)`, курсор по
  `updated_at`). Р-23: сервер — вторая линия защиты от цифр 6+ в текстовых полях. Р-19:
  миграции только добавляют. Матрица прав — §3 индекса.
- Роутер `backend/server/server.go`: всё под `/api`, защищённая группа
  `auth.Middleware(tokenService)`; роль/семья/пользователь — `auth.GetRole/GetHouseholdID/
  GetUserID/GetSlot`; хелперы `decodeJSONBody(w, r, limit, dst)` (413/400), `respondJSON`
  (`internal/handlers/auth.go`). Образец хендлера с ролями и 409 — `internal/handlers/sync.go`.
- Репозитории: интерфейсы в `internal/repository` (`DocRepository` и др.), pg-реализации
  `NewSQL*Repository(*sql.DB)` (JSON в SQL — строкой, не `[]byte`: пулер с
  `binary_parameters=yes`), моки `mock_repo.go` (`NewMockRepositories()`); `server.Repos`
  (`Users, Households, Docs`) и `NewHandler` выбирают pg или моки. Новый репозиторий — в
  `Repos`, pg + мок.
- Миграции: `backend/migrations/000001_init.sql` (схема `app`, все имена квалифицированы
  `app.`), следующая — `000002_statements.sql`, встраивается `//go:embed *.sql`, каждая в своей
  транзакции; `cmd/server` применяет на старте, функция Vercel — нет, в прод — `cmd/migrate`.
- Тесты: хендлеры на моках (`internal/handlers/*_test.go`), `TestPostgres*` через
  `internal/testdb.Open(t)` (CI — два режима DSN), `server/server_e2e_test.go`
  (`runLiveServerE2EFlow` на моках и PG). `backend/README.md` — список ручек.
- Тело функции Vercel ≤ 4,5 МБ — батчи операций режет клиент (B2C-07), сервер ставит свой лимит.

## Задача

1. Миграция `000002_statements.sql`:
   - `app.statement_uploads` (`id uuid pk default gen_random_uuid()`, `household_id` FK → households
     ON DELETE CASCADE, `user_id` FK → users ON DELETE CASCADE, `bank text`, `period_from date`,
     `period_to date`, `ops_count int`, `created_at timestamptz default now()`); индекс
     `(household_id, created_at)`.
   - `app.operations` (`user_id` FK CASCADE, `id text`, `household_id` FK CASCADE, `upload_id` FK →
     statement_uploads ON DELETE SET NULL, `bank text`, `op_date date`, `amount bigint`, `kind text`,
     `merchant text`, `counterparty text null`, `note text null`, `category_id text null`, `internal
     boolean default false`, `created_at`, `updated_at timestamptz default now()`; PK `(user_id, id)`);
     индекс `(user_id, updated_at)`. CHECK на `kind` из списка B2C-02 и на длину текстов (≤ 200).
2. Репозиторий `StatementRepository` (интерфейс, pg, мок): `CreateUpload`, `ListUploads(householdID)`
   (с `slot` участника через `household_members`), `UpsertOperations(userID, householdID, ops)`
   (одна транзакция, `INSERT … ON CONFLICT (user_id, id) DO UPDATE` всех изменяемых полей,
   `updated_at = now()`), `ListOperations(userID, since time.Time, limit)` → строки и курсор.
3. Ручки (защищённые):
   - `POST /api/statements` — `member`; тело `{bank, period_from, period_to, ops_count}` → 201 запись.
   - `GET /api/statements` — member и viewer; список загрузок семьи (новые первыми, лимит 200):
     `id, slot, bank, period_from, period_to, ops_count, created_at`.
   - `POST /api/operations/batch` — `member`; `{operations: [...]}` ≤ 2000 строк и ≤ 2 МБ →
     upsert своих; ответ `{upserted: n}`.
   - `GET /api/operations?since=<RFC3339>&limit=<≤2000>` — `member`; свои операции с
     `updated_at > since`, по `updated_at, id`; ответ `{operations, next}` (`next` — `updated_at`
     последней или `null`).
   - Проверки → 400: `amount` не целое / вне int64, дата невалидна, `kind` вне списка,
     `merchant` пустой у `purchase`, в `merchant`/`counterparty`/`note` последовательность из 6+
     цифр или длина > 200, `id` не из `[0-9a-f]{8,32}`. Viewer → 403 на всех, кроме `GET
     /api/statements`. Ничего из тел операций не логируется.
4. `server.Repos` + `NewHandler` + `NewRouter`; `backend/README.md` — ручки одной-двумя строками;
   `runLiveServerE2EFlow` — загрузка, батч, чтение по курсору, список загрузок партнёром.

## Тесты

- Хендлеры на моках: 201/200 для member; viewer 403 (и 200 на списке загрузок); чужая семья не
  видит загрузок; каждая проверка 400 из п. 3 (в том числе гвард цифр); лимит строк → 413/400;
  курсор: две страницы без пропусков и дублей; upsert дважды — одна строка, категория обновилась.
- `TestPostgres…`: миграция на чистой и на уже мигрированной БД; upsert идемпотентен; курсор по
  `updated_at`; удаление пользователя каскадом удаляет операции и загрузки; удаление загрузки не
  трогает операции (`SET NULL`).
- `server_e2e_test.go`: сценарий п. 4 в обоих режимах.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...`, PG-режим, корень `go vet ./api/...
  && go test ./api/...` — зелёные; CI `ci-backend` зелёный.
- На локальном стенде с Postgres: партнёр (второй пользователь семьи) не получает операции
  первого ни одной ручкой (проверить запросами), список загрузок видит.

## Вне скоупа

- Итоги по категориям — в общем документе (B2C-02/B2C-07), сервер их не считает.
- «Нет семьи» (409) — B2C-22; удаление аккаунта — B2C-24 (каскады здесь уже заложены).
- События метрики — B2C-28 (загрузки уже дают «вторую выписку за 14 дней»).
