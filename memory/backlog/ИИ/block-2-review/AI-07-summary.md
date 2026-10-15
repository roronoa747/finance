# AI-07 — Сводка месяца без имён (фронт)

Блок 2 · MVP · Каталог: `frontend/src/lib/` (новый `aiSummary.ts`) · Зависит от: Блок 1 🏁 · Роли: member

## Контекст (что уже есть)

- Р-3: разбору уходит сводка + траты по разделам: цифры месяца, **посчитанные `finance.ts`** (доход, платежи, остаток,
  долги со ставками, цели с прогрессом и сроками), итоги трат по разделам; имена → «участник 1/2»; без заметок, без
  операций и продавцов, без личного документа. Модель денег не считает. Р-9: сводку человек может посмотреть («что
  ушло», AI-09) — она же и уходит.
- `lib/finance.ts` (чистые функции; доктрина ИИ — :11-18):
  - `monthPlan(state: MonthPlanState, ctx: MonthPlanCtx): MonthPlan` :3368 (типы `MonthPlanState` :3195,
    `MonthPlanCtx` :3211, `MonthPlan` :3279 — `income {total, byPerson}`, `dues`, `duesTotal`, `spend`, `spendTotal`,
    `outTotal`, `free`, `queue`, `queueTotal`, `putTotal`, `rest`, `short`, `byPerson[]{income, dues, spend, queue,
    left}`, `saved`). Сокращения стора: `finance.planInput(key)` (`stores/finance.ts:286`), `finance.monthPlanOf(key)`
    :296.
  - Траты по разделам: `spendRows(totals, categories, {kind:'month', period, by?})` :4360; `monthSpentByFact(...)` :4796;
    `liveSpendCategories` :4342, `spendCategoryName` :4348. Данные — `doc.spendTotals` (тип `SpendTotal`,
    `lib/statements/types.ts:87`, id `by:kind:period:categoryId`, без раздела — `_unknown`).
  - Долги: `debtsOverview(state, key): {total, freeMonth, rows: DebtRow[]}` :2875 (`DebtRow` :2852 — `payment, rate,
    rateUnknown, person, endMonth, left, paidShare`).
  - Цели: `openGoals` :741, `goalTerm(item, goal, key, forecast?)` :3789 (`need, remaining, doneMonth, months, off,
    afterPlan`), `goalRemaining` :790, `mainGoal` :3078; очередь — `MonthPlan.queue` (`PlanQueueItem` :3251 —
    `want/given/have/need/put/doneMonth/paused`).
  - Свободно по факту: `freeByFact(...)` :4713 (тип :4690). Дни до зарплаты — `untilPayday` :1962.
- Имена и текст людей, которые **не уходят**: `Person.name` (`types/finance.ts:24`), все `*.note`, `reason` версий,
  названия, введённые людьми как свободный текст **у целей и желаний — уходят только названия целей** (иначе шаги «к
  мечте» безлики; заметки целей — нет); `wishlist` целиком не уходит; весь `privateDoc`; операции и продавцы.
- Тест-хелперы: `src/test/planFamily.ts` (`planFamilyDoc`). Демо-семья — `lib/demo.ts`.

## Задача

1. `lib/aiSummary.ts`: `buildMonthSummary(doc: SyncDoc, key: string, now: Date): MonthSummaryAI` — **только вызывает**
   функции `finance.ts` и раскладывает результаты (ни одного своего сложения/умножения денег; округлений нет — всё уже
   целое). Структура (стабильная, без лишнего; ключи — латиницей, значения — целые тенге):
   - `month` (`'YYYY-MM'`), `daysToPayday`;
   - `income: {total, byPerson: [{who: 'участник 1'|'участник 2'|…, amount}]}` (по порядку slot a, b, c);
   - `dues: {total, items: [{name, amount}]}` (названия статей/обязательств/кредитов — как в документе; без заметок);
   - `spend: {total, byCategory: [{name, amount}]}` (по разделам месяца, без `_unknown` → строка «Без раздела»);
   - `rest`, `short`, `free`, `saved`;
   - `debts: {total, items: [{name, left, payment, ratePercent | null, endMonth}]}`;
   - `goals: [{name, want, have, monthlyPut, doneMonth | null, paused}]` (очередь месяца + открытые цели).
   Имя участника в названии статьи (например «Кредит Айгуль») — заменить на «участник N» по `people` (точное вхождение
   имени, без учёта регистра).
2. `summaryNumbers(s): number[]` — все числа сводки (для тестов и для сверки на фронте, если понадобится).
3. Ничего не отправляет — только строит (отправка — AI-09).

## Тесты

- На семье с именами («Айгуль», «Ерлан»), заметками, причинами версий, желаниями и личным документом (счета, правила):
  в `JSON.stringify(summary)` нет ни одного имени, ни одной заметки, ни одного названия желания, ни строки личного
  документа, ни одного продавца/операции (поиск подстрок).
- Каждое число сводки равно результату соответствующей функции `finance.ts` на том же документе (`rest`, `duesTotal`,
  итоги разделов, остатки долгов, `goalTerm`).
- Статья с именем участника → «участник N». Пустой месяц (нет дохода) — сводка строится, массивы пустые, без исключений.
- Демо-семья → сводка строится (её снимок — основа заготовки AI-10).

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные.
- Сводка на живых данных (локальная копия документа владельца со стенда, не в git) просмотрена глазами — имён и
  заметок нет; пример (обезличенный) — в Handoff.

## Вне скоупа

- Ручка и вызов модели — AI-08; кнопка, лист, сохранение — AI-09; демо-заготовка — AI-10.
- Прошлые месяцы (`monthPlanPast`) — после MVP.
