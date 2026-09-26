# B2C-37 — Capacitor iOS на Mac: проект, сборка, вход Google, пуш через APNs (оболочка + фронт)

Блок 8 · MVP · Каталог: `frontend/ios/`, `frontend/src/lib/platform.ts`, `lib/push.ts`, `backend/internal/config` · Зависит от: Блок 7 🏁 · Роли: —

## Контекст (что уже есть)

- Р-18 (iOS — на Mac владельца; Apple Developer 99 $/год принят), Р-25 (нативный вход Google;
  `GOOGLE_CLIENT_IDS` — добавить аудиторию iOS, если плагин отдаёт токен с ней), Р-26 (пуш iOS —
  через APNs средствами Firebase: FCM-токен, тот же отправитель). Основа дизайна — iPhone.
- Оболочка Android (Блок 7): `capacitor.config.ts`, `lib/platform.ts`, `lib/push.ts`
  (`@capacitor/push-notifications`), плагин входа Google, `VITE_API_BASE`, CORS
  (`capacitor://localhost` уже добавлен в B2C-33), сторис через `@capacitor/share`.
- Mac: Xcode, CocoaPods, аккаунт Apple Developer (владелец); `npx cap add ios` → `frontend/ios/`
  (в git без `Pods/`); подпись — команда разработчика в Xcode. Firebase: iOS-приложение (bundle
  id = `appId`), `GoogleService-Info.plist` → `memory/secrets/ios/` (в git не попадает,
  копируется перед сборкой), APNs-ключ `.p8` — загружает владелец в Firebase (секрет).
  Пуш через FCM на iOS требует Firebase SDK в оболочке и код в `AppDelegate` по документации
  Capacitor («Push Notifications — iOS with FCM»).
- Файлы: выписка на iOS — из «Файлов» (`<input type=file>` открывает системный выбор; Kaspi
  «Поделиться → Сохранить в Файлы» → выбрать); Share Extension — после MVP.
- Сессии Блока 8 идут **на Mac владельца** (клон репо, `git config core.hooksPath
  memory/process/hooks`, Node, Go для тестов).

## Задача

1. `npx cap add ios`, иконки/сплэш, `Info.plist`: `NSPhotoLibraryUsageDescription`,
   `NSCameraUsageDescription` (фото целей), URL-схема для входа Google (reversed client id),
   capabilities Push Notifications и Sign in with Apple (B2C-38), Background Modes → remote
   notifications. iPhone only (iPad — не поддерживаем, отметить в App Store Connect).
2. Вход Google на iOS через тот же плагин (iOS client id в Google Cloud Console — владелец;
   `GOOGLE_CLIENT_IDS` — по факту `aud`).
3. Пуш: Firebase SDK по документации Capacitor, `AppDelegate` — регистрация APNs → FCM-токен →
   `lib/push.ts` (та же ветка `isNative()`, `kind: 'fcm'`); разрешение запрашивается после
   первой выписки (как в веб B2C-30).
4. Оболочка: safe area (челка и нижняя полоса), клавиатура не закрывает поля (`Sheet`),
   статус-бар под тему, `WKWebView` — `<input type=file>` с PDF/xlsx из «Файлов», сторис через
   `@capacitor/share`, прокрутка резиновая только внутри `<main>`.
5. Сборка: `npm run build` (env iOS) → `npx cap sync ios` → Xcode → симулятор и iPhone
   владельца (dev-подпись); памятка `frontend/ios/README.md`.

## Тесты

- Веб/фронт: `platform.test.ts` (`ios`), `push.test.ts` — ветка без изменений; весь `e2e/` и
  `npm test` зелёные (веб не тронут).
- Ручная проверка на iPhone: вход Google, синк, выписка из «Файлов», фото, сторис, пуш от
  стенда (Go локально с `FCM_*` тестового проекта, `VITE_API_BASE` — стенд в сети).

## Критерии приёмки

- Приложение на iPhone владельца по dev-подписи проходит смоук п. «Тесты»; `frontend/ios/`
  в git без секретов и `Pods/`.

## Вне скоупа

- Sign in with Apple — B2C-38; TestFlight/App Store — B2C-39; Share Extension — после MVP.
