# PV-20 — Ошибки входа по-русски и ошибка кода приглашения (Б-13, Б-14) (фронт)

Блок 5 · MVP · Каталог: `frontend/` · Зависит от: Блок 1 (по порядку — Блок 4) · Роли: все

## Контекст (что уже есть)

- Р-15: контракт Go не меняется, тексты переводятся на фронте по текстам Go.
- Ошибка доходит как `ApiError { status, data, message = body.error }` (`frontend/src/api/client.ts:12-24,
  67-72`; без `error` в JSON — `HTTP error {status} …`); `stores/auth.ts:82-86, 98-104, 157-161`
  пробрасывает.
- `views/Access.vue`: проверки до отправки (`:73, :85, :102`); разбор в `catch` (`:116-126`):
  `/invalid credentials|unauthorized/i` → «Неверная почта или пароль»; `/already exists|duplicate/i`
  → «Пользователь с такой почтой уже зарегистрирован»; `/invalid or expired invite code/i` → «Код
  приглашения недействителен или истёк»; иначе — сырой английский текст.
- **Тексты Go** (поле `error`): Register (`backend/internal/handlers/auth.go:53-107`): 400 «valid
  email is required», 400 «password must be at least 6 characters long», 409 «user already
  exists», 500 «failed to create user» / «failed to create household» / «failed to generate
  token»; Login (`:109-154`): 400 «email and password are required», 401 «invalid email or
  password», 404 «household membership not found», 500 «failed to load household membership»;
  Join (`household.go:66-112`, маршрут защищённый): 400 «invite code is required», 401
  «unauthorized», 404 «invite code not found», 400 «invite code has already been used» / «invite
  code has expired» / «household has maximum members», 500 «failed to join household»;
  CreateInvite (`:38-64`): 403 «only full members can create invites», 401 «unauthorized», 500
  «failed to create invite»; тело (`auth.go:184-196`): 413 «request body too large», 400 «invalid
  request body»; мидлвар (`internal/auth/middleware.go:19-50`): 401 «unauthorized».
- Следствия: «invalid email or password» не совпадает с `invalid credentials` → английский;
  тексты кода приглашения не совпадают с регэкспом → английский; короткий пароль — английский;
  режим «По коду» на `/access` без токена → 401 «unauthorized» → «Неверная почта или пароль»
  (хвост «новые семьи» — не чинить, но текст должен быть честным).
- React `src/screens/Access.tsx:178-189` (Supabase): «Почта или пароль не подходят.», «Пароль
  слишком короткий: нужно хотя бы 6 символов.», «Такая почта уже зарегистрирована…» — взять
  оттуда дословно, где смысл совпадает.
- **Б-14.** `views/Overview.vue:177-187` `makeInvite` — `catch { console.error }` (`:182-183`),
  баннер при `people.length < 2` (`:205`) виден и viewer (получит 403); `views/Setup.vue:111-121`
  `handleMakeInvite` — только `console.error` (`:116-117`). React `Setup.tsx:520-530` — текст
  ошибки встаёт на место кода (`:525-526`), то же `:230-231`, `SyncBadge.tsx:52-53`.

## Задача

1. `lib/authErrors.ts`: `authErrorText(message: string, context: 'login' | 'register' | 'join' |
   'invite'): string` — таблица Go-текст → русский (все тексты выше; «unauthorized» в `join` →
   «Чтобы войти по коду, сначала войдите в аккаунт»; 5xx и неизвестное → «Не получилось
   связаться с сервером. Попробуйте ещё раз.»; сырой текст — в `console.warn`).
2. `Access.vue`: разбор через `authErrorText` (регэкспы убрать).
3. `Overview.vue`, `Setup.vue`: ошибка создания кода показывается текстом под кнопкой
   (`authErrorText(…, 'invite')`); viewer баннер не видит (`isViewer`).

## Тесты

- `lib/authErrors.test.ts`: каждый Go-текст → ожидаемая строка; неизвестный → общая;
  `HTTP error 500 …` → общая.
- `views/views.test.ts` (SSR `Access`/`Setup`) — при заданной ошибке текст виден; `Overview.test.ts`
  — под viewer баннера приглашения нет.

## Критерии приёмки

- Браузер (стенд, Go на моках): неверный пароль → «Почта или пароль не подходят.»; пароль
  «123» при регистрации → русский текст; код приглашения выдуманный → «Код не найден…»; повтор
  использованного → «уже использован»; ошибка создания кода (например, viewer) — текст на
  экране, не в консоли.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Вход по коду без сессии, шаг дохода партнёра — хвост «новые семьи» (`STATE.md`).
- Изменение текстов Go — нет (Р-15).
