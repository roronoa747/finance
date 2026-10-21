# FB-11 — Расчёты по одному участнику: `by` у `spendCompare` / `usualSpend` / `monthSpendByCategory` / `rkShare`; строки участников (фронт, lib)

Блок 3 · MVP · Каталог: `frontend/src/lib/finance.ts`, `lib/spendCompare.test.ts`, `lib/monthPlan.test.ts` · Зависит от: Блок 2 (`spendCompare.oneOff`, `spentOf` без разовых) · Роли: расчёт для member, партнёра и viewer

## Контекст (что уже есть)

- Р-7, Р-18, Р-22 (§2); матрица §3. Сейчас «Траты в сравнении» — семья целиком (Р-5 «ИИ-польза»: «участников не сравниваем»):
  `monthSpendByCategory(people, totals, categories, key, uploads)` (`finance.ts:3992`) суммирует итоги всех участников с
  выпиской месяца (`uploadedBy`); `usualMonths` (:4048, месяц полный у **каждого** участника с итогами) → `usualSpend` (:4063);
  `spendCompare(state, ctx)` (:4120) → `rows` семьи, `plan` = Σ планов участников, `unknown`, (после Блока 2) `oneOff`;
  `rkShare(state, ctx, group)` (:4179) — по участникам с выпиской; `spendPlansBy(plan, people, categoryId)` (:4195) —
  план каждого по разделу; `whereRows` (:6120) и `reviewFindings` (:5959) зовут `spendCompare` — **семейный разбор
  остаётся семейным** (Р-18).
- Строка «план · факт» участника уже есть: `monthPlan(state, ctx).spend` → `PlanSpend {by, plan, fact, rows}` (:3288,
  :3458-3476; `fact` — Σ `spentOf` по итогам участника при `uploadedBy`, иначе null; с Блока 2 — с разовыми).
  `spendFact(spend)` (:3982) — сумма фактов.
- `MonthPlanCtx` — `uploads`, `totals`, `spendCategories`, `key`, `byFact?`; `state.people`.

## Задача

1. `monthSpendByCategory`, `usualMonths`, `usualSpend`, `spendCompare`, `rkShare` получают необязательный `by?: PersonId`:
   с `by` — только итоги и загрузки этого участника (`usualMonths` — его полные месяцы; `uploadedBy(by)`; `plans` — только
   его строки плана; `unknown`/`oneOff` — его). Без `by` — как было (разбор ИИ, `whereRows`, тесты прежние).
   `SpendCompareRow` без изменений; `spendCompare` с `by` возвращает ещё `mine: {plan, fact} | null`? — нет: строки
   участников берутся из `monthPlan().spend`, здесь лишнего не добавлять.
2. `participantLines(plan: MonthPlan, people: Person[]): {by, name, plan, fact: number | null}[]` — по `plan.spend`, свой
   первым (`me` передаёт экран), участник без строк и факта — не показывается (как фильтр `monthPlan`). `fact` с разовыми
   (входят в факт, Р-5).
3. `spendPlansBy` — без изменений (FB-12 вызовет для своего участника).
4. Документировать в JSDoc: «семейные» вызовы (без `by`) — только отчёт ИИ и `whereRows`; экраны — с `by`.

## Тесты

- `lib/spendCompare.test.ts`: семья из двух с разными разделами — `spendCompare(…, by: 'a')` содержит только разделы `a`,
  `plan` = план `a`, `usual` — по полным месяцам `a` (месяц, полный только у `b`, не в счёт), `unknown`/`oneOff` — `a`;
  без `by` — прежние ожидания не изменились; `rkShare` с `by`.
- `lib/monthPlan.test.ts`: `participantLines` — порядок, факт null без выписки, факт с разовыми, участник без плана и факта
  отсутствует.
- Мутанты: `by` игнорируется в `usualMonths` (месяц партнёра засчитан); `plans` не фильтруется.

## Критерии приёмки

- Все расчёты экрана «Траты» доступны по одному участнику; семейные вызовы не изменились (тесты разбора зелёные без правок).
- `cd frontend && npm run build && npx vitest run` зелёные.

## Вне скоупа

- Экраны — FB-12. Отчёт ИИ — не трогать (Р-18, вопрос владельцу в FB-14).
