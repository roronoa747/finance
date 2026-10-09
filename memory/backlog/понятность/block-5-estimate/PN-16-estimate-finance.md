# PN-16 — Расчёты «Прикинуть кредит» и «Хватит?» (фронт)

Блок 5 · MVP · Репо/каталог: `frontend/src/lib/finance.ts`, `frontend/src/lib/estimate.test.ts` · Зависит от: Блок 4 🏁 (`inSalaries` — Блок 2, `goalPace`/`closerDays` — Блок 3) · Роли: —

## Контекст (что уже есть)

- Аннуитет: `annuityPayment(principal, annualRate, months)` (`finance.ts:23`), `annuityMonths` (:31), `annuityTotal`
  (:40), `installmentMonths(principal, payment)` (:82), `creditOutlook(c) → { closes, months, overpay, monthlyInterest,
  sharePct }` (:292), `rateFromSchedule` (:56). Рассрочка — ставка 0 (`Credit.annualRate === 0`, без `rateUnknown`).
- План месяца: `monthPlan(state: MonthPlanState, ctx: MonthPlanCtx): MonthPlan` (:3086) — `income.total`, `dues`,
  `duesTotal`, `free`, `queue` (`PlanQueueItem` :2970 — `kind`, `goalId`, `name`, `want`, `given`, `have`, `need`,
  `doneMonth`), `rest`, `short`. Очередь прогоняется по месяцам (`queueRun` :3037, горизонт 600): `doneMonth` — когда цель
  собрана при нынешнем остатке. Кредиты в `state.credits` — производные (остаток из отметок); платёж месяца кредита
  в `dues` — `creditDueAmount`/`monthDues` (:1708). Главная мечта — первая `kind: 'goal'` в `queue` (`heroGoal` стора,
  `mainGoal` :2810).
- «До зарплаты»: `untilPayday(state, now) → null | { who, income, inDays, day, key, due, paid, dueTotal, knowsCash,
  onAccounts, shortfall }` (:1747-1833; `shortfall = onAccounts − dueTotal`, `knowsCash` — есть счета не-депозиты).
- Блок 2: `capitalStats`, **`inSalaries(amount, income): number | null`** (одна десятая). Блок 3: **`goalPace(goal,
  key)`**, **`closerDays(amount, pace)`** (PN-09). `monthsBetween` (:2249).
- Р-11: (а) «Прикинуть кредит»: сумма, срок, ставка или «рассрочка 0 % на N месяцев» → «нагрузка станет M % дохода,
  <главная мечта> отодвинется на N месяцев, переплата — K зарплат»; (б) «Хватит?»: сумма покупки → «да, до зарплаты
  останется N» или «нет: <мечта> отодвинется на N дней». Ничего не сохраняется; считает `finance.ts` на существующих
  функциях.

## Задача

1. **`tryCredit(state: MonthPlanState, ctx: MonthPlanCtx, input: { principal: number; months: number; annualRate: number
   }): TryCredit`** — ставка 0 = рассрочка:
   ```ts
   export type TryCredit = {
     payment: number                       // annuityPayment (ставка 0 → ceil(principal / months))
     loadNowPct: number | null             // duesTotal / income.total × 100 (income 0 → null)
     loadPct: number | null                // (duesTotal + payment) / income × 100
     hero: { name: string; doneBefore: string | null; doneAfter: string | null; delayMonths: number | null } | null
     overpay: number                       // payment × months − principal (рассрочка — 0)
     overpaySalaries: number | null        // inSalaries(overpay, income.total)
   }
   ```
   `hero` — главная мечта из `monthPlan(state, ctx).queue` (первая `kind: 'goal'`): `doneBefore` — её `doneMonth`;
   `doneAfter` — `doneMonth` той же цели из `monthPlan({ ...state, credits: [...credits, фиктивный Credit { id:
   'try', principal, annualRate, payment, day: 1, updatedAt }] }, ctx)` — **один и тот же план, без копии формул**:
   платёж ляжет в `dues`, очередь пересчитается сама; `delayMonths = monthsBetween(doneBefore, doneAfter)` (оба null
   — null; `doneAfter` null при `doneBefore` — «не соберётся» → `delayMonths: Infinity`). Целые тенге.
2. **`canAfford(state: Parameters<typeof untilPayday>[0] & MonthPlanState, ctx: MonthPlanCtx, amount: number, now =
   today()): CanAfford`**:
   ```ts
   export type CanAfford =
     | { ok: true; left: number; inDays: number | null }          // до зарплаты останется left
     | { ok: false; short: number; goal: string | null; days: number | null }   // не хватает short; мечта отодвинется на days
   ```
   `up = untilPayday(state, now)`: `up && up.knowsCash` → `left = up.shortfall − amount`; иначе (счетов нет) →
   `left = monthPlan(state, ctx).rest − amount`, `inDays: null`. `left ≥ 0` → ok. Иначе `short = −left`, `goal` — имя
   главной мечты, `days = closerDays(short, goalPace(hero, ctx.key))` (из PN-09: столько дней взносов съест
   покупка); героя нет или темпа нет → `days: null`.
3. Обе функции — чистые, без записи; экраны зовут их через стор (`planInput(key)` даёт `state`/`ctx`; гвард
   `legacy.test.ts:75` — `monthPlan(` только в `finance.ts`).

## Тесты

- `lib/estimate.test.ts` на `planFamilyDoc()`: (1) `tryCredit` 1 000 000 / 24 мес / 20 % — платёж = `annuityPayment`,
  `loadPct` > `loadNowPct`, `overpay` = платёж × 24 − сумма, `overpaySalaries` = `inSalaries`; рассрочка 0 % —
  `overpay` 0, платёж = ceil; герой: `doneAfter` позже `doneBefore` ровно на то, что даёт `monthPlan` с кредитом
  (сверить прогоном очереди руками на маленькой семье); доход 0 → `loadPct` null. (2) `canAfford`: со счетами —
  `shortfall − amount`; без счетов — `rest − amount`; нехватка → `goal` и `days` по `closerDays`; без героя — `days`
  null. Мутации (платёж не в `dues`; `short` без знака) — красные.

## Критерии приёмки

- Все числа — `finance.ts`, целые (кроме «зарплат» — одна десятая). `cd frontend && npm run build && npx vitest run`
  зелёные.

## Вне скоупа

- Листы — PN-17. Сохранение «прикидок» — нет (Р-11). Сравнение двух кредитов — нет.
