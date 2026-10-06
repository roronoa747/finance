# B2C-99 — Расчёты «Денег» в `finance.ts`: цели в счетах, обзор долгов, месяцы «Истории», зарплаты месяца (фронт)

Блок 16 · MVP · Репо/каталог: `frontend/src/lib/finance.ts` (+ тесты рядом) · Зависит от: Блок 15 🏁 · Роли: —

## Контекст (что уже есть)

- `netWorth` (`finance.ts` ~1252) = счета + `goalSavings` (цели **без** `accountId`, `have` ≥ 0) − остатки кредитов.
- Доход месяца по участникам — `monthPlan(...).income.byPerson` (`PlanIncome`: пришла ли, сумма); строки зарплат
  «Месяца» собирает `MonthPlan.vue` (`salaries`, ~143: `paidFor`, `atLabel`, `salaryOf`).
- Долги: `creditOutlook` (~292), `planForecast` (~2508), `activePlan` в сторе; отметки платежей кредита несут
  `principal` (погашенная часть тела). Исходной суммы кредита в документе нет.
- Сводка месяца — `monthPlanPast` (~3569: `left`, `put`); первый месяц данных — `historyStart`.
- Решения: Р-108…Р-112, правило 6.

## Задача

1. `capitalGoals(goals, accounts)` → `{ count, total, items: { goalId, name, amount, accountName: string | null }[] }`:
   живые цели с `have > 0`; `total` — только цели вне счетов (= `goalSavings`); цели со счётом — с `accountName`.
2. `debtsOverview(state, key)` → `{ total, freeMonth: string | null, rows: { creditId, name, payment, rate, endMonth,
   left, paidShare: number | null }[] }`: `freeMonth` — с активным планом «Сначала долги» его прогноз, без — последний
   месяц закрытия по графикам; `paidShare` = тело из отметок / (остаток + оно), `null` — отметок нет.
3. `historyMonths(state, key, max = 12)` → `{ key, left, put }[]` от прошлого месяца назад, не раньше первого месяца
   данных; числа — из `monthPlanPast` (одна функция с «Месяцем»).
4. Строки зарплат месяца — одна функция для «Месяца» и «Капитала» (вынести сборку из `MonthPlan.vue`), чтобы экраны
   не собирали их каждый сам.

## Тесты

- `capitalGoals`: цель на счёте не входит в `total`; `total` = `goalSavings`; счета + `total` − кредиты = `netWorth`.
- `debtsOverview`: план есть / нет — разный `freeMonth`; `paidShare` на ручном расчёте; без отметок — `null`.
- `historyMonths`: числа = `monthPlanPast` того же месяца; граница — первый месяц данных; не больше `max`.
- Строки зарплат: «Месяц» после выноса — те же строки (регрессия `MonthPlan.dom.test.ts`).
- Мутация хотя бы одной функции ловится тестом (откат копией файла).

## Критерии приёмки

- `npm run build && npm test` зелёные; экраны (B2C-100…B2C-102) берут числа только отсюда.

## Вне скоупа

- Перекладка денег между целями, «↑ N за месяц» у капитала, исходная сумма кредита (поля нет — не заводим).
