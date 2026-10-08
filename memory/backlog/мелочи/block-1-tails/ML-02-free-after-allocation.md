# ML-02 — «Свободно» уменьшается после раскладки (фронт)

Блок 1 · MVP · Репо/каталог: `frontend/src/lib`, `frontend/src/components/money` · Зависит от: ML-01 · Роли: member, viewer

## Контекст (что уже есть)

Хвост §4 `идея-и-редизайн` **951** (жив, сверено 2026-10-08):

- `freeByFact(state, totals, spendCategories, key, uploads=[]): FreeByFact` — `lib/finance.ts:4124-4155`; формула
  `income - dues - goals - spent` (:4153), `goals = amounts.d3 + amounts.planExtra`. В `state` поля `allocations` нет —
  разовые взносы в цели и досрочка из зарплаты/остатка «Свободно» не уменьшают («600 000 → Япония» — сумма прежняя).
- `Allocation` (`types/finance.ts:471-488`): `source: 'salary'|'rest'|'freed'`, `kind?: 'breakdown'|'plan'`,
  `parts: AllocationPart[]` (breakdown — `ArticleKey`, plan — `goalId` или `prepay:<creditId>`). Поиск —
  `allocationFor(state.allocations, {source, sourceId, period})` (finance.ts:2042, 3179, 4247).
- Вызов: `components/money/MonthPlan.vue:160`; тесты — `lib/finance.test.ts:2436+`, `stores/operations.test.ts:443/552/585`.

## Задача

1. `freeByFact` принимает `allocations?: Allocation[]` (старые вызовы без поля работают как раньше).
2. Вычитать части живых (`!deletedAt`) раскладок месяца `period===key` с `source` salary или rest, **кроме** части
   `life` (уже в тратах) и кроме `source:'freed'` (уже в плане через взносы). Часть, уже учтённая плановым взносом
   цели месяца (`d3`/`planExtra`), не вычитается второй раз — правило учёта записать комментарием в коде.
3. Передать `allocations` из всех вызовов (`MonthPlan.vue:160` и др. — `grep -n "freeByFact(" frontend/src`).

## Тесты

- `finance.test.ts`: раскладка зарплаты 600 000 в цель → «Свободно» −600 000; часть `life` не вычитается; `freed` не
  вычитается; удалённая раскладка не вычитается; другой месяц не влияет; двойного счёта с плановым взносом нет.
- Мутация: убрать вычет → тест красный (откат копией файла).

## Критерии приёмки

- На стенде: разложил остаток в мечту → «Свободно» в плане месяца уменьшилось ровно на эту часть.
- Деньги — целые; считает только `finance.ts`. `npm run build && npx vitest run` зелёные.

## Вне скоупа

- Плановые разделы без отметки (952/967) — ML-03.
