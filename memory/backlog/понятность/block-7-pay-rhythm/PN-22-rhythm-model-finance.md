# PN-22 — Модель и расчёты ритма зарплаты и плавающего дохода (фронт)

Блок 7 · MVP · Репо/каталог: `frontend/src/types/finance.ts`, `lib/finance.ts`, `stores/finance.ts` · Зависит от: Блок 6 🏁 (`capitalStats` — Блок 2) · Роли: —

## Контекст (что уже есть)

- `Person` (`types/finance.ts:22-50`): `salary` (оклад по умолчанию), `salaryVersions?: ObligationVersion[]` (версии с
  месяца, валюта на версии — `salaryOf(p, key) → { amount, currency, rate? }` :963), `payday` (1–28; день 31-го в
  коротком месяце — последний, `dayIn`), `onboardedAt`, `emoji`, `color`. `paydayIso(p, key)` (:972).
- Отметка «пришла» — `Payment kind: 'salary'` (`types:318-369`): `targetId` = участник, **`period` = месяц `YYYY-MM`**,
  `amount` (тенге), `foreign?/currency?`, `source`, `opId`, `at`. Одна на пару (участник, период): `countedPayments`
  (:1353-1367) схлопывает по ключу `kind:targetId:period`; `paidFor(payments, 'salary', id, period)` (:1370).
  Стор: `markSalary(personId, { period?, amount?, foreign?, accountId?, source?, opId?, at? })` (`stores/finance.ts:
  1372-1396`, идемпотентна по (участник, период)), `editPaid`, `unmarkPaid(kind, targetId, period)`.
- Доход месяца: `monthPlan` (:3094-3100): на участника `paidFor(…, key)` → `paidTenge(state, id, key, rec)`
  (:1455), иначе `salaryTenge(p, key, ctx).tenge` (:1019); `totalIncome` (:1090); `salaryAt` (:980).
- «Ждёт отметки»: `salaryOpen(p, payments, period, now)` (:1851-1857 — день настал или ≤ `SALARY_EARLY_DAYS` 3, не
  отмечена; следующий месяц — только в окне); `salaryAsk` (:1865); **`untilPayday(state, now)`** (:1747-1833 —
  слоты по людям и месяцам `PAYDAY_HORIZON` 3, ближайшая непришедшая, `inDays`, платежи до неё, `shortfall`).
- Строки зарплат: `monthSalaries(plan, state, now) → SalaryLine[]` (:3236-3258; `payday`, `left`, `foreign`, `fx`,
  `at`, `open`). Прошлые месяцы — `monthPlanPast` (`came`, `cameBy`), `historyMonths`.
- Выписка: `lib/statements/matching.ts:245-253` (кандидат зарплаты: `nearestPeriod(op.date, p.payday)` :50-59, окно
  `SALARY_WINDOW` 7 дней, ±`SALARY_TOLERANCE` 10 % от `salaryTenge`), `ruleHit` (:83-104), стор операций
  `markByOperation` (`operations.ts:170-173` → `markSalary(..., { period, … })`); первый запуск
  `lib/statements/firstRun.ts` `detectIncome` (:97), `salaryOpOfMonth` (:133) — **PN-24**.
- Слияние: поля записи `Person` — LWW по `updatedAt` (`mergeList`), новые поля регистрировать не нужно.
- Р-5: ритм — раз в месяц (как сейчас) · аванс + зарплата (два дня, две суммы) · каждую неделю (день недели, сумма за
  неделю); план, «до зарплаты», «Пришла», выписка — по ритму; поля необязательны, старые документы — «месяц». Р-6:
  плавающий — «Пришла» всегда спрашивает сумму; план — среднее трёх последних приходов, пока их нет — оклад.

## Задача

1. **Типы** (Р-21): `Person.payRhythm?: 'month' | 'advance' | 'week'` (нет — `month`), `payday2?: number` (день аванса,
   1–28), `salary2?: number` (аванс — в валюте оклада; остаток `salaryOf − salary2` приходит в `payday`), `weekday?:
   1..7` (ISO, понедельник 1), `floating?: boolean`. Оклад при `week` хранится **за неделю** (`salary`/версии —
   сумма за неделю).
2. **`payEvents(p, key, now?)`** в `finance.ts` — приходы месяца по ритму:
   ```ts
   export type PayEvent = { period: string; day: string /* ISO */; amount: number /* валюта оклада */; currency: Currency; kind: 'salary' | 'advance' | 'week' }
   ```
   `month` → один, `period = key` (как сейчас — старые отметки действуют), `day = paydayIso`; `advance` → `[{ period:
   'YYYY-MM-DD' дня аванса, amount: salary2, kind: 'advance' }, { period: 'YYYY-MM-DD' дня зарплаты, amount: salaryOf −
   salary2, kind: 'salary' }]`; `week` → по одному на каждый `weekday` месяца (`period` = ISO дня, `amount` =
   `salaryOf`). **`period` у не-месячных ритмов — ISO-день события** (уникален, `countedPayments` не схлопывает
   соседние недели; `periodMonth(period) = period.slice(0, 7)`). `salaryMonthly(p, key)` = Σ `amount` событий (в
   валюте) — ею заменить прямые `salaryOf` там, где нужен **месячный** оклад: `salaryTenge` (:1019 — тенге события по
   курсу его дня, сумма), `salaryAt`, `totalIncome`, `fxYearDelta`/`paydayRates` (курс дня — первого события).
3. **Отметки по событиям:** `salaryRecords(payments, p, key)` — `paidFor` по каждому `event.period`;
   `monthPlan` доход участника = Σ (запись ? `paidTenge` : ожидаемое событие); `came` = все события отмечены;
   `PlanIncome` += `events: { period, day, amount, came, open }[]`, `cameCount`, `eventCount`. `monthSalaries`:
   `open` = есть открытое событие; `payday` — день ближайшего неотмеченного (или первого). `untilPayday`: слоты —
   события всех людей в горизонте, ближайшее неотмеченное; `salaryOpen(p, payments, period, now)` — по событию
   (`period` события; окно 3 дня до его дня). `salaryAsk` — то же через `untilPayday`. Прошлые месяцы
   (`monthPlanPast.came`) — «пришла», если хотя бы одно событие отмечено; `cameBy` — по первому.
4. **Плавающий доход (Р-6):** `expectedSalaryTenge(p, key, ctx, payments)` — `floating` → среднее `amount` трёх
   последних отметок `kind: 'salary'` участника (по `at`, целое; меньше трёх — среднее имеющихся; нет — оклад события);
   для `week`/`advance` — среднее по тому же `kind` события. Использовать в доходе плана, `untilPayday.income`,
   `monthSalaries` (`amount` ожидаемого); `salaryTenge` остаётся «по окладу» (формы, курс).
5. Стор: `setPerson(id, patch)` (:760) принимает новые поля; `markSalary` — `period` события (как сейчас — параметр);
   `correctSalary`/`amendSalary` — без изменений (оклад события или недели). Старые документы без полей — ритм
   `month`, числа прежние (тест).

## Тесты

- `lib/rhythm.test.ts` (новый): `payEvents` — месяц (один, `period = key`), аванс (два, суммы, дни), неделя (4 или 5
  событий по месяцам 2026-10 / 2026-11, `weekday` 5 → пятницы), 31-е в коротком месяце; `salaryMonthly` недели = n ×
  оклад; `salaryTenge` валютной недельной — по курсам дней.
- `monthPlan.test.ts`: доход при двух из четырёх отмеченных недель = 2 факта + 2 ожидания; `came` только при всех;
  `SalaryLine.open` при открытом событии; старый документ (без ритма) — прежние числа до тенге.
- `finance.test.ts`: `untilPayday` — ближайшее событие недели (`inDays`), аванс после 15-го → остаток зарплаты;
  `salaryOpen` по событию; плавающий — среднее трёх отметок, две — среднее двух, ноль — оклад.
- `merge.test.ts`: новые поля `Person` сливаются по записи.

## Критерии приёмки

- Все числа — `finance.ts`, целые тенге. `cd frontend && npm run build && npx vitest run` зелёные; гвард
  `router/legacy.test.ts` цел.

## Вне скоупа

- Формы и лист — PN-23; выписка и полоска — PN-24. Несколько источников дохода — после MVP (Р-6).
