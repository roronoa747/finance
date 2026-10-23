# FB-07 — «Разовая» в данных: `oneOff` в правках и итогах, без разовых в «обычно», находках, привычках; строка «Разовые» (фронт)

Блок 2 · MVP · Каталог: `frontend/src/lib/statements/types.ts`, `lib/statements/model.ts`, `stores/operations.ts`, `lib/finance.ts`, `lib/statements/finds.ts`, `lib/statements/habits.ts`, `components/money/MonthPlan.vue` · Зависит от: Блок 1 (FB-02 `opEdits`, `editOp`, `spendOf`) · Роли: member (отмечает свои), партнёр (видит строку «Разовые» через итоги), viewer (видит)

## Контекст (что уже есть)

- Р-5, Р-16 (§2). После Блока 1: `OpEdit.oneOff?: boolean` уже в типе, `Operation.oneOff?` накладывается `withEdits`,
  `editOp(id, patch)` пишет правку и пересчитывает итоги; `spendOf(op)`.
- `SpendTotal` (`types.ts:97`) — `amount, ops, unmarked?`; образец «часть суммы отдельным полем» — `unmarked`
  (`spendTotals` `model.ts:377`, `sameTotal` `stores/operations.ts:46`, `spentOf` `finance.ts:1349`).
- Расчёты на итогах: `spentOf` → `monthSpendByCategory` (:3992) → `usualSpend` (:4063) и `spendCompare` (:4120, строки
  `rows`, `unknown`), `spendOver`, `rkShare` (:4179, сырой `t.amount`), `spendSlack` (:4338) → `stepCandidates`,
  `monthPlan` (:3416, `PlanSpend.fact` = Σ `spentOf`), `mySpendOf` (:5094, «Неделя»), `whereRows` (:6120),
  `reviewOutcome`, `reviewFindings` (:5959, `opsOf` по `t.ops`).
- Расчёты на операциях: `leakFinds`/`topFinds` (`finds.ts:96/109`; общий фильтр `sellerOk` :64, у `topFinds` своя
  группировка по `isSpend`), `habitTotals` (`habits.ts:67`), `weekFeed`, `sectionWeek`/`sectionMonth`.
- «Месяц → Траты» — `MonthPlan.vue:706-752`: строки `compare.rows`, тихая строка «Не разобрано» (`data-spend-unknown`,
  без листа) — образец для «Разовые».

## Задача

1. `SpendTotal.oneOff?: number` — сумма разовых (по `spendOf`) внутри `amount`; `spendTotals` считает (`marks` не нужны);
   `sameTotal` сравнивает; старые итоги без поля — 0.
2. `finance.ts`: `spentOf(t, live)` → без разовых (`amount − oneOff`, у разделов платежей — `unmarked` как было; разовая в
   разделе платежей — редкость, считать `unmarked` без разовых не нужно — записать в Handoff); `oneOffOf(t)`; факт месяца
   участника `PlanSpend.fact` и `spendFact` — **с** разовыми (Р-5: входят в факт) — значит `monthPlan` берёт `spentOf + oneOffOf`;
   `spendCompare` возвращает ещё `oneOff` (сумма разовых участников с выпиской месяца) для строки; `usualSpend`,
   `spendOver`, `rkShare`, `spendSlack`, `whereRows`, `reviewOutcome` — без разовых автоматически через `spentOf` (у
   `rkShare` заменить сырой `t.amount`). «Неделя» (`mySpendOf`) — с разовыми (Р-16).
3. Операции: `sellerOk` → `!op.oneOff`; `topFinds` — группировка без разовых; `habitTotals` — без разовых; `reviewFindings`
   `opsOf` — по `t.ops` как есть (счётчик операций, не деньги).
4. `MonthPlan.vue`: тихая строка «Разовые · N» (`data-spend-oneoff`, как «Не разобрано», но нажимаемая) под строками
   разделов, когда `compare.oneOff > 0`; нажатие — лист «Разовые» (`Sheet`): свои разовые операции месяца (имя, сумма,
   день; `sectionMonth` с фильтром `oneOff`), строка → `OpSheet` (снять «Разовая» можно там). У партнёра — своя часть
   строки = его разовые (в его копии); viewer — строка есть, листа нет.
5. Тест на «план не сдвигается»: `spendCompare.advice` и `stepCandidates('move')` не меняются от разовой траты.

## Тесты

- `lib/statements/model.test.ts`: `spendTotals` — `oneOff` в сумме и отдельно; с возвратом — по `spendOf`.
- `lib/spendCompare.test.ts`: разовая 300 000 в «Образовании» — строка раздела без неё, `oneOff` 300 000, «обычно»
  следующих месяцев без неё, `over` нет, `advice` прежний; `rkShare` без неё; `monthPlan().spend.fact` — с ней.
- `lib/statements/finds.test.ts`, `habits.test.ts`, `reviewFindings.test.ts`: разовая не утечка, не верхушка, не привычка,
  не «раздуло».
- `lib/week.test.ts`: сумма недели и лента — с разовой.
- `components/money/MonthPlan.dom.test.ts`: строка «Разовые» → лист → строка → `OpSheet`; без разовых — строки нет.
- Мутанты: `spentOf` без вычета `oneOff`; `sellerOk` без `oneOff`; `fact` без разовых (тест «входит в факт» красный).

## Критерии приёмки

- Разовая трата: факт месяца («потрачено») её содержит, строка раздела — нет, «Разовые» — да; «обычно» следующих месяцев,
  точка «больше обычного», находки и привычки её не видят; «Неделя» — как была.
- `cd frontend && npm run build && npx vitest run` зелёные.

## Вне скоупа

- Чипы и переключатель — FB-08. Разовая в разделах платежей — как обычная (Handoff).
