# FG-25 — «Деньги»: мини-рамки «счета | долги», калькулятор досрочки с «?» и одним итогом; строка «в Алматы» убрана; строка `SalaryRow` без экрана удалена (FG-Х6) (фронт)

Блок 4 · MVP · Репо/каталог: `frontend/src` · Зависит от: FG-19 · Роли: участник, viewer (видят одинаково; viewer без «Внёс досрочно»)

Эталон — `19:2` «16 · Деньги · Капитал», `51:873` «17.3 · Долги → калькулятор», `50:178` «13.6 · Месяц → раздел трат» (правки
владельца 2026-10-26) + хвост **FG-Х6** (критик Блока 3; судьба — владелец 2026-10-26: строкой в пачку вида). Размер **S**: подписи и
вид; расчёты (`prepayOutcome`, `payoffLadder`, `netWorth`) не меняются.

## Контекст (что уже есть)

- **16 Капитал** `views/Money.vue:40-43, :74`: формула `data-worth-formula` одной строкой `счета ${plain(assets)} − долги ${money(debt)}`
  / `счета ${money(assets)} · долгов нет` под суммой капитала 34. Токены: `--line-strong` (`style.css:23`, тёмная `:92`). Тесты:
  `views/Money.test.ts`, `Money.b16.dom.test.ts`, `Money.stats.dom.test.ts`, `Access.demo.dom.test.ts`; e2e `pn-block2-capital-stats`,
  `pv-block2-money-edit`.
- **17.3 Калькулятор** `components/capital/PayoffSheet.vue:113-270`: карточка кредита; «Как вносите» `Segmented`; поле «Сколько
  добавите к платежу, ₸» (подпись — FG-19); чипы `+48 000` (пресеты, без «₸» — поля ввода, по правилу); итог `:161-173` — коробка
  `border-brand bg-brand-soft` с «Закроется на N мес. раньше» 18, «экономия N ₸», «Останется N платежей вместо M»; **абзац 1**
  `:174-177` «Впишите сумму, которую действительно можете внести…» (когда суммы нет); «Внёс досрочно» (ghost md w-full → FG-19);
  «Досрочные взносы» со «Снять»; **«Отдача падает»** `:242-262` — лесенка `ladder` строками «+N ₸ | −N мес. | N ₸» + **абзац 2**
  «Половину переплаты снимает уже добавка в …»; «Закрыть» брендовая. `kit/Hint.vue` — «?» с `label`; `kit/Field` — слот `#hint`.
  Тесты: `components/capital/CapitalSheets.dom.test.ts`, `components/money/CapitalLists.test.ts`, `views/Money.test.ts`; e2e
  `pv-block1-calculator`, `pv-block2-money-edit`, `block5-capital-goals`, `f2-block2-prepay`.
- **13.6 Строка РК** `components/money/SpendCategorySheet.vue:111-114` `data-cat-rk` «Продукты: у вас 53 % · в Алматы 54 %» + `Hint`
  «Справка»; проп `rk` (`:25`), считают `catRk` в `MonthPlan.vue:477` и `MonthPast.vue:53` через `rkShare` (`lib/finance.ts:4376`),
  данные `RK_SPEND_GROUPS` (`lib/statements/dictionary.ts`). Тесты: `SpendCategorySheet.dom.test.ts`, `MonthPlan.dom.test.ts`
  (`data-cat-rk`), `lib/finance.test.ts` (`rkShare`).
- **FG-Х6** `components/SalaryRow.vue`: три режима — `button && small` (`:70-79`, «Пришла» `xs` в строке «Месяца»), `button`
  (`:80-88`, «Пришла зарплата» + «Другая сумма или счёт» в листе зарплаты) и **`v-else` строка `Row`** (`:90-143`: «+N ₸», «пришла
  … · счёт», ✓ / «Пришла») + `SalaryExchange` `:144`. Все вызовы в приложении — с `button` (`money/MonthPlan.vue:1110`,
  `money/SalarySheet.vue:131, :159`); строку видят только `components/SalaryRow.test.ts` (3 SSR-теста «строка зарплаты») и e2e
  `e2e/b2c-block13-fx-salary.test.ts:298-310` (`screen(A.pinia, SalaryRow, '/money', …)` — проверяет «обменяно» из `SalaryExchange`).
  `SalaryExchange` рисуется и без строки: `MonthPlan:1102` (`part="button"`), `SalarySheet:142` (`part="line"`).

## Задача

1. **16 Капитал** (`19:2`): вместо строки-формулы — две мини-рамки в ряд: **«счета N ₸»** (`data-worth-assets`) и **«долги N ₸»**
   (`data-worth-debts`): `inline-flex h-6 items-center rounded-lg border border-line-strong px-2 text-[12px] num`, подпись `text-ink-2`,
   число `text-ink` (`money` у каждой — Р-12, суммы теперь порознь); без долгов — одна рамка «счета N ₸» и тихое «долгов нет»
   `text-ink-2`. Нажатие плашки (статистика) — как было.
2. **17.3 Калькулятор** (`51:873`): (а) абзац 1 → **`Hint`** у подписи поля «Сколько добавите к платежу» (слот `#hint` у `Field`),
   текст короче: «Сумма, которую действительно можете добавлять каждый месяц — больше приложение не предложит»; (б) итог — без
   коробки: **«−7 мес.»** 28 Bold (`font-num text-[28px] font-bold num text-ink`) и строкой **«переплата меньше на 100 261 ₸»**
   (`text-ok`, `money(saved)`); «Останется N платежей вместо M» и абзац 2 («Половину переплаты снимает уже добавка в …») — в **`Hint`
   у итога**; `!sooner` — «Срок почти не изменится» `text-ink-2` + та же строка переплаты; (в) **«Отдача падает» свёрнута** под
   тихой строкой **«Подробнее ›»** (`<details>`, `summary` как в `GoalDetail`), по умолчанию закрыта, строки лесенки без изменений;
   (г) порядок ниже итога — как был: «Внёс досрочно» (компактная по FG-19), «Досрочные взносы», «Подробнее ›», «Закрыть».
3. **13.6**: строку `data-cat-rk` с `Hint` убрать; проп `rk`, `catRk` (`MonthPlan`, `MonthPast`), `rkShare` и его тесты — удалить,
   если grep не находит других вызовов (`RK_SPEND_GROUPS` оставить, если его читает ещё кто-то, иначе — тоже).
4. **FG-Х6**: из `SalaryRow.vue` удалить ветку `Row` (`v-else`) и строку `SalaryExchange` `:144`, пропсы `note`, `clickable`, `dense`,
   эмит `open`, неиспользуемые импорты (`Row`, `PhArrowUp`, `PhCheck`, `atLabel`, `memberColor`, `cn`, `money`/`moneyIn`, `shown*`,
   `toAccount`); JSDoc — два режима. `SalaryRow.test.ts` — три теста строки удалить, оставить/дописать тесты режимов `button` и
   `button small` (viewer без кнопки, окно 3 дня, отмеченная — без кнопки). e2e `b2c-block13-fx-salary:298-310` — факт «обменяно»
   проверять через `SalarySheet` (`part="line"`) или `MonthPlan` (`part="button"`), не через `SalaryRow`.
5. Правило 12 — в Handoff: калькулятор — одна крупная цифра у предмета, пояснения в «?», таблица скрыта; капитал — две цифры в
   рамках у суммы.

## Тесты

- `views/Money.test.ts` / `Money.b16.dom.test.ts`: `[data-worth-assets]` «счета 3 991 310 ₸», `[data-worth-debts]` «долги 2 297 324 ₸»
  (NBSP — через `\s`); без долгов — одна рамка и «долгов нет»; `data-worth-formula` больше нет.
- `components/capital/CapitalSheets.dom.test.ts` (или новый `PayoffSheet.dom.test.ts`): сумма введена → `[data-payoff-months]`
  «−7 мес.» и `[data-payoff-saved]` «переплата меньше на N ₸»; `Hint` у подписи поля и у итога открываются; лесенка — внутри
  `details`, закрыта по умолчанию, после `summary` видна; `!sooner` → «Срок почти не изменится».
- `components/money/SpendCategorySheet.dom.test.ts`, `MonthPlan.dom.test.ts`: строки «в Алматы» нет; `lib/finance.test.ts` —
  тесты `rkShare` удалены вместе с функцией.
- `components/SalaryRow.test.ts` — режимы `button`; e2e `b2c-block13-fx-salary` — адаптирован.
- e2e `pv-block1-calculator`, `pv-block2-money-edit`, `block5-capital-goals`, `pn-block2-capital-stats` — адаптировать.

## Критерии приёмки

- Стенд Chrome 390 и 375, обе темы, демо: «Деньги» — под капиталом две рамки «счета … ₸» и «долги … ₸» (24 px, обводка
  `--line-strong`), сумма та же; лист кредита → «Досрочное погашение»: «?» у подписи поля и у итога, «−7 мес.» крупно и
  «переплата меньше на N ₸» зелёным, «Подробнее ›» раскрывает лесенку; «Месяц → Траты → раздел» — строки «в Алматы» нет;
  `grep -rn "SalaryRow" src e2e` — только режимы `button`. Числа калькулятора — те же, что до правки (снимок до/после).
- `npm run build && npx vitest run` зелёные; `lib/finance.ts` — дифф только удаление `rkShare` (если удаляется).

## Вне скоупа

- Листы кредита «Внёс досрочно» / «Молодец!» (`51:580`, `51:724`) — кит FG-19; «Как закрыть быстрее» — не правился.
- `ScheduleTable`, `StrategyCompare` (FG-16) — не трогать.
