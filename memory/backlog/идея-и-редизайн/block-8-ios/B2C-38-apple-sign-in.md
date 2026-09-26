# B2C-38 — Sign in with Apple: Go и оболочка (бэкенд + оболочка + фронт)

Блок 8 · MVP · Каталог: `backend/`, `frontend/ios/`, `frontend/src/views/Access.vue`, `stores/auth.ts` · Зависит от: B2C-37 · Роли: все

## Контекст (что уже есть)

- Р-13: Sign in with Apple — в блоке iOS, обязателен при входе через Google (правило App Store
  4.8: приложение с третьесторонним входом обязано предлагать вход через Apple). На сайте —
  только Google (правило касается приложения).
- Go после Блока 4: `internal/googleauth` (JWKS, `iss`/`aud`/`exp`, `email_verified`),
  `POST /api/auth/google`, привязка по email, пользователь без семьи, middleware по базе;
  `app.users`: `google_sub`, `display_name`, `password_hash NULL`.
- Apple: identity token — JWT RS256, JWKS `https://appleid.apple.com/auth/keys`, `iss`
  `https://appleid.apple.com`, `aud` = bundle id приложения, `sub` стабильный, `email` может
  быть приватным relay (`@privaterelay.appleid.com`) и **выдаётся только при первом входе**
  вместе с именем (клиент обязан сохранить и прислать); `email_verified` строкой/булевым.
  Плагин оболочки — `@capacitor-community/apple-sign-in` (iOS) — выбор исполнителя с
  обоснованием.

## Задача

1. Вынести общий код JWKS-проверки из `googleauth` в `internal/oidc` (кэш ключей, RS256,
   сравнение `iss`/`aud`/`exp`) — два потребителя; `googleauth` и новый `appleauth` на нём.
2. Миграция `000008_apple_auth.sql` (номер по каталогу): `app.users.apple_sub text UNIQUE NULL`.
3. `POST /api/auth/apple` `{identity_token, name?}` → как Google: по `apple_sub` → иначе по
   `email`, **если это не relay-адрес** (relay — новый пользователь, привязку к существующему по
   почте не делаем; в README — почему) → иначе создать (email из токена; имя — из `name` при
   первом входе); `APPLE_CLIENT_IDS` (bundle id) — без переменной 503. Ответ как у Google.
4. Оболочка/фронт: на iOS кнопка «Войти через Apple» (HIG: чёрная/белая по теме) рядом с
   Google → плагин → `identityToken` + `givenName/familyName` → `apiClient.appleLogin`;
   на Android и в веб кнопки нет. `/access` — по `platform()`.
5. README: переменная, ручка, relay-почта, порядок привязки.

## Тесты

- Go: `oidc` — общие тесты; `appleauth` — фейковый JWKS, `aud` bundle, relay-email → новый
  пользователь без привязки, обычный email → привязка, повторный вход по `sub`, имя при первом
  входе, без переменной 503.
- Фронт: `auth.test.ts` — `appleLogin`; SSR `Access` — кнопка только на iOS.

## Критерии приёмки

- `go build/vet/test` + PG зелёные; на iPhone владельца: вход через Apple (с relay и без) →
  «с кем» → приложение; повторный вход — тот же пользователь.

## Вне скоупа

- Sign in with Apple в веб (JS) — после MVP. Слияние аккаунтов Google и Apple одной семьи —
  через привязку по email, как есть.
