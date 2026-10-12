# PN-24 — Выписка и план по ритму; «зарплат» в статистике Капитала (фронт)

Блок 7 · MVP · Репо/каталог: `frontend/src/lib/statements/matching.ts`, `lib/statements/firstRun.ts`, `lib/finance.ts` (`capitalStats`), `stores/operations.ts` · Зависит от: PN-23 · Роли: member

## Контекст (что уже есть)

- Поиск прихода в выписке — `lib/statements/matching.ts`: `matchCandidates(ops, state, rules, me)` (:177-267);
  зарплата (:245-253): `op.amount > 0`, `kind` `transfer-in | income`, только свой участник (:188), `nearestPeriod(op.date,
  p.payday).gap ≤ SALARY_WINDOW` (7 дней; :50-59 — прошлый/этот/следующий месяц), сумма в ±`SALARY_TOLERANCE` 10 % от
  `salaryTenge(p, period, ctx).tenge`; вопрос «Это зарплата {имя}?»; `ruleHit` (:83-104) — по правилу семьи без окна
  дат. Отметка — `markByOperation` (`operations.ts:170-173` → `markSalary(targetId, { period, amount, accountId: null,
  source: 'statement', opId, at })`), `acceptMatch` пишет правило. Пары, уже отмеченные, пропускаются (:260).
- Первый запуск — `firstRun.ts`: `detectIncome(ops)` (:97 — регулярный ±15 % ≥ 2 раз или крупный ≥ 50 %),
  `salaryOpOfMonth` (:133, `SALARY_TOLERANCE`), `IncomeCandidate` (:14-27).
- Блок 2 `capitalStats` (PN-04): `debtFree.salaries = months`, `overpay.salaries = inSalaries(amount, income.total)`
  — «зарплата» = месячный доход семьи.
- PN-22: `payEvents(p, key)` (события с `period` ISO-дня для не-месячных ритмов), `expectedSalaryTenge`,
  `periodMonth`.
- Р-5: «поиск прихода в выписке считает по ритму».

## Задача

1. `matching.ts`: кандидат зарплаты — по **ближайшему событию** `payEvents` (месяцы прошлый/этот/следующий):
   `nearestEvent(op.date, p) → { event, gap }`, окно `SALARY_WINDOW`; сумма — ±10 % от тенге события
   (`expectedSalaryTenge` для плавающего: ±30 % — `SALARY_FLOATING_TOLERANCE`); `period` кандидата = `event.period`;
   вопрос: `advance` — «Это аванс {имя}?» / «Это зарплата {имя}?», `week` — «Это зарплата {имя} за неделю?».
   `ruleHit` для правила зарплаты — ближайшее событие без окна. `markByOperation` — `period` события. Пропуск уже
   отмеченных пар — по `event.period`.
2. `firstRun.ts`: `detectIncome` без изменений (предлагает месяц); если найденный приход повторяется еженедельно
   (≥ 3 раза с шагом 7 ± 1 день) — `IncomeCandidate.rhythm: 'week'` и `weekday`, карточка «Это ваш доход?»
   (`Start.vue`, PN-23) подставляет ритм «каждую неделю» и недельную сумму. Аванс не определяем (руками).
3. `capitalStats` (PN-04): `debtFree.salaries` и `overpay.salaries` остаются «месячных доходов» — единица не
   меняется (слово «зарплат» на экране оставить; если `/ux` сочтёт сбивающим при недельном ритме — «месяцев дохода»);
   доход месяца уже по ритму через `monthPlan` — проверить тестом, что недельный оклад даёт доход × n.
4. «Неделя» → вопросы (`decisionQueue`, `finance.ts:4270`, карточка зарплаты :4291 «Да, зарплата / Нет / Потом») —
   тексты по п. 1.

## Тесты

- `matching.fx.test.ts`/`matching.test.ts`: недельный ритм — операция в пятницу ±7 дней → кандидат с `period`
  ISO-дня этой пятницы, следующая неделя — свой кандидат (не схлопывается); аванс 15-го → «аванс», сумма `salary2`;
  плавающий — ±30 %; уже отмеченное событие — пропуск; правило семьи — по ближайшему событию.
- `firstRun.test.ts`: четыре прихода по пятницам → `rhythm: 'week'`, `weekday: 5`; месячный — как прежде.
- `capitalStats.test.ts`: недельный оклад 150 000 × 5 пятниц → доход 750 000, `overpay.salaries` от него.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные; стенд с Go: загрузить выписку семьи с еженедельными
  приходами (фикстура `secrets/statements` при наличии или синтетическая) → вопросы по неделям, отметки по событиям.

## Вне скоупа

- Пуш в день зарплаты — Блок 5 B2C. Переводы партнёру — хвост «перевод партнёру» (`matchPerson`), не здесь.
