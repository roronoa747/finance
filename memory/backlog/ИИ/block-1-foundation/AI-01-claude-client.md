# AI-01 — Проверка платформы и клиент Claude (бэкенд)

Блок 1 · MVP · Каталог: `backend/` (+ корневой `go.mod`, `vercel.json` при необходимости) · Зависит от: — · Роли: —

## Контекст (что уже есть)

- Р-2: Claude (Anthropic API), платно; вызов только из Go; ключ — env `ANTHROPIC_API_KEY` (значение —
  `memory/secrets/anthropic.md`, кладёт владелец; в доки — только имя); без ключа ИИ выключен везде; прод без ключа
  валиден. Р-13: официальный Go SDK `github.com/anthropics/anthropic-sdk-go`; модели — env по функции с дефолтами
  `AI_MODEL_REVIEW` = `claude-opus-5-5`, `AI_MODEL_SELLERS` = `claude-haiku-5-5`, `AI_MODEL_WISH` = `claude-opus-5-5`;
  структурный ответ по JSON-схеме; ретраев SDK ≤ 1. Р-14: расход ≈ $ — целые микродоллары по `usage`. Р-15: ничего из
  запроса/ответа/ключа не логируется.
- Факты API (справка Claude API, кэш 2026-10-06 — **сверить с живой документацией** `platform.claude.com/docs`):
  цены $/MTok вход/выход — Opus 5.5 `4 / 20`, Haiku 5.5 `0.10 / 0.50` (до 100K токенов промпта), Sonnet 5.5 `2 / 10`.
  У Opus 5.5 thinking **не выключается** (`disabled` → 400), глубина — `output_config.effort`, дефолт `medium`;
  prefill запрещён (400); структурный ответ — `output_config.format` (json_schema), не устаревший `output_format`;
  принудительный `tool_choice` у Opus 5.5 → 400. `stop_reason: "refusal"` — проверять до чтения `content`.
  Изображение — блок `image` с `source.type: "base64"`; длинная сторона до 2576 px у моделей high-res зрения.
  SDK: `anthropic.NewClient(option.WithAPIKey(…), option.WithBaseURL(…), option.WithMaxRetries(…),
  option.WithRequestTimeout(…))`; модель — строкой (`Model: "claude-opus-5-5"`, не типизированные константы);
  ошибки — `errors.As(err, &apierr)` с `*anthropic.Error` и `StatusCode`. Имена полей structured outputs в Go SDK в
  справке не показаны — писать код и чинить по ошибкам компилятора.
- Внешний HTTP в проекте — `internal/fx/fx.go` (структура с `HTTP`/`BaseURL`, таймаут, `httptest` в тестах);
  `vercel.json` без `functions`/`maxDuration`; регион `icn1` (Сеул); два `go.mod` (§6).
- Конфиг — `internal/config/config.go` (`Config` :16-28, `Load()` :34-51, `getEnv` :92-97, `ValidateProduction` :61-70).

## Задача

1. **Проверка до кода** (результат — в Handoff с источниками-ссылками и датой; **не по памяти**):
   - Anthropic API доступен из Южной Кореи (список поддерживаемых стран/регионов API) — функция в `icn1`.
   - Условия платного API: данные запросов не используются для обучения; срок хранения по умолчанию.
   - Лимит времени Vercel-функции Go на тарифе проекта (дефолт и максимум `maxDuration`; тариф проекта — у владельца /
     в настройках Vercel через MCP `get_project`).
   - Актуальные id и цены трёх моделей Р-13; поддержка structured outputs и зрения у них.
   Недоступно из Кореи или Р-13-модель не существует → **стоп, вопрос владельцу** (без кода).
2. Если лимит функции по умолчанию меньше ~60 с — добавить в `vercel.json` `functions` для `api/index.go` с
   `maxDuration` (значение — по п. 1, с запасом над таймаутом клиента) и записать в Handoff.
3. Конфиг: в `Config` — `AnthropicAPIKey`, `AIModelReview`, `AIModelSellers`, `AIModelWish` (дефолты Р-13),
   `AIMonthlyLimit` (int, дефолт 30, Р-8; используется в AI-02). Ничего из этого не в `ValidateProduction`.
4. Пакет `backend/internal/ai`:
   - `Client` поверх SDK: конструктор из ключа + базового URL (для тестов), таймаут запроса (меньше лимита функции, по
     п. 1; стартово 45 с), `MaxRetries(1)`. Без ключа клиента нет (`nil`) — потребители считают ИИ выключенным.
   - Один метод вызова: модель, системная инструкция, содержимое пользователя (текст и/или одна картинка base64 с
     media type), JSON-схема ответа, effort, `max_tokens` → разобранный JSON-ответ + `Usage{Model, InputTokens,
     OutputTokens}`. Ошибки — свои типы: `ErrRateLimited` (429 Anthropic), `ErrRefused` (`refusal`), `ErrFailed`
     (5xx, таймаут, сеть, ответ не по схеме / `max_tokens`).
   - Цены: таблица констант `model → (вход, выход)` в **центах за MTok** (Opus 5.5 — 400 / 2000, Haiku 5.5 — 10 / 50,
     Sonnet 5.5 — 200 / 1000) и `CostMicros(usage) int64 = (in·cIn + out·cOut) / 100`; неизвестная модель → 0.
   - Ничего не логирует (ни тело, ни ответ, ни ключ); ошибки наружу — без содержимого запроса.
5. `backend/README.md`: строки env-таблицы (`ANTHROPIC_API_KEY` — «значение в `memory/secrets/anthropic.md`», три
   модели, `AI_MONTHLY_LIMIT`). Шаблон `memory/secrets/anthropic.md` (вне git) — только если владелец дал ключ;
   иначе в Handoff — шаги владельцу (console.anthropic.com → API key → файл в `memory/secrets/`).

## Тесты

- `internal/ai` на `httptest`: исходящий запрос содержит модель, инструкцию, содержимое и схему — **и ничего сверх**
  (тест разбирает тело); ключ — в заголовке `x-api-key`, есть `anthropic-version`; ответ по схеме → разобран, `Usage`
  заполнен; 429 → `ErrRateLimited`; 500 → `ErrFailed`; `stop_reason: refusal` → `ErrRefused`; таймаут (сервер спит
  дольше таймаута клиента) → `ErrFailed`; невалидный JSON в ответе → `ErrFailed`.
- `CostMicros`: Opus 5.5 1 000 000 входа + 100 000 выхода → 6 000 000; Haiku 5.5 10 000 + 2 000 → 2 000;
  неизвестная модель → 0.
- `config_test.go`: дефолты моделей и лимита; прод без ключа проходит `ValidateProduction`.
- Живой вызов (необязательный тест, skip без `ANTHROPIC_API_KEY` и `AI_LIVE=1`): Haiku 5.5, короткая схема — ответ
  разобран, `Usage > 0`.

## Критерии приёмки

- Handoff: проверка п. 1 со ссылками и датой; решение по `maxDuration`.
- `cd backend && go build ./... && go vet ./... && go test ./...` и в корне `go vet ./api/... && go test ./api/...`
  зелёные; зависимость SDK — в обоих `go.mod`/`go.sum`; CI `ci-backend` зелёный.
- С ключом (если владелец дал) — живой тест локально зелёный; ключ и содержимое не попали ни в логи, ни в git
  (pre-commit-хук).

## Вне скоупа

- Флаг семьи, счётчик, лимит, `/auth/me` — AI-02. Ручки функций — AI-08, AI-11, AI-14 (гейт `aiGate` — AI-08).
- Промпты функций — в задачах функций. Кэширование промптов — не нужно (короткие запросы).
