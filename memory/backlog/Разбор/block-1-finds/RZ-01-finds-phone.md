# RZ-01 — Итоги находок участника по операциям → документ (фронт)

Блок 1 · MVP · Каталог: `frontend/src/lib/statements/` (новый `finds.ts`), `lib/statements/types.ts`, `types/finance.ts`,
`lib/merge.ts`, `stores/finance.ts` (`defaultSyncDoc`), `stores/operations.ts` · Зависит от: — · Роли: member (пишет свои),
viewer (операций нет), демо (заготовка — RZ-09)

## Контекст (что уже есть)

- Р-13: операции личные и есть только на телефоне участника (`stores/operations.ts` `all` :144 — `Record<string,
  Operation>` в `localStorage`, свои месяцы по загрузкам); партнёр видит только итоги в общем документе. Образец —
  итоги привычек AU-27: `lib/statements/habits.ts` (`habitTotals(ops, by, period, at)` :67 — только счётчик и сумма,
  ниже порога не пишется; `habitKeepFrom` :82, `HABIT_KEEP_MONTHS` 4) и запись `writeHabitTotals(months)`
  (`stores/operations.ts:391`): зовётся из `writeTotals` :356 для месяцев пересчитанных итогов, пропавший итог
  обнуляется (`count: 0, amount: 0` — надгробие в `mergeList` закрыло бы id навсегда), месяцы старше окна — надгробия,
  тот же итог второй раз не пишется.
- Р-14 — пороги. Готовые куски: `detectRecurring(ops)` (`lib/statements/firstRun.ts:184`) → `RecurringCandidate {key,
  name, amount (медиана), day, count, kind, categoryId, opIds}` — повторы по продавцу (≥ 2 списания близкой суммы ±5 % в
  близкие дни ±3, от 500 ₸; словарные разделы кредит/аренда/коммуналка/связь/подписки — с одного раза), без людей и
  внутренних; `ruleFor(op, rules)` (`model.ts:157`) — правило семьи, `to.payment` = `{kind: 'obligation'|'credit'|'salary',
  targetId}` (правила — личный документ: `financeStore.merchantRules` — computed без надгробий, `stores/finance.ts:288`;
  стор операций так и зовёт `ruleFor(o, finance.merchantRules)` :723); `normalizeMerchant` :62; `isSpend(op)` :275;
  `entrepreneurName(name)` — **приватная** в `model.ts` (ниже `aiSellerNames` :364) — «ИП + фамилия»; `habitOf(op)`
  (`habits.ts:60`) — операция уже привычка Блока 7 (такси, кофе, доставка, обеды, маркетплейсы). Сумма платежа месяца
  по обязательству — `amountAt(o, key = monthKey(), book?)` (`finance.ts:847`); обязательства — `financeStore.obligations` /
  `householdDoc.obligations` (`Obligation {id, name, day, versions, every?}`), кредиты — `householdDoc.credits`.
- Операция: `Operation` (`types.ts:14`) — `date` `YYYY-MM-DD`, `amount` (минус — списание, целые ₸), `kind`, `merchant`
  (после `sanitize` — без ФИО и номеров), `counterparty?` (переводы людям), `categoryId | null`, `internal`.
- Документ: новое поле = ключ в `SyncDoc` (`types/finance.ts:671-720`), дефолт в `defaultSyncDoc()`
  (`stores/finance.ts:106`), `mergeList(…, x => x.id)` в `known` `mergeDocs` (`lib/merge.ts:188-248`); запись —
  `finance.mutateHouseholdDoc(fn)` :480.
- Разделы платежей (`plannedElsewhere`, `SpendCategory`) и «не разобрано» `UNKNOWN_CATEGORY`
  (`statements/dictionary.ts`); переводы людям и наличные — `SPEND_LAST` (`finance.ts:4063`).

## Задача

1. Тип в `lib/statements/types.ts`:
   ```ts
   export type ReviewFindKind = 'leak' | 'recurring' | 'pricier' | 'double' | 'top'
   /** Итог находки участника за месяц (бэклог «Разбор», Р-13): без дат операций и без людей. */
   export type ReviewFind = Tracked & {
     /** `${by}:${period}:${kind}:${key}` — key: нормализованный продавец (leak/recurring/pricier/double) или categoryId (top). */
     id: string
     by: PersonId
     period: string            // YYYY-MM
     kind: ReviewFindKind
     /** Продавец как печатает банк (после sanitize), ≤ 40 знаков; у top — ''. */
     name: string
     categoryId: string | null
     count: number
     /** leak, top — сумма за месяц; recurring, pricier, double — типичная сумма одного списания; 0 — обнулённый итог. */
     amount: number
     /** pricier: сумма в плане месяца (amountAt). */
     was?: number
     /** pricier/recurring: обязательство (кредит), к которому ведёт правило платежа. */
     targetId?: string
     /** top: до 2 крупнейших покупок месяца в разделе — название и сумма. */
     top?: { name: string; amount: number }[]
   }
   ```
   `SyncDoc.reviewFinds?: ReviewFind[]` + дефолт `[]` в `defaultSyncDoc()` + `mergeList` в `known`.
2. Новый `lib/statements/finds.ts` (чистые функции над операциями одного участника, без стора):
   - константы `LEAK_MIN_COUNT = 6`, `LEAK_MAX_AVG = 8_000`, `DOUBLE_MIN = 1_000`, `DOUBLE_DAYS = 3`, `PRICIER_SHARE = 10`
     (%), `PRICIER_MIN = 500`, `FINDS_MAX = {leak: 5, top: 5, dues: 6}`, `FIND_NAME_MAX = 40`;
   - `sellerOk(op)` — трата (`isSpend`), без `counterparty`, не `internal`, продавец без 6+ цифр и не
     `entrepreneurName` (экспортировать её из `model.ts`), раздел не `plannedElsewhere` для `leak`/`top`;
   - `leakFinds(ops, by, period)` — по `normalizeMerchant` продавца за месяц: `count ≥ LEAK_MIN_COUNT`, `amount / count ≤
     LEAK_MAX_AVG`, операции привычек (`habitOf(op) !== null`) не считаются; до 5 по сумме;
   - `topFinds(ops, by, period, categories)` — по разделам месяца (кроме `plannedElsewhere`, `_unknown`, `SPEND_LAST`):
     `count`, `amount`, `top` — две крупнейшие покупки `{name, amount}`; до 5 разделов по сумме;
   - `dueFinds(ops, by, period, ctx: {rules, obligations, credits, key, book})` — по операциям 3 закрытых месяцев до
     `period` и самого `period`: `recurring` — кандидаты `detectRecurring` с операцией в `period`, у которых нет правила
     платежа (`ruleFor(op, rules).to.payment`) и нет обязательства/кредита с тем же `normalizeMerchant(name)`; `pricier`
     — операция `period` по правилу платежа обязательства, `-amount ≥ was × 1,1` и `-amount − was ≥ PRICIER_MIN`, `was =
     amountAt(obligation, period)` (> 0); `double` — два списания одного продавца одной суммы ≥ `DOUBLE_MIN` в ≤ 3 дня
     внутри `period` (`count` = число таких списаний); вместе — до 6 по сумме;
   - `reviewFinds(ops, by, period, ctx)` — всё вместе, отсортировано по `kind`, `id`; `findKeepFrom = habitKeepFrom`.
3. `stores/operations.ts`: `writeReviewFinds(months)` рядом с `writeHabitTotals` и по той же схеме (обнуление
   пропавших, надгробия старше окна, «тот же итог второй раз не пишется», `updatedAt = at`), зовётся из `writeTotals`
   после `writeHabitTotals` теми же месяцами; `ctx` — правила личного документа, обязательства и кредиты общего, книга
   курсов (как у `amountAt` в сторе). Viewer и демо — как у привычек (демо пишет в документ демо).
4. Комментарий-доктрина в шапке `finds.ts`: что уходит в документ и что нет (даты, люди, ИП — нет).

## Тесты

- `lib/statements/finds.test.ts` на операциях одного участника за 4 месяца: утечка (7 покупок по 1 500 в месяц — есть;
  5 — нет; средний чек 9 000 — нет; «ИП Абенова» 8 раз — нет; такси 10 раз — нет, это привычка; перевод человеку —
  нет); `top` — две крупнейшие покупки и число операций раздела, разделы платежей и «не разобрано» мимо; `recurring` —
  «Yandex Plus» 1 990 два месяца подряд без правила — есть, с правилом платежа — нет, с обязательством того же имени —
  нет; `pricier` — подписка по правилу 2 990 при плане 2 490 — есть (`was` 2 490), 2 590 — нет; `double` — два списания
  12 000 одному продавцу через день — есть, через 5 дней — нет, 800 ₸ — нет; лимиты 5/5/6; id стабильны; названия ≤ 40.
- `stores/operations` (рядом с тестами `writeHabitTotals` — grep `habitTotals` в `stores/*.test.ts`): после загрузки
  выписки в документе появляются `reviewFinds` участника за месяцы выписки; повторная запись тех же операций ревизию не
  растит; утечка пропала — итог обнулён, не надгробие; месяц старше 4 — надгробие.
- `lib/merge`: `reviewFinds` сливаются по id (две записи одного участника — поздняя побеждает).

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные.
- В документе после загрузки выписки на стенде (своя выписка из `memory/secrets/statements/`, Handoff — только виды и
  счётчики, без продавцов) — записи `reviewFinds` участника: ни дат, ни `counterparty`, ни «ИП + фамилия»; размер записей
  месяца ≤ 2 КБ (прикинуть `JSON.stringify`).
- Открытие приложения без новой выписки ревизию документа не растит (B2C-25).

## Вне скоупа

- Находки семьи, цена в год, образы, сценарий, счётчик — RZ-02 (`finance.ts`). Факты для модели — RZ-03. Заготовка
  находок демо — RZ-09. Экран — Блок 2. Пороги не настраиваются из интерфейса (константы, Р-14).
