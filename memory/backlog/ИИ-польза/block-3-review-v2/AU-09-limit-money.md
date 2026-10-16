# AU-09 — Лимит в деньгах: гейт, конфиг, админка (бэкенд + фронт)

Блок 3 · MVP · Каталог: `backend/internal/config/`, `internal/ai/limit.go`, `internal/repository/ai_repo.go`, `internal/handlers/ai.go`, `internal/handlers/admin_ai.go`, `server/server.go`, `backend/README.md`, `frontend/src/views/Admin.vue`, `types/api.ts` · Зависит от: Блок 2 🏁 · Роли: admin, member

## Контекст (что уже есть)

- Р-11: лимит — деньги, одно значение на все семьи, env, старт $2 в месяц на семью; по хранимому `cost_micros`; месяц по
  Алматы; кончился — 429 `ai_limit` и «ИИ вернётся 1 <месяца>». Заменяет Р-8 «ИИ» (`memory/decisions/ai-limit-money.md`).
  Р-21: env `AI_MONTHLY_LIMIT_USD` — целые доллары, дефолт 2 (0 / минус / не число → 2), внутри микродоллары;
  `AI_MONTHLY_LIMIT` удаляется; счётчик запросов остаётся для админки.
- Конфиг: `internal/config/config.go:39-50` — `AIMonthlyLimit int` из `AI_MONTHLY_LIMIT` (`positiveInt`, :72),
  `DefaultAIMonthlyLimit = 30`; тесты `config_test.go:12, 181-200`. Таблица env — `backend/README.md:119, 177`.
- Лимит: `ai.LimitReached(used, limit int) bool` (`internal/ai/limit.go`, тест `limit_test.go`).
- Гейт: `AIGate{repo, client, limit int, now}` (`handlers/ai.go:23-76`), `NewAIGate(repo, client, limit)` :30; проверка —
  `used, err := g.repo.Used(ctx, household, month)` → `ai.LimitReached` → 429 (:64-74). Собирается в `server.go:170`
  (`cfg.AIMonthlyLimit`).
- Репозиторий: `AIRepository.Used` (`ai_repo.go:22-23`) — **запросы** месяца; SQL :94-104; мок `MockAIRepo.Used` :164;
  `cost_micros` уже копится `AddUsage` :106-115 (успех и оплаченные неудачи).
- Админка: `AdminAIHandler{…, limit int}` (`handlers/admin_ai.go:21-46`) → `GET /api/admin/families` `{families, limit,
  key}`; фронт — `types/api.ts:135-138` (`limit: number`), `views/Admin.vue:134` «До N запросов ИИ в месяц на семью»,
  строка семьи `spent(requests, micros)` :86-89 (`usdFromMicros`, `lib/money.ts:57`).

## Задача

1. Конфиг: `AIMonthlyLimitMicros int64` из `AI_MONTHLY_LIMIT_USD` (целые доллары × 1 000 000; дефолт 2); поле и env
   `AI_MONTHLY_LIMIT` удалить (код, тесты, README; строка README: прежнее имя больше не читается).
2. `ai.LimitReached(spentMicros, limitMicros int64) bool` — `spent >= limit`; комментарий про гонку (одна-две
   параллельных просьбы могут пройти сверх) сохранить.
3. Репозиторий: `Used` → `Spent(ctx, household, month) (int64, error)` — `cost_micros` месяца (нет строки — 0); SQL,
   мок, PG-тест. Других вызовов `Used` нет — проверить grep-ом.
4. Гейт: `limit int64` микродолларов; порядок проверок прежний (§6 индекса).
5. Админка: ответ `{families, limit_micros, key}`; фронт — «До $2 ИИ в месяц на семью» и у семьи «N запросов · ≈ $0.42
   из $2» (формат `usdFromMicros`; слова — `/ux`).

## Тесты

- `config_test.go`: дефолт 2 → 2 000 000; «5» → 5 000 000; «0», «-1», «abc» → 2 000 000; старый `AI_MONTHLY_LIMIT`
  больше не читается.
- `limit_test.go`: равно лимиту — достигнут; меньше — нет.
- `handlers/ai_test.go` (гейт через ручку разбора): потрачено ≥ лимита → 429 `ai_limit`; меньше → 200; неудача модели
  не списывает запрос, но её токены увеличивают `Spent` (следующий вызов у края лимита → 429).
- `admin_ai_test.go`: `limit_micros` в ответе. PG: `Spent` на `app.ai_usage` (`*_pg_test.go`, имя с `Postgres`).
- DOM `Admin`: строка лимита в долларах, «≈ $ из $2» у семьи.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...` + корень `go test ./api/...`; PG-тесты (`go test -p 1
  -count=1 -run Postgres ./...` с `TEST_DATABASE_URL`) зелёные; `cd frontend && npm run build && npx vitest run`.
- Стенд: семье с флагом подставить `ai_usage.cost_micros` ≥ 2 000 000 → «Разобрать» → «ИИ вернётся 1 <месяца>».

## Вне скоупа

- Лимит на каждую семью — после MVP. Прод env — владелец (§5). Слова «ИИ вернётся» — прежние.
