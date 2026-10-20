# RZ-10 — Метки советов в сторе; ✦ на «Месяце» (разделы, платежи) и «Деньгах» (фронт)

Блок 3 · MVP · Каталог: `frontend/src/stores/ai.ts`, `components/ai/` (новый `AdviceMark.vue`), `components/money/MonthPlan.vue`,
`components/money/DueRow.vue`, `components/money/PaymentLine.vue`, `components/money/CapitalLists.vue` · Зависит от: Блок 2 🏁 ·
Роли: member, viewer, партнёр, демо

## Контекст (что уже есть)

- После Блока 2: разбор v3 текущего месяца — `finance.aiReviewOf(monthKey())` с `advices[i].action` (`do` — `candidate.shift`:
  `from {spend, categoryId} | 'rest'`, `to {goalId} | 'debt'`; `open` — `target {kind: cat|goal|credit|obligation|seller, id,
  categoryId?}`); отчёт открывается `/month?review=1&card=<n>` (n — номер совета 1…3). Точные имена — промпт исполнителя
  в SESSION.md (критик Блока 2 актуализирует).
- Строки: разделы «Месяца» — `MonthPlan.vue` `data-spend-row` :663 (нажатие — лист «Сколько в месяц» / лист раздела;
  название строки — grep `r.name` рядом); платежи «Месяца» — `DueRow.vue` (`due: PlanDue`, `id = kind:targetId`, строка —
  кнопка-название `row-open`, кружок плательщика — отдельная кнопка поверх: «кнопка в кнопке недопустима»); «Деньги» —
  `PaymentLine.vue` (`item {kind: 'credit' | 'obligation'}`), подписки группой (`subscriptionGroup`, `CapitalLists.vue:95`,
  строки :302). Иконки `PhSparkle` (`@phosphor-icons/vue`), цвет `text-brand`; точка «новый» — образец разметки точки у ✦.
- Р-9, Р-23: ✦ 12 px отдельной кнопкой (`@click.stop`), `aria-label` «Совет ИИ», только у разбора текущего месяца;
  нажатие → отчёт на карточке совета; viewer и партнёр видят ✦ так же; цель `seller` метит строку своего раздела.

## Задача

1. `stores/ai.ts` — `adviceMarks` (computed): `Map<string, number>` ключ `kind:id` → номер совета (1-based) по v3-разбору
   текущего месяца: `open` → `${target.kind}:${target.id}`, для `seller` — ещё `cat:${target.categoryId}`; `do` `move` →
   `cat:${from.categoryId}` и `goal:${to.goalId}`; `prepay` → `credit:<id карточки долга / кредита очереди>` (как
   `stepCandidates` берёт `debt.creditId`); `cushion` → `goal:<id подушки>`. Первый совет на предмет побеждает. Демо —
   по заготовке. Хелпер `markFor(kind, id): number | null`.
2. `components/ai/AdviceMark.vue`: проп `n: number | null`; `n` есть — `<button type="button" aria-label="Совет ИИ"
   data-advice-mark>` с `PhSparkle` 12 `text-brand`, `@click.stop` → `router.push({path: '/month', query: {review: '1',
   card: String(n)}})`; `n` null — ничего. Размер касания ≥ 28 px (внутренние отступы), не ломает высоту строки.
3. ✦ в строках: `MonthPlan.vue` — после названия раздела в строке `data-spend-row` (`markFor('cat', r.categoryId)`) и у
   платежа в `DueRow` (новый проп `mark?: number | null`, рисуется после названия; `markFor('obligation'|'credit',
   targetId)` по `due.kind`); «Деньги» — `PaymentLine` (проп `mark`), строки подписок и платежей в `CapitalLists`. Внутри
   `row-open`-кнопки ✦ не вкладывать — рядом, как кружок плательщика.
4. Открытие отчёта с «Денег»: `/month?review=1&card=<n>` — роутер переходит на «Месяц» с отчётом (отчёт читает `card`).

## Тесты

- `stores/ai` — `adviceMarks` по разбору v3: `open` всех видов, `do` трёх видов, `seller` метит и раздел, первый совет
  побеждает, прошлый месяц — пусто, v2 — пусто, демо — по заготовке.
- `AdviceMark.dom.test.ts`: кнопка с `aria-label`, нажатие → адрес отчёта с `card`, `stop` — строка не открылась.
- `MonthPlan.dom.test.ts`: ✦ у раздела из совета и у платежа; у viewer тоже; без разбора — нет. `CapitalLists`/`PaymentLine`
  DOM-тест: ✦ у подписки из совета.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные.
- Браузер 390, обе темы, member / viewer / демо: на «Месяце» у раздела и платежа из советов — ✦; нажатие ✦ открывает отчёт
  на карточке этого совета, нажатие строки — прежний лист; на «Деньгах» ✦ у подписки; строки ровные, высота не
  изменилась.

## Вне скоупа

- Мечты, экран цели, долги — RZ-11. e2e и доки — RZ-12. ✦ у операций продавца в истории — после MVP.
