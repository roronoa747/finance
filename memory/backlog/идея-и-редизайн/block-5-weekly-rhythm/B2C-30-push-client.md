# B2C-30 — Фронт: подписка, день и час, пуш в SW, пометка «без выписки <имя>» (фронт)

Блок 5 · MVP · Каталог: `frontend/src/lib/push.ts` (новый), `frontend/public/sw-push.js` (новый), `frontend/vite.config.ts`, `views/Settings.vue`, `views/Week.vue`, `api/client.ts` · Зависит от: B2C-29 · Роли: member, viewer

## Контекст (что уже есть)

- Р-15 (iPhone получает пуш только установленным на «Домой»; в оболочках — нативный). Ручки
  B2C-29: `GET /api/push/config`, `POST/DELETE /api/push/subscription`, `GET/PUT
  /api/push/settings`; нагрузка `{title, body, url}`.
- PWA `frontend/vite.config.ts`: `generateSW`, `/sw.js` scope `/` — не менять; свой код в SW —
  `workbox.importScripts: ['sw-push.js']` (файл из `frontend/public/`); тест сборки
  `e2e/pwa-build.test.ts` (манифест, `sw.js`). `lib/pwa.ts` `watchServiceWorkerUpdates`.
- Настройки `/settings` (B2C-13/25); неделя `/week` (B2C-21) — картина с «без выписки <имя>»
  (`weekPicture`, B2C-14). События `track(kind)` (B2C-28) — `push_open`.
- Web Push в браузере: `Notification.requestPermission`, `registration.pushManager.subscribe({
  userVisibleOnly: true, applicationServerKey })` (ключ — base64url → `Uint8Array`); iOS Safari —
  только в standalone (`navigator.standalone`), Chrome Android — в браузере и PWA; localhost —
  без HTTPS.

## Задача

1. `public/sw-push.js`: `push` → `showNotification(title, { body, data: { url }, icon })`;
   `notificationclick` → открыть/сфокусировать `url` (клиент `clients.matchAll`), в URL —
   `?from=push` для события `push_open`. `vite.config.ts` — `importScripts`.
2. `lib/push.ts`: `pushSupport()` (`unsupported` / `ios-needs-home-screen` / `ok`),
   `subscribePush(client)` (разрешение → подписка → POST; уже подписан → upsert),
   `unsubscribePush`, `currentSubscription`. Ключ — из `/api/push/config`.
3. Настройки: секция «Напоминание о выписке» — переключатель (подписка этого устройства), день
   недели и час (`Select`, семья; viewer видит без правки), текст про iPhone («Добавьте
   приложение на экран „Домой“…») при `ios-needs-home-screen`; в демо — секция с текстом «в
   демо напоминаний нет».
4. Первое предложение подписаться — один раз после первой отправленной выписки (карточка на
   `/week`, «Напоминать по воскресеньям» / «Не сейчас»; ответ — `localStorage`).
5. `/week`: карточка «<имя> ещё не загрузил(а) выписку за эту неделю» (данные `weekPicture`)
   — без кнопок давления (пуш партнёру шлёт cron, Р-15); `?from=push` → `track('push_open')`.

## Тесты

- `push.test.ts` (фейковые `navigator.serviceWorker`, `PushManager`, `Notification`): поддержка,
  подписка шлёт endpoint и ключи, отписка; iOS не standalone → `ios-needs-home-screen`.
- SSR `Settings`: секция, viewer без правки дня/часа, демо; `Week`: карточка партнёра,
  предложение подписаться один раз.
- `e2e/pwa-build.test.ts`: `sw.js` содержит `importScripts` с `sw-push.js`, scope прежний,
  `sw-push.js` в `dist`.

## Критерии приёмки

- Браузер (стенд, Chrome localhost, Go с тестовыми VAPID): подписка → cron (dev `?now=`) →
  уведомление → клик открывает `/week` и пишет `push_open`; настройки дня/часа видны партнёру;
  `npm run build && npm test` зелёные. На телефоне владельца (Android, прод после деплоя) —
  в смоуке приёмки.

## Вне скоупа

- Нативный пуш оболочек — Блок 7. Другие уведомления (зарплата, платежи) — после MVP.
