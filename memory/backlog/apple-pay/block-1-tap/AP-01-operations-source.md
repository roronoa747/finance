# AP-01 — Миграция 000008: источник, валюта, надгробия операций (бэкенд)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: — · Роли: member (свои операции)

## Контекст (что уже есть)

- Р-14: операции с телефона живут в той же `app.operations`; сервер пишет их сам (AP-03), раздел ставит телефон (AP-04).
  Р-16: выписка заменяет трату с телефона — **надгробием**, чтобы замена дошла до второго устройства через курсор
  `updated_at`. Удаления операций сейчас нет вовсе (ни ручки, ни колонки).
- Таблица `app.operations` — `backend/migrations/000002_statements.sql:24-43`. Последняя миграция на `main` —
  `000006_events.sql`; `000007_ai.sql` — у цепочки «ИИ» (ещё не на `main`) → **эта — `000008_applepay.sql`** (§6 индекса:
  раннер применяет по имени каждый неприменённый файл, дыра в номерах не мешает).
- Хендлер `internal/handlers/statements.go`: `knownBanks` :42 (`kaspi`, `freedom`), `validateOperation` :157-196,
  `UpsertOperations` :200-226, `ListOperations` :231-265. Репозиторий `internal/repository/statement_repo.go`:
  `UpsertOperations` :98-158 (`operationColumns = 11` :96, ON CONFLICT обновляет перечисленные поля), `operationSelect`
  :160-163, `queryOperations` :183-200. Модель `models.Operation` (`internal/models`, поля с json-тегами `id, bank, date,
  amount, kind, merchant, counterparty, note, category_id, internal, upload_id, updated_at`). Мок — `mock_repo.go`.
- Телефон отправляет назад операции с телефона после раскладки (AP-04) через тот же `POST /api/operations/batch` — их
  банк может быть `halyk` или `card` (Р-14), сейчас это 400 `unknown bank` на всю пачку.

## Задача

1. Миграция `backend/migrations/000008_applepay.sql` (комментарий-шапка в стиле 000002/000006, только добавление):
   - `ALTER TABLE app.operations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'statement' CHECK (source IN
     ('statement','tap','push'))`, `occurred_at TIMESTAMPTZ NULL`, `fx_currency TEXT NULL CHECK (fx_currency IN
     ('USD','EUR','RUB','CNY'))`, `fx_amount BIGINT NULL CHECK (fx_amount > 0)` (минорные единицы), `deleted_at
     TIMESTAMPTZ NULL`; CHECK «`fx_currency` и `fx_amount` оба заданы или оба пусты».
   - Индекс для дублей и лимита ручек телефона: `(user_id, occurred_at) WHERE source <> 'statement'`.
   - `CREATE TABLE app.phone_keys (key_hash BYTEA PRIMARY KEY, user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE
     CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ NULL)` + индекс `(user_id)` (Р-13 —
     свой ключ на каждый телефон, ≤ 5 на человека; используют AP-02, AP-03).
   - `CREATE TABLE app.wallet_debug (user_id UUID PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE, body TEXT NOT
     NULL CHECK (length(body) <= 2048), at TIMESTAMPTZ NOT NULL DEFAULT now())` — диагностика формата только для админов
     (Р-13а; пишет AP-03).
   - Откат — одной строкой в Handoff (`DROP TABLE app.phone_keys; ALTER TABLE app.operations DROP COLUMN …` + строка
     `schema_migrations`, как откат 000007 у ИИ).
2. Модель и провод: `models.Operation` + `Source string json:"source"`, `OccurredAt *time.Time json:"occurred_at,
   omitempty"`, `FxCurrency *string json:"fx_currency,omitempty"`, `FxAmount *int64 json:"fx_amount,omitempty"`,
   `Deleted bool json:"deleted,omitempty"`.
3. `ListOperations` отдаёт новые поля и **надгробия** (`deleted: true`, `deleted_at IS NOT NULL`) — курсор их тоже
   несёт; порядок и правило «страница не рвёт один `updated_at`» не меняются.
4. `UpsertOperations`: в INSERT — только прежние 11 колонок (+ надгробие); `source`, `occurred_at`, `fx_*` пишет только
   сервер (AP-03), батч их не меняет и не создаёт (новая строка из батча — `source = 'statement'`). `deleted: true` →
   `deleted_at = COALESCE(app.operations.deleted_at, now())`; `deleted` false/нет — `deleted_at` **не трогается**
   (надгробие необратимо; старый клиент без поля его не воскресит).
5. `knownBanks` += `halyk`, `card` (в `validateOperation` и `CreateUpload` — загрузки выписок по-прежнему только
   kaspi/freedom: для `CreateUpload` оставить свой набор, `uploadBanks`).

## Тесты

- PG (`statement_pg_test.go` или новый `applepay_pg_test.go`, имя с `Postgres`): миграция на базе без 000007 и на базе
  с ним (если файл есть); старые строки получают `source = 'statement'`; надгробие из батча → `ListOperations` отдаёт
  `deleted: true` с новым `updated_at`; повторный батч той же операции без `deleted` надгробие не снимает; батч не
  меняет `source`/`occurred_at`/`fx_*` строки, записанной сервером (вставить SQL-ом); CHECK пары `fx_*`; каскад
  `phone_keys` при удалении пользователя.
- Хендлер (моки): `halyk` и `card` в батче — 200; `CreateUpload` с `halyk` — 400.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...`; PG-тесты с `TEST_DATABASE_URL` (стенд цепочки —
  Postgres :54451) `go test -p 1 -count=1 -run Postgres ./...`; корень `go test ./api/...` — зелёные.
- Миграция применилась на чистой базе и на копии с данными; `GET /api/operations` старого клиента не ломается (новые поля
  — дополнительные).

## Вне скоупа

- Ключи и ручки телефона — AP-02, AP-03. Решение «что заменить» — телефон (AP-05). Прод-миграция — утром, владелец.
