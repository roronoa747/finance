# PV-08 — Тема на старте, «Авто» следит за телефоном, кольца в тёмной теме (фронт)

Блок 1 · MVP · Каталог: `frontend/` · Зависит от: — · Роли: все

## Контекст (что уже есть)

- Хвост §4 RP «тема на старте» (судьба → PV-08), сверка Б-12 (кольца) и часть Б-19 («Авто»).
- **Сейчас тема применяется только когда открыта панель «Оформление»**:
  `frontend/src/components/AppearancePanel.vue` — `currentTheme = ref(localStorage
  'ff_theme' || 'auto')` (`:22-24`), акцент `'ff_accent'` (`:25-27`), `updateTheme` (`:31-35`),
  `applyCurrentPalette()` (`:43-49`, категории зашиты `{ d1: 'blue', d2: 'brick', d3: 'green',
  d4: 'ochre', d5: 'steel' }`), `onMounted(() => applyCurrentPalette())` (`:92-94`) —
  единственный вызов `applyTheme` при старте. Панель — `v-if="themeOpen"` в
  `AppShell.vue:250-265`. `main.ts` и `App.vue` тему не трогают; `/access` и `/setup` вне
  `AppShell` (`router/index.ts:19-27`) — темы не получают вовсе. `index.html` без встроенного
  скрипта темы (в React тоже).
- `lib/palette.ts`: `applyTheme(opts)` (`:88-106`: `root.classList.toggle('dark', dark)`,
  `--brand*`, `--d1..d5`), `prefersDark()` (`:79-81`, `matchMedia('(prefers-color-scheme:
  dark)').matches`), `resolveDark(choice)` (`:83-85`), `hueColor(hue, dark)` (`:109-111`),
  `ThemeChoice` (`:76`). Слушателя `change` у `matchMedia` нет → «Авто» не реагирует на смену
  темы телефона. Композаблов `useIsDark`/`useTheme` во Vue нет.
- React: `src/lib/useTheme.ts:10-28` `useThemeSync()` (подписка на `matchMedia` `change`,
  `applyTheme` по `settings`), `:31-43` `useIsDark()`; вызов на старте — `src/App.tsx:85` до
  гейтов входа/настройки. `src/components/charts.tsx:58-69` `Ring` → `dark = useIsDark()`,
  `stroke={hueColor(hue, dark)}`; `GoalDetail.tsx:33, :167` — `hueColor(goal.hue, dark)` для
  «Ритма цели». Оформление — дело устройства, в документ не попадает (Р-20).
- `frontend/src/components/Ring.vue` (не в `kit/`): проп `dark?: boolean` дефолт `false`
  (`:5-18`); `strokeColor = hueColor(props.hue, props.dark)` (`:23`, дуга `:40`); дорожка
  `var(--track)`, золото `var(--gold)`, метка `var(--ink-3)` — токены, переключаются сами.
  Использования без `dark`: `views/Goals.vue:187-192`, `views/Overview.vue:425-430`,
  `views/GoalDetail.vue:135`. `GoalDetail.vue:247` — `hueColor(goal.hue, false)` жёстко
  (`hueColor` импортирован `:10`). Образцы `HUES[h].light` в пикерах (`GoalDetail.vue:382`,
  `Goals.vue:346`, `Setup.vue:389`, `AppearancePanel.vue:143`) — в React тоже `.light`, не трогать.
- Токены: `style.css` `:root {` (`:11`) / `.dark {` (`:74`), `@custom-variant dark (&:is(.dark *))`
  (`:3`), `html.dark { color-scheme: dark }` (`:176-181`).
- Тесты: `lib/palette.test.ts` — `resolveDark` (`:37-44`, без `matchMedia` → `false`),
  `hueColor` (`:46-51`), `applyTheme` с моком `documentElement` (`:53-79`). SSR-тесты вью идут в
  Node без `window` — новый код не должен трогать `window`/`localStorage` при импорте.

## Задача

1. `frontend/src/lib/theme.ts` (Р-20): чтение/запись `ff_theme` / `ff_accent` в `try/catch`
   (`readThemeChoice()`, `setThemeChoice()`, `readAccent()`, `setAccent()`); реактивный
   `isDark` (`ref`, false в Node); `applyCurrentPalette()` (перенос из `AppearancePanel.vue:43-49`,
   категории пока те же зашитые — PV-22 подключит «Цвета разделов»); `watchSystemTheme()` —
   слушатель `matchMedia('change')`: при `auto` переприменяет палитру и обновляет `isDark`.
   Ничего не выполнять на уровне модуля.
2. `main.ts`: `applyCurrentPalette()` + `watchSystemTheme()` **до** `mount` — тема есть и на
   `/access`, и на `/setup`.
3. `AppearancePanel.vue`: локальные копии (`:22-49`, `:92-94`) → функции `lib/theme.ts`.
4. `Ring.vue`: проп `dark` убрать; цвет дуги — `hueColor(props.hue, isDark.value)` (как React
   `useIsDark`). `GoalDetail.vue:247` → `isDark.value`.
5. Никаких новых токенов не нужно; если понадобится — в обе секции `style.css`.

## Тесты

- `lib/theme.test.ts` (фейки `localStorage`, `matchMedia` с управляемым `matches` и
  `addEventListener('change')`, `documentElement` как в `palette.test.ts:53-79`): выбранная
  «Тёмная» → после `applyCurrentPalette()` класс `dark` есть; «Светлая» + тёмный телефон — нет;
  «Авто» + тёмный телефон — есть; событие `change` под «Авто» переключает класс и `isDark`, под
  «Светлая» — нет; сломанный `localStorage` (бросает) → дефолт `auto`, без исключения.
- `components/Ring.test.ts` (SSR): при `isDark = true` (через экспортированный сеттер/ref)
  дуга `stroke` = `HUES[hue].dark`, при `false` — `.light`.
- `views/Goals.test.ts`: SSR `GoalDetail` в тёмной теме — ячейки «Ритма цели» с `HUES[hue].dark`.

## Критерии приёмки

- Браузер: выбрать «Тёмная» → перезагрузить → тёмная сразу, без вспышки светлой на `/`, `/access`
  (после выхода) и `/setup`; «Авто» + DevTools «prefers-color-scheme: dark» переключается
  живьём в обе стороны; кольца на Обзоре, в Целях и на экране цели и «Ритм цели» — тёмные
  оттенки (`HUES[…].dark`); акцент тоже применяется на старте.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- «Цвета разделов» и имя в «Оформлении» — PV-22.
- Хранение темы в документе — нет (Р-20).
- Встроенный скрипт в `index.html` против вспышки до загрузки JS — не делаем (в React не было);
  если вспышка заметна на телефоне — хвост §4.
