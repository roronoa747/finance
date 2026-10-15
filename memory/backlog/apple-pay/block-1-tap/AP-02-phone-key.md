# AP-02 — Личный ключ: подключить, статус, отключить (бэкенд)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: AP-01 · Роли: member (свой ключ); viewer — 403

## Контекст (что уже есть)

- Р-5, Р-13: один ключ на человека, показывается один раз, в базе — SHA-256; «Подключить» снова — новый ключ, старый
  мёртв; «Отключить» — удаление. Ключ — `Authorization: Bearer ffk_…`. Р-17: ссылки на команды — env бэкенда, отдаются
  ручкой статуса; только `https://www.icloud.com/shortcuts/…`.
- Таблица `app.phone_keys` (PK `user_id`, `key_hash BYTEA UNIQUE`, `created_at`, `last_used_at`) — из AP-01.
- Роуты — `server/server.go` `NewRouter` :126-223; группа `family` :192 (`auth.RequireHousehold`); `Repos` :33-43
  (SQL :50-60, моки :66-68). `member()` → 403 «only members» (`handlers/statements.go:74-84`). Роль и семья из базы —
  `membershipResolver` (`server.go:82-98`) через `repos.Households.GetMembership`. Похожее хранение кодов —
  `household_invites` (код открытым текстом; у нас — только хеш).
- Конфиг: `internal/config/config.go` `Config` / `Load()` :34-51 (`getEnv`); таблица env — `backend/README.md`
  «Переменные окружения». `ValidateProduction()` новые переменные **не** требует.

## Задача

1. Конфиг: `APPLEPAY_SHORTCUT_URL`, `APPLEPAY_SHORTCUT_URL_LEGACY` → поля `Config`; значение не с префиксом
   `https://www.icloud.com/shortcuts/` — считается пустым (лог-предупреждение при старте без значения).
2. Пакет `internal/applepay` (рядом с `fx`, `linkpreview`): `NewKey() (plain string, hash []byte, err)` — `ffk_` +
   base64url(32 байта `crypto/rand`); `HashKey(plain) []byte` — SHA-256; `ParseBearer(header) (plain, ok)` — только
   формат `Bearer ffk_<43 знака>`.
3. Репозиторий `internal/repository/phonekey_repo.go` (+ мок): `Put(ctx, userID, hash)` (upsert — заменяет старый,
   `created_at = now()`, `last_used_at = NULL`), `Delete(ctx, userID)`, `Get(ctx, userID) (*PhoneKey, error)`
   (подключён / когда / последнее использование), `UserByHash(ctx, hash) (userID, error)` + отметка `last_used_at`
   (одним запросом).
4. Хендлер `internal/handlers/applepay.go`, ручки в группе `family`:
   - `GET /api/applepay` (member) → `{"connected": bool, "connected_at"?: ts, "last_used_at"?: ts, "shortcut_url":
     "…"|"", "shortcut_url_legacy": "…"|""}`.
   - `POST /api/applepay/connect` (member) → 201 `{"key": "ffk_…"}` — **единственный раз, когда ключ уходит с
     сервера**; заголовок `Cache-Control: no-store`.
   - `DELETE /api/applepay` (member) → 204; ключа нет — тоже 204.
   - viewer → 403 на все три.
5. Мидлварь ключа для ручек телефона (`applepay.KeyAuth` или функция в хендлере — без нового общего механизма): нет /
   битый / неизвестный ключ → 401 `{"error":"unauthorized"}` без подробностей; ключ найден → членство из базы
   (`GetMembership`): нет семьи или роль не `member` → 403; в контекст — `userID`, `householdID` (существующие ключи
   контекста `auth` — чтобы `member()` и `caller()` работали как в JWT-ручках). Ключ, хеш и тело не логируются.
6. `backend/README.md` — две строки env (имя и смысл, без значений).

## Тесты

- `applepay`: ключ — префикс, длина, два вызова различаются; `HashKey` детерминирован; `ParseBearer` отвергает JWT,
  пустое, `Bearer` без ключа, лишние пробелы внутри.
- Хендлер (моки): connect → ключ в ответе, в моке — только хеш (тест сравнивает: открытого ключа в хранилище нет);
  повторный connect — старый хеш не находится; DELETE → статус `connected: false`; viewer → 403 на всех трёх; ссылки из
  конфига в статусе, ссылка не iCloud → пусто.
- Мидлварь: неизвестный ключ → 401; ключ viewer → 403; ключ пользователя без семьи → 403; удалённый ключ → 401.
- PG: `Put`/`UserByHash`/`Delete`, `last_used_at` обновляется, каскад при удалении пользователя.

## Критерии приёмки

- `go build ./... && go vet ./... && go test ./...` + PG-тесты — зелёные; `grep` по диффу: ни `log.` с ключом/телом, ни
  ключа в тестовых фикстурах, похожих на настоящий (pre-commit-хук ловит секрето-подобные строки — фикстуры собирать из
  частей).
- Стенд (Go :8141 с БД :54451): `curl` connect → ключ; статус `connected: true`; DELETE → `false`.

## Вне скоупа

- Ручка касания — AP-03; экраны — AP-06. Несколько ключей на человека — после MVP. Ручка пуша и её ссылка — Блок 2.
