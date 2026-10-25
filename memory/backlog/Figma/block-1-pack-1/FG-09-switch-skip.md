# FG-09 — Переключатель с ползунком, «Пропустить» от угла (фронт)

Блок 1 · MVP · Репо/каталог: `frontend/src` · Зависит от: — · Роли: все

Комментарии владельца (2026-10-24):

| № | id | Где на макете | Суть | Что меняется в коде |
|---|---|---|---|---|
| К-11 | `1980123531` | `19:178` → `19:181` сегмент «Неделя · Месяц» | «здесь можно сделать анимацию переключения кнопки» | ползунок, который переезжает под активную вкладку (Р-9, вариант составителя); то же у «Капитал · Долги · История» |
| К-10 | `1980124234` | `19:156` → `19:158` «Пропустить» | «отступ слишком маленький от угла» | «Пропустить» дальше от правого верхнего угла; учёт выреза iPhone |

## Контекст (что уже есть)

- `components/plan/PlanSwitch.vue`: `div.flex.gap-1.rounded-[14px].bg-surface-2.p-1` `role="group"`; кнопки `press relative
  flex-1 rounded-[10px] p-[9px] text-[14.5px] font-semibold`, активная `bg-surface text-ink`, иначе `text-ink-2`;
  `data-plan-view`, `aria-current`, точка `data-plan-dot`; `pick()` → `writePlanView` + `router.replace`. Ползунка нет;
  переход — только цвет фона кнопки (`press`, `--motion-fast`).
- `components/money/MoneySquares.vue` — та же разметка на три кнопки (`/money`, `/money/debts`, `/money/history`), активная по
  `route.path`, `router.replace`.
- Экран при смене адреса пересоздаётся: `AppShell.vue:229-233` — `RouterView` с ключом `String(r.name ?? r.path)` и
  `fx-fade`. Значит, переключатель внутри экрана **размонтируется и монтируется заново** — переход, начатый до навигации,
  не доиграет. `/week` и `/month` — разные имена маршрутов (`router/index.ts:94-95`); квадраты «Денег» — один маршрут
  `money/:square?` :103 (компонент не пересоздаётся — проверить, что `MoneySquares` остаётся смонтированным).
- `style.css`: `--motion-base` 320 ms, `--ease-out`; `prefers-reduced-motion` гасит переходы :463-472.
- `views/Start.vue` :203-213: шапка шага `div.sticky.top-0.z-10.-mx-5.-mt-5.bg-canvas.px-5.pb-2.pt-5` `data-start-head`;
  строка `flex min-h-8 items-center gap-3`; «Пропустить» — `Button variant="ghost" size="sm" class="-mr-2 shrink-0"
  data-skip` (размер `sm` — `h-8 px-3`, `components/ui/button.ts:29`). Корень экрана :198 `px-5 pb-6 pt-5`. `/start` — вне
  `AppShell` (маршрут верхнего уровня `router/index.ts:79`), `env(safe-area-inset-top)` нигде в `Start` не учтён (есть только в
  `AiReport.vue:569`, `ThemePhotoViewer.vue:58`) — на iPhone в PWA кнопка стоит под строкой статуса; `viewport-fit=cover` в
  `frontend/index.html` — проверить.
- Тесты: `components/plan/PlanSwitch.dom.test.ts` :70-132 (маршрут, память, `data-plan-dot`); `data-plan-view` — `ReviewDot.dom`,
  `MonthPlan.dom`, e2e `b2c-block14`, `b2c-block15`; `views/Start.test.ts` :198, :214, :224 (`data-skip` есть / нет),
  `Start.dom.test.ts:284`, e2e `fr-block1-setup.test.ts:110` (текст `data-start-head`). Классы отступов тесты не проверяют.

## Задача

1. **Ползунок (К-11), вариант составителя (Р-9).** Один механизм для `PlanSwitch` и `MoneySquares` — общий компонент
   `components/kit/SegmentGroup.vue` (пропсы: `items {key, label, dot?}`, `active`, `label`; эмит `pick`), который оба
   используют; третьей копии разметки не оставлять. Внутри: абсолютный `span` ползунка `bg-surface rounded-[10px]` шириной
   `100% / n`, `transform: translateX(i·100%)`, `transition: transform var(--motion-base) var(--ease-out)`; кнопки
   `relative z-10` без своего фона, активная `text-ink`, иначе `text-ink-2`; `role="group"`, `aria-current`,
   `data-plan-view` / прежние атрибуты сохраняются.
   Чтобы переезд было видно, несмотря на пересоздание экрана: модульная переменная «откуда» (`lastActive` по `label`
   группы) — при монтировании, если она есть и отличается от `active`, ползунок рисуется на прежней позиции и в следующем
   кадре (`requestAnimationFrame`) переезжает на активную; затем `lastActive = active`. Навигация не задерживается.
   С `prefers-reduced-motion` ползунок встаёт сразу (общее правило).
2. **«Пропустить» от угла (К-10).** Убрать `-mr-2` (коробка кнопки — по краю контента, 20 px от края экрана, текст — 32 px);
   верх шапки — `padding-top: max(24px, calc(env(safe-area-inset-top) + 8px))` вместо `pt-5` (inline-стиль или утилита в
   `style.css`); `-mt-5` корня согласовать, чтобы шаг не прыгал. Если в `index.html` нет `viewport-fit=cover` — добавить
   (иначе `env()` = 0) и проверить, что остальные экраны (`AppShell` с шапкой) не поехали под вырез; поехали — не трогать
   `index.html`, записать в Handoff как хвост.

## Тесты

- `components/kit/SegmentGroup.dom.test.ts` (новый): ползунок стоит под активной (`translateX(100%)` у второй из двух);
  при монтировании после `lastActive = 'week'` с `active = 'month'` первый кадр — позиция 0, после `rAF` — 100 %;
  `pick` эмитится только при смене.
- `PlanSwitch.dom.test.ts` — без изменений по смыслу (маршрут, память, точка), адаптировать селекторы при необходимости.
- `views/Start.dom.test.ts` — у `[data-skip]` нет класса `-mr-2`; у `[data-start-head]` стиль `padding-top` с `safe-area`.

## Критерии приёмки

- Демо в Chrome 390 (обе темы): нажатие «Месяц» — ползунок уезжает из-под «Неделя» под «Месяц» (видно покадрово, ~320 мс),
  экран меняется без задержки; «Капитал → Долги → История» — то же; с «Уменьшить движение» — без переезда. Первый запуск,
  шаг «Тратьте как обычно» в эмуляции iPhone (Chrome, viewport с вырезом): «Пропустить» не под строкой статуса, от правого края
  ≥ 20 px до коробки кнопки.
- `npm run build && npx vitest run` зелёные.

## Вне скоупа

- `kit/Segmented.vue` (капсула другого вида) и `kit/Tabs.vue` — не трогаем.
- Остальные экраны под вырезом (`AppShell`) — не трогаем, кроме проверки, что `viewport-fit=cover` их не ломает.
- Макеты `19:181`, `19:158` — FG-13.
