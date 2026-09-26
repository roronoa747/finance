# B2C-33 — Capacitor Android: проект, сборка, нативный вход Google (оболочка + фронт + бэкенд CORS)

Блок 7 · MVP · Каталог: `frontend/` (`capacitor.config.ts`, `android/`), `frontend/src/lib/platform.ts` (новый), `backend/internal/config` · Зависит от: Блок 5 🏁 (Блок 6 — если открыт) · Роли: —

## Контекст (что уже есть)

- Р-18: Capacitor поверх того же кода (не Flutter), сборка со встроенными файлами, релиз через
  магазин, live-обновления — после; Android первым. Р-25: в оболочках — нативный плагин входа
  Google (WebView не допускает OAuth Google), тот же ID-токен на `POST /api/auth/google`;
  аудитории — `GOOGLE_CLIENT_IDS`.
- Веб-приложение: `frontend/` (Vite, `dist/`), API по относительному `/api` (`api/client.ts`
  `baseUrl`), JWT в заголовке (кук нет), вход Google через GIS (B2C-25), PWA SW (`/sw.js`),
  Web Share (сторис B2C-20), `<input type=file>` для выписок (B2C-07), фото — `fetch` с токеном.
- Go CORS (`server.go`): `cfg.AllowedOrigins()` из `CORS_ORIGIN` (по умолчанию localhost:5173);
  прод — тот же origin, CORS не использовался. Оболочка Android отдаёт приложение с origin
  `https://localhost` — запросы к домену станут кросс-доменными → `CORS_ORIGIN` должен включать
  `https://localhost` (Android) и `capacitor://localhost` (iOS, Блок 8).
- Домен и имя приложения — B2C-26 / `DESIGN.md` §1; `appId` — обратное имя домена.
- Инструменты на машине владельца: Android Studio + SDK (устанавливает владелец по инструкции
  агента; `./gradlew` из CLI после установки), телефон владельца по USB (отладка) —
  проверка сборки только так, CI оболочки нет (§6).
- Секреты: `google-services.json` (Firebase, B2C-35) и keystore подписи (B2C-36) — в
  `memory/secrets/android/`, в `.gitignore`; OAuth-клиент Android (SHA-1 отпечаток) создаёт
  владелец в Google Cloud Console.

## Задача

1. Зависимости (разрешены ТЗ): `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
   `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/share`, `@capacitor/filesystem`, плагин
   входа Google (выбор исполнителя: `@codetrix-studio/capacitor-google-auth` или
   `@capgo/capacitor-social-login` — критерии: поддерживается, отдаёт `idToken`, обоснование в
   Handoff). `frontend/capacitor.config.ts`: `appId`, `appName`, `webDir: 'dist'`. `npx cap add
   android` → `frontend/android/` в git (сборочные каталоги — по `.gitignore` Capacitor);
   иконки и сплэш из `DESIGN.md`.
2. `lib/platform.ts`: `isNative()`, `platform()`; сборка оболочки — `VITE_API_BASE=https://<домен>/api`
   (клиент берёт `baseUrl` из env при наличии), веб-сборка — без изменений; регистрация SW в
   оболочке пропускается; `Web Share` → `@capacitor/share` с файлом через `Filesystem` (сторис);
   `<input type=file>` работает в WebView (проверить с PDF из «Файлов»).
3. Вход: на `isNative()` — кнопка Google зовёт плагин → `idToken` → `apiClient.googleLogin`
   (тот же путь, что веб); `GOOGLE_CLIENT_IDS` — добавить аудиторию, которую отдаёт плагин
   (обычно веб-клиент как `serverClientId`; Android OAuth-клиент с SHA-1 нужен для работы
   плагина, в `aud` не попадает — проверить по факту и записать).
4. Оболочка: `viewport-fit=cover`, отступы `env(safe-area-inset-*)` в `AppShell`; статус-бар под
   тему (светлая/тёмная); системная «Назад» — `App.addListener('backButton')`: закрыть открытый
   `Sheet` → назад по истории → на корне свернуть приложение.
5. Go: `CORS_ORIGIN` в проде — домен + `https://localhost` + `capacitor://localhost`; тест
   `AllowedOrigins`. README.
6. Сборка: `npm run build` с env → `npx cap sync android` → `./gradlew assembleDebug` → APK на
   телефон владельца; шаги — в `frontend/android/README.md` (без секретов).

## Тесты

- `platform.test.ts`; `api/client.test.ts` — `baseUrl` из env; `AppShell.dom.test.ts` — «Назад»
  закрывает `Sheet`; Go `config_test.go` — origins.
- Веб-сборка не изменилась по поведению: весь `e2e/` и `npm test` зелёные.

## Критерии приёмки

- Debug-APK на Android владельца: вход Google (нативно), синк семьи с прода (CORS ok), загрузка
  выписки из «Файлов», фото цели, сторис через системный лист, «Назад», тёмная тема; веб-прод
  без регрессий. Запись шагов сборки в README оболочки.

## Вне скоупа

- Приём «Поделиться» — B2C-34; пуш — B2C-35; магазин — B2C-36; live-обновления — после MVP.
