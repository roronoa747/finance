# FB-09 — «Добавить в платежи»: повтор продавца, `prefill` у «Регулярного платежа», отметка и правило (фронт)

Блок 2 · MVP · Каталог: `frontend/src/lib/statements/firstRun.ts`, `lib/finance.ts`, `components/OpSheet.vue`, `components/week/SectionSheet.vue`, `components/money/SpendCategorySheet.vue`, `components/capital/NewObligationSheet.vue`, `stores/operations.ts`, `views/Week.vue`, `components/money/MonthPlan.vue` · Зависит от: Блок 1 (OpSheet) · Роли: member; viewer — нет

## Контекст (что уже есть)

- Р-6, Р-17 (§2). Скриншот владельца — лист раздела «Подписки» на «Неделе» со строкой APPLE.COM BILL: «предложение
  добавить сразу». «Подписки · N» на «Деньгах» (`CapitalLists.vue`) — это уже заведённые обязательства, не списания.
- Повтор продавца: `detectRecurring(ops)` (`firstRun.ts:184`) → `RecurringCandidate {key, name, amount (медиана), day
  (медиана), count, kind, categoryId, budget, opIds}` — ≥ 2 списания ±5 % и ±3 дня за всё, что передали; словарные виды
  (`KIND_BY_CATEGORY` :62 — подписки, связь, коммуналка, кредиты, аренда) — с одного; ключ группы — `groupKey` :82.
- Образец «записать повтор как платёж + отметить месяц + правило» — `views/Start.vue:343-371 answerRecurring`:
  `financeStore.addObligation({name, note, day, category: BUDGET_BY_KIND[kind], amount, estimate})` → `paymentOpOfMonth` →
  `markPaid('obligation', id, slot, {period, amount, source: 'statement', opId, at: operationAt(...)})` →
  `ops.recategorize(ruleMatchOf(op), {payment: {kind, targetId, categoryId: matchCategory(...)}})`.
- Форма — `components/capital/NewObligationSheet.vue`: пропы `open, people?, housing?`, поля «Что оплачиваем», «Как часто»,
  валюта, сумма, день (`'10'`), «Чья», «сумма плавает»; `createObligation()` → `addObligation` (id не отдаёт), `emit('close')`.
- Отметки: `finance.markPaid` (`stores/finance.ts:1457`), `paidFor`, `matchCategory` (`matching.ts:89`: d4 подписка →
  `sc_subscriptions`); правило платежа применяется `reapply`/`paymentFits`; «Отмечено по выписке» — `lastAutoMarked`.
- Пересечение: «ИИ-польза» Блок 4 AU-17 планирует «Нашли · K» + «Добавить» в «Деньгах» через тот же `NewObligationSheet` с
  заполнением — здесь делается `prefill`, там останутся метки и имена от ИИ (Р-17; критик пишет строку в их промпт).

## Задача

1. `recurringOf(op, ops, today)` в `firstRun.ts`: кандидат `detectRecurring` по своим операциям за 3 месяца, в чей `groupKey`
   входит `op` (или `op` — единственное списание словарного вида); null, если у продавца уже есть правило платежа
   (`ruleFor` → `payment`) или живая отметка этой операции (`payments.opId`). Возвращает `{name, amount, day, kind}`.
2. `NewObligationSheet`: проп `prefill?: {name: string; amount: number; day: number; kind?: RecurringKind}` — при открытии
   поля заполнены (имя — редактируемое поле, как сейчас), «Как часто» месяц, валюта ₸; событие `created(id)`
   (`createObligation` эмитит id перед `close`). Без `prefill` — как было.
3. `OpSheet`: чип «В платежи» в ряду тихих чипов, когда `recurringOf(op) !== null` (у операции без повтора — нет);
   нажатие → `NewObligationSheet` с `prefill` поверх (`z` 70); `created(id)` → стор операций `addToPayments(op, id)`:
   `markPaid('obligation', id, me, {period: месяц операции (`nearestPeriod` по дню), amount: |op.amount|, source:
   'statement', opId: op.id, at: operationAt(op.date)})` + `recategorize(ruleMatchOf(op), {payment: {kind: 'obligation',
   targetId: id, categoryId: matchCategory('obligation', o)}})`; тост «Добавлено в платежи» (Toast `Week`/`MonthPlan`).
4. Строки листов раздела для разделов `plannedElsewhere` («Недели» `SectionSheet`, «Месяца» `SpendCategorySheet`): у строки
   без отметки с `recurringOf` ≠ null — небольшая тихая кнопка «В платежи» (`secondary sm`) у суммы (правило 12: действие
   у своего предмета) → тот же лист с `prefill`. Данные: `sectionWeek`/`sectionMonth` строки получают `recurring?:
   {name, amount, day}` (считает `finance.ts` по `recurringOf`; `ops` — `store.shown`).
5. Повтор продавца, уже заведённый (есть правило платежа), — кнопки нет; следующая выписка отмечает платёж сама
   (`autoMark`), «Отмечено по выписке: N».

## Тесты

- `lib/statements/firstRun.test.ts`: `recurringOf` — две строки APPLE.COM BILL ±3 дня → кандидат; одна строка словарного вида
  (`sc_subscriptions`) → кандидат; продавец с правилом платежа → null; операция с отметкой → null.
- `components/capital/NewObligationSheet.dom.test.ts`: `prefill` заполняет, имя меняется («Apple Music»), `created(id)` с
  суммой/днём из `prefill`; без `prefill` — как было.
- `stores/operations.test.ts`: `addToPayments` → обязательство d4, отметка месяца этой строкой, правило по продавцу, строка
  ушла из трат раздела (`unmarked`), следующая загрузка с тем же продавцом отмечает сама (`lastAutoMarked` 1).
- `views/Week.dom.test.ts`: лист «Подписки» → кнопка «В платежи» у APPLE.COM BILL → лист → «Сохранить» → «Подписки · N» на
  «Деньгах» +1, строки в разделе недели больше нет.
- Мутанты: `recurringOf` не смотрит правило платежа (кнопка у заведённого); `created` без id; отметка без `opId`.

## Критерии приёмки

- У повторяющегося списания в листе операции и в листе раздела платежей — «В платежи»; лист открыт с суммой, днём и именем
  (имя меняется), одно «Сохранить» → платёж в «Деньгах» (подписка), месяц отмечен этой строкой, строка не трата,
  следующие строки отмечаются сами. Путь: строка → «В платежи» → «Сохранить» = 2 нажатия (+ правка имени).
- Правило 12: кнопка небольшая, у строки; в листе операции — чип; в «Деньгах» ничего нового.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд 390 px, обе темы, выписка владельца (APPLE.COM BILL или
  аналог) — в Handoff без сумм.

## Вне скоупа

- Имена от ИИ, «подорожала», «нашли · K» в «Деньгах» — AU-15…AU-18 «ИИ-польза». Кредиты и аренда через этот путь — вид
  всегда «Подписка» (d4); иное — через «Деньги», как сейчас.
