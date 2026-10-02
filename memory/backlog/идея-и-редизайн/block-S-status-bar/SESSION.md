# Блок S — Системная строка · сессии

**Цель блока:** строка сверху телефона (время, заряд, Dynamic Island) — в цвет фона экрана в светлой и тёмной
теме, а не коричневая; мелочь до Блока 11 (Р-64, Р-67).

Сессии: исполнитель ✅ 2026-10-02 · приёмка ⬜
<!-- Режим S (Р-67): исполнитель → приёмка; приёмка мёржит в `main` и деплоит, ревью и клинапа нет.
Все ✅ → 🏁 в §4 индекса. -->

## Промпт исполнителя — уровень light · Opus 5 · effort medium

```
/worker идея-и-редизайн S
```

Блок-специфика:

- **Ветка `b2c-block-S-status-bar` от `main`** (Блок 10 🏁, прод `dpl_J4ZRcjGaBBabba4k7g6tbPmDhpMf`).
  `git config core.hooksPath memory/process/hooks`. Push ветки ради CI — с согласия владельца; `main` и прод не
  трогать; бэкенда и миграций нет.
- Одна задача — B2C-53. Среда: `cd frontend && npm run dev -- --port 5174 --strictPort` (Go не нужен — демо),
  обе темы и «авто»; Playwright — `playwright-core` из корневого `node_modules`, Chromium `chromium-1223`
  (`colorScheme: 'dark'` для «авто»), мета-теги проверить в DOM. На iPhone проверяет владелец на приёмке
  (стенд с телефона недоступен — не блокирует).
- Handoff: коммит, что выбрано в п. 4 ТЗ (`theme-color` или `apple-mobile-web-app-status-bar-style`) и почему.
- Верификация — `cd frontend && npm run build && npm test`.
- Следующий шаг — `/accept идея-и-редизайн S` (критика нет — режим S).

## Промпт приёмки — уровень review · Opus 5 · effort xhigh

```
/accept идея-и-редизайн S
```

Блок-специфика:

- Критерии — ТЗ B2C-53; весь накопительный e2e-набор (`npm test`), CI ✅. Ревью диффа — здесь же (критика нет).
- **Деплой (каждый шаг — после «да» владельца в этой сессии):** миграций нет. Точка отката — текущий Production
  `dpl_J4ZRcjGaBBabba4k7g6tbPmDhpMf` (Блок 10) → `git switch main && git pull --ff-only && git merge --no-ff
  b2c-block-S-status-bar -m "Merge b2c-block-S-status-bar: B2C-53 системная строка в цвет фона"` → `cd frontend &&
  npm install && npm run build && npm test` → `git push origin main` → новый `dpl_…` READY (статус CI — публичным
  GitHub API, `gh` нет). Откат — promote прежнего деплоя.
- **Перезапуск PWA на обоих телефонах** (закрыть из переключателя, открыть) — манифест и мета-теги обновятся.
- **Смоук владельца на проде:** iPhone, установленная PWA — строка сверху в цвет фона в светлой и тёмной теме и при
  «авто»; агент параллельно — `/api/health`, мета-теги в DOM прода, ошибок консоли нет.
- Доки: «Приёмка» здесь; трекер; §4 — S 🏁; `STATE.md` — Production, откат, следующий шаг
  `/worker идея-и-редизайн 11 ultrathink`.

## Handoff (заполняет исполнитель)

- **Коммиты:** `e4248c8` B2C-53-01 (ветка `b2c-block-S-status-bar` от `main` `67a7f5b`; не запушена — push ради CI
  с согласия владельца).
- **Что сделано:**
  - `frontend/index.html` — вместо статичного `#B4562F` два `theme-color` с `media` light / dark: `#f2f2f0` /
    `#121214` (`--canvas` из `style.css`) — строка верна до загрузки JS.
  - `src/lib/palette.ts` `applyTheme` — после смены класса `dark` читает вычисленный `--canvas`
    (`getComputedStyle`, литерала в TS нет) и пишет его в `content` **обоих** мета-тегов: ручной выбор сильнее их
    `media` (при «Светлой» на тёмном телефоне строка светлая). «Авто» и смена системной темы — через существующий
    `watchSystemTheme` → `applyCurrentPalette` → `applyTheme`, нового кода не понадобилось.
  - `vite.config.ts` — манифест `theme_color: '#F2F2F0'` (= `background_color`).
  - **П. 4 — выбрано: `apple-mobile-web-app-status-bar-style` НЕ добавлен, iPhone берёт `theme-color`.** Причина:
    коричневая строка в установленной PWA владельца — и есть `theme-color` `#B4562F` (иначе iOS показал бы белую
    `default`), значит строка его читает. `black-translucent` невозможен без переделки шапок: в `src` нет ни одного
    `safe-area-inset-top` (grep пуст) — контент ушёл бы под Dynamic Island. Явный `default` поведение не меняет,
    поэтому не добавлен (минимальная правка). Если на приёмке строка в PWA не сменит цвет при ручной теме —
    это кэш iOS: перезапуск PWA из переключателя (шаг приёмки).
  - Гварды переписаны по смыслу: манифест `theme_color` = `background_color` = светлый `--canvas`; иконка =
    `--brand` светлой темы; в `index.html` и `vite.config.ts` нет `#B4562F`; мета-теги исходника и `dist` = токены
    `--canvas` (значения читаются из `style.css`, не литералами в тестах).
  - Экран: главное действие, подсказки, скрытое — без изменений (правка — только оформление устройства).
- **Отклонения от ТЗ:** нет. Корневые `index.html` / `vite.config.ts` (React-эталон) тоже несут `#B4562F` — вне
  скоупа (каталог задачи `frontend/`), не трогал.
- **Грабли среды:** порт 5174 занят чужим процессом (не мой — не убивал), стенд поднят на `:5180`;
  `playwright-core` 1.63 ищет `chromium_headless_shell-1243` — запуск с `executablePath` на
  `ms-playwright/chromium-1223/chrome-win64/chrome.exe`. Тесты `theme.test.ts` / `palette.test.ts` стабят
  `document` — в стабы добавлены `querySelectorAll` и `getComputedStyle`.
- **Верификация:**
  - `cd frontend && npm run build` (`vue-tsc -b` + `vite build`) ✅; `npm test` после сборки — **109 файлов,
    1197 ✅ / 1 skipped** (с `e2e/pwa-build`).
  - Мутация: без записи мета-тегов в `applyTheme` падают 2 теста (B2C-53 в `palette.test`, «Авто» в `theme.test`);
    откат копией файла.
  - Стенд демо `:5180`, Playwright Chromium 390×844, система light/dark × выбор auto/light/dark (6 комбинаций):
    до JS — пара `light=#f2f2f0`, `dark=#121214`; после — оба тега = вычисленный `--canvas` выбранной темы;
    смена системной темы на лету (`emulateMedia`) под «авто» перекрашивает строку, под «Светлой»/«Тёмной» — нет;
    ошибок консоли 0. iPhone/Android — на приёмке владельцем (стенд с телефона недоступен).

## Приёмка

**Вердикт: ✅ принято 2026-10-02** (приёмщик, Opus 5.5; режим S — ревью диффа здесь же). Остаётся критерий,
который проверяет только владелец: строка на iPhone (Safari и PWA) и Android — смоук на проде после деплоя.

- **Ревью диффа** `main...b2c-block-S-status-bar` (6 файлов `frontend/`): литерала цвета в TS нет — `applyTheme` читает
  вычисленный `--canvas` (правило 6); мета-теги ведёт единственная точка, где тема попадает в DOM; пустой `--canvas`
  (SSR/тест) — выход без записи; гварды переписаны по смыслу (иконка = `--brand`, строка = `--canvas`, значения из
  `style.css`). П. 4 ТЗ (без `apple-mobile-web-app-status-bar-style`) — обоснование в Handoff принимаю: `safe-area-inset-top`
  в `src` нет, `black-translucent` увёл бы контент под Dynamic Island. Замечаний к коду нет.
- **Критерии ТЗ:** п. 1 — два `theme-color` с `media` в `index.html` и в `dist`; п. 2 — ручной выбор и «авто» (ниже);
  п. 3 — манифест `dist`: `theme_color` = `background_color` = `#F2F2F0`; п. 4 — Handoff; п. 5 — гвард иконки = `--brand`.
  Тесты ТЗ — есть (`pwa-build`, `palette.test`, `theme.test`). `#B4562F` в `frontend/index.html` и `vite.config.ts` нет.
- **Верификация:** `cd frontend && npm run build` ✅ → `npm test` — **109 файлов, 1197 ✅ / 1 skipped** (весь
  накопительный `e2e/`, с `pwa-build` после сборки).
- **Браузер:** `vite preview` собранного `dist` `:5181`, 390×844, **Chromium 1223 и WebKit 2359** (движок Safari),
  система light/dark × выбор auto/light/dark = 12 прогонов: оба мета-тега = вычисленный `--canvas` = фон `body`
  (`#f2f2f0` / `#121214`); смена системной темы на лету под «авто» перекрашивает строку, под «Светлой»/«Тёмной» — нет;
  ошибок консоли 0. Скрипт — scratchpad сессии (`statusbar.cjs`).
- **Новые сценарии в e2e-набор** — не добавлялись: всё, что проверял браузер, уже закреплено исполнителем в vitest
  (`palette.test` — 3 темы, `theme.test` — смена системы под «авто», `pwa-build` — исходник и `dist`).
- **Точка отката — уточнение промпта:** текущий Production — `dpl_3B4vrVSsRHD1cqDn38m3y8QMgi42` (`61ba3b7`, докоммит
  поверх Блока 10, код = `d62e44a`), а не `dpl_J4ZRcjGa…`; откат — promote `dpl_3B4vrVSs…` (оба равноценны по коду).
- **CI:** ветка не пушилась — CI прогоняется на `main` после мёржа.
