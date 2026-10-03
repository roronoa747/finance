# B2C-77 — Книга курсов на фронте: клиент ручки, кэш, `rateOn`, `CNY`, демо-курсы (фронт)

Блок 13 · MVP · Репо/каталог: `frontend/src/` · Зависит от: B2C-76 · Роли: member, viewer, демо

## Контекст (что уже есть)

- `lib/fx.ts`: `FxRates`, `fetchRates(fetchImpl)` (публичная `/api/fx-rate`, ошибка → `null`), `formRate`.
- API-клиент — `api/client.ts` (`ApiClient.request<T>`, `ApiError(status)`, токен `Authorization: Bearer`). Демо
  (`useAuthStore().isDemo`) — без запросов к `/api`.
- `Currency = 'KZT' | 'USD' | 'EUR' | 'RUB'` (`types/finance.ts` ~214) — `CNY` нет (в Go есть).
- `fxToTenge(foreign, rate)` (`lib/finance.ts` ~773) — единственное умножение на курс.
- Локальное хранилище — `lib/storage` (`LOCAL_KEYS` стираются при выходе); время — `lib/dates.ts` (Алматы).
- Ручка B2C-76: `GET /api/fx-rates?code&from&to` → `{ code, rates: { 'YYYY-MM-DD': number }, partial }`.
- Решения: Р-72 (книга, `rateOn`, параметром, демо), Р-70 (`CNY`).

## Задача

1. `Currency` += `'CNY'`; подписи и знаки валют — одна таблица (`€`, `$`, `₽`, `¥`), где удобнее экранам (`lib/money`
   или `lib/fx.ts`); формы счетов получают `CNY`.
2. `type RateBook = Partial<Record<Currency, Record<string, number>>>` и в `lib/finance.ts`:
   `rateOn(book, code, day, fallback?)` — курс последнего дня ≤ `day` в книге (выходные), нет — `fallback`, нет и его —
   `null`; `KZT` → 1. Чистая функция, без дат «сейчас» внутри.
3. `apiClient.fxRates(code, from, to)` и стор/модуль книги (`stores/fx.ts` или `lib/fx.ts` + composable):
   `ensureRates(codes, from, to)` — догружает недостающие периоды, повторяет при `partial` (с паузой, ограниченно),
   кэш в `localStorage` (ключ в `LOCAL_KEYS`), офлайн — что есть. Валюты к загрузке — те, что встречаются в
   документе (оклады, обязательства, счета; до B2C-78 — только счета), период — 13 месяцев назад до сегодня.
4. Демо: синтетическая книга (EUR, USD за 13 месяцев с понятным трендом — например евро с 640 до 506 ₸) без
   запросов; функции подачи данных — те же.

## Тесты

- `rateOn`: точный день, выходной (берёт пятницу), до начала книги → `fallback` → `null`, `KZT` → 1.
- Книга: слияние двух ответов, повтор при `partial`, кэш переживает перезагрузку стора, выход стирает ключ; демо —
  ни одного `fetch`.
- `fxToTenge` остаётся единственным умножением (гвард-тест grep-ом по `lib/` и `components/`, как в прошлых блоках).

## Критерии приёмки

- `cd frontend && npm run build && npm test` зелёные.
- Стенд (Go на моках + Vite :5174): в «Капитале» новый валютный счёт в `CNY` создаётся; книга EUR за год приходит из
  Go (на моках — без БД ручка отвечает из банка или моком — факт в Handoff).

## Вне скоупа

- Оклад и платежи в валюте — B2C-78, B2C-81. Тенге валютного счёта по книге — B2C-79.
