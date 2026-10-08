# ML-15 — Модель и расчёты: долг человеку и платёж людям (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/src/types/finance.ts`, `frontend/src/lib/finance.ts` · Зависит от: ML-14 (ворота ✅) · Роли: member, viewer

## Контекст (что уже есть)

- `Credit` (`types/finance.ts:275-297`): `id, name, note, principal, principalSetAt?, annualRate, rateUnknown?, payment,
  day, payer?, updatedAt, deletedAt`; срок не хранится (`creditOutlook`), остаток — `creditBalance` (`lib/finance.ts:1476`).
  Рассрочка — без флага: `annualRate===0 && !rateUnknown` (`interestFree` :714, `unknownRate` :715).
- `Obligation` (`types/finance.ts:168-227`): `category: 'd1'..'d5'`, `versions` (с `currency?` — Р-75), `estimate?`,
  `group?`, `every?`, `who?`, `payer?`…; подписка — производная `isSubscription = !group && category==='d4' &&
  !estimate` (finance.ts:910). Группа — `subscriptionGroup(items, all)` (:3532-3558, `SUBS_GROUP_MIN=2`),
  `monthSubscriptions` :3561.
- Долги: `openCredits` :748, `openDebt` :751, `netWorth` :1260; `debtsOverview(state, key): {total, freeMonth, rows}`
  :2603-2627 (`DebtRow` :2582 = `{creditId, name, payment, rate, rateUnknown, endMonth, left, paidShare}`; без плана
  `freeMonth` — последний конец графика; с планом — графики 0 %-строк + `planForecast(...).debtFreeMonth`).
- **«Сначала долги» 0 % не досрочит** (`costliestCredits` :758-763 — только `annualRate>0`; `simulateStrategy` :556,
  :576-577) — рассрочка идёт по своему графику. Это и есть «последним, как рассрочка» Р-7.
- Документ семьи — `householdDoc: SyncDoc` (`types :523-568`), `withDefaults` (`stores/finance.ts:128`), слияние по
  записи `mergeDocs` (`lib/merge.ts:175-229`, LWW полей записи :192-199). Бэкенд поля документа не проверяет
  (`backend/internal/handlers/sync.go:70-84`) — Go и миграции не нужны.

## Задача

1. Типы (Р-12): `Credit.person?: boolean` — долг человеку (ставка всегда 0, `rateUnknown` нет); `Obligation.people?:
   boolean` — платёж людям. Старые документы без полей читаются как сейчас.
2. `finance.ts`:
   - долг человеку — в `openDebt`, `netWorth`, `debtsOverview` (строка с `person: true` в `DebtRow`, `freeMonth` — по
     графику, как 0 %-строка), в досрочку плана не входит (как рассрочка — Р-7);
   - `peopleGroup(items, all)` — по образцу `subscriptionGroup`, но группа с **1** платежа (строка «Людям · N» нужна
     всегда, когда есть хоть один); `isSubscription` → `false` для `people`;
   - платёж людям в сумму остатков не входит (у обязательства остатка нет) — проверить, что `debtsOverview.total` его
     не видит.
3. Никаких копий формул: долг человеку проходит тем же путём, что рассрочка, отличается только флагом показа.

## Тесты

- `lib/moneyScreens.test.ts` (рядом с `debtsOverview` :81): долг брату 500 000 / 50 000 в мес → в `total`, строка с
  `person`, `freeMonth` с ним — по его графику, позже кредита с планом — не раньше его конца; платёж «маме» не в `total`.
- `finance.test.ts`: `peopleGroup` — 1 и 3 платежа; подписка с `people` не попадает в `subscriptionGroup`; план
  «Сначала долги» не досрочит долг человеку.
- `merge.test.ts`: правка `person`/`people` у партнёра сливается по записи.

## Критерии приёмки

- Все числа — `finance.ts`, целые. `cd frontend && npm run build && npx vitest run` зелёные.

## Вне скоупа

- Экраны и формы — ML-16, ML-17. Проценты по долгу человеку — нет (Р-5).
