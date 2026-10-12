# PN-30 — Модель и расчёт поездки: даты, бюджет, `tripSpent` (фронт)

Блок 9 · MVP · Репо/каталог: `frontend/src/types/finance.ts`, `lib/finance.ts`, `lib/merge.ts`, `stores/finance.ts`, `stores/operations.ts`, `lib/statements/model.ts` · Зависит от: Блок 8 🏁 (мечты — Блок 3, ритм — Блок 7) · Роли: member

## Контекст (что уже есть)

- `Goal` — дат нет (PN-13 добавил `doneAt`); «Путешествие» — только шаблон (`template` = `travel` или направление,
  `templateById(id).type === 'travel'`, `photo.place`). `GoalNew.vue` срок не хранит (считает `monthly`).
- Операции выписки — **личные**: `Operation` (`lib/statements/types.ts:14-33`: `id, bank, date 'YYYY-MM-DD', amount
  (минус — списание), kind, merchant, categoryId, internal, uploadId`), стор `stores/operations.ts` (`all`, `shown`,
  `remember`, `upload`/`send`, `pull`); партнёр видит только итоги по разделам в общем документе —
  **`SyncDoc.spendTotals`** (`SpendTotal { id = by:kind:period:categoryId, by, kind: 'week'|'month', period,
  categoryId, amount, ops, unmarked? }`), которые пишет каждый телефон из своих операций: `writeTotals(periods)`
  (`operations.ts:354-379`, `spendTotals(ops, by, kind, period, at, marks)` `model.ts:282-304`, `isSpend` :275 —
  списание и не перевод между своими), пересчёт при новых операциях и отметках. Платежи и подписки по выписке —
  `markedOps(ops, state, rules, me, declined)` (`matching.ts:136-147` — ids операций, засчитанных отметками
  `Payment.opId` и живыми кандидатами), `totalMarks` (`operations.ts:382-384`).
- Личный документ — `privateDoc: Record<string, unknown>` (`accounts`, `merchantRules`, `gifts`), слияние
  `mergePrivateDocs` (`merge.ts:230+`: записи с id — по id, LWW, надгробия; незнакомые ключи не теряются); стор —
  `mutatePrivateDoc`, образец записей — `addMerchantRules`.
- Новый ключ верхнего уровня `SyncDoc`: тип → `defaultSyncDoc()` (`stores/finance.ts:95`) → `known` в `mergeDocs`
  (`merge.ts:184-226`, `mergeList` по id) — правило Р-19 `идея-и-редизайн` (§6): «всё, что может прийти с двух
  устройств офлайн, — записи с id в отдельном списке; остатки выводятся из записей».
- Даты: `todayIso`, `addDaysIso`, `weekRange` (`lib/dates.ts`). Р-14: «мечта «Путешествие» с датами и бюджетом; до
  начала — копим как обычно, с первого дня — «потрачено N из M»: все операции выписки за даты поездки, кроме платежей
  и подписок; лишнее убирается нажатием». Р-21: поля `from?`, `to?`, `budget?`, исключённые операции.

## Задача

1. **Типы:** `Goal.from?: string | null`, `to?: string | null` (`YYYY-MM-DD`), `budget?: number | null` (целые тенге;
   нет — `need`). Новый список **`SyncDoc.tripSpends?: TripSpend[]`**: `TripSpend = Tracked & { id: '<goalId>:<by>';
   goalId; by: PersonId; amount: number; ops: number }` — итог участника по своей выписке (как `spendTotals`: каждый
   телефон пишет свою запись, слияние по id безопасно). В личном документе — `tripExcluded: (Tracked & { id: opId;
   goalId })[]` (исключённые операции, «вернуть» — надгробие). Регистрация: `defaultSyncDoc`, `known` в `mergeDocs`
   (`mergeList`), `isEmptyDoc` при необходимости; `mergePrivateDocs` — ключ `tripExcluded` по id.
2. `finance.ts`/`model.ts`: **`tripStatus(goal, todayIso) → 'none' | 'before' | 'during' | 'after'`** (нет дат —
   `none`); **`tripOps(ops, goal, marked: ReadonlySet<string>, excluded: ReadonlySet<string>)`** — свои операции:
   `isSpend`, `from ≤ date ≤ to`, не в `marked` (платежи и подписки по отметкам), не в `excluded`; **`tripTotal(ops)`**
   — сумма и число; **`tripSpent(goal, tripSpends, people) → { total, byPerson: { person, name, amount }[], budget }`**
   — из записей общего документа; `budget = goal.budget ?? goal.need`.
3. Стор операций: **`writeTripTotals()`** — для каждой живой цели с датами и `tripStatus !== 'before'`: запись
   `tripSpends` `goalId:me` из `tripOps(all, goal, markedOps(...), excluded)`; та же запись не пишется второй раз
   (как `sameTotal`); зовётся там же, где `writeTotals` (после `remember`/`send`/`pull`) и при смене исключений. Стор
   финансов: `setTripDates(goalId, { from, to, budget })`, `excludeFromTrip(goalId, opId)` / `includeInTrip(opId)`
   (личный документ) → будит `writeTripTotals`.
4. Старые цели без дат — `tripStatus 'none'`, ничего не пишется (тест). Поездка после `to` — записи остаются (итог
   поездки виден всегда).

## Тесты

- `lib/trip.test.ts`: `tripStatus` по датам; `tripOps` — границы дат включительно, отметки и исключения не входят,
  переводы между своими не входят; `tripSpent` — сумма двух участников, `budget` из `need`.
- `stores/operations.test.ts`: `writeTripTotals` пишет `goalId:by`, не пишет повтор, исключение меняет сумму;
  `merge.test.ts`: `tripSpends` по id с двух телефонов, `tripExcluded` в личном.

## Критерии приёмки

- Все числа — `finance.ts`/`model.ts`, целые; `cd frontend && npm run build && npx vitest run` зелёные; гвард
  «новый ключ `SyncDoc` зарегистрирован в `mergeDocs`» (есть ли такой тест — если нет, добавить проверку `known`).

## Вне скоупа

- Экраны — PN-31. Операции партнёра построчно — нет (Р-5: личные), только его итог. Курс валют поездки — нет
  (выписки в тенге; валютные траты уже в тенге банка).
