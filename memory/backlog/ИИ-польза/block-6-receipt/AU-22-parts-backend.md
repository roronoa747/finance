# AU-22 — Части покупки в базе: миграция и ручки операций (бэкенд)

Блок 6 · MVP · Каталог: `backend/migrations/`, `internal/models/statement.go`, `internal/handlers/statements.go`, `internal/repository/statement_repo.go`, `mock_repo.go` · Зависит от: Блок 5 🏁 · Роли: member (свои операции)

## Контекст (что уже есть)

- Р-10: покупка получает части по разделам — новое в модели операций; возможна миграция `app.operations`; только свои
  покупки (операции личные). Р-23 / §5: миграцию на прод запускает владелец по готовой команде.
- Таблица `app.operations` (`migrations/000002_statements.sql:24-48`): ключ `(user_id, id)`, `amount BIGINT` (минус —
  списание), `category_id TEXT` (≤ 64), текстовые поля с CHECK против 6+ цифр. Последняя миграция — `000007_ai.sql`
  (проверить: Блоки 3–4 «ИИ» и 1–5 здесь миграций не планировали) → новая `000008_operation_parts.sql`. Формат шапки и
  строки отката — как в `000007_ai.sql:1-7` (откат с удалением строки `app.schema_migrations`).
- Модель — `models.Operation` (`internal/models/statement.go:20-33`); проверка — `validateOperation`
  (`handlers/statements.go:157-197`); ручки `UpsertOperations` (`POST /api/operations/batch`) :200, `ListOperations`
  :231; репозиторий — `UpsertOperations` / `ListOperations` / `queryOperations` (`statement_repo.go:98-204`), мок
  `MockStatementRepo` (`mock_repo.go:701-722`). `cmd/server` мигрирует сам, Vercel-функция — никогда; прод —
  `cmd/migrate` руками владельца.

## Задача

1. Миграция `000008_operation_parts.sql`: `ALTER TABLE app.operations ADD COLUMN IF NOT EXISTS parts JSONB` с CHECK:
   `parts IS NULL OR (jsonb_typeof(parts) = 'array' AND jsonb_array_length(parts) BETWEEN 2 AND 12)`; шапка — зачем и
   откат одной строкой (`DROP COLUMN` + строка `schema_migrations`).
2. `models.Operation.Parts []OperationPart` (`{category_id, amount}`, `json:"parts,omitempty"`); `validateOperation`:
   частей 2…12, у каждой `amount > 0` (целые тенге), `category_id` непустой ≤ 64 без NUL, **сумма частей = |amount|**,
   части только у списаний (`amount < 0`); иначе 400 с понятной строкой.
3. Репозиторий: запись и чтение `parts` (NULL ↔ пусто); upsert без `parts` у существующей строки — **не стирает** части
   (повторная загрузка той же выписки не должна терять разделение: `COALESCE(EXCLUDED.parts, app.operations.parts)` —
   проверить, как телефон шлёт повтор, и записать решение в Handoff).
4. Готовая команда прод-миграции для владельца — в Handoff (без секретов: имя env и `cmd/migrate`).

## Тесты

- `statements_test.go`: части с суммой ≠ |amount| → 400; одна часть → 400; часть ≤ 0 → 400; у прихода → 400; верные →
  200 и обратно в `ListOperations`.
- PG (`*_pg_test.go`, `Postgres` в имени): миграция поверх `000007`; CHECK режет 13 частей; повторный upsert без `parts`
  сохраняет части; откат из шапки на своём Postgres — повторный выкат проходит.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...` + корень `go test ./api/...`; PG-тесты
  (`go test -p 1 -count=1 -run Postgres ./...` с `TEST_DATABASE_URL`) зелёные; CI.

## Вне скоупа

- Фронт — AU-23; ручка чека — AU-24. Части у чужих операций — нет (ключ `user_id`).
