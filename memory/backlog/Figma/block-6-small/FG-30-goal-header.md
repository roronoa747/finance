# FG-30 — Шапка цели: без имени, кнопки шапки «белый 60 %»; мёртвые `indexedNeed` / `contributionStreak` (фронт)

Блок 6 · MVP · Репо/каталог: `frontend/src` · Зависит от: — · Роли: все (участник, viewer); демо

Хвост **FG-Х10** (`/ux` Блока 4, 2026-10-27): имя цели стоит дважды — в шапке оболочки и на обложке; в утверждённых макетах `78:50`,
`78:104` имени в шапке нет (только «‹», «Поделиться», «···»); длинное имя режется («Поездка в Япо…»). **Владелец 2026-10-27: «ок»**
(страница `/ux` «Варианты пачки 2», п. 6) — убрать имя цели из шапки. **+ владелец 2026-10-27:** фон кнопок шапки цели («‹»,
«поделиться», «···») — вариант **C: белый 60 %** вместо чистого `--surface` (на бежевом холсте резко; макет Figma `104:21`, только
чтение). Строкой в ту же задачу — наблюдение приёмки Блока 4: `indexedNeed`, `contributionStreak` в приложении не зовутся (ритм и
«дорожает» сняты с цели по «ок» владельца, §6 «После Блока 4»). Режим блока M; эта задача — вид (экран цели), `/ux` смотрит.

## Контекст (что уже есть)

Пути — от `frontend/src/`; `main` `19f46bff`.

- **Заголовок шапки** — `components/AppShell.vue` `header` computed `:113-137`: `p.startsWith('/goals/')` → `liveGoals(financeStore.goals)
  .find(id)` → `{ title: goal?.name ?? 'Цель' }` `:123-127`; шаблон `:192-216`: `<header v-if="!heroHeader" … data-shell-header>`,
  кнопка «Назад» `:194-202` (`v-if="!isRoot"`, `aria-label="Назад"`, класс `grid size-[38px] shrink-0 place-items-center rounded-[12px]
  bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer`), `<h1 class="type-h1 truncate text-ink">{{ header.title }}</h1>`
  `:204`, `header.sub` `:205`, `#shell-actions` `:210` (сюда `HeaderActions` переносит кнопки экрана). `liveGoals` импортируется ради
  заголовка — после правки, возможно, не нужен.
- **Кнопки цели** — `views/GoalDetail.vue` `:412-432`: `<HeaderActions>` → «Поделиться» (`data-goal-share`, `PhShareNetwork`) и «Меню
  цели» (`v-if="canEdit"`, `PhDotsThree`) — тот же класс с `bg-surface`. Другие кнопки-значки 38 в шапках: `kit/Sheet.vue:317` и
  `ai/AiReport.vue:579` — `bg-surface-2` (листы, не шапка оболочки — не трогать). Имя цели на экране остаётся на обложке
  (`kit/DreamHero` `size="goal"` `title` 26, `data-hero-title`) и в заголовке листа меню (`:433` `:title="goal.name"`).
- **Токены** — `style.css` `:root` `:17-85`, `.dark` `:88-146`, `@theme inline` `--color-*` `:160-215`; пара light/dark обязательна
  (гард `style.tokens.test.ts` «каждый цвет :root есть в .dark» и класс `--color-<имя>`). `--surface` светлая `#ffffff`, тёмная `#1c1c1f`;
  холст `--canvas` `#f2f2f0` / `#121214`. Полупрозрачные токены уже есть (`--brand-edge`, `--scrim`, `--photo-scrim`) — образец записи
  `rgb(r g b / a)`.
- **Тесты шапки**: `components/AppShell.test.ts` `:40-60` — таблица `['/goals/x', 'Цель']` читает `<h1 class="type-h1 truncate text-ink">`;
  `AppShell.dom.test.ts:101` — `main.textContent` содержит «Цель» (это контент страницы-заглушки, не шапка — не ломается);
  `e2e/fg-block4-accept.test.ts:127` — «···» цели в `[data-shell-header]` (остаётся); `GoalDetail.test.ts:474, :507, :744`,
  `GoalDetail.done.dom`, `GoalDetail.term.dom`, `Dreams.queue.dom` — ищут `aria-label="Меню цели"` (остаётся).
- **Мёртвый код** — `lib/finance.ts`: `indexedNeed(need, months, inflation = INFLATION)` `:220-223` (+ JSDoc `:216-219`),
  `contributionStreak(movements)` `:2585-2599` (+ комментарий «Подсчёт серии…» `:2578-2580`; `movementMonth` `:2583` — проверить,
  зовётся ли ещё кем-то, кроме неё). Тесты: `lib/finance.test.ts` импорт `:18`, `:73`, `it('indexedNeed…')` `:1213-1221`,
  `contributionStreak` `:2932-2933` (внутри другого `it` — убрать только эти строки); `views/GoalDetail.test.ts` импорт `:11`,
  `it('contributionStreak…')` `:59-78`. **`INFLATION` `:214` — живая:** `components/capital/AccountSheet.vue:8, :80, :286` (реальная
  ставка депозита `realRate(…, INFLATION)` и подсказка «При инфляции 10,2 %») — **не удалять** (приёмка Блока 4 ошиблась, записав её в
  мёртвые); тесты `GoalDetail.test.ts:150, :353-354`, `finance.test.ts:1214` с `INFLATION` остаются (у `:1214` — перенести `expect(INFLATION)`
  в живой тест `realRate`, если `it` удаляется целиком).
- Макет `104:21` (Figma, файл `qBsIBtTRI4MIaRa6b8Eli9`) — только чтение, ≤ 2 `get_screenshot` на блок (исполнителю не обязательно:
  решение владельца словами выше).

## Задача

1. **Шапка `/goals/:id` без заголовка.** В `header` для `/goals/` — `title: ''`; `<h1>` в шаблоне рисуется только при непустом
   `title` (`v-if`), блок `min-w-0` остаётся (место под «Назад»). Имя цели читается с обложки (`data-hero-title`), читалке — `aria-label`
   кнопки «Назад» прежний. Неиспользуемый импорт `liveGoals` убрать. У `/goals/new` — «Новая мечта» как было. Сбывшаяся цель — тоже
   без имени в шапке (одно правило).
2. **Кнопки шапки — «белый 60 %».** Новый токен **`--surface-glass`**: светлая `rgb(255 255 255 / 0.6)`, тёмная `rgb(28 28 31 / 0.6)`
   (= `--surface` тёмной темы на 60 %); `--color-surface-glass` в `@theme inline`; комментарий у токена — одна строка («кнопки-значки
   шапки оболочки на холсте и на фото, FG-30»). Класс `bg-surface` → `bg-surface-glass` у трёх кнопок: «Назад» в `AppShell` (она общая
   для всех экранов с «‹» — «Новая мечта», «Закрыть быстрее», «Свой кружок», «Цифры»: один стиль значков шапки, по-разному не красим —
   вариант составителя, `/ux` проверит на этих экранах), «Поделиться» и «Меню цели» в `GoalDetail`. Ховер `hover:bg-surface-3` оставить.
   Литеральных цветов и `opacity` на кнопке — нет (правило 6: цвет только из токена с парой).
3. **Удалить** `indexedNeed`, `contributionStreak` (с JSDoc) и их тесты; `movementMonth` — оставить, если зовётся ещё где-то, иначе
   тоже удалить. `INFLATION` и `realRate` — остаются (живые в `AccountSheet`). `npm run build` (vue-tsc) — чистый.
4. `DESIGN.md` (`memory/backlog/идея-и-редизайн/block-2-design/DESIGN.md`) — в §6 «Заголовки экранов» строка про цель: «шапка без
   заголовка — имя на обложке»; в §5 у кнопок шапки — токен `--surface-glass`. Точечно, grep-ом по «Цель»/«шапк».

## Тесты

- `components/AppShell.test.ts`: строка таблицы `/goals/x` → `h1` отсутствует (`title()` → `undefined`), остальные маршруты — как были;
  новый `it`: у `/goals/x` в шапке есть «Назад» и `#shell-actions`, `<h1>` нет.
- `views/GoalDetail.test.ts` (SSR): у `[data-goal-share]` и «Меню цели» класс `bg-surface-glass`, `bg-surface ` (с пробелом) у них нет;
  `AppShell.test.ts` — у кнопки «Назад» `bg-surface-glass`.
- `style.tokens.test.ts` — пара ловится существующим гардом (ничего не добавлять); при желании — `expect` значения 0.6 в обеих темах.
- `lib/finance.test.ts`, `views/GoalDetail.test.ts` — тесты удалённых функций убраны, `INFLATION`/`realRate` живы; `grep -rn
  "indexedNeed\|contributionStreak" frontend/src` — пусто.
- e2e: в `e2e/fg-block6-small.test.ts` сценарий «цель: шапка оболочки одна, без `h1`, «···» и «Поделиться» в ней, имя — на обложке
  один раз (`data-hero-title`), длинное имя («Поездка в Японию на сакуру и Фудзи») не обрезано в шапке — его там нет».
- Мутанты (откат копией): (1) вернуть `goal?.name` в `header` → `AppShell.test` красный; (2) `bg-surface` у «Меню цели» →
  `GoalDetail.test` красный.

## Критерии приёмки

- Стенд (Chrome 390 и 375, обе темы; демо, участник, viewer): экран цели — шапка оболочки без имени, «‹» слева, «Поделиться» и «···»
  справа (viewer — без «···»), имя — только на обложке (26) и в заголовке листа «···»; фон трёх кнопок — `--surface-glass`
  (светлая — белый 60 % на бежевом, тёмная — 60 % `#1c1c1f`), читаемость значков `--ink-2` в обеих темах; сверка с макетом `104:21`
  (`/ux`, ≤ 2 снимка). На «Новой мечте», «Закрыть быстрее», «Свой кружок» — «‹» того же вида, не выбивается.
- `cd frontend && npm run build && npx vitest run` зелёные; бэкенд не тронут.

## Вне скоупа

- Размытие под кнопкой (`backdrop-blur`) — не делаем: владелец выбрал «белый 60 %», не «стекло»; при желании — хвост после `/ux`.
- Кнопки-значки листов (`Sheet`, `AiReport`, `bg-surface-2`) — не трогаем.
- Шапка «Мечт» на фото (`ShellPeople`, FG-21) — не трогаем (safe-area — FG-31).
- `INFLATION`, `realRate`, калькулятор депозита `AccountSheet` — не трогаем.
