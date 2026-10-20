# RZ-02 — Находки семьи, сценарий, счётчик, «куда ушло», итог прошлого месяца (`finance.ts`)

Блок 1 · MVP · Каталог: `frontend/src/lib/finance.ts` (+ тест-файл `lib/reviewFindings.test.ts`) · Зависит от: RZ-01 ·
Роли: все (расчёт по общему документу)

## Контекст (что уже есть)

- Правило 6 CLAUDE.md: все числа считает `finance.ts`; целые тенге. Вход расчётов — `planInput(key)` → `{state:
  MonthPlanState, ctx: MonthPlanCtx}` (`ctx.totals` — `SpendTotal[]` с **`ops`** — числом операций, `ctx.uploads`,
  `ctx.spendCategories`, `ctx.key`); `state` — `people, goals, credits, obligations, habitTotals, imageMoves, planShifts,
  goalOrder, moneySettings…` (добавить `reviewFinds` в `MonthPlanState`/`planState()` стора, как `habitTotals`).
- Готовые расчёты: `spendCompare(state, ctx)` :4092 → `rows` (`amount, plan, usual, share, over`), `usualMonths(people,
  totals, uploads, key, n = 3)` :4020 (закрытые месяцы с выписками у всех участников), `monthSpendByCategory` :3964;
  `mainGoal` :3090, `goalPace` :2483, `closerDays` :2493, `goalTerm` :3881, `goalRemaining`; **приватные** `earlierDays(goal,
  key, amount)` :5649 и `measureFor(amount)` :5637 (мерка справочника `lib/prices.ts` по карману сумме) — экспортировать;
  `prepayOutcome(credit, extra, 'monthly')` :332 → `{monthsSaved, saved}`; `habitImages` :5661 / `imageLine` :5751 /
  `yearsMonths` :5742 — образец слов образа; `shiftMade(shifts, draft)` :4286; `stepCandidates` :4329; `monthsLabel`,
  `plural`, `money`, `plain` (`lib/money.ts`).
- Документ: `SyncDoc.reviewFinds` (RZ-01: `ReviewFind {by, period, kind, name, categoryId, count, amount, was?, targetId?,
  top?}`), `SyncDoc.aiReviews` (`aiReviewOf(month)` в сторе; v3-разбор — RZ-05: `advices[{action}]`, `sent.facts[{about,
  value, raw}]`), `obligations` (`amountAt`), `credits`.
- Р-14 (пороги семьи), Р-19 (счётчик), Р-20 (итог прошлого месяца), Р-4 (цифры картинки), Р-5 (4) сценарий.

## Задача

1. Типы и функция **находок семьи** `reviewFindings(state, ctx): ReviewFinding[]`:
   ```ts
   export type ReviewFinding =
     | { kind: 'leak'; name: string; categoryId: string | null; monthly: number; count: number; months: number; yearly: number; image: FindImage | null }
     | { kind: 'grew'; categoryId: string; name: string; amount: number; usual: number; growth: number; yearly: number;
         why: { kind: 'purchases'; items: { name: string; amount: number }[] } | { kind: 'often'; count: number; usualCount: number } }
     | { kind: 'recurring'; name: string; categoryId: string | null; amount: number; count: number; yearly: number }
     | { kind: 'pricier'; name: string; obligationId: string; amount: number; was: number; yearly: number }
     | { kind: 'double'; name: string; categoryId: string | null; amount: number; count: number; yearly: number }
   export type FindImage = { kind: 'dream'; goalId: string; name: string; share: number } | { kind: 'measure'; name: string; price: number }
   ```
   - `leak`: по `reviewFinds` всех живых участников за 3 закрытых месяца до `ctx.key` (`addMonths`), продавец (`key` id)
     с записью `count > 0` в ≥ 2 месяцах; `monthly` = Σ сумм участников за эти месяцы ÷ число месяцев с записью (целое),
     `count` — так же, `yearly = monthly × 12`; `image` — главная мечта с `need > 0` → `share = round(yearly × 100 /
     need)` (как у `habitImages` 'dream'), иначе `measureFor(yearly)` → `{name, price}`, иначе null. Сортировка по
     `yearly`, до 5.
   - `grew`: строки `spendCompare` с `over`; `growth = amount − usual`; `why` — покупки: `top` записей `kind: 'top'` раздела
     за `ctx.key` всех участников, 1–2 крупнейшие, если их сумма ≥ growth / 2; иначе «чаще»: `count` = Σ `SpendTotal.ops`
     раздела за `ctx.key`, `usualCount` = среднее Σ `ops` за `usualMonths`, если `count × 10 ≥ usualCount × 13`; ни то ни
     другое — строки нет (Р-1). `yearly = growth × 12`. Разделы `SPEND_LAST` мимо.
   - `recurring` / `pricier` / `double`: записи `ctx.key` (у `recurring` — и прошлого месяца, если в `ctx.key` ещё нет
     выписки ни у кого — `uploadedBy`), по продавцу — одна (большая сумма), `yearly`: `recurring` — `amount × 12`,
     `pricier` — `(amount − was) × (every === 'year' ? 1 : 12)`, `double` — `amount × (count − 1) × 12`; `recurring`,
     продавец которого уже есть среди обязательств (`normalizeMerchant` имени) — мимо (страховка от гонки с RZ-01).
   Все находки вместе — не больше 12 (`REVIEW_FINDINGS_MAX`), порядок: `grew` по `growth`, затем остальные по `yearly`.
2. **Сценарий** `reviewScenario(state, ctx, findings)` → `{ finding: ReviewFinding; monthly: number; days: number | null;
   goalId, goalName } | { finding; monthly; months: number; saved: number; creditId, creditName } | null`: по находке с
   наибольшим `yearly` среди `leak` / `recurring` / `double`, `monthly = yearly / 12`; есть главная мечта с темпом
   (`earlierDays` > 0) — вариант мечты; иначе есть кредит с процентами — `prepayOutcome(credit, monthly, 'monthly')`
   (кредит — самая высокая ставка, `firstDebt`-подобно); иначе null.
3. **Счётчик** `reviewWork(state, ctx, findings, used: ReviewFinding[] = findings)` → `{ops, found, yearly}` (Р-19):
   `ops` = Σ `SpendTotal.ops` всех участников за `ctx.key` и `usualMonths(…, 3)` (`kind: 'month'`, без надгробий);
   `found = findings.length`; `yearly` = Σ `yearly` у `used`.
4. **«Куда ушло»** `whereRows(state, ctx, n = 5)` → `{categoryId, name, amount, usual, plan, share}[]` — строки
   `spendCompare` без `SPEND_LAST` и без `amount` null, по убыванию `amount`, `share = amount / max(amount, usual, plan)` по
   всем строкам (доля полосы, 0…1); `usual`/`plan` — null, если нет. Текста нет — его пишет модель (RZ-03/RZ-04).
5. **Итог прошлого месяца** `reviewOutcome(state, ctx, prev: AiReview | null)` (Р-20) → `{ done: {title, done: boolean}[];
   sections: {name, amount, usual}[]; dream: {name, was: string, now: string | null} | null } | null`: `prev` — v3-разбор
   месяца `addMonths(key, −1)` (нет — null); `done` — советы с `action.kind === 'do'`: `shiftMade(state.planShifts,
   {...candidate.shift, period: prev.month})`; `sections` — разделы советов `open` с `target.kind === 'cat'` и находок
   `grew` из `sent` (categoryId в `OpenTarget`/фактах): сумма прошлого месяца (`monthSpendByCategory` за `prev.month`) и
   «обычно» сейчас (`usualSpend` за `ctx.key`); `dream` — главная мечта: `was` = `value` факта `sent.facts`, чей `about`
   начинается с «главная мечта» и `raw` — месяц `YYYY-MM`; `now` = `goalTerm(...).doneMonth` → `monthBy`.
6. Экспортировать `earlierDays`, `measureFor`. Шапку-доктрину `finance.ts` (:11-18) дополнить строкой о находках.

## Тесты

- `lib/reviewFindings.test.ts` на `planFamilyDoc` с `reviewFinds` двух участников за 4 месяца и итогами разделов: утечка
  из записей двух участников (среднее по месяцам, образ — доля мечты; без мечты — мерка; 1 месяц из 3 — нет);
  `grew` покупками (две покупки ≥ ½ прироста) и частотой (`ops` ×1,3), без причины — строки нет; `recurring` с
  обязательством того же имени — мимо; `pricier` годовой — `yearly` = разница; `double` — лишнее × 12; лимит 12 и
  порядок; `reviewScenario` — мечта (`days` через `earlierDays`), без мечты — кредит (`prepayOutcome`), без обоих — null;
  `reviewWork` — `ops` за текущий + 3 месяца всех участников, `yearly` только по `used`; `whereRows` — 5 строк, доля
  полосы ≤ 1, `SPEND_LAST` мимо; `reviewOutcome` — «Сделать» сделан / нет, разделы, срок мечты «был/стал»; без v3-разбора
  — null; пустая семья — всё пусто без падений.
- Все числа — целые (проверка `Number.isInteger` по всем полям).

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные.
- На документе демо-семьи (пока без `reviewFinds` демо — RZ-09) `reviewFindings` даёт только `grew` (кафе выше обычного,
  причина — покупки или частота) без падений; на документе стенда с настоящей выпиской (RZ-06) — ≥ 2 находок разных видов.

## Вне скоупа

- Факты и `about` для модели — RZ-03. Отрисовка полос — RZ-08. Карточка итога — RZ-07. Заготовка находок демо — RZ-09.
- Новых действий «Сделать» нет (Р-6); сценарий — только факт для модели и совета «Открыть».
