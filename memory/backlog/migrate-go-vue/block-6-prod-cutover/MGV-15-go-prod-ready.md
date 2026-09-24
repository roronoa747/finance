# MGV-15 — Go к проду: fail-fast, схема `app`, коды 400/413, `/api/fx-rate` (бэкенд)

Блок 6 · MVP · Репо/каталог: `backend/` · Зависит от: Блоки 1–5 · Роли: все (вход, синк), анонимный (курс)

## Контекст (что уже есть)

- `backend/internal/config/config.go` — `Load()` читает `PORT`, `DATABASE_URL`, `JWT_SECRET`
  (дефолт `dev-secret-change-in-production`), `CORS_ORIGIN`, `APP_ENV` (дефолт `development`);
  ошибок не возвращает никогда. Тесты — `config_test.go`.
- `backend/cmd/server/main.go` — без `DATABASE_URL` молча уходит на in-memory моки
  (`repository.NewMockRepositories()`); с ним — `db.Connect` + `db.RunMigrations` на старте.
  Роутер — `setupRouter(...)`, все ручки под `/api`.
- `backend/migrations/000001_init.sql` — таблицы `users`, `households`, `household_members`,
  `household_docs`, `private_docs`, `household_invites` **без схемы** и с `IF NOT EXISTS`.
  На живой базе Supabase в `public` уже лежат таблицы React с теми же именами → миграция
  молча пропустит создание (Р-7: Go живёт в схеме `app`). Миграция 000001 к живой базе
  не применялась никогда.
- `backend/internal/db/migrate.go` — раннер, таблица учёта `schema_migrations` (тоже без схемы),
  сессионный advisory lock.
- SQL репозиториев — `backend/internal/repository/{user,household,doc}_repo.go`, имена таблиц
  без схемы.
- `backend/internal/testdb/testdb.go` — PG-тесты сбрасывают `DROP SCHEMA public CASCADE`.
- Синк: `backend/internal/handlers/sync.go` — `http.MaxBytesReader(w, r.Body, 10<<20)`,
  ошибка декодирования → 400 (в т.ч. превышение лимита — надо 413). `PushDocRequest.Data` —
  `json.RawMessage`: битый UTF-8 доезжает до PostgreSQL, тот отвергает `jsonb` → 500 (надо 400).
  Тот же `MaxBytesReader` (1 МБ) — в `auth.go` (`Register`, `Login`) и `household.go` (`JoinHousehold`).
- Курс валют: React зовёт Edge Function Supabase `fx-rate` (`src/lib/fx.ts`), её исходника
  в репо нет — взять с живого проекта (`get_edge_function`, проект `tpkyopaovfdkcmdhauws`,
  только чтение). Контракт ответа (`frontend/src/lib/fx.ts`, тип `FxRates`):
  `{ rates: Record<string, number>, date: string, source: string }`; `rates[код] = тенге за 1 ед.`
  Источник — Национальный банк РК (сайт не отдаёт CORS, поэтому только с сервера).

## Задача

1. **Fail-fast прода** (Р-13): при `APP_ENV=production` `config.Load()` возвращает ошибку, если
   `DATABASE_URL` пуст или `JWT_SECRET` пуст / равен дефолту / короче 32 символов. `main.go`
   уже падает на ошибке `Load()` — проверить, что моки в проде недостижимы.
2. **Схема `app`** (Р-7): все объекты Go — в схеме `app` (включая таблицу учёта миграций).
   Рекомендуемый путь — квалифицировать имена (`app.users` …) в миграции и в SQL репозиториев:
   это работает на любом пулере, не завися от `search_path` (риск брифа: Supavisor может не
   передать `search_path` из строки подключения). Правка 000001 допустима (к живой базе не
   применялась); выбранный путь — в Handoff. `testdb` сбрасывает схему `app` (и `public`,
   если там что-то остаётся от старых прогонов).
3. **Коды ошибок** (Р-13): превышение лимита тела (`*http.MaxBytesError`) → **413** во всех
   ручках с `MaxBytesReader`; невалидный UTF-8 в `data` синка → **400** до обращения к БД.
4. **`GET /api/fx-rate`** (Р-11): публичная ручка (без JWT — демо-режим тоже её видит),
   отдаёт `FxRates` по курсам Нацбанка, логика — по образцу живой Edge Function.
   Кэш в памяти процесса (TTL ~1 ч) + заголовок `Cache-Control: public, s-maxage=3600`
   (на Vercel кэширует CDN). Банк недоступен → 502 с `{"error": ...}` (Vue тогда даёт ввести
   курс руками). Внешний HTTP — с таймаутом; клиент/URL инъецируются для тестов.

## Тесты

- `config`: прод без `DATABASE_URL` → ошибка; прод с дефолтным/коротким `JWT_SECRET` → ошибка;
  прод с корректными значениями → ок; `development` без переменных → ок (как сейчас).
- `handlers`: тело > лимита → 413 (синк и вход); `data` с битым UTF-8 → 400.
- `fx`: разбор ответа банка на фикстуре (из реального формата); повторный вызов в пределах
  TTL не ходит наружу; банк отвечает ошибкой/таймаутом → 502; заголовок `Cache-Control`.
- PG-режим (`TEST_DATABASE_URL`): таблицы создаются в `app`, в `public` ничего нового;
  существующий E2E на реальном PG зелёный. Отдельный тест: в `public` заранее лежит таблица
  `household_docs` чужой структуры — миграции Go её не трогают и создают свою в `app`.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` — зелёные.
- `TEST_DATABASE_URL=<одноразовая БД> go test -p 1 -count=1 -run Postgres ./...` — зелёные.
- Локально: `APP_ENV=production go run ./cmd/server` без переменных падает с понятной ошибкой;
  `curl localhost:8080/api/fx-rate` (dev) отдаёт курсы с живого банка.
- CI `ci-backend` зелёный (push в ветку блока — с согласия владельца, `main` не пушится).

## Вне скоупа

- Адаптер Vercel, отдельная команда миграций, пул под пулер — MGV-16.
- Использование `/api/fx-rate` во Vue — MGV-17.
- liveness/readiness (Н-10) — закрыт Р-13 как неактуальный для serverless.
- Любые записи в живую базу Supabase — не в этой задаче.
