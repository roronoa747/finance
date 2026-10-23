# TL-03 — Строка кредита → лист кредита с остатком (фронт)

Блок 1 · MVP · Репо/каталог: `frontend/` · Зависит от: TL-02 · Роли: member · Х-20, Р-3

## Контекст (что уже есть)

- `src/components/AddPaymentSheet.vue` (34 строки): пропсы `{opId: string | null, z? = 70}`; `prefill =
  store.recurringFor(op)` :19; `<NewObligationSheet :open="!!prefill" :prefill>` :32; `created(id)` →
  `store.addToPayments(op.id, id)` + тост «Добавлено в платежи» :22-28. Им пользуются три кнопки «В платежи»: «Нашли в
  выписке» (`MonthPlan.vue:847`, монтаж :1191), лист операции (`OpSheet.vue:127`, :142), лист раздела «Недели»
  (`week/SectionSheet.vue:88`, :105).
- `RecurringPrefill` — `lib/statements/firstRun.ts:251` `{name, amount, day, kind}`; `kind` `credit` — из словаря
  (`sc_credit`). `src/components/capital/NewObligationSheet.vue` **`prefill.kind` игнорирует**: всё становится
  обязательством `d4` («быт») — `createObligation` :87-108.
- Форма кредита — `src/components/capital/NewDebtSheet.vue` (190 строк; монтаж `DebtsWidget.vue:196` «+ Долг»,
  `CapitalLists.vue:398`): пропсы `{open}`, эмит только `close`; поля — «Банку»/«Человеку», имя, «Остаток долга, ₸», «Платёж
  в месяц, ₸», «Проценты» (нет / ставка / срок), «День» (по умолчанию 12); `createDebt` → `financeStore.addCredit({name,
  note, principal, annualRate, payment, day 1..28, person})` (`stores/finance.ts:907`, возвращает id).
- `stores/operations.ts:708` `addToPayments` знает только `kind: 'obligation'` (`markPaid('obligation', …)`, правило
  `{payment: {kind: 'obligation', …}}`). Сопоставление кредита: `matching.ts:89` `matchCategory('credit') → sc_credit`,
  `ruleHit` :110 — кредит ±2 % `creditDueAmount` или ровно `c.payment`.

## Задача

1. `AddPaymentSheet`: при `prefill.kind === 'credit'` открывать `NewDebtSheet` (поверх текущего экрана, тот же `z`) вместо
   `NewObligationSheet`: «Банку», имя, «Платёж в месяц» и «День» заполнены из `prefill`; «Остаток долга» пуст и обязателен —
   его и спрашиваем.
2. `NewDebtSheet`: добавить необязательные пропсы `prefill` (имя, платёж, день) и `z`, эмит `created(id)` после `addCredit`.
   Без пропсов — поведение «+ Долг» как сейчас.
3. `addToPayments` научить кредиту (вид цели параметром): отметка `markPaid('credit', …)` за ближайший период и правило
   `{payment: {kind: 'credit', targetId, categoryId: 'sc_credit'}}` — через тот же путь записи правил, что в TL-02.
4. Тост после создания — «Добавлено в платежи», как у обязательства.
5. Правило 12: главное действие листа — одна кнопка подтверждения во всю ширину (лист-форма); новых карточек на экране нет.

## Тесты

- `src/components/capital/CapitalSheets.dom.test.ts` (NewDebtSheet :181, :211): с `prefill` поля заполнены, без остатка
  кнопка неактивна, `created(id)` эмитится; без `prefill` — как было.
- `src/components/AddPaymentSheet` (новый `AddPaymentSheet.dom.test.ts` или в `MonthPlan.dom.test.ts` :1459): строка вида
  `credit` открывает лист кредита, подписка — лист обязательства.
- `src/stores/operations.test.ts`: `addToPayments` для кредита → `Payment` вида `credit` с `opId`, правило `credit`;
  следующая операция кредита отмечается сама (ярус 0).
- Адаптировать e2e, что ждут кредит как `d4`: `e2e/b2c-block3-first-run-sync.dom.test.ts:126-148` («Оплата Kaspi Кредита» →
  теперь `credits[]` с остатком, не обязательство), проверить `e2e/b2c-block3-screens.test.ts` (`toPayments` :481) и
  `e2e/fb-block5-look.test.ts:343-382`.
- e2e `e2e/tl-block1-found-payments.test.ts`: «нашли» → строка кредита → «В платежи» → остаток → кредит в «Деньгах → Долг» с
  остатком, платёж месяца отмечен.

## Критерии приёмки

- «В платежи» у строки кредита (из «Нашли в выписке», листа операции, листа раздела) открывает лист кредита с платежом и
  днём; после ввода остатка кредит виден в «Деньгах → Долг», платёж отмечен, раздел — «Кредиты».
- Подписки и прочие платежи заводятся как раньше.
- `npm run build && npx vitest run` зелёные; стенд Chrome 390, обе темы: лист кредита поверх «Месяца».

## Вне скоупа

- Кредит человеку из выписки («Человеку») — не делаем (вид `credit` — банковский).
- Пересчёт процентов/срока по выписке — не делаем; остаток вводит человек.
