# B2C-85 — Данные плана: плательщик, траты каждого, фонды, пауза, очередь целей и желаний (фронт)

Блок 14 · MVP · Репо/каталог: `frontend/src/types`, `lib/merge.ts`, `stores/finance.ts`, `lib/finance.ts` · Зависит от:
B2C-84 · Роли: member (пишет), viewer (читает)

## Контекст (что уже есть)

- Типы — `types/finance.ts`: `Obligation` (`who?` — «чей платёж», пусто — общий), `Credit`, `Goal` (`main?`, `monthly`,
  `have`, `movements`, `template`, `photoId`), `WishItem`, `MoneySettings` (`potGoalId`, `orderedAt`), `SyncDoc`.
- Слияние — `lib/merge.ts`: `known` ~184; список — `mergeList(…, (x) => x.id)`; объект целиком — `newerObject` ~139
  (как `moneySettings`). Новые поля записей (`Goal`, `Obligation`) — LWW записи, отдельной обработки не нужно.
  Правило новых данных Р-19 (§6 «Документ и слияние»): `defaultSyncDoc()` → `known`; старые документы — без ключа.
- Стор — `mutateHouseholdDoc(fn)`; `setMainGoal` (Р-84 меняет смысл); шаблоны целей — `lib/goalTemplates` (есть
  `cushion`).
- Решения: Р-80 (плательщик), Р-81 (`spendPlans`), Р-82 (фонды, копилка → «Подушка», карточка долга), Р-83
  (`pausedAt`), Р-84 (порядок — объект целиком; `main` не пишется), Р-85 (миграции нет; старое не трогаем).

## Задача

1. Типы: `payer?: PersonId | null` у `Obligation`, `Credit`, `Goal`; `Goal.fund?: 'reserve' | 'cushion' | null`,
   `Goal.fundMonths?: number` (порог в месяцах трат), `Goal.pausedAt?: string | null`; `SpendPlan` (`id` =
   `${by}:${categoryId}`, `by`, `categoryId`, `amount`, `updatedAt`, `deletedAt?`) → `SyncDoc.spendPlans`;
   `QueueOrder = Tracked & { ids: string[] }` → `SyncDoc.goalOrder` (ids целей и `debt` — карточка долга),
   `SyncDoc.wishOrder`; настройки карточки долга (`monthly`, `pausedAt`) — в `goalOrder` или своём объекте (решение —
   в Handoff, слияние — объект целиком).
2. Слияние: `spendPlans` — `mergeList` по id; `goalOrder`, `wishOrder` — `newerObject`; тесты на слияние.
3. Чистые функции (`finance.ts`): `payerOf(item, people)` (Р-80: `payer` → `who` → первый участник); `queueOf(doc)` —
   порядок очереди: ids из `goalOrder`, живые цели не в списке — в конец по созданию, мёртвые — выпадают; при пустом
   `goalOrder` старый `main: true` (поздний) — первым (Р-84); `wishQueue(doc)` — то же для желаний; `fundsOf(doc)`.
4. Стор (одна правка документа на действие): `setPayer(kind, id, person)`, `setSpendPlan(by, categoryId, amount)`,
   `pauseGoal(id, on)`, `moveInQueue(id, toIndex)`, `moveWish(id, toIndex)`, `makeMain(id)` (= наверх; `setMainGoal`
   становится обёрткой и больше не пишет `main`), `ensureFund(kind)` (копилка `potGoalId` → `fund: 'cushion'` один
   раз; «Запас» — новый фонд-цель с шаблоном), правка порога фонда.
5. Демо (`views/Access.vue` `startDemoMode`): плательщики у платежей, суммы трат у обоих, фонды, одна цель на паузе,
   порядок очереди и желаний.

## Тесты

- Слияние: `spendPlans` с двух телефонов (разные разделы — оба; один — поздний); `goalOrder` — поздний целиком;
  незнакомые ключи и старые документы без ключей не теряются.
- `queueOf`: новые цели в конец, удалённые выпадают, старый `main` первым при пустом порядке, фонды и `debt` в очереди.
- `payerOf`: три ветки умолчания.
- Стор: `makeMain` переносит наверх и не пишет `main`; `ensureFund` идемпотентен, копилка сохраняет `have` и взносы.

## Критерии приёмки

- `npm run build && npm test` зелёные; прежние экраны работают (данные новые, экраны ещё старые).

## Вне скоупа

- Расчёт плана — B2C-86; перетаскивание и «Мечты» — B2C-87; экран — B2C-88; удаление `moneyArticles` из документа —
  не делаем (Р-85: не читаются).
