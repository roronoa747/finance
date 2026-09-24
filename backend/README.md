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

## Переменные окружения

| Переменная | Где | Значение |
|---|---|---|
| `APP_ENV` | прод | `production` — включает fail-fast: без `DATABASE_URL` или с дефолтным/коротким (< 32) `JWT_SECRET` сервер не стартует |
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
