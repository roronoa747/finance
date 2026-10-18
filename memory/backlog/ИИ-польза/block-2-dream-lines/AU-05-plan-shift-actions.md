# AU-05 — Сдвиг месяца и кандидаты «Сделать» (фронт, `finance.ts` + стор)

Блок 2 · MVP · Каталог: `frontend/src/lib/finance.ts`, `types/finance.ts`, `stores/finance.ts`, `lib/merge.ts` · Зависит от: AU-04 · Роли: member (пишет), viewer (видит итог в плане)

## Контекст (что уже есть)

- Р-3: три действия — «Перенести N из раздела в мечту» (план трат раздела −N, взнос мечты +N **в этом месяце**),
  «Внести N досрочно» (кредит), «Отложить N в подушку»; суммы и эффект считает код; ИИ (Блок 3) выбирает одно из
  кандидатов кода; «Вернуть срок» — то же действие. Р-17: одна запись `PlanShift` в общем документе; деньги двигает, как
  сейчас, «Отложил»/«Оплатил» у строки «Месяца».
- `monthPlan` (`finance.ts:3377-3507`): траты участника — строки `spendPlans` (`rows[].plan`); очередь `shape` → `want`
  (цель: `min(monthly, need − have)`; карточка долга: сумма карточки или шаг плана, не больше `afterRegular`) → `given`
  сверху вниз из `free`; даты — `queueRun(items, free, ends)` :3328 (каждый месяц одинаковый `cap`).
- Эффекты: мечта — `closerDays(N, goalPace(goal, key))` :2490; досрочка — `prepayOutcome(credit, N, 'once')` :329
  (`monthsSaved`, `saved` — проценты); подушка — `cushionCover(item, goal, settings)` :3834 (`months` — хватит на N мес.).
  Карточка долга и её кредит — `costliestCredits` :776, `debtCardOf` :3169; подушка — `fundsOf(doc).cushion` :3112.
- Сравнение разделов — `spendCompare` (AU-01: `plan`, `usual`, `amount`); сдвиг мечты — `dreamShift` (AU-04).
- План трат участника — `SpendPlan` (`id = by:categoryId`), постоянный; стор `setSpendPlan` (`stores/finance.ts:1956`).

## Задача

1. **Модель.** `SyncDoc.planShifts?: PlanShift[]`, `PlanShift = Tracked & { id, period: 'YYYY-MM', by: PersonId, from:
   'rest' | { spend: PersonId; categoryId: string }, to: { goalId: string } | 'debt', amount: number, at }`; слияние
   `mergeList` по id; отмена — `deletedAt`. Стор: `addPlanShift(...)`, `undoPlanShift(id)`; viewer — нет (кнопок нет,
   сервер и так не примет).
2. **`monthPlan` учитывает сдвиги своего месяца:** `from.spend` — план строки участника −N (не ниже 0; строки нет — сдвиг
   не применяется); `to.goalId` / `'debt'` — `want` +N (не больше остатка до суммы, порога, долга); `from: 'rest'` —
   только `want` +N (остаток уменьшится сам). Даты: добавка — **только первый месяц** прогона: `RunItem` получает
   `first?: number`, `queueRun` прибавляет его к `cap` при `m === 0`. Без сдвигов — числа прежние.
3. **Кандидаты.** `stepCandidates(state, ctx)` → до 3 `StepCandidate { id, kind: 'move' | 'prepay' | 'cushion', shift:
   Omit<PlanShift, 'id' | 'by' | 'at' | Tracked>, effect }`, суммы — вниз до 1 000, не меньше 5 000 (константы):
   - `move` — раздел с планом, где `usual !== null && usual < plan`: `N = plan − max(usual, amount ?? 0)`; источник —
     участник с бо́льшим планом в разделе; цель — первая мечта очереди (не фонд, не на паузе); `effect = { days }`;
   - `prepay` — есть карточка долга (кредит с процентами) и `rest > 0`: `N = rest`; `effect = { months: monthsSaved,
     saved }` из `prepayOutcome`;
   - `cushion` — подушка не собрана и `rest > 0`: `N = min(rest, need − have)`; `effect = { months }` — на сколько
     месяцев хватит после (`cushionCover` с `have + N`).
   Нет данных — кандидата нет (пустой список — нормально).
4. **«Вернуть срок».** `returnTermShift(state, ctx, snap, goalId)` → кандидат `move` или `null`: `N` = недобор мечты
   этого месяца из `dreamShift` (вверх до 1 000); источник — `rest`, если хватает, иначе раздел с запасом плана ≥ N
   (как у `move`), иначе `null` (кнопки не будет). После сдвига `dreamShift` этой мечты — не дальше снимка (тест).
5. Деньги — целые; ни одного расчёта в компонентах (AU-06 только вызывает).

## Тесты

- `monthPlan.test.ts`: сдвиг из раздела — `spend` −N, `given` мечты +N, `rest` прежний; из остатка — `rest` −N; в долг
  — `given` карточки +N; сдвиг чужого месяца не применяется; надгробие — не применяется; `doneMonth` после сдвига — не
  позже прежнего, добавка не повторяется в следующих месяцах прогона (против ручного расчёта).
- `stepCandidates`: каждый вид на семье `planFamilyDoc`; округление и минимум; без мечты — нет `move`; без долга — нет
  `prepay`; подушка собрана — нет `cushion`.
- `returnTermShift`: после применения `dreamShift` ≤ 0 дней; денег нет — `null`.
- `merge.test.ts`: сдвиги с двух телефонов по id; отмена побеждает по `updatedAt`.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные; прежние `monthPlan`-тесты без правок ожиданий.

## Вне скоупа

- Листы и кнопки — AU-06; выбор кандидата ИИ — Блок 3 (AU-11…AU-13). Перенос между участниками, долгосрочная смена
  `monthly` или `SpendPlan` — нет (только этот месяц).
