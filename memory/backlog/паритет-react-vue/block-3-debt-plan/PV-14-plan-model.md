# PV-14 — Модель плана в документе и расчёт от факта (фронт)

Блок 3 · MVP · Каталог: `frontend/` · Зависит от: Блок 2 · Роли: member (запись), все (чтение)

## Контекст (что уже есть)

- Р-4, Р-5, Р-7, Р-9, Р-10, Р-11, Р-16. Новое, сверх React. Задача — модель, чистая математика,
  стор и слияние; UI — PV-15…PV-17.
- **Документ:** `SyncDoc` (`types/finance.ts:269-286`): `people`, `categories`, `goals`,
  `wishlist`, `obligations`, `accounts`, `credits`, `payments?`, `setupDoneAt?`. `Goal`
  (`:65-94`): `need`, `seed`, `have`, `monthly`, `hue`, `planPct`, `movements`, `accountId?` —
  флага паузы нет и не будет (Р-9). `Payment` (`:231-265`). `Tracked` (`:16-19`).
  `defaultSyncDoc()` (`stores/finance.ts:25-39`); `mutateHouseholdDoc` (`:237-244`);
  геттеры `goals` (`:120`, с надгробиями; `liveGoals` — `lib/finance.ts:469`), `payments` (`:122`),
  `credits` (`:130-132`, производные). `applyPrepayment(creditId, by, { amount, mode: 'term' |
  'payment', accountId? })` (`:988-1022`; `null`, если `lumpPlan` вернул `null`; `period =
  monthKey()`; при `'payment'` переписывает `credit.payment`), `removePrepayment` (`:1029-1041`),
  `markPaid` (`:865-902`), `unmarkPaid`, `newPayment(fields, accountId, at?)` (`:909-923`;
  счёт по умолчанию `lastAccountFor(...) ?? null`).
- **Слияние** `lib/merge.ts`: `known` (`:145-164`) — `setupDoneAt`, `people`, `categories`,
  `goals` (+`mergeGoal`), `wishlist`, `obligations` (+`mergeObligation`), `accounts`,
  `credits`, `payments` — все списки через `mergeList` по `id` (`:51-76`: LWW по `updatedAt`,
  при равенстве local, `{...loser, ...winner}`, надгробие сильнее). Новый ключ — добавить в
  `known` (комментарий `:125-126`). `isEmptyDoc` (`:169-178`).
- **Математика** `lib/finance.ts`: `simulateStrategy` (`:380-462`), `strategyInputs` /
  `strategyGain` (PV-02), `openCredits` / `costliestCredits` (PV-01), `lumpPlan(principal, rate,
  payment, lump, mode)` (`:278-302`; **`null` при `debt <= 0 || paid <= 0 ||
  !isFinite(annuityMonths(...))`** `:288` — платёж не покрывает проценты; хвост §4 RP, Р-11),
  `annuityMonths` (`:24-30`, `Infinity` при `x <= 0`), `debtCost` (`:197-210`), `creditBalance`,
  `prepaySaved`, `countedPayments`, `budgetAmounts(state)` (`:628-659`; d3 = Σ `monthly` живых
  целей `:653`, `free` `:656`), `mandatoryMonthly(categories)` (`:599-602`), `emergencyCoverage`,
  `goalMonths`. Даты — `lib/dates.ts`: `monthKey(d?)`, `addMonths(key, n)`, `today()`,
  `parseMonthKey`, `monthTitle`, `monthIn`, `monthAfter`, `atLabel`.
- Тесты: `stores/finance.test.ts` (`family()` `:720-734`, фальшивые таймеры `2026-09-24T07:00Z`),
  `lib/merge.test.ts` (`createEmptyDoc` `:6-17`, хелперы `mark`/`both`/`tomb` `:413-521`),
  `lib/finance.test.ts`.

## Задача

1. **Тип `DebtPlan`** (`types/finance.ts`, `Tracked`): `id`, `status: 'active' | 'done' |
   'cancelled'`, `by: PersonId`, `startedAt` (ISO; месяц старта — `monthKey(startedAt)`),
   `endedAt?: string | null`, `keptGoalIds: string[]` («Что не останавливать»), `cushionGoalId:
   string | null` (Р-7), `creditIds: string[]` (открытые процентные долги на момент выбора —
   их платежи после закрытия «освобождаются» в план, Р-5), `months: 12 | 24 | 36`, `lump`
   (взнос «Вложить уже накопленное» на момент выбора, 0 — нет), `forecast: { gain,
   savedInterest, debtFreeMonth }` (снимок на момент выбора, Р-6), `result?: { savedInterest }
   | null` (итог, Р-5). `SyncDoc.plans?: DebtPlan[]`; `Payment.planId?: string` (досрочка по
   плану). `defaultSyncDoc()` → `plans: []`; `known` в `mergeDocs` → `plans: mergeList по id`.
2. **`lib/finance.ts`** (все суммы целые; `key` — месяц по Алматы, Р-16):
   - `activePlan(plans)` — активный с поздним `startedAt` (Р-9: при двух активных после
     слияния побеждает поздний);
   - `pausedGoals(plan, goals)` — живые цели не из `keptGoalIds` и не подушка;
   - `planExtra(plan, goals, credits)` — Σ `monthly` целей на паузе + Σ `payment` кредитов из
     `creditIds`, которые уже закрыты (производный остаток 0, не удалены);
   - `planStep(plan, state, key)` → `{ kind: 'cushion', goalId, amount }` (подушка выбрана и
     `have` < месяца обязательных списаний — `mandatory` из `strategyInputs`; `amount = min(extra,
     mandatory − have)`) · `{ kind: 'prepay', creditId, amount, period: key, applied: Payment |
     null }` (самый дорогой из `costliestCredits`; в месяц старта `amount += lump`; `applied` —
     живая досрочка с `planId` за `period`) · `{ kind: 'done' }` (процентных открытых нет).
     Пропущенные месяцы не накапливаются: шаг всегда за текущий `key` (Р-4);
   - `planForecast(plan, state, key)` — пересчёт от факта: `simulateStrategy` A/B на текущих
     остатках и целях плана → `{ gain, savedInterest, debtFreeMonth }` (дата закрытия
     сдвигается сама);
   - `planFact(plan, payments)` → `{ savedInterest: Σ saved живых досрочек с planId, steps:
     [{ period, creditId, amount }] }`;
   - `planMonths(plan, state, key)` — строки с месяца старта по `key`: `{ period, planned,
     fact }`;
   - `budgetAmounts(state)` принимает `plans?`: d3 без целей на паузе, новое поле `planExtra`,
     `free` вычитает его (сумма «Свободно» не меняется от выбора плана);
   - **Р-11:** `lumpPlan` при платеже ≤ процентов больше не `null`: `{ paid, left, payment (в
     'term' прежний; в 'payment' — прежний, если срок бесконечен), months: Infinity | число,
     monthsBefore: Infinity, saved: 0, openEnded: true }`; при `left === 0` — как сейчас.
     `LumpPlan.openEnded?: boolean`. Капитал показывает при `openEnded` «При текущем платеже
     долг не закрывается — экономию не считаем» вместо «не отдадим банку N» (правка UI — здесь,
     минимально). *(дефолт составителя — владелец согласился 2026-09-25)*
3. **Стор:** геттеры `plans` (`?? []`), `activePlan`; `choosePlan({ keptGoalIds, cushionGoalId,
   months, lump }, by)` — viewer → `null` (Р-12); прежние активные → `cancelled`; снимок
   `forecast`; `cancelPlan()` — `status cancelled`, `endedAt`; `applyPlanStep(by, { accountId?,
   mode = 'term' })` — шаг `prepay` → `applyPrepayment(creditId, by, { amount, mode, accountId,
   planId })` (Р-10; `applyPrepayment` принимает `planId?`); повтор в том же месяце — `null`
   (`applied` уже есть); `settlePlan()` — активный без открытых процентных долгов → `done`,
   `endedAt`, `result.savedInterest = planFact(...)`; два активных → старший `cancelled`.
   `settlePlan` зовётся после `applyPrepayment`, `markPaid`, `unmarkPaid`, `removePrepayment`,
   `updateCredit`, `removeCredit` и после слияния (`syncHousehold` / `pullHousehold`).
4. Всё через `mutateHouseholdDoc`; демо работает локально.
5. **Месяц закрытия долга — одно правило** (хвост §4 критика Блока 1, судьба — владелец
   2026-09-25). Сейчас кредит, закрытый последним плановым «Оплатил», в том же месяце уже
   выпадает из «Кредиты» и «Свободно» (`budgetAmounts`, PV-01: закрыт = производный остаток 0),
   хотя деньги ушли в этом месяце. А «На обязательства» (`monthDues`, правило `creditDueIn`)
   платёж ещё показывает, и Бюджет месяц не сходится. Нужно одно правило в `finance.ts`,
   общее для `budgetAmounts`, `monthDues` и перехода платежа плана в следующий долг:
   - d2 = открытые кредиты + закрытые, у которых есть отметка «Оплатил» в текущем месяце
     (по `creditDueIn`);
   - досрочка на весь остаток ведёт себя как в PV-01 — выпадает сразу, это критерий PV-01.

   Не забыть поправить определение PV-01 в комментарии `openCredits`.

## Тесты

- `lib/finance.test.ts` (п.5): кредит закрыт плановым «Оплатил» в этом месяце → d2 и
  `monthDues` содержат его платёж, «Свободно» сходится с «На обязательства»; в следующем
  месяце его нет нигде; закрыт досрочкой → выпадает сразу (PV-01 не сломан).

- `lib/finance.test.ts`: `planStep` — подушка ниже месяца обязательных → `cushion` с
  `min(extra, недостача)`; подушка полна → `prepay` в самый дорогой; закрыт самый дорогой →
  следующий по ставке и `planExtra` вырос на его платёж; все закрыты → `done`; месяц старта —
  `+lump`; `applied` найден по `planId` и `period`, надгробие не считается. `planForecast` от
  меньшего остатка даёт меньший `debtFreeMonth`. `planFact` — Σ `saved` живых с `planId`, без
  чужих досрочек. `budgetAmounts` с планом: d3 без пауз, `planExtra` = Σ их `monthly`, `free`
  прежний. `lumpPlan` при платеже ≤ процентов → `openEnded`, `paid`/`left` верные, взнос,
  закрывающий долг, → `left 0`, `months 0`.
- `lib/merge.test.ts`: `plans` сливается по id, надгробие, LWW `status`; два документа с
  разными активными → после слияния оба в списке, `activePlan` — поздний; незнакомый клиент
  (RP-02) ключ не теряет.
- `stores/finance.test.ts`: `choosePlan` → `plans` с `forecast`, старый активный `cancelled`;
  `applyPlanStep` → запись `prepay` с `planId`, `mode 'term'`, платёж кредита не изменился;
  повтор в том же месяце — `null`; `cancelPlan` → цели «возобновились» (`pausedGoals` пусто);
  `settlePlan` после досрочки на весь остаток единственного долга → `done` с `result`;
  viewer → `choosePlan` `null`, документ не менялся; граница месяца по Алматы для `period`.
- `e2e/two-clients-sync.test.ts`-подобный сценарий (файл блока): A выбрал план офлайн, B
  выбрал другой офлайн → после синка активен поздний у обоих.

## Критерии приёмки

- `cd frontend && npm run build && npm test` зелёные; тесты выше есть.
- Документ старого клиента (без `plans`) читается и сливается; `resetDoc` шлёт `plans: []`.
- В браузере проверяется в PV-15…PV-17 (здесь UI нет, кроме текста `openEnded` в Капитале).

## Вне скоупа

- UI выбора/паузы/шага/экрана — PV-15, PV-16, PV-17.
- Отбасы в плане — RP-23; «снизить платёж» по LWW — хвост §4 RP.
- Автоматическое пополнение подушки со счёта — нет (шаг `cushion` — подсказка, PV-16).
