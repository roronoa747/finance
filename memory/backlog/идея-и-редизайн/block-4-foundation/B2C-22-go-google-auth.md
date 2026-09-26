# B2C-22 — Go: вход через Google, привязка по email, пользователь без семьи (бэкенд)

Блок 4 · MVP · Каталог: `backend/` (+ корень `go.mod`, если нужна зависимость — не ожидается) · Зависит от: Блок 3 🏁 · Роли: все; новая — «без семьи»

## Контекст (что уже есть)

- Р-13: ID-токен Google → проверка в Go → свой JWT; почта и пароль уходят с экрана, ручки
  остаются для стенда и e2e; существующие пользователи привязываются по email; пользователь без
  семьи допустим. Р-25: проверка по JWKS Google (RS256 через `golang-jwt`), аудитории —
  `GOOGLE_CLIENT_IDS` (веб, Android, iOS через запятую); без семьи — JWT без `household_id`,
  ручки семьи → 409 `no household`.
- `internal/handlers/auth.go`: `Register` (создаёт пользователя **и** семью, слот `a`), `Login`
  (email + пароль, `GetMembership` → 404 без семьи), `Me` (user, household, member);
  `AuthResponse{Token, User, Household, Member}`. `internal/auth/jwt.go`: `Claims{UserID,
  HouseholdID, Role, Slot}`, HS256, TTL 30 дней; `middleware.go`: `Middleware(tokens)` кладёт
  claims в контекст, хендлеры берут семью из claims — **семья и роль в токене могут устареть
  (роль, удаление аккаунта) — здесь чинится**.
- `app.users`: `email UNIQUE`, `password_hash NOT NULL`. `UserRepository`: `Create(email, hash)`,
  `GetByEmail`, `GetByID`, `Delete`. `HouseholdRepository.GetMembership(userID)` →
  `ErrMembershipNotFound`.
- Зависимость `github.com/golang-jwt/jwt/v5` уже есть — умеет RS256 (`jwt.ParseWithClaims` с
  `*rsa.PublicKey`); JWKS Google — `https://www.googleapis.com/oauth2/v3/certs` (`keys[]`:
  `kid`, `n`, `e` base64url) — собрать `rsa.PublicKey` стандартной библиотекой, кэш по
  `Cache-Control: max-age`. Внешний HTTP — образец `internal/fx/fx.go` (клиент с `BaseURL`,
  таймаут, `httptest` в тестах).
- Конфиг: `getEnv`, `ValidateProduction()`; новые переменные — опциональные.
- Миграции: следующий номер — по каталогу (после Блока 3 ожидается `000004`).

## Задача

1. Миграция `000004_google_auth.sql`: `app.users` — `password_hash` **DROP NOT NULL**, `google_sub
   text UNIQUE NULL`, `display_name text NULL`. Только добавление/ослабление.
2. Пакет `internal/googleauth`: `Verifier{ JWKS URL, HTTP, ClientIDs, Now }` → `Verify(idToken)`
   → `{ Sub, Email, EmailVerified, Name }`: подпись по `kid` из JWKS (кэш, обновление при
   незнакомом `kid`), `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` ∈
   `GOOGLE_CLIENT_IDS`, `exp`, `email_verified == true` (иначе отказ). Таймаут запроса JWKS 4 с.
3. `POST /api/auth/google` `{id_token}` → 200/201 `AuthResponse`: пользователь по `google_sub` →
   иначе по `email` (привязка: записать `google_sub`, `display_name`) → иначе создать (без
   пароля, без семьи). Семья есть → JWT как сейчас; нет → JWT с пустыми `household_id`/`role`/
   `slot`, `Household: null, Member: null`. Без `GOOGLE_CLIENT_IDS` → 503 «вход через Google не
   настроен». Ничего из токена не логируется.
4. **Middleware по факту базы**: после проверки JWT — `GetMembership(userID)` (и существование
   пользователя): claims в контексте обновляются из базы (семья, роль, слот); пользователя нет
   → 401; семьи нет → контекст без семьи. Хелпер `auth.RequireHousehold` (или проверка в
   хендлерах семьи) → 409 `{"error":"no household"}` для `/sync/*`, `/statements*`,
   `/operations*`, `/photos*`, `/household/invites`. `/auth/me`, `/household` (B2C-23),
   `/household/join`, `/account` (B2C-24), `/events` — работают без семьи.
5. `Login` для пользователя без пароля → 401 (обычный текст). `Register` — оставить (стенд, e2e).
   `Me` — `household`/`member` могут быть `null`.
6. `UserRepository`: `GetByGoogleSub`, `CreateGoogle(email, sub, name)`, `LinkGoogle(id, sub,
   name)`; pg + мок. `backend/README.md`: `GOOGLE_CLIENT_IDS`, ручка, поведение без семьи.

## Тесты

- `googleauth`: фейковый JWKS (`httptest`, ключ RSA из теста) — валидный токен; чужой `aud`;
  истёкший; `iss` не Google; `email_verified=false`; незнакомый `kid` → повторная загрузка JWKS;
  таймаут.
- Хендлеры: новый пользователь → 201 без семьи; существующий по email → 200 привязан (в базе
  `google_sub`); повторный вход по `sub`; без `GOOGLE_CLIENT_IDS` → 503; `Me` без семьи;
  `/sync/household` без семьи → 409; токен удалённого пользователя → 401; роль из базы, а не из
  старого токена (мок: сменить роль → следующий запрос видит новую).
- `TestPostgres…`: миграция; `password_hash NULL`; уникальность `google_sub`.
- `config_test.go`: прод-конфиг без `GOOGLE_CLIENT_IDS` валиден.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...`, PG-режим, корень `api/` —
  зелёные; CI `ci-backend` зелёный.
- Живой вход: локально `go run ./cmd/server` с `GOOGLE_CLIENT_IDS` (веб-клиент, создаёт
  владелец в Google Cloud Console; id — в `memory/secrets/google-oauth.md` и env, в доки — имя
  переменной) и ID-токеном, полученным фронтом B2C-25 — пользователь создан/привязан.

## Вне скоупа

- Создание семьи / вход по коду без семьи — B2C-23; удаление — B2C-24; фронт — B2C-25; Apple —
  Блок 8.
