# B2C-54 — Модель разбора в документе: план статей, сопоставление разделов, слияние, умолчания (фронт)

Блок 11 · MVP · Репо/каталог: `frontend/` · Зависит от: S 🏁 · Роли: member пишет, viewer читает

## Контекст (что уже есть)

- Документ семьи — `SyncDoc` (`src/types/finance.ts` ~387): план месяца — `categories: Category[]` (d1…d5,
  `{key, name, note, amount}`; сумма «Трат» — `d4.amount`, правится в `LivingWidget` через
  `financeStore.setCategoryAmount('d4', …)`); раскладки — `allocations?: Allocation[]` (`{id, source: 'salary' |
  'rest' | 'freed', sourceId, period, by, at, total, parts: {target, amount}[]}`, `target` — id цели, `life`,
  `prepay:<creditId>`); разделы выписки — `spendCategories?: SpendCategory[]`.
- Умолчания документа — `defaultSyncDoc()` и `withDefaults()` (`src/stores/finance.ts` ~59–84; документ новой семьи
  с сервера `{}` дополняется ключами — B2C-19, `74c8cba`). Слияние — `mergeDocs` (`src/lib/merge.ts` ~180–205):
  записи с `id` — `mergeList` (LWW по `updatedAt`, надгробие `deletedAt` сильнее), незнакомые ключи —
  `mergeUnknownKeys` (не теряются у старого клиента — RP-02/RP-03).
- Словарь разделов — `src/lib/statements/dictionary.ts` (`DEFAULT_SPEND_CATEGORIES`, `plannedElsewhere`: аренда,
  кредиты, коммуналка, связь, подписки — «уже в плане» платежами).
- `budgetAmounts` (`src/lib/finance.ts` ~1010) берёт «Траты» из `d4.amount` (+ прочие обязательства) — на нём стоят
  «Свободно», «Доход», `freeByFact`, `salaryFree`.
- Решения: Р-51, Р-55, Р-56, Р-66, Р-68 (§2 индекса).

## Задача

1. Типы (`types/finance.ts`):
   - `ArticleKey = 'must' | 'life' | 'reserve' | 'debts' | 'cushion' | 'dreams' | 'spend'`;
   - `MoneyArticle = Tracked & { id: ArticleKey; order: number; on: boolean; amount?: number }` — `amount` в целых
     тенге: для `life`, `spend` — сумма месяца; для `reserve`, `cushion`, `debts` — взнос месяца (без плана «Сначала
     долги»); у `must` и `dreams` суммы нет — они выводятся (платежи месяца, взносы целей);
   - `MoneySettings = Tracked & { reserveMonths: number; cushionMonths: number; costlyRate: number; potGoalId?: string
     | null; orderedAt?: string | null }` — пороги ступеней (целые: месяцы; ставка — целые проценты годовых, долг
     «дорогой» при `annualRate >= costlyRate`), цель-копилка «Запаса» и «Подушки» (Р-66), когда пройден «Ваш
     порядок» (`null` — первый разбор начинается с него, Р-55);
   - `SpendCategory.article?: 'must' | 'life' | 'spend'` — статья раздела;
   - `Allocation.kind?: 'breakdown'` — запись разбора: `parts` по статьям (`target` = `ArticleKey`); старые записи
     без `kind` не трогаются (Р-65).
2. `SyncDoc`: `moneyArticles?: MoneyArticle[]`, `moneySettings?: MoneySettings | null`. Слияние: статьи —
   `mergeList` по `id`; настройки — целиком по `updatedAt` (поздний побеждает). Новые ключи — в `defaultSyncDoc`.
3. Умолчания (одна функция данных рядом со словарём или в `finance.ts`, без UI):
   - порядок и `on: true` по Р-56: must, life, reserve, debts, cushion, dreams, spend;
   - `reserveMonths: 1`, `cushionMonths: 3`, `costlyRate: 0` (все процентные — как `costliestCredits` и план
     «Сначала долги»; владелец правит в «Ваш порядок»);
   - `life.amount` = `d4.amount` документа, `spend.amount` = 0 (предложение разделить по факту — B2C-56);
     `reserve/cushion/debts.amount` = 0 (статья с нулём и без плана — пустая, не показывается, Р-65);
   - статьи разделов: `plannedElsewhere` → `must`; `sc_cafe`, `sc_shopping`, `sc_fun`, `sc_travel` → `spend`;
     остальные (вкл. `sc_other`, `_unknown`) → `life`. Поле в документе побеждает умолчание (как `plannedElsewhere`).
4. Один источник суммы «жизнь + траты»: при заведённых статьях `budgetAmounts` берёт `d4` = `life.amount +
   spend.amount` (выключенная статья — 0), без статей — `d4.amount`, как сейчас. `d4.amount` после «Ваш порядок»
   не пишется (иначе два места одной суммы).
5. Стор (`stores/finance.ts`): `setArticle(id, patch)`, `reorderArticles(ids)`, `setMoneySettings(patch)`,
   `setSpendArticle(categoryId, article)` — через `mutateHouseholdDoc`, `updatedAt` на каждой правке; геттеры
   `moneyArticles` (с умолчаниями, по `order`), `moneySettings`.

## Тесты

- `lib/merge.test.ts`: `moneyArticles` по `id` (свои и партнёра, надгробие), `moneySettings` — поздний побеждает;
  документ без ключей — пустые умолчания; старый клиент не теряет новые ключи (`mergeUnknownKeys`).
- `stores/finance.test.ts`: `withDefaults({})` несёт новые ключи; правки стора пишут `updatedAt`.
- `lib/finance.test.ts`: `budgetAmounts` без статей — те же числа, что до задачи (снимок на демо-документе); со
  статьями — `d4 = life + spend`, выключенная — 0; статья раздела: поле документа сильнее умолчания.

## Критерии приёмки

- Старый документ (прод-снимок демо) читается без изменений чисел «Денег» и «Мечт»; новые ключи синкаются между
  двумя профилями (стенд Go на моках, два браузера).
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Расчёт разбора и статусы — B2C-55; экраны — B2C-56/57; удаление `categories` d1…d5 — не делаем (на них стоят
  старые месяцы и `budgetAmounts`).
