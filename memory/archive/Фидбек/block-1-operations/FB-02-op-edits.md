# FB-02 — Правки операции в личном документе: `opEdits`, заметка, «Мне вернули», `spendOf` (фронт, lib + стор)

Блок 1 · MVP · Каталог: `frontend/src/lib/statements/types.ts`, `lib/statements/model.ts`, `lib/merge.ts`, `stores/finance.ts`, `stores/operations.ts`, `lib/finance.ts`, `lib/statements/finds.ts`, `lib/statements/habits.ts` · Зависит от: — · Роли: member (свои операции); партнёр видит только итоги

## Контекст (что уже есть)

- Р-11, Р-12, Р-22 (§2). Операция в копии перезаписывается сервером (`pullOnce` `stores/operations.ts:834` — `fromWire`) и
  повторной загрузкой выписки (`remember` :584) — поэтому заметка, возврат и (в Блоке 2) «Разовая» живут не в операции, а в
  личном документе и **накладываются при чтении**.
- Личный документ: `stores/finance.ts:220 privateDoc` (`Record<string, unknown>`), списки `accounts`, `merchantRules` :290,
  `gifts`, `tripExcluded` (образец записи «по id операции с надгробием»: `tripExcluded`, поиск по `tripExcluded` в сторе);
  слияние `lib/merge.ts:258 mergePrivateDocs` — новый список добавить в `known` (`list('opEdits')`), иначе он сольётся как
  неизвестный ключ. Запись — `mutatePrivateDoc` / то, как пишет `addMerchantRules` :1183 (найти по grep `privateDoc.value`).
- `Operation` — `types.ts:18`; `note` уже занято именем операции банка (Kaspi «Покупка»/«Перевод», Freedom «имя · остаток»)
  и у ручной — заметкой человека (`handOperation` `model.ts:221`, `merchant` = заметка или имя раздела).
- Где считается сумма траты как `-op.amount`: `spendTotals` (`model.ts:375`), `sectionWeek` (`finance.ts:5215`), `weekFeed`
  (:5283), `leakFinds`/`topFinds` (`finds.ts:100, 111-121`), `habitTotals` (`habits.ts:75`), `tripOps`/`tripTotal`,
  `unknownGroups` (`model.ts:427`), `amountTotal` над готовыми строками. `isSpend` (`model.ts:354`) — знак и `internal`.
- Приходы: `kind` `transfer-in` / `income`, `amount > 0`; `matchCandidates` (`matching.ts:274`) предлагает их как зарплату;
  `internal: true` снимает с них вопросы и «Историю».
- Стор `all` (`stores/operations.ts:161`) = `Object.values(ops)`; на нём стоят `shown`, `writeTotals`, `recategorizeAll`,
  `weekFeed` в `Week.vue`. `toWire` :88 шлёт поля явно — лишние поля на сервер не уйдут.

## Задача

1. Тип `OpEdit = Tracked & { id: string; memo?: string; oneOff?: boolean; refund?: { amount: number; opId?: string } }`
   (`types.ts`; `oneOff` заводится сейчас, пишется в Блоке 2). `Operation` получает производные необязательные поля
   `memo?`, `oneOff?`, `refund?` (комментарий: «наложены из `opEdits`, на сервер не уходят»).
2. Стор `finance`: `opEdits` (живые), `setOpEdit(id, patch)` — слияние с существующей записью, пустая запись (ни `memo`, ни
   `oneOff`, ни `refund`) → надгробие; `mergePrivateDocs` — `opEdits` в `known`. Тест слияния двух телефонов.
3. Стор `operations`: `all` = копия с наложенными правками (`withEdits(ops, edits)` — чистая функция в `model.ts`): `memo`,
   `oneOff`, `refund` на операции-трате; операция-приходу из `refund.opId` — `internal: true` (только в чтении). `remember`,
   `toWire`, `pending` работают с «сырой» копией (`ops.value`) — правки не утекают на сервер; `recategorizeAll`/`reapply`
   сравнивают по `categoryId`/`internal` сырой копии (проверить, что наложенный `internal` не попадает в `changed` и в
   батч; если `reapply` идёт по `all` — пересобрать на сырых).
4. `spendOf(op)` в `model.ts`: `Math.max(0, -op.amount - (op.refund?.amount ?? 0))`; заменить `-op.amount` на `spendOf(op)` в
   `spendTotals`, `sectionWeek`, `weekFeed`, `leakFinds`/`topFinds` (и сумма верхушки `top`), `habitTotals`, `tripOps`/`tripTotal`,
   `unknownGroups`. Трата с полным возвратом (`spendOf` = 0) в ленте и листах остаётся строкой с суммой 0 и пометкой
   (FB-04), в итогах — `ops` считает, `amount` — нет (0 не прибавляет); в находках и привычках — не участвует (как
   `spendOf(op) === 0` → пропуск).
5. `refundCandidates(op, ops)` в `model.ts`: свои приходы (`amount > 0`, `transfer-in`/`income`, не `internal`, не в `payments`
   отметкой зарплаты — передаётся `linkedIds`) в окне ±14 дней от траты, `amount ≤ -op.amount`, сначала ближайшие по дате;
   у прихода с `counterparty` — подпись получателя. Приход, уже взятый другой правкой (`refund.opId`), не предлагается.
6. Правило семьи и словарь на правки не влияют; правки на правила — тоже. `forgetRule`, `settleReleased`, `saveHand`
   (ручная: `memo` — это `note` формы, правки для ручной только `oneOff`/`refund`) — без изменений смысла.
7. Пересчёт итогов при правке: `setOpEdit` зовёт `writeTotals(periodsOf([op, приход?]))` (через стор операций — метод
   `editOp(id, patch)` в `stores/operations.ts`, который пишет правку в `finance` и пересчитывает итоги; при снятии
   возврата — тоже).

## Тесты

- `lib/statements/model.test.ts`: `withEdits` — поля наложены, приход `internal`; `spendOf` — полный, частичный, без
  возврата, не ниже 0; `refundCandidates` — окно, сумма, занятые приходы, зарплата исключена.
- `lib/merge.test.ts`: `opEdits` сливаются по id, надгробие побеждает старую запись, два телефона.
- `stores/operations.test.ts`: `editOp` с возвратом → итоги недели/месяца раздела уменьшены на возврат, приход не
  становится вопросом «это зарплата?» (`pendingMatches`), на сервер в `pending` уходит **ничего** (правка) — батч пуст;
  `pull` перезаписал операцию — `memo`/`refund` на месте; повторная загрузка той же выписки — тоже.
- `lib/week.test.ts`, `lib/statements/finds.test.ts`, `habits.test.ts`: трата с возвратом — сумма ленты/листа/находок без
  неё; полный возврат — не утечка и не привычка.
- Мутанты: `spendOf` без вычета; `withEdits` без `internal` прихода; `opEdits` не в `known` слияния.

## Критерии приёмки

- Правка переживает `pull`, повторную загрузку выписки и второй телефон (личный документ); партнёр в своём документе
  правок не видит, его итоги — только через `SpendTotal`.
- Сумма недели, строки разделов, лента, лист раздела, «Месяц → Траты» и находки согласованы: везде одна `spendOf`.
- `cd frontend && npm run build && npx vitest run` зелёные; Go не трогается.

## Вне скоупа

- Экран (лист операции, чипы) — FB-04. «Разовая» в расчётах — FB-07. Удаление операций выписки — нет.
- Возврат, пришедший партнёру (его приход) — после MVP.
