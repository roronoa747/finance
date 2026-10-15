# AI-03 — Админка: семьи, переключатель ИИ, расход, проверка связи (бэкенд)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: AI-02 · Роли: admin (`ADMIN_EMAILS`)

## Контекст (что уже есть)

- Р-7: в админке список семей — почты участников, включён ли ИИ, запросов и ≈ $ за месяц — с переключателем.
  Р-8: общий потолок расхода владелец ставит в консоли Anthropic. Р-2: доступность API из `icn1` проверить в первом
  блоке — после деплоя это делает «проверка связи» отсюда (прод-смоук клинапа).
- Единственная админ-ручка сейчас — `GET /api/admin/metrics` (`server/server.go:189`) → `EventsHandler.Metrics`
  (`internal/handlers/events.go:84-98`): читает пользователя по `auth.GetUserID`, `isAdmin(h.admins, email)`
  (:78-80), не-админу и при пустом `ADMIN_EMAILS` — **404 `{"error":"not found"}`**. Отдельной мидлвари нет.
- Данные: `app.households` (+ `ai_enabled` из AI-02), `app.household_members` (role, slot), `app.users` (email),
  `app.ai_usage` (AI-02, месяц `ai.MonthKey`). SQL-образец агрегатов — `internal/repository/events_repo.go:86-139`.
- Клиент Claude — `internal/ai` (AI-01); модель продавцов (лёгкая) — `Config.AIModelSellers`.

## Задача

1. `GET /api/admin/families` (protected, админ-проверка как у `Metrics` → 404): массив по всем семьям —
   `{id, created_at, emails: string[] (участники, по slot), ai: bool, month: 'YYYY-MM', requests, cost_micros}` за
   текущий месяц по Алматы (нет строки `ai_usage` → 0). Сортировка: включённые ИИ сверху, затем по `created_at` новые
   сверху. Плюс в ответе `limit` (из конфига) и `key: bool` (ключ задан). Метод репозитория — в `ai_repo.go` (или
   рядом с `Metrics`, одним SQL с `LEFT JOIN`).
2. `PUT /api/admin/families/{id}/ai` с телом `{on: bool}` (≤ 64 байт) → `SetEnabled`; неизвестная семья → 404; ответ —
   обновлённая строка. Не-админ → 404 (как `Metrics`).
3. `POST /api/admin/ai-check` (админ): если ключа нет → `{ok:false, reason:"no_key"}`; иначе минимальный вызов лёгкой
   модели (инструкция «ответь ok», схема `{ok: boolean}`, `max_tokens` малый) → `{ok, model, ms}` или `{ok:false,
   reason:"failed"|"rate_limited"|"refused"}`. В лимит семей и `ai_usage` **не** пишется. Ничего не логирует.
4. Админ-проверку вынести в маленький общий хелпер, если `Metrics` и новые ручки дублируют чтение пользователя
   (не больше этого — без мидлвари «на будущее»).

## Тесты

- Хендлеры (моки репо, фейковый Claude на `httptest`): не-админ → 404 на все три; `ADMIN_EMAILS` пуст → 404;
  список содержит почты, флаг, запросы и `cost_micros` текущего месяца, прошлый месяц не попадает; `PUT` включает и
  выключает, неизвестный id → 404, лишнее поле в теле → 400; `ai-check` без ключа → `no_key`, с фейком «ok» → `ok:true`,
  фейк 500 → `failed`; `ai-check` не меняет `ai_usage`.
- PG: запрос списка на двух семьях с участниками и расходом — правильные суммы и порядок.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...` + PG-тесты + корень `go test ./api/...` зелёные; CI.
- Локально (`cmd/server` + БД, админ из `ADMIN_EMAILS`): curl списка, переключение, `ai-check` (с ключом — `ok:true`).

## Вне скоупа

- Экран — AI-04. Лимит на семью отдельно, история по месяцам — после MVP.
