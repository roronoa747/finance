# PN-04 — Расчёт `capitalStats` в `finance.ts` (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/src/lib/finance.ts`, `frontend/src/lib/capitalStats.test.ts` · Зависит от: PN-03 (ворота ✅) · Роли: —

## Контекст (что уже есть)

- **План месяца** — единственный вход для долей дохода: `monthPlan(state: MonthPlanState, ctx: MonthPlanCtx): MonthPlan`
  (`finance.ts:3086`; типы :2927-3024). Нужные поля `MonthPlan`: `income.total` (зарплаты месяца: пришедшая —
  `paidTenge`, иначе `salaryTenge`), `dues: PlanDue[]` (`MonthDue & { payer }`; `MonthDue` :1696 — `{ targetId, name,
  day, amount, paid } & ({ kind: 'obligation'; obligation } | { kind: 'credit'; credit })`), `duesTotal`, `spendTotal`
  (траты по планам), `queue: PlanQueueItem[]` (:2970 — `kind: 'goal' | 'fund' | 'debt'`, `given` — что очередь получает
  в этом месяце, `creditId` у карточки долга), `queueTotal`, `rest`, `short`. Тождество: доход = платежи + траты +
  очередь + `rest` − `short`. Экраны берут вход из стора: `useFinanceStore().planInput(key)` / `monthPlanOf(key)`
  (`stores/finance.ts:278-291`); гвард `router/legacy.test.ts:75` запрещает экранам звать `monthPlan(` напрямую.
- **Тело платежа кредита:** `creditSplit(principal, annualRate, amount) → { amount, interest, body }` (:1300-1319;
  проценты = остаток × ставка / 12, до тенге); рассрочка и долг человеку — ставка 0 → всё тело. Досрочка карточки долга
  (`queue` kind `debt`, `given`) — тело целиком. Кредиты стора — производные (`finance.credits`, остаток уже из отметок).
- **Долги:** `debtsOverview(state: PlanState & { plans? }, key) → { total, freeMonth: string | null, rows: DebtRow[] }`
  (:2607; `freeMonth` — с планом «Сначала долги» из `planForecast`, без плана — конец графиков); `creditOutlook(c) →
  { closes, months, overpay, monthlyInterest, sharePct }` (:292; не закрывается — `months`/`overpay` = `Infinity`);
  `overpayNoPlan(credits): number | null` (:2553 — сверить семантику перед использованием), `planOutlook` (:2570),
  `openCredits` (:748), `costliestCredits` (:758, только ставка > 0). `activePlan(plans)` (:2304).
- Даты: `monthsBetween(from, to)` (:2249), `monthKey`, `addMonths`, `monthIn` (`lib/dates.ts`).
- Фикстуры: `src/test/planFamily.ts` (`planFamilyDoc()` — семья с подушкой, кредитами `cc`/`loan`, арендой),
  `lib/monthPlan.test.ts` (образец тестов плана), `lib/moneyScreens.test.ts` (`debtsOverview`, `netWorth`).
- Деньги — целые тенге; проценты — целые; «зарплат» — одна десятая (не деньги). Р-3: «всё из текущих цифр, без новых
  данных».

## Задача

1. В `finance.ts` (раздел рядом с `monthSalaries`/`capitalGoals`) — **`capitalStats(plan: MonthPlan, state: PlanState &
   { plans?: DebtPlan[]; credits?: Credit[] }, key: string): CapitalStats`**, чистая функция от уже посчитанного плана
   (экран передаёт `finance.monthPlanOf(key)` — без второго прогона очереди):
   ```ts
   export type CapitalPart = { key: 'credits' | 'payments' | 'goals' | 'rest'; amount: number; share: number; pct: number }
   export type CapitalStats = {
     income: number                 // plan.income.total
     parts: CapitalPart[]           // пусто, если income ≤ 0; «credits» отсутствует, если кредитов нет (0)
     short: number                  // plan.short — не хватает на платежи и траты (полоска заполнена, строка «остаётся» 0)
     growth: number                 // тело кредитов месяца + досрочки карточки + взносы в цели и фонды (given)
     debtFree: { month: string | null; months: number | null; salaries: number | null }
     overpay: { amount: number | null; salaries: number | null }   // null — не закрывается при текущем платеже
   }
   ```
   - `credits` = Σ `dues` с `kind === 'credit'` (`amount`) + Σ `queue` kind `debt` `given`; `payments` = Σ `dues`
     `kind === 'obligation'` (аренда, коммуналка, подписки, людям — всё, что платёж); `goals` = Σ `queue` kind
     `goal` | `fund` `given`; `rest` = max(0, income − credits − payments − goals) — остаётся на жизнь (траты планов
     входят сюда: владелец видит четыре доли, не пять). `share = amount / income` (0…1), `pct = Math.round(share × 100)`;
     сумма `amount` четырёх частей = income − short… — проверить тождество в тесте: `credits + payments + goals + rest
     = max(income, credits + payments + goals)`.
   - `growth` = Σ по `dues` кредитов `creditSplit(credit.principal, credit.annualRate, due.amount).body` + Σ `queue`
     `debt.given` + `goals`. Целое; округление «~N» до тысяч — на экране (`Math.round(x / 1000) * 1000`), не здесь.
   - `debtFree.month` = `debtsOverview(state, key).freeMonth`; `months` = `monthsBetween(key, month)`; `salaries` =
     `months` (ритм — месяц; Блок 7 PN-24 заменит на число приходов). Нет кредитов → все null.
   - `overpay.amount` = сумма переплат процентных открытых кредитов: `creditOutlook(c).overpay` по `openCredits` с
     `annualRate > 0`; любой `Infinity` → `amount: null`. При активном плане «Сначала долги» — минус
     `planForecast(plan, state, key).savedInterest` (если не null). `salaries` = `amount / income` с одним знаком после
     запятой (`Math.round(x * 10) / 10`), income ≤ 0 → null.
2. Хелпер `inSalaries(amount, income): number | null` (та же одна десятая) — экспортировать: Блок 5 использует.
3. Ничего в документ не пишется; новых входов нет (Р-3).

## Тесты

- Новый `lib/capitalStats.test.ts` на `planFamilyDoc()` и семье с двумя окладами: (1) части — тождество с планом
  (`credits + payments + goals + rest` и `short`), `pct` в сумме 100 ± 1; (2) `growth`: аннуитет вручную (остаток ×
  ставка / 12 → тело), рассрочка 0 % — платёж целиком, долг брату — целиком, взносы целей — `given`; (3) `debtFree` —
  месяц из `debtsOverview`, `months`/`salaries`; без кредитов — null; (4) `overpay` — сумма `creditOutlook`, кредит
  «не закрывается» → null, с планом — минус `savedInterest`; `inSalaries(450_000, 300_000) = 1.5`; (5) `income` 0 →
  `parts: []`, `overpay.salaries: null`. Мутации руками (убрать `given` долга из `credits`, `pct` без округления) —
  красные (откат копией файла, не `git checkout`).

## Критерии приёмки

- Все числа — `finance.ts`, целые; `cd frontend && npm run build && npx vitest run` зелёные.

## Вне скоупа

- Экран — PN-05. «Зарплат» по ритму — Блок 7. Снимки капитала по месяцам — после MVP.
