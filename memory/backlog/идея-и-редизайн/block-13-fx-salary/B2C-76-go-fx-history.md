# B2C-76 — Go: таблица курсов `000004`, ручка `GET /api/fx-rates`, догрузка дней, `cmd/fxbackfill` (бэкенд)

Блок 13 · MVP · Репо/каталог: `backend/` · Зависит от: Блок 12 🏁 · Роли: member, viewer

## Контекст (что уже есть)

- Клиент Нацбанка — `backend/internal/fx/fx.go`: `Client{HTTP, BaseURL, TTL, Now}`, `NewClient()` (таймаут 4 с,
  кэш 1 ч), `Rates(ctx)` — шаг назад до 7 дней от сегодня по Алматы (`almaty`, UTC+5), `fetchDay(ctx, day)` — один
  день (`?fdate=DD.MM.YYYY`), `ParseRates(xml)` → `map[code]float64` по `Supported` (USD, EUR, RUB, CNY). Тесты —
  `fx_test.go` (`httptest`, `testdata/`). Выходные и праздники Нацбанк не публикует — день без курса (пустой ответ).
- Ручка — `handlers/fx.go` `FxRateHandler(client)` (публичная, таймаут 8 с, `Cache-Control: public, s-maxage=3600`);
  маршрут — `server/server.go` ~121. Защищённая группа ~125 (`auth.Middleware`); роль — `auth.GetRole`, участник без
  семьи — 409 `no household` (как у `/api/statements`, `handlers/statements.go`).
- Репозитории: интерфейс + `NewSQL…Repository(*sql.DB)` + мок в `repository/mock_repo.go`; `server.Repos` ~36,
  pg ~49, моки ~58. Образец — `PhotoRepository` (`photo_repo.go`, PG-тест `photo_pg_test.go`).
- Миграции: `backend/migrations/000001…000003*.sql` (`//go:embed`, каждая в транзакции), имена в SQL — с `app.`;
  функция Vercel миграций не применяет; `cmd/server` применяет на старте; в прод — `cmd/migrate` (владелец, §5).
- Пулер 6543 с `binary_parameters=yes` (§6 «Где что лежит»). Таймаут функции Vercel — дефолт Hobby.
- Решения: Р-71 (таблица, ручка, лимиты, backfill), Р-19 (миграции только добавляют).

## Задача

1. Миграция `000004_fx_rates.sql`: `app.fx_rates (day date NOT NULL, code text NOT NULL, rate numeric(12,4) NOT NULL
   CHECK (rate > 0), fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (day, code))`; плюс отметка «день
   проверен, курса нет» (выходной), чтобы не спрашивать банк повторно — отдельной таблицей `app.fx_days (day date
   PRIMARY KEY, published boolean NOT NULL)` или колонкой — на усмотрение исполнителя, запись в Handoff.
2. `repository.FxRepository`: `Rates(ctx, code, from, to)`, `Checked(ctx, from, to)` (какие дни уже спрошены),
   `Save(ctx, day, rates map[string]float64)` (upsert; пустая карта — «проверен, курса нет»). Pg + мок + в `Repos`.
3. В `fx.Client` — публичный `Day(ctx, day) (map[string]float64, error)` (обёртка `fetchDay` без кэша «сегодня»).
4. Ручка `GET /api/fx-rates?code=EUR&from=2025-10-01&to=2026-10-03` (защищённая группа; member и viewer; без семьи —
   409): проверка `code` ∈ `Supported`, даты `YYYY-MM-DD`, `from ≤ to ≤ сегодня (Алматы)`, период ≤ 400 дней → 400.
   Ответ `{ code, rates: { "2026-10-01": 512.34, … }, partial: bool, source }` — только опубликованные дни. Не
   спрошенные дни — догрузить у банка **не больше лимита за запрос** (например 20 дней, по 4 параллельно, общий
   таймаут ≤ 8 с — константы в коде), сохранить; остались — `partial: true`. Ошибка банка не роняет ответ — отдаём
   то, что есть, `partial: true`, в лог — без деталей запроса пользователя.
5. `GET /api/fx-rate` после успешного ответа банка сохраняет свой день в таблицу (ошибка записи — только лог; ответ
   прежний). В моках (`db == nil`) — без записи.
6. `cmd/fxbackfill` — заполнить таблицу за N дней назад (флаг `-days`, по умолчанию 730; пропускает уже
   проверенные; паузы между запросами к банку); подключение — как у `cmd/migrate` (переменная окружения строки БД).
   Выводит `filled N days, M published`.

## Тесты

- `fx`: `Day` на `httptest` (опубликованный день, пустой день, 500 банка).
- Хендлер: 400 на код/даты/период > 400 дней/`to` в будущем; 401 без токена; 409 без семьи; viewer — 200; ответ из
  мока репозитория без банка; догрузка ≤ лимита и `partial: true`; ошибка банка → то, что есть, `partial: true`.
- PG-тест репозитория (как `photo_pg_test.go`): upsert, «проверен без курса», выборка периода.
- `/api/fx-rate` пишет день (мок репозитория видит запись).

## Критерии приёмки

- `cd backend && go build ./... && go test ./...` и корневой `go build ./...` зелёные; PG-тесты — на локальном
  Postgres (Docker `ff-b2c-pg` или embedded, §6 «Грабли»).
- Локально: `cmd/migrate` на локальной базе применяет `000004`; `go run ./cmd/fxbackfill -days 400` заполняет год
  (сверка двух дат с сайтом Нацбанка — в Handoff); `curl` ручки с токеном отдаёт год без `partial`.
- Новых зависимостей Go нет.

## Вне скоупа

- Клиент на фронте и книга курсов — B2C-77. Курсы коммерческих банков, прогноз — не делаем.
- Запуск миграции и backfill в прод — владелец в клинапе (§5).
