# PV-02 — Калькулятор «копить или гасить» 1:1 с React (фронт)

Блок 1 · MVP · Каталог: `frontend/` · Зависит от: PV-01 · Роли: все (просмотр; кнопок правки нет)

## Контекст (что уже есть)

- Сверка А-1; Р-3 (что возвращаем), Р-21 (отдельный компонент, нативные чекбоксы).
- **Эталон — React `src/screens/Capital.tsx` `StrategyCompare` `:1541-1727`.** Встроен в
  `DebtAdvice` (`:1115`; Segmented «Какой первым» / «Копить или гасить» `:1146-1153`,
  `<StrategyCompare credits={credits}/>` `:1157`; без процентного долга — null `:1124`).
  - Состояние (`:1562-1565`): `months: 12|24|36` (дефолт 36), `kept: string[]` (id целей,
    которые не останавливать), `cushion = true`, `useSaved = false`.
  - Производные (`:1568-1582`): `debts = credits.map({principal, annualRate, payment})`;
    `saving = Σ goals.monthly`; `keep = Σ monthly` целей из `kept`; `start = Σ max(0, have)`
    по всем целям; `movable = Σ max(0, have)` по целям **не** из `kept`; `mandatory =
    Σ monthlyAmount(o, key)` по живым обязательствам + `Σ c.payment` по кредитам;
    `buffer = cushion ? round(mandatory/1000)*1000 : 0`; `interestFree = credits.filter(rate
    === 0 && principal > 0)`; `redirected = saving − keep`.
  - Вызовы (`:1584-1589`): `a = simulateStrategy({debts, saving, keep: saving, payDebts: false,
    start, months})`; `b = simulateStrategy({debts, saving, keep, payDebts: true, start,
    months, buffer, lump: useSaved ? max(0, movable − buffer) : 0})`; `gain = b.net − a.net`.
  - Гейт (`:1607`): нет долга с `annualRate > 0 && principal > 0` → null.
  - UI по порядку (тексты дословно — из React):
    1. Заголовок «Одинаковые траты, разный порядок» (`:1611`) + `Hint` (`:1613-1617`): «В обоих
       сценариях уходит одно и то же: платежи по долгам плюс {plain(saving)} ₸ в цели. Разница
       только в том, куда идут деньги. «Сначала долги» направляет взносы в самый дорогой долг,
       а закрытый долг освобождает платёж для следующего.»
    2. `Field label="Горизонт"` + `Segmented` '12'|'24'|'36' с подписями «Год» / «Два» / «Три»
       (`:1620-1630`).
    3. При `redirected > 0` (`:1632-1649`): две колонки `Col` (`:1591-1605`) «Копим как сейчас»
       (`strong={gain<0}`) и «Сначала долги» (`strong={gain>=0}`); в колонке: «накоплено»
       `money(round(savings))`, «долг» `debtLeft`, «процентов банку» `interestTotal` (класс
       `text-warn`), «без процентных долгов» — `debtFreeMonth === null ? 'не закрываются' : 0 ?
       'уже' : 'через N мес.'`. Вывод: `gain >= 0 ? 'Сначала долги выгоднее на' : 'Копить
       выгоднее на'` + `money(abs(round(gain)))` + «чистыми через {months} мес. — это деньги,
       которые не ушли банку». Иначе (`:1651-1655`): «Все цели отмечены как неприкосновенные —
       направлять в долги нечего. Снимите отметку с цели, которую можно поставить на паузу.»
    4. «Что не останавливать» при `goals.length > 0` (`:1658-1683`): Hint «Отметьте
       цели-страховки. Если декрет или другая обязательная трата ближе года, пауза там обойдётся
       дороже процентов: доход упадёт, а долги останутся.»; на цель — чекбокс + `g.name` +
       `{plain(g.monthly)}/мес`.
    5. Чекбокс `cushion` (`:1685-1698`): «Сначала подушка — {money(round(mandatory/1000)*1000)}»
       (сумма видна и при снятой галке); подпись «месяц обязательных списаний; без неё первая
       поломка вернёт вас на кредитную карту».
    6. Чекбокс `useSaved` при `movable > 0` (`:1700-1716`): «Вложить уже накопленное —
       {money(max(0, movable − buffer))}»; подпись «из неотмеченных целей, подушка остаётся. Если
       это вклад с госпремией — сначала проверьте условия: премия может обыграть ставку.»
    7. При `interestFree.length > 0` (`:1718-1724`): «Беспроцентные долги — {names.join(', ')} —
       досрочно не гасятся: они ничего не стоят, а внесённые раньше срока деньги просто
       перестают быть доступными.»
- `simulateStrategy` во Vue `frontend/src/lib/finance.ts:380-462` — построчно = React
  (`:317-399`), менять не надо. `StrategyResult` (`:345-358`): `savings`, `debtLeft`, `net`,
  `interest`, `interestTotal`, `debtFreeMonth` (`0` — процентных долгов нет; `null` — не
  закрываются за 600 мес.). `buffer` и `lump` действуют только при `payDebts`; `lump` ограничен
  `start`.
- **Vue сейчас — `views/Capital.vue`**: script `:412-455` (`stratMonths = 36`, `stratCushion =
  true`, `stratDebts`, `stratSaving`, `stratStart`, `stratMandatory`, `stratBuffer`, `stratA`,
  `stratB` с `keep: 0`, `lump: 0`); шаблон `:912-941` внутри секции «Что гасить первым»
  (`:836-943`, Segmented `adviceView` `:840-846`). Нет: горизонта, `kept`, `useSaved`,
  `movable`, `redirected`, `interestFree`, `gain`, ветки «Копить выгоднее», строки «без
  процентных долгов», Hint, заметки о беспроцентных; вторая колонка подсвечена всегда;
  заголовок «Сначала гасить» вместо «Сначала долги». `key = monthKey()` (`:85`), `credits`
  (`:91`), `obligations = liveObligations(...)` (`:92`), `goals = liveGoals(...)` (`:93`).
  После PV-01 долги — `openCredits(credits)`, `stratMandatory` — по открытым.
- Кит: `Field` (`<label>` — тап по подписи жмёт первую кнопку `Segmented`, хвост RP → PV-09,
  здесь не чинить), `Hint` со слотом, `Segmented` generic по строкам, `Callout`. Чекбоксов во
  Vue нет нигде (Р-21: нативный `<input type="checkbox">` с токенами внутри компонента).
- `monthlyAmount(o, key)` — `finance.ts`; `money`/`plain` — `lib/money.ts`.
- Тесты: `views/Capital.test.ts:124-152` — чистый вызов `simulateStrategy`; SSR `:154-232`
  рендерит `adviceView = 'order'`, калькулятор не проверяет. `lib/finance.test.ts:177-208` —
  один тест `simulateStrategy` (без `buffer`/`lump`/`debtFreeMonth`).

## Задача

1. `lib/finance.ts`: `strategyInputs({ credits, goals, obligations, key, kept, cushion,
   useSaved })` → `{ debts, saving, keep, start, movable, mandatory, buffer, lump,
   interestFree, redirected }` по формулам React (целые; `round(mandatory/1000)*1000` — здесь).
   `strategyGain(a, b)` → целое `round(b.net − a.net)`.
2. `components/StrategyCompare.vue` (Р-21): пропсы `credits` (открытые, из PV-01), `goals`,
   `obligations`, `monthKey`; состояние `months`/`kept`/`cushion`/`useSaved` с дефолтами React;
   опциональный проп `initial` для SSR-тестов и сценариев. Разметка и тексты — пункты 1–7 выше
   дословно; колонки подсвечиваются по знаку `gain`; цвета — только токены (`text-warn`,
   `border-brand`, `bg-brand-soft`), тёмная тема.
3. `Capital.vue`: шаблон `:912-941` → `<StrategyCompare :credits="openCredits(credits)" …/>`;
   `strat*` из script убрать. Гейт секции остаётся как есть (`worstDebt`).
4. Компонент только показывает: все суммы — из `strategyInputs` / `simulateStrategy` /
   `strategyGain`.

## Тесты

- `lib/finance.test.ts`: `simulateStrategy` — `buffer` набирается до досрочек (месяц 1: долг не
  уменьшился сверх графика, `savings` ≥ buffer); `lump` ограничен `start` и уменьшает `savings`;
  `debtFreeMonth`: `0` без процентных долгов, `null` при платеже ≤ процентов, `N` иначе;
  `strategyInputs`: `keep` только по `kept`, `movable` без `kept`, `buffer` округлён до тысяч и
  0 при `cushion=false`, `interestFree` = ставка 0 и остаток > 0, `lump = 0` при
  `useSaved=false`.
- `components/StrategyCompare.test.ts` (SSR, образец `PaidRow.test.ts`): дефолт — Горизонт
  «Год/Два/Три», обе колонки, «Сначала долги выгоднее на», «без процентных долгов … через N
  мес.», «Что не останавливать» с именами целей и «/мес», подпись подушки с суммой; при
  `initial.kept` = все цели — текст «Все цели отмечены как неприкосновенные…»; при 0%-кредите с
  остатком — заметка «Беспроцентные долги — …»; при `movable = 0` чекбокса «Вложить уже
  накопленное» нет; числа в колонках = `simulateStrategy` на тех же входах.
- `views/Capital.test.ts`: SSR Капитала с `adviceView` strategy (через `initial`/маршрут) —
  секция содержит «Одинаковые траты, разный порядок».

## Критерии приёмки

- Браузер: все семь элементов на месте; переключение горизонта, галок и целей меняет цифры;
  цифры колонок и вывод совпадают с `simulateStrategy` до тенге (сверить скриптом); закрытый
  кредит (PV-01) не влияет; тёмная тема — только токены; телефонная ширина без горизонтальной
  прокрутки.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- «Выбрать этот план» и пауза целей — PV-15 (компонент получит кнопку там).
- Доходность вклада/Отбасы в стратегии (`keep` как «декретный депозит» в ТЗ RP-23) — RP-23;
  хвост §4 про недостижимость «Копить выгоднее».
- Правка `Field` (`<label>` вокруг `Segmented`) — PV-09.
