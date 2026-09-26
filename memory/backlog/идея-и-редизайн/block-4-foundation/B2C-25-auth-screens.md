# B2C-25 — Фронт: вход через Google, экран «с кем», удаление аккаунта, старт с pull (фронт)

Блок 4 · MVP · Каталог: `frontend/src/views/Access.vue`, `views/Who.vue` (новый), `views/Settings.vue`, `stores/auth.ts`, `stores/syncEngine.ts`, `api/client.ts`, `router/index.ts` · Зависит от: B2C-22, B2C-23, B2C-24 · Роли: все

## Контекст (что уже есть)

- Р-13, Р-25 (Google Identity Services в веб; нативный плагин — Блоки 7–8); `DESIGN.md` §2
  (первый запуск: Google → «с кем»), §6 (тексты), §2 настройки.
- `views/Access.vue`: режимы `login | register | join` (почта + пароль, `authErrorText`),
  `startDemoMode()`. `stores/auth.ts`: `login`, `register`, `joinHousehold` → `setAuthData`
  (`ff_auth_token`, `ff_user`, `ff_household`, `ff_member`), `isAuthenticated`, `isViewer`,
  `member.slot`; `clearAuth`. Роутер: гард `requiresAuth` → `/access`; после Блока 3 —
  `/start` для первого запуска (B2C-19), `/settings` (B2C-13). Ручки B2C-22…24: `POST
  /api/auth/google`, `GET /api/auth/me` (семья может быть `null`), `POST /api/household`,
  `POST /api/household/join`, `GET /api/household/members`, `DELETE /api/account`; без семьи
  ручки семьи → 409.
- Хвосты сюда: истёкший вход (401) не ведёт на вход; старт движка — полный синк при каждом
  открытии (`syncEngine.ts`: первый круг — `syncHousehold` даже без `unsent`; у viewer — 403 на
  каждом старте). Шторка синка показывает участников из `people` документа, роль — только свою.
- Стенд: e2e и SSR — Node, без Google; Vitest-тесты стора — фейковый `ApiClient`.
- Переменная фронта `VITE_GOOGLE_CLIENT_ID` (публичный id веб-клиента) — env Vercel и
  `frontend/.env.local` (значение — `memory/secrets/google-oauth.md`; в репо —
  `frontend/.env.example` с именем).

## Задача

1. Вход: `Access.vue` — кнопка Google (GIS: скрипт `accounts.google.com/gsi/client` грузится по
   требованию, `initialize({ client_id, callback })` + `renderButton`; One Tap не включать) →
   `apiClient.googleLogin(id_token)` → `setAuthData`; семья `null` → `/who`; семья есть →
   `/start` или `/`. Форма почта/пароль и «Создать» — **только в dev-сборке**
   (`import.meta.env.DEV`), в проде их нет; «По коду» переезжает в `/who`. Демо — как есть
   («Попробовать»).
2. `views/Who.vue` (`/who`, только для вошедших без семьи): «Я один» / «Создать семью» →
   `POST /api/household` (имя семьи по желанию; для «один» — без вопросов) → токен → `/start`;
   «У меня есть код» → `join` → `/start` (партнёр проходит свои шаги, B2C-19). Гард: без семьи →
   всегда `/who` (кроме `/settings` → только удаление и выход).
3. 401 от любой ручки (`ApiError.status === 401`, не в демо) → `clearAuth` + локальные данные
   семьи остаются до входа (как «Выйти»?) — нет: 401 = сессия недействительна → `clearAuth`,
   документ **не стирать** (при повторном входе той же семьи — сольётся; другой семьи —
   `claimFor` очистит), переход на `/access` с текстом «Вход истёк, войдите снова».
4. Старт движка: первый круг — `pullHousehold`/`pullPrivateDoc`; push — только при `unsent` /
   расхождении; тест движка обновить (ожидание изменилось).
5. Настройки: «Семья» — участники из `GET /api/household/members` (роль, «это вы»), код
   приглашения; «Удалить аккаунт» — `DangerZone`, текст из `DESIGN.md` §6 (что удалится, что
   останется у семьи), подтверждение вводом слова → `DELETE /api/account` → очистить всё
   локальное → лэндинг/`/access`. Шторка синка — участников и роли брать из той же ручки.
6. Существующие пользователи: вход через Google той же почтой — привязка прозрачна (текст на
   `/access`: «Раньше входили по почте? Войдите через Google с той же почтой»).

## Тесты

- `stores/auth.test.ts`: `googleLogin` → данные; без семьи → маршрут `/who`; 401 → `clearAuth`
  и переход; удаление → очистка.
- `router.test.ts`: без семьи → `/who`; с семьёй и без данных → `/start`.
- SSR: `Access` в прод-режиме без формы пароля (`import.meta.env.DEV` замокать), `Who`
  три пути, `Settings` участники и удаление; viewer в настройках без кода приглашения.
- `syncEngine.test.ts`: первый круг — pull, POST нет без `unsent`; viewer без 403.
- e2e `b2c-block4-foundation.test.ts` (фейковый бэкенд с новыми ручками): Google-пользователь →
  «один» → `/start` → главный; второй → по коду → партнёр; 401 → `/access`, документ цел;
  удаление → всё очищено; открытие приложения → rev на сервере не растёт.

## Критерии приёмки

- Браузер (стенд с `GOOGLE_CLIENT_IDS`/`VITE_GOOGLE_CLIENT_ID`, настоящий вход Google в двух
  профилях): один → семья → первый запуск; второй → по коду; настройки — участники, удаление
  (стенд); прод-сборка (`vite preview`) без формы пароля; `cd frontend && npm run build && npm
  test` зелёные.

## Вне скоупа

- Лэндинг и перенос демо — B2C-27. Apple — Блок 8. Нативные плагины — Блоки 7–8.
