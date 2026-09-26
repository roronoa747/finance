# Бэкенд Family Finance (Go)

REST API приложения: вход, домохозяйство, синхронизация `household_docs` / `private_docs`,
курс Нацбанка. Все таблицы — в схеме **`app`** (в той же базе Supabase в `public` лежат
таблицы старого React-приложения).

## Как устроено

- `server/` — сборка роутера (`NewHandler`, `FromEnv`); единая точка для двух запусков:
  - `cmd/server` — долгоживущий сервер для локальной разработки, миграции на старте;
  - `../api/index.go` — функция Vercel (корневой модуль `finance-vercel`, `replace` на
    `./backend`); миграций **не** запускает, пул — `db.ServerlessPool`.
- `cmd/migrate` — миграции отдельной командой (прод).
- `cmd/transfer` — перенос семьи между таблицами React (`auth.users`, `public.*`) и схемой `app`
  в одной транзакции со сверкой до `COMMIT` (расхождение → `ROLLBACK`, код выхода ≠ 0).
- `migrations/` — SQL, встроены в бинарник.
- Синк (`handlers/sync.go`, `repository/doc_repo.go`): push с верной ревизией сохраняет ключи
  верхнего уровня, которых нет в присланном документе (`data || pushed` в том же `UPDATE`, что
  и проверка ревизии), — старый PWA не стирает списки нового кода; присланные `[]` и `null`
  побеждают. Вложенное сервер не сливает — это клиент (`frontend/src/lib/merge.ts`).
- Выписки (`handlers/statements.go`, `repository/statement_repo.go`, миграция `000002`): файл
  выписки на сервер не приходит — только JSON операций, разобранных на телефоне.
  `POST /api/statements` (member) — запись загрузки `{bank, period_from, period_to, ops_count}`;
  `GET /api/statements` (member и viewer) — загрузки семьи со слотом загрузившего.
  `POST /api/operations/batch` (member, ≤ 2000 строк / 2 МБ) — upsert **своих** операций по
  отпечатку `id`; `GET /api/operations?since=<RFC3339>&limit=<≤2000>` (member) — свои операции
  после курсора `updated_at`, `next` — метка последней; страница не рвётся внутри одного батча.
  В текстовых полях 6+ цифр подряд — 400 (и CHECK в базе); тела операций не логируются.

## Переменные окружения

| Переменная | Где | Значение |
|---|---|---|
| `APP_ENV` | прод | `production` (регистр и пробелы не важны) — включает fail-fast: без `DATABASE_URL` или с дефолтным/коротким (< 32) `JWT_SECRET` сервер не стартует. Функция Vercel (`FromEnv`) проверяет это **всегда**, даже без `APP_ENV` |
| `DATABASE_URL` | прод, опционально локально | без неё локально — in-memory моки |
| `JWT_SECRET` | прод | 32+ символа, свой для Preview и Production |
| `PORT`, `CORS_ORIGIN` | только `cmd/server` | дефолты `8080` и `localhost:5173` |

Строки подключения к Supabase — только в `memory/secrets/` и env Vercel, в доки не пишутся.

- **Функция Vercel** — транзакционный пулер Supavisor, порт `6543`, с `binary_parameters=yes`
  в строке (иначе `lib/pq` делает prepare и bind в разных обращениях, а пулер между ними
  может сменить соединение).
- **`cmd/migrate` и `cmd/transfer`** — сессионное/прямое подключение, порт `5432`
  (advisory lock миграций и перенос в одной транзакции требуют одной сессии).

## Команды

```sh
go run ./cmd/server                                   # локально, моки
DATABASE_URL=<5432> go run ./cmd/migrate              # миграции схемы app (идемпотентно)
DATABASE_URL=<5432> go run ./cmd/transfer forward -dry-run   # репетиция переноса, всё откатывается
DATABASE_URL=<5432> go run ./cmd/transfer forward [-replace] # копия public → app (-replace: app не пуст)
DATABASE_URL=<5432> go run ./cmd/transfer back [-force] [-dry-run] # откат: документы app → public
go test ./...                                         # юнит-тесты на моках
TEST_DATABASE_URL=<одноразовая БД> go test -p 1 -run Postgres ./...   # БД стирается
```

`testdb` отказывается работать, если в `TEST_DATABASE_URL` есть `supabase`: тесты делают
`DROP SCHEMA public CASCADE`, а на живом проекте там прод-данные React.
