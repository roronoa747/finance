# AI-02 — Флаг семьи, счётчик и лимит, `/auth/me` → `ai` (бэкенд, миграция)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: AI-01 · Роли: все (чтение флага)

## Контекст (что уже есть)

- Р-7: ИИ включается семье в админке, флаг — в базе (миграция); по умолчанию выключен. Р-8: лимит — одно значение
  env `AI_MONTHLY_LIMIT` (30, поле `Config.AIMonthlyLimit` из AI-01) на каждую семью в месяц по Алматы; кончился → 429
  `ai_limit`. Р-14: списывается только успех; ≈ $ — целые микродоллары. Р-15: в базе только флаг и счётчики.
- База (§6): последняя миграция `000006_events.sql` → эта `000007_ai.sql`; `app.households` (id, name, created_by,
  created_at). Месяц по Алматы — `time.FixedZone("Asia/Almaty", 5*60*60)` (`internal/fx/fx.go:37`,
  `internal/repository/events_repo.go:15`). Репозитории — интерфейс + SQL + мок (`mock_repo.go`); `Repos`
  (`server/server.go:33-43`, SQL :50-60, моки :66-68) — сюда новый репозиторий. PG-тесты — `*_pg_test.go`, `testdb.Open`.
- `/auth/me`: `AuthHandler.Me` (`internal/handlers/auth.go:240-269`) отвечает картой `{user, household, member, admin}`
  (:263-268); `AuthHandler` — `auth.go:22-28` (держит `admins`); собирается в `server.go:150`. Фронт: `MeResponse`
  (`frontend/src/types/api.ts:35-41`), `stores/auth.ts` `fetchMe` :120-143.
- Удаление аккаунта / семьи — каскад от `app.households` (новая таблица — `ON DELETE CASCADE`).

## Задача

1. Миграция `backend/migrations/000007_ai.sql`:
   - `ALTER TABLE app.households ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT false;`
   - `CREATE TABLE app.ai_usage (household_id UUID NOT NULL REFERENCES app.households(id) ON DELETE CASCADE,
     month TEXT NOT NULL /* 'YYYY-MM' по Алматы */, requests INT NOT NULL DEFAULT 0, input_tokens BIGINT NOT NULL
     DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0, cost_micros BIGINT NOT NULL DEFAULT 0,
     PRIMARY KEY (household_id, month));`
   - Без down-ветки, если проект их не держит (как 000006); откат — в Handoff одной строкой (`DROP TABLE`,
     `DROP COLUMN`).
2. Репозиторий `internal/repository/ai_repo.go` (+ мок): `Enabled(ctx, householdID) (bool, error)`,
   `SetEnabled(ctx, householdID, on bool) error`, `Used(ctx, householdID, month) (int, error)`,
   `AddUsage(ctx, householdID, month, requests int, in, out, costMicros int64) error` (upsert, прибавляет).
   Хелпер месяца `ai.MonthKey(now time.Time) string` по Алматы (в пакете `internal/ai`, рядом с ценами).
   Лимит: `ai.LimitReached(used, limit int) bool` (`used >= limit`); `AI_MONTHLY_LIMIT` ≤ 0 или не число → 30
   (защита от опечатки; «без лимита» не бывает).
   Гонку двух одновременных запросов на 30-м не закрываем (перерасход ≤ 1–2 запроса допустим — записать в README).
3. `/auth/me` → поле `ai: bool` = клиент Claude есть (ключ задан) **и** `households.ai_enabled` у семьи пользователя
   (нет семьи → `false`). `AuthHandler` получает зависимость (интерфейс с `Enabled`) и признак «ключ задан».
4. Фронт — только тип и стор: `MeResponse.ai?: boolean`; `stores/auth.ts` — `ai` ref (`res.ai === true`), сбрасывается
   при выходе как `admin`; в демо `false`. Экранов не трогать (AI-05).

## Тесты

- PG (`ai_repo_pg_test.go`, имя с `Postgres`): миграция применяется; `ai_enabled` по умолчанию `false`; `SetEnabled`
  → `Enabled`; `AddUsage` дважды за месяц суммирует, другой месяц — отдельная строка; удаление семьи удаляет `ai_usage`.
- `MonthKey`: 2026-10-31 20:00 UTC → `2026-11` (Алматы +5), 2026-10-31 18:00 UTC → `2026-10`.
- Хендлер `/auth/me` (моки): без ключа → `ai: false` даже при флаге; с ключом и флагом → `true`; флаг выключен →
  `false`; нет семьи → `false`.
- Фронт: `stores/auth` — `ai` из ответа `me`, сброс при выходе.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...`; PG-тесты с `TEST_DATABASE_URL`
  (`go test -p 1 -count=1 -run Postgres ./...`); корень `go test ./api/...`; `cd frontend && npm run build && npx
  vitest run` — зелёные; CI зелёный.
- Локально (`cmd/server` с БД): `/api/auth/me` отдаёт `ai`; миграция 000007 прошла на чистой и на существующей базе.

## Вне скоупа

- Админские ручки и экран — AI-03, AI-04. Проверка лимита в ручках — гейт AI-08.
- Лимит на каждую семью отдельно — после MVP (Р-8). Прод-миграция — клинап Блока 1, руками владельца.
