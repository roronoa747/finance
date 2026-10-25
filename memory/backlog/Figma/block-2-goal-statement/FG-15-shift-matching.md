# FG-15 — Сдвиг ↔ строка выписки: пара не считается тратой второй раз (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/src` · Зависит от: FG-14 · Роли: участник (свои операции), viewer (нет)

## Контекст (что уже есть)

- Потрачено со счёта для трат: `spentSince(ops, marked, anchor)` `lib/finance.ts:1651-1662` — операции после якоря, кроме
  `marked`; списание: `o.internal ? -o.amount : spendOf(o)`, приход — минусом; возвраты (`refund.opId`) не дублируются. Вклад
  в остаток — `spentOn(a, ctx)` :1665-1672 → `accountBalance` :1695-1706.
- Пишет `writeAccountSpent(marked)` `stores/operations.ts:476-498` (запись `AccountSpent` `<счёт>:<я>`, нетто своих операций
  после якоря); зовут `writeTotals` :458 и наблюдатель :1150. `marked` = `totalMarks(list).marked` :636-638 =
  `markedOps(list, matchState(), merchantRules, me(), declined)` — **тот же набор идёт в итоги разделов** (`SpendTotal.unmarked`),
  поэтому пару «сдвиг ↔ строка» в него класть нельзя: покупка мечты — настоящая трата раздела, из итогов разделов её
  исключать неправильно.
- Сопоставление — `lib/statements/matching.ts`: `DAY_WINDOW = 5`, `AMOUNT_TOLERANCE = 0.02` :36-47, `within()` :49;
  `markedOps` :180-191 (живые `Payment.opId` + кандидаты `matchCandidates` без отклонённых); цели и депозиты среди целей
  сопоставления нет. Дубли телефон ↔ выписка — `lib/statements/phone.ts:44` `replacementPairs` (та же сумма, дата ±1 день,
  продавец) — внутренние строки (`internal`) туда не берутся.
- Выписка: перевод на депозит Kaspi — `kind: 'transfer-out'`, `internal: true` (`parsers/kaspi.ts:32-34`); Freedom «Перевод
  валюты» → `internal` (`freedom.ts:149`); межбанковская пара — `pairInternalTransfers` → `internal: true` (`model.ts:362-384`);
  `isSpend = amount < 0 && !internal` (`model.ts:404`), `spendOf` :411; поля `Operation`: `kind`, `internal`, `counterparty?`
  (`statements/types.ts:26-35`). Внеплановый доход в выписке — приход (`amount > 0`, не зарплата).
- Тесты: `lib/spendBalance.test.ts` :73-126 (`spentSince`: :99-100 — `internal transfer-out → +30000`, :94 — отмеченная не
  считается), `lib/statements/matching.test.ts:193-206` (`markedOps`), e2e `f2-block3-spend-balance.test.ts` (:106 «трата,
  отмеченная платежом, — один раз»), `f2-block3-accept.test.ts` (:78-91 — перевод себе со счёта `−50_000 'transfer-out'
  'На депозит' internal`).

## Задача

1. `lib/statements/matching.ts`: `shiftedOps(ops, shifts, me): Set<string>` — для каждого живого сдвига `by === me` берётся
   ближайшая по дате ещё не занятая операция с `op.amount === shift.amount` (точное равенство в тенге; для валютных строк —
   `within(AMOUNT_TOLERANCE)` по `tenge`-сумме, если такая есть) и `|дата − shift.date| ≤ DAY_WINDOW`; одна операция — одному
   сдвигу, один сдвиг — одной операции; операции из `markedOps` не берутся. `kind` операции не важен (`internal`
   перевод на депозит, обычная трата-покупка мечты, приход внеплановым доходом). Чистая функция, без состояния.
2. `stores/operations.ts`: `writeAccountSpent(marked)` получает `marked ∪ shiftedOps(all, finance.accountShifts, me())` —
   только здесь; `totalMarks().marked` для итогов разделов **не меняется**. Пересчёт — при изменении `accountShifts`
   (наблюдатель рядом с :1150).
3. `lib/finance.ts` ничего не считает по-новому: `spentSince` как есть — пара просто не попадает в `counted`.
4. Handoff: сценарии стенда с цифрами (без данных семьи), что видит партнёр.

## Тесты

- `lib/statements/matching.test.ts`: `shiftedOps` — пара по сумме и ±5 дней; вторая строка с той же суммой через 10 дней — не
  пара; две одинаковых строки и один сдвиг — одна пара (ближайшая по дате); операция из `markedOps` не берётся; чужой сдвиг
  (`by` партнёра) не берётся; приход +x ↔ сдвиг `income` +x.
- `lib/spendBalance.test.ts`: `spentSince(ops, marked ∪ shifted)` — взнос 50 000 + строка «На депозит −50 000» → нетто без
  неё; покупка мечты `done` −120 000 + строка траты −120 000 → без неё в `spentSince`, но раздел трат её считает (тест на
  `totalMarks` / `SpendTotal` — сумма раздела с ней).
- e2e `e2e/fg-block2-goal-statement.test.ts`: A: карта «Траты отсюда» 500 000 → «Положить» 50 000 в цель с карты → «На карте
  450 000»; выписка через 2 дня со строкой `transfer-out 'На депозит' −50 000 internal` → по-прежнему 450 000 (не 400 000);
  другая трата −12 500 из той же выписки → 437 500; партнёр видит 437 500; внеплановый доход +30 000 на карту + приход
  +30 000 в выписке → один раз; сдвиг до сверки, строка после новой сверки — не вычитается (якорь).

## Критерии приёмки

- Стенд `8198`/`5298`, семья из двух, Chrome 390: сценарий e2e руками на тестовом PDF — «На карте» и строка счёта в
  «Капитале» показывают одну и ту же честную цифру до и после выписки; «Месяц → Траты» считает покупку мечты в разделе;
  `f2-block3-*` зелёные без правок смысла.
- `cd frontend && npm run build && npx vitest run` зелёные; Go не тронут.

## Вне скоупа

- Ручная сверка «это тот же перевод?» в UI, показ пары в листе операции; записи `opId` в сдвиг (пересчёт без состояния).
- Сопоставление взносов, сделанных до Блока 2 (без записей `accountShifts`).
