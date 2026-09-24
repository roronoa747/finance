# MGV-17 — PWA во Vue, замена service worker React, курс через `/api/fx-rate`, CI фронта (фронт)

Блок 6 · MVP · Репо/каталог: `frontend/`, `.github/workflows/` · Зависит от: MGV-16 · Роли: все

## Контекст (что уже есть)

- React-прод — PWA на `vite-plugin-pwa` (корневой `vite.config.ts`): `registerType: 'autoUpdate'`,
  манифест `name: 'Family Finance'`, `short_name: 'FF'`, `lang: 'ru'`, `start_url: '/'`,
  `display: 'standalone'`, `background_color: '#E9EDEC'`, `theme_color: '#0A6B57'`, иконки
  `favicon.svg` (`any` и `maskable`), `workbox.globPatterns: ['**/*.{js,css,html,svg,png,woff2}']`.
  Service worker по умолчанию — `/sw.js`, scope `/`. **У обоих участников он уже установлен** —
  после cutover именно он решает, что увидит телефон.
- React — `HashRouter` (`/#/capital`); Vue — `createWebHistory` (`/capital`). Старые закладки
  с `#` откроют корень Vue — это приемлемо, но проверить, что не ломается.
- `frontend/vite.config.ts` — плагинов PWA нет; `frontend/public/favicon.svg` **отличается** от
  корневого `public/favicon.svg` (иконка на домашнем экране — от React).
- `frontend/src/lib/fx.ts` — `fetchRates()` заглушка, всегда `null`; вызывается в
  `frontend/src/views/Capital.vue` (открытие формы счёта в валюте), `null` → ручной ввод курса.
- Vue хранит документы в `localStorage` (`frontend/src/stores/finance.ts`), токен —
  `ff_auth_token` (`frontend/src/api/client.ts`) → офлайн работает, если ассеты в кэше SW.
- CI фронта нет (есть только `.github/workflows/ci-backend.yml`); шаблон —
  `memory/process/templates/ci-web.yml` (под pnpm — у фронта npm и `package-lock.json`).

## Задача

1. **PWA во Vue** (Р-10): `vite-plugin-pwa` в `frontend/`, манифест и цвета — как у React;
   иконка — корневой `public/favicon.svg` (привычная иконка участников).
2. **Замена SW React**: тот же путь `/sw.js` и scope `/`, `autoUpdate` — старый SW при проверке
   обновления получает новый и переключается; устаревший precache вычищается
   (`cleanupOutdatedCaches`); `navigateFallback` на `index.html` c `navigateFallbackDenylist`
   для `/api/`. Ответы `/api/*` SW не кэширует (кроме, по желанию, `/api/fx-rate` —
   не обязательно).
3. **Курс** (Р-11): `fetchRates()` → `GET /api/fx-rate` (через общий `ApiClient` или `fetch`
   с тем же базовым путём); любая ошибка → `null`, как в React.
4. **CI фронта**: `.github/workflows/ci-frontend.yml` по шаблону `ci-web.yml`, адаптированный
   под npm и каталог `frontend/` (триггер по `frontend/**`): `npm ci`, `npm run build`, `npm test`.

## Тесты

- `fx.test.ts`: 200 → разобранный `FxRates`; 502/сетевая ошибка → `null`.
- Сборка: в `frontend/dist` есть `sw.js` и `manifest.webmanifest` с полями как у React
  (проверка — юнит-тест, читающий `dist`, или шаг в CI; выбор — в Handoff).
- Браузер (реальный, на preview-адресе MGV-16): вручную — сценарий «замена SW» ниже.

## Критерии приёмки

- `cd frontend && npm run build && npm test` — зелёные; CI `ci-frontend` зелёный на ветке блока.
- **Замена SW** (браузер, локально через `vite preview`/`vercel dev` или на preview):
  открыть React-сборку → её SW установлен → на том же origin выложить Vue-сборку → перезагрузка
  показывает Vue без ручной очистки кэша (не более одной лишней перезагрузки — записать
  фактическое поведение в Handoff).
- Офлайн: после первого открытия Vue в режиме «нет сети» открывается и показывает данные
  из `localStorage`.
- PWA ставится на домашний экран (Chrome DevTools → Application → Manifest без ошибок).
- Форма счёта в валюте на preview подставляет курс Нацбанка.

## Вне скоупа

- Push-уведомления, фоновая синхронизация SW.
- Перенос `localStorage` React во Vue (Р-15: кэш React Vue не читает).
- Удаление React `src/` и корневого `vite.config.ts` — хвост уборки после cutover.
