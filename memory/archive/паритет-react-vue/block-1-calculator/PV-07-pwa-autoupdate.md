# PV-07 — PWA переходит на новую версию сама (фронт)

Блок 1 · MVP · Каталог: `frontend/` · Зависит от: — · Роли: все

## Контекст (что уже есть)

- Сверка Б-20. React `src/main.tsx:24-41` (без `virtual:pwa-register`; регистрацию SW делает
  плагин, логика вручную):
  ```ts
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      window.location.reload()
    })
    // Возвращаемся в приложение — проверяем, не вышла ли новая версия.
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return
      void navigator.serviceWorker.getRegistration().then((r) => r?.update())
    }
    document.addEventListener('visibilitychange', checkForUpdate)
    window.addEventListener('focus', checkForUpdate)
  }
  ```
  Комментарий `:12-23`: при первой установке не перезагружаем (`hadController`), `reloading`
  защищает от повторной перезагрузки.
- Vue `frontend/src/main.ts` (14 строк): `createApp` → pinia → router → `mount` →
  `startSyncEngine()`; ни `serviceWorker`, ни `controllerchange`. `stores/syncEngine.ts:37-43`
  слушает `focus`/`visibilitychange` только ради синка данных.
- `frontend/vite.config.ts:15-43`: `VitePWA({ registerType: 'autoUpdate', manifest, workbox: {
  globPatterns, cleanupOutdatedCaches: true, navigateFallback: 'index.html',
  navigateFallbackDenylist: [/^\/api\//] } })`; `skipWaiting`/`clientsClaim` плагин добавляет
  сам при `autoUpdate` (в `dist/sw.js` есть). `dist/registerSW.js` регистрирует `/sw.js` на
  `load`. Типов `vite-plugin-pwa/client` нет и не нужны.
- `frontend/e2e/pwa-build.test.ts`: проверяет собранный `dist` (пропускается без
  `dist/index.html`, `:7-10`): манифест, `registerSW.js`, `sw.js` (`skipWaiting`,
  `clientsClaim`, `cleanupOutdatedCaches`, denylist `/api`), иконка, шрифты. Перезагрузку не
  проверяет. `npm run build` создаёт `dist` — тест идёт после билда.
- Грабли RP §6: после деплоя старый JS может отработать ещё один запуск (включая синк) — поэтому
  RP-02/RP-03; хвост «старый PWA Блока 0» держится перезапуском PWA при деплое.

## Задача

1. `frontend/src/lib/pwa.ts`: `watchServiceWorkerUpdates({ sw, doc, win })` — перенос логики
   React (те же гварды `hadController` / `reloading`, проверка на `visibilitychange` и `focus`,
   `getRegistration().then(r => r?.update())`). Зависимости передаются параметрами, чтобы
   тестировать фейками в Node; возвращает функцию отписки (не обязательна для приложения).
2. `main.ts`: при `'serviceWorker' in navigator` — вызвать после `mount`.
3. `e2e/pwa-build.test.ts`: в собранных `dist/assets/*.js` есть строки `controllerchange` и
   `visibilitychange` (в том же стиле, что проверки `sw.js`).

## Тесты

- `lib/pwa.test.ts` (фейки `sw` с `controller`, `addEventListener`, `getRegistration`; `doc` с
  `visibilityState`; `win` с `location.reload`): без контроллера при старте `controllerchange`
  не перезагружает; с контроллером — перезагружает ровно один раз при двух событиях; при
  `visibilityState === 'visible'` `update()` вызван, при `hidden` — нет; `focus` тоже зовёт
  `update()`; отсутствие регистрации (`undefined`) не падает.
- `e2e/pwa-build.test.ts` — пункт 3.

## Критерии приёмки

- `npm run build` + `npm test` зелёные (включая `pwa-build`).
- Браузер: `npm run preview` (SW работает только в собранной версии) → открыть, изменить любую
  строку, пересобрать, вернуться на вкладку → страница перезагрузилась сама с новой версией;
  первая установка без перезагрузки.

## Вне скоупа

- Индикатор версии / кнопка «Обновить» — в React не было.
- Процедура перезапуска PWA при утреннем деплое — промпт деплоя (SESSION.md), не код.
