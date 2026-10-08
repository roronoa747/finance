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
- `cmd/fxbackfill` — история курсов Нацбанка за `-days` дней назад (прод, вручную после
  `cmd/migrate`); спрошенные дни пропускает, сбой банка по дню считает `failed` — повтор добирает.
- `migrations/` — SQL, встроены в бинарник.
- Вход (`handlers/auth.go`, `internal/googleauth`, миграция `000005`, Р-13, Р-25):
  `POST /api/auth/google {id_token}` — ID-токен Google проверяется по JWKS Google (подпись RS256
  по `kid`, ключи кэшируются по `max-age`, незнакомый `kid` — перезагрузка не чаще раза в минуту;
  `iss` — Google, `aud` ∈ `GOOGLE_CLIENT_IDS`, `exp`, `email_verified`). Пользователь ищется по
  `google_sub`, иначе по почте (старый пользователь привязывается: `google_sub`, `display_name`),
  иначе создаётся без пароля и **без семьи** — 201, иначе 200; ответ — `AuthResponse`, у
  пользователя без семьи `household`/`member` — `null`, JWT без семьи. Почта, привязанная к
  другому аккаунту Google, — 409. Без `GOOGLE_CLIENT_IDS` — 503; JWKS недоступен — 503; плохой
  токен — 401. Из токена ничего не логируется. `register`/`login` остаются для стенда и e2e;
  пользователь без пароля по `login` получает 401.
  **Семья по факту базы:** защищённые ручки берут семью, роль и слот не из JWT, а из базы на
  каждом запросе (`auth.Middleware` + `membershipResolver`): удалённый пользователь — 401,
  смена роли действует сразу. Без семьи (`auth.RequireHousehold`) — 409 `no household` на
  `/sync/*`, `/statements`, `/operations*`, `/photos*`, `/household/invites`, `/fx-rates`;
  работают `/auth/me` и `/household/join`.
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
- Фото целей и желаний (`handlers/photos.go`, `repository/photo_repo.go`, миграция `000003`, Р-9):
  картинка сжимается на телефоне (~100 КБ webp), байты лежат в `app.photos` (`bytea`).
  `POST /api/photos?hidden=0|1` (member; тело — байты, `Content-Type` `image/webp` или
  `image/jpeg`, ≤ 512 КБ → иначе 413; сигнатура формата проверяется → 400) — `201 {id}`.
  `GET /api/photos/{id}` (member и viewer) — своя семья; скрытое (`hidden`, подарок-сюрприз) —
  только автору, всем остальным **404**, как и чужой семье и неизвестному id (существование
  не раскрывается); заголовки `Cache-Control: private, max-age=31536000, immutable` и
  `X-Content-Type-Options: nosniff`. `DELETE /api/photos/{id}` — автор всегда; **не-скрытое —
  любой member семьи** (цель общая, её картинка тоже — решение B2C-16); viewer — 403; чужое
  скрытое — 404. `<img src>` токен не несёт — клиент забирает `fetch`-ом с `Authorization` и
  показывает через object URL. Байты идут параметром `[]byte`: `bytea` принимает и бинарную
  форму (пулер с `binary_parameters=yes`), в отличие от `jsonb`.
- История курсов (`handlers/fx.go`, `repository/fx_repo.go`, миграция `000004`, Р-71):
  `app.fx_rates` — курс дня по коду (`fx.Supported`: USD, EUR, RUB, CNY), `app.fx_days` — «день
  спрошен у банка». `GET /api/fx-rates?code=EUR&from=YYYY-MM-DD&to=YYYY-MM-DD` (member и viewer;
  другая роль — 403, токен без семьи — 409): `from ≤ to ≤ сегодня (Алматы)`, ≤ 400 дней — иначе
  400. Дни без отметки догружаются из банка: новые первыми, ≤ 20 за запрос, по 4 параллельно,
  общий таймаут 6 с; остаток или сбой банка — `partial: true` с тем, что есть (клиент спросит
  снова). Правила `fx_days` (`MissingDays`/`SaveAsked` — одни для ручки и `cmd/fxbackfill`):
  пустой прошлый день — «не опубликован», пустое «сегодня» не пишется (курс может выйти позже),
  опубликованный день назад не откатывается. Ответ банка без закрывающего `</rates>` (страница
  работ, обрезанная лента) — ошибка, а не пустой день. Публичная `GET /api/fx-rate` пишет свой
  опубликованный день раз на экземпляр (таймаут записи 2 с, ошибка — только лог).
  **Новый код в `fx.Supported`** сам в историю не догрузится (отметка дня общая на все коды):
  `DELETE FROM app.fx_days`, затем `cmd/fxbackfill`.

## Переменные окружения

| Переменная | Где | Значение |
|---|---|---|
| `APP_ENV` | прод | `production` (регистр и пробелы не важны) — включает fail-fast: без `DATABASE_URL` или с дефолтным/коротким (< 32) `JWT_SECRET` сервер не стартует. Функция Vercel (`FromEnv`) проверяет это **всегда**, даже без `APP_ENV` |
| `DATABASE_URL` | прод, опционально локально | без неё локально — in-memory моки |
| `JWT_SECRET` | прод | 32+ символа, свой для Preview и Production |
| `PORT`, `CORS_ORIGIN` | только `cmd/server` | дефолты `8080` и `localhost:5173` |
| `GOOGLE_CLIENT_IDS` | прод, опционально | id клиентов OAuth Google через запятую (веб, Android, iOS) — допустимые `aud`; без неё вход через Google отвечает 503. Значения — `memory/secrets/google-oauth.md` |

Строки подключения к Supabase — только в `memory/secrets/` и env Vercel, в доки не пишутся.

- **Функция Vercel** — транзакционный пулер Supavisor, порт `6543`, с `binary_parameters=yes`
  в строке (иначе `lib/pq` делает prepare и bind в разных обращениях, а пулер между ними
  может сменить соединение).
- **`cmd/migrate` и `cmd/fxbackfill`** — сессионное/прямое подключение, порт `5432`
  (advisory lock миграций и перенос в одной транзакции требуют одной сессии).

## Команды

```sh
go run ./cmd/server                                   # локально, моки
DATABASE_URL=<5432> go run ./cmd/migrate              # миграции схемы app (идемпотентно)
DATABASE_URL=<5432> go run ./cmd/fxbackfill -days 730   # история курсов (идемпотентно; повтор добирает failed)
go test ./...                                         # юнит-тесты на моках
TEST_DATABASE_URL=<одноразовая БД> go test -p 1 -run Postgres ./...   # БД стирается
```

`testdb` отказывается работать, если в `TEST_DATABASE_URL` есть `supabase`: тесты делают
`DROP SCHEMA public CASCADE`, а на живом проекте там прод-данные React.
