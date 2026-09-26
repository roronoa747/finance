# B2C-35 — Нативный пуш: FCM в оболочке и отправка из Go (оболочка + фронт + бэкенд)

Блок 7 · MVP · Каталог: `frontend/android/`, `frontend/src/lib/push.ts`, `backend/internal/push` · Зависит от: B2C-33 · Роли: member, viewer

## Контекст (что уже есть)

- Р-15 (в оболочках — нативный пуш), Р-26 (FCM; одна таблица подписок с `kind` `web` / `fcm`).
  Блок 5: `app.push_subscriptions` (`kind`, `endpoint` — для fcm токен), `due(...)` и `Sender`
  (`kind = fcm` пока пропускается), ручки подписки; фронт `lib/push.ts` (`subscribePush`).
- Firebase: проект создаёт владелец (бесплатно), Android-приложение с package name и SHA-1,
  `google-services.json` → `memory/secrets/android/` (в git не попадает), копируется в
  `frontend/android/app/` перед сборкой (скрипт `npm run cap:secrets` — путь из env, не в репо);
  Gradle-плагин `com.google.gms.google-services`. Сервисный аккаунт Firebase для отправки —
  JSON в env Vercel `FCM_SERVICE_ACCOUNT` (значение — `memory/secrets/push.md`), `FCM_PROJECT_ID`.
- FCM HTTP v1: `POST https://fcm.googleapis.com/v1/projects/<id>/messages:send` с OAuth2
  access-token сервисного аккаунта; токен — JWT RS256 по ключу аккаунта (`golang-jwt` уже умеет
  RS256) → `https://oauth2.googleapis.com/token` (grant `jwt-bearer`), кэш ~50 минут — без новых
  зависимостей. Ошибка `UNREGISTERED`/404 → токен мёртв.
- Плагин `@capacitor/push-notifications` (официальный): `requestPermissions`, `register` →
  событие `registration` с токеном FCM, `pushNotificationActionPerformed` → навигация.

## Задача

1. Оболочка: плагин, Gradle google-services, канал уведомлений Android с именем из
   `DESIGN.md`; иконка уведомления монохромная.
2. `lib/push.ts` на `isNative()`: разрешение → `register` → `POST /api/push/subscription`
   `{kind: 'fcm', endpoint: token}`; обновление токена → upsert; выход из аккаунта → DELETE;
   нажатие → маршрут из `data.url` + `track('push_open')`.
3. Go `internal/push`: `FCMSender` (токен сервисного аккаунта с кэшем, отправка `message: {
   token, notification: {title, body}, data: {url} }`), `due` шлёт `fcm`-подписки тем же
   правилом; `UNREGISTERED` → удалить; без `FCM_*` — `fcm` пропускается (как сейчас). README.

## Тесты

- Go: обмен JWT → access-token на `httptest`; отправка с верным телом; кэш токена; `UNREGISTERED`
  → удалена; без переменных — пропуск.
- Фронт: ветка `isNative()` в `push.test.ts` (фейковый плагин).
- Ручная проверка: телефон владельца, cron с `?now=` на стенде против прод? Нет — прод-функция
  без dev-параметра: проверка на стенде с локальным Go, `FCM_*` тестового проекта Firebase и
  debug-APK, у которого `VITE_API_BASE` — адрес стенда в локальной сети.

## Критерии приёмки

- `go build/vet/test` зелёные; на Android владельца: подписка после входа, уведомление от
  стенда приходит, нажатие открывает неделю; веб-пуш не сломан (`e2e/`).

## Вне скоупа

- iOS/APNs — Блок 8 (B2C-37). Тексты уведомлений за пределами еженедельного — после MVP.
