# AU-23 — Части покупки в итогах, «Неделе», «Истории» (фронт)

Блок 6 · MVP · Каталог: `frontend/src/lib/statements/types.ts`, `lib/statements/model.ts`, `stores/operations.ts`, `types/api.ts`, `lib/finance.ts`, `components/week/SectionSheet.vue`, `components/money/HistorySquare.vue` · Зависит от: AU-22 · Роли: member (свои операции), партнёр (итоги)

## Контекст (что уже есть)

- Р-10: итоги, «Неделя», «История» считают части. Операции — личные; партнёр видит только итоги (`spendTotals` общего
  документа).
- `Operation` (`lib/statements/types.ts`, интерфейс с `categoryId: string | null`), провод — `OperationWire`
  (`types/api.ts:103-116`), `toWire` / `fromWire` (`stores/operations.ts:79, 95`).
- Итоги по разделам — `spendTotals(ops, by, kind, period, at, marks)` (`lib/statements/model.ts:282-304`, одна операция →
  один раздел), пишет `writeTotals` (`stores/operations.ts:355-383`). Лист раздела «Недели» — `sectionWeek(ops, {week,
  categoryId})` (`lib/finance.ts:4614`); «История» — `historyFeed` (:2393), `historyCategories` (:2430), лист операции
  «<продавец> — куда отнести?» (`HistorySquare.vue:291-297`, `CategoryChips` → `recategorize`). Правила продавцов
  (`applyRules`, `recategorize`, `stores/operations.ts:163, 497`) переписывают `categoryId` операций.
- Поездка — `tripOps` / `writeTripTotals` (по датам, не по разделам).

## Задача

1. `Operation.parts?: { categoryId: string; amount: number }[] | null` (сумма частей = |amount|), провод `parts`
   (`category_id`, `amount`).
2. `spendTotals`: операция с частями даёт по части в каждый раздел (сумма и `ops` += 1 на раздел); `unmarked` у разделов
   платежей — по части. `sectionWeek` — операция в разделе части суммой части; `historyCategories` и фильтр «Истории» —
   по разделам частей.
3. Правила продавцов и `recategorize` **не трогают** операцию с частями (части — решение человека по этой покупке);
   «куда отнести?» у такой операции заменяется видом частей (список «раздел · сумма») с «Убрать разделение» (части →
   `null`, раздел — прежний `categoryId`).
4. Стор: `splitOperation(id, parts)` / `unsplitOperation(id)` → пересчёт итогов периода (`writeTotals(periodsOf([op]))`)
   → отправка, как у `recategorize`.

## Тесты

- `model.test.ts`: покупка 10 000 = 6 000 Продукты + 4 000 Дом → итоги двух разделов; без частей — как раньше.
- `finance` `sectionWeek` / история: операция с частями — в обоих разделах суммой части.
- Стор: `splitOperation` → итоги в документе; правило продавца не перезаписывает части; `unsplit` возвращает раздел.
- Провод: `toWire`/`fromWire` с частями и без.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные (регрессия «Недели» и «Истории»).

## Вне скоупа

- Чек и ручка — AU-24, AU-25. Ручной ввод частей без чека — только через лист чека (AU-25).
