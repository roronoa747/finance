# B2C-55 — Расчёт разбора в `finance.ts`: статьи, закрытие по порядку, статусы ступеней, факт по статьям (фронт)

Блок 11 · MVP · Репо/каталог: `frontend/src/lib/` · Зависит от: B2C-54 · Роли: —

## Контекст (что уже есть)

- Все деньги считает `src/lib/finance.ts` (правило 6 CLAUDE.md, Р-63); целые тенге, без `Infinity` и дробей в
  состоянии. Опоры (строки — §6 индекса «Перед Блоками 11–12»):
  - платежи месяца — `monthDues(state, key)` + `duesTotal` (обязательства и кредиты; отметки учтены);
  - зарплаты — `totalIncome(people, key)`, `salaryAt(person, key)`, отметка зарплаты — `paidFor(payments,
    'salary', who, key)` (`record.amount` — сколько пришло);
  - дорогие долги — `costliestCredits` (процентные, самый дорогой первым), план «Сначала долги» — `activePlan`,
    `planStep(plan, state, key)` (`kind: 'prepay' | 'cushion' | 'done'`, `amount`), `planMandatory`;
  - цели — `liveGoals`, `goal.monthly`, `goal.have`, `goalRemaining`, пауза плана — `pausedGoals`;
  - траты по выпискам — `SpendTotal` (`kind: 'month'`, `period`, `categoryId`, `amount`), загрузки — `UploadPeriod`;
    образец — `monthSpentByFact` (`null` без загрузок за месяц);
  - записи — `allocationFor(list, {source, sourceId, period})`.
- Модель статей и настроек — B2C-54 (`MoneyArticle`, `MoneySettings`, `SpendCategory.article`,
  `Allocation.kind: 'breakdown'`).
- Решения: Р-51, Р-53…Р-56, Р-63, Р-65, Р-66.

## Задача

Новые чистые функции (имена — ориентир; JSDoc по-русски, как соседние):

1. **`breakdownArticles(state, ctx: { key; totals; spendCategories; uploads })`** → статьи месяца по порядку:
   `{ key, name, on, need, status, empty, goals?, creditId?, potGoalId? }`, где `need` — сколько статье нужно в
   этом месяце:
   - `must` — `duesTotal(monthDues(state, key))`; статус — короткий перечень («аренда, 2 кредита, коммуналка»);
   - `life`, `spend` — `amount` статьи; статус — факт по выпискам (п. 4): «по выпискам N ₸» или нет;
   - `reserve` — копилка (`potGoalId`) до порога `reserveMonths × (life + spend)`: `need = min(amount, порог −
     have)`, не меньше 0; статус «есть 0,6 из 1 месяца» (дробь — только в строке, десятые вниз);
   - `cushion` — та же копилка дальше, до `cushionMonths × (must + life)`; статус «1 из 3 месяцев»; при активном
     плане «Сначала долги» — цель-подушка плана и шаг `planStep` `kind: 'cushion'` (Р-66);
   - `debts` — без плана: `amount` в самый дорогой долг с `annualRate >= costlyRate`; с планом — шаг `planStep`
     `kind: 'prepay'` (не внесённый); статус «<имя> · 34 %»;
   - `dreams` — сумма `monthly` живых целей не на паузе, кроме копилки; статус «<главная цель> · к <месяцу>»;
   - `empty` — нечего закрывать (нет долгов, нет целей, нуль без плана; закрытая ступень — `need` 0 и статус
     «закрыт»): пустые не показываются (Р-65).
2. **`breakdownFill(articles, amount, covered)`** — закрытие по порядку (Р-54): по включённым статьям `given =
   min(need − covered[key], остаток)`; → `{ given: Record<ArticleKey, number>, rest, waiting, short }`: `rest` —
   остаток этой суммы (≥ 0), `waiting` — недозакрытые статьи, которые закроет ещё не пришедшая зарплата этого
   месяца, `short` — сколько не хватает семье до всех включённых статей с учётом ещё не пришедших окладов (> 0 →
   красным, Р-65). Сумма `given` + `rest` = `amount` до тенге.
3. **`monthBreakdown(state, ctx, source)`** — экранная сводка для источника: зарплата (`{person, period}` — сумма
   `record.amount`), остаток месяца, освободившийся платёж, закрытый долг (Р-65: не-зарплата — только статьи от
   `reserve` и ниже); `covered` — части записей `kind: 'breakdown'` этого месяца (обе зарплаты, Р-54); уже
   записанная — `recorded`. И **`asUsual(state, ctx, me)`** — карточка «как в <прошлом месяце>»: включённые статьи
   прошлой записи разбора участника (нет её — план), `rest` по ним, или `null`, если зарплата не пришла / уже
   разложена / плана нет (тогда первый разбор — «Ваш порядок», Р-55).
4. **`articleFact(totals, spendCategories, key, uploads)`** → `{ life, spend } | null` — траты месяца по статьям
   разделов (`must`-разделы не входят, `_unknown` — в `life`); `null` без загрузок. Сумма `life + spend` =
   `monthSpentByFact` (одна правда — тест).
5. **`breakdownEffects(given, articles, mode: 'once' | 'monthly')`** — что записать: взносы в цели (`dreams` — по
   целям в порядке, каждой не больше её `monthly`, остаток — главной; `reserve`/`cushion` — в копилку), досрочка
   (`debts` → `{creditId, amount}`), рост `monthly` (ежемесячный источник), части записи `parts` по статьям.
   Стор только исполняет (B2C-57).
6. Удалить ставшее мёртвым после B2C-58 — **не здесь** (B2C-58 удаляет `salaryFree`, `allocationRoom` и т. п.,
   когда у них не останется потребителей).

## Тесты

- `lib/finance.test.ts`, блок «разбор» — **ручной расчёт** в комментарии теста для каждого случая: одна зарплата
  закрывает всё; зарплата меньше суммы статей (`short`, нижние не закрыты); две зарплаты — первая закрывает
  верх, вторая докрывает (и наоборот — вторая пришла раньше, порядок тот же); выключенная статья — её сумма в
  `rest`; пустые статьи (нет долгов / целей); запас и подушка — копилка у порога (закрыт, частично); план «Сначала
  долги» — `debts` и `cushion` из `planStep`; не-зарплатный источник — только статьи от `reserve`;
  `asUsual` — прошлый месяц, нет записи, уже разложено; `articleFact` = `monthSpentByFact` на демо-итогах;
  `breakdownEffects` — `dreams` по `monthly`, остаток — главной.
- Свойства: `given + rest = amount`; все суммы — целые (`Number.isInteger`); `need >= 0`.

## Критерии приёмки

- Ни одной формулы денег вне `finance.ts` (экраны B2C-56…59 только показывают); vitest зелёный, покрытие веток
  новых функций — каждым сценарием выше.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- UI — B2C-56/57/58; нормы и доли разделов — B2C-59; инвестиции (ступень 7) — после MVP.
