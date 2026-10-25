# FG-14 — Запись сдвига счёта (`accountShifts`) при взносе, снятии, доходе, покупке мечты (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/src` · Зависит от: Блок 1 принят · Роли: участник (пишет свои сдвиги), viewer (нет)

Хвост **F2-Х1** («Фидбек-2» §4, критик Блока 3): взнос в цель со счёта для трат и «Внеплановый доход» на него двигают остаток
сами; когда тот же перевод приходит выпиской, `spentSince` считает его ещё раз — карта ниже правды до сверки. Связи «сдвиг ↔
строка выписки» нет. Решение — **Р-7** (§2): отдельный блок M, данные без миграций (Р-10).

## Контекст (что уже есть)

- Сдвиг остатка: `financeStore.shiftAccountAmount(id, delta)` `stores/finance.ts:1414-1434` — меняет базу `account.amount` на
  `shiftedBase(x, payments, delta, balanceCtx())` (`lib/finance.ts:1810`), якорь `amountSetAt` не трогает (`amountAnchor(x, {}, t)`),
  работает и для личных счетов (`privateDoc.accounts`), и для счетов семьи. Следа о сдвиге не остаётся.
- Кто зовёт: `views/GoalDetail.vue` `applyDeposit()` :298-318 — взнос `contribute(goal, v, by, note)` + при выбранном счёте
  `shiftAccountAmount(accountId, -v)`; снятие `withdraw` + `shiftAccountAmount(accountId, +v)`; выбор счёта —
  `<Select v-model="depositAccountId">` «Списать со счёта (опционально)» :705-714 (`payableAccounts`). `capital/ExtraIncomeSheet.vue`
  `applyExtraIncome()` :37-48 — либо `contribute(goal)`, либо `shiftAccountAmount(account, +x)`. `markGoalDone` / `undoGoalDone`
  `stores/finance.ts:2102, :2110` — покупка мечты двигает счёт (а покупка потом придёт выпиской обычной тратой). Ещё
  `lib/finance.ts:1799` — проверить, что это (не UI-вызов).
- Взнос в цель — `GoalMovement { id, date, amount (со знаком), by, note?, planId? }` (`types/finance.ts:214-227`) в
  `goal.movements` (`contribute` :2369-2381); полей `accountId`/`opId` нет; записи в `Payment` нет.
- Образец списка в документе семьи «своя запись по id, слияние по id, `Tracked`»: `AccountSpent = Tracked & { id, accountId, by,
  since, amount }` (`types/finance.ts:589`), `householdDoc.accountSpent` :786, слияние `lib/merge.ts:225`
  `mergeList(local, remote, x => x.id)`; личный документ — `mergePrivateDocs` :258+ (`list('notes')` и т. п.).
- Деньги — целые тенге; все числа считает `lib/finance.ts` (правило 6 CLAUDE.md).
- Тесты рядом: `lib/spendBalance.test.ts`, `lib/merge.test.ts`, `views/GoalDetail.test.ts`, `components/capital/*.dom.test.ts`.

## Задача

1. Тип `AccountShift = Tracked & { id: string; accountId: string; amount: number; date: string; by: PersonId; goalId?: string;
   kind: 'goal-in' | 'goal-out' | 'income' | 'done' }` — `amount` со знаком относительно счёта (минус — ушло со счёта,
   плюс — пришло), `date` — ISO-день сдвига, `id` — `as_` + 8 hex. Список `householdDoc.accountShifts?: AccountShift[]`
   (счета семьи) и `privateDoc.accountShifts` (личный счёт — там же, где лежит счёт); слияние по id (`mergeList` в
   `merge.ts`, `mergePrivateDocs` — `list('accountShifts')`), удаление — надгробие.
2. `shiftAccountAmount(id, delta, meta?: { by: PersonId; kind: AccountShift['kind']; goalId?: string; date?: string })` — при
   `meta` и фактическом сдвиге (не ранний `return`) пишет запись в тот же документ, что и счёт. Вызовы без `meta`
   (внутренние, если есть) — без записи. Хелпер `liveShifts(doc)` в `lib/finance.ts` — живые записи.
3. Передать `meta` из `GoalDetail.applyDeposit` (`goal-in` / `goal-out`, `goalId`), `ExtraIncomeSheet` (`income`),
   `markGoalDone` / `undoGoalDone` (`done`; `undo` — надгробие записи `done` той же цели, если она есть, иначе запись с
   обратным знаком).
4. Стор: `financeStore.accountShifts` — computed живых записей обоих документов (для FG-15 и тестов). UI не меняется.

## Тесты

- `lib/merge.test.ts`: `accountShifts` сливаются по id, надгробие побеждает.
- `stores/finance.test.ts` (или рядом с существующими тестами стора): `shiftAccountAmount` с `meta` пишет запись со знаком и
  датой; без фактического сдвига — не пишет; личный счёт → `privateDoc`; `markGoalDone` → `done`, `undoGoalDone` убирает.
- `views/GoalDetail.test.ts`: «Положить» со счётом → `accountShifts` содержит `goal-in` на −v с `goalId`; без счёта — нет
  записи; снятие — `goal-out` на +v.

## Критерии приёмки

- Стенд (семья из двух, `8198`/`5298`): взнос 50 000 с карты → в документе семьи `accountShifts` запись `goal-in` −50 000 с
  сегодняшней датой, остаток карты −50 000 (как раньше); у партнёра после синка запись видна, остаток тот же; viewer записей не
  пишет. Экраны не изменились.
- `cd frontend && npm run build && npx vitest run` зелёные.

## Вне скоупа

- Сопоставление с выпиской и исключение из `spentSince` — FG-15. UI сверки, показ записей на экранах — нет.
- Миграция старых взносов (сделанных до блока) — нет; они останутся как есть до ближайшей сверки счёта.
