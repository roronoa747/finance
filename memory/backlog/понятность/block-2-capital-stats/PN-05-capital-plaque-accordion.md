# PN-05 — Плашка «счета − долги» и аккордеон статистики (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/src/views/Money.vue`, `frontend/src/components/money/` · Зависит от: PN-04 · Роли: member, viewer

## Контекст (что уже есть)

- `views/Money.vue:41-52` — плашка (см. PN-03): `data-capital`, число `data-worth`, `Hint data-worth-hint` с «Счета и
  цели — N, долги — M»; `assets` (:31), `debt` (:32), `worth` (:29). `finance.monthPlanOf(key)` — вход плана
  (`stores/finance.ts:288`). `planState()` стора — вход `debtsOverview` (`DebtsWidget.vue:39`:
  `debtsOverview({ ...financeStore.planState(), plans: financeStore.plans }, key)`).
- Кит: `kit/StackBar.vue` (`segments: { key, share, color }[]`), `kit/Card.vue`, `kit/Hint.vue`; раскрытие на месте в
  проекте — `ref` + `aria-expanded` + шеврон `PhCaretRight rotate-90` (`CapitalLists.vue:205-231` «Цели · N»,
  `DebtsWidget.vue:125-150` «Людям · N») либо `<details>` (`GoalDetail.vue:398`). Токены — `style.css` (`--s1`,
  `--s3`, `--s12`, `--ok`, `--ink-2`, `--warn`; у каждого пара тёмной темы). Шкала: крупная цифра `type-big` 34,
  подписи `--ink-2` (Р-117).
- Эталон — утверждённый `capital-stats.html` (PN-03, «Ворота макета» в SESSION.md).
- **Гвард тишины:** `views/Money.test.ts:321` — в SSR «Денег» нет строк «До зарплаты», «Подробнее», «Доход», «остаток по
  плану», «Пришла зарплата». Аккордеон по умолчанию закрыт, тело — `v-if` (не `v-show`, не открытый `<details>`): в
  SSR закрытого экрана статистики нет, гвард цел; подписи долей — «кредиты», «платежи», «в цели», «остаётся» (слова
  «Доход»/«остаток по плану» не использовать). `Money.b16.dom.test.ts` проверяет `data-worth-hint` — переписать на
  формулу.
- Форматы: `money()` / `plain()` (`lib/money.ts`), `monthIn(key)` («в марте 2027»), `plural` (`lib/utils`).

## Задача

1. **Плашка (Р-2):** под числом капитала — строка `--ink-2` `data-worth-formula`: «счета {assets} − долги {debt}»
   (`plain`, без «₸» дважды — как в макете). `Hint` «Что такое капитал» убрать (числа видны). Вся плашка — кнопка
   (`role="button"`, `aria-expanded`, `data-capital-stats`), нажатие раскрывает статистику под формулой; шеврон по макету.
   Состояние — локальный `ref`, при каждом заходе на экран закрыто (сложное скрыто, правило 12).
2. **Аккордеон (Р-3)** — новый `components/money/CapitalStats.vue` (пропсы: `stats: CapitalStats`), внутри:
   - `StackBar` из `stats.parts` (цвета — токены макета: кредиты `--s12`, платежи `--s1`, в цели `--s3`, остаётся
     `--ok` — или те, что утвердил макет); `income ≤ 0` — полоски и строк нет, одна строка «Нет дохода месяца —
     задайте оклад» (`--ink-2`).
   - Четыре строки `data-stat-row="<key>"`: метка цвета, подпись, сумма `money`, `N %` (`num`); `short > 0` — у
     «остаётся» 0 и подпись `--warn` «не хватает {short}».
   - `data-growth`: «Капитал растёт на ~{round1000(growth)} в месяц»; `growth ≤ 0` — строки нет.
   - `data-debt-free`: «Без долгов к {monthIn(month)} · переплата {money(amount)}» и второй строкой `--ink-2`
     «переплата — {salaries} {зарплаты} · к {monthIn(month, false)} — ещё {months} {зарплат}»; `overpay.amount` null →
     «переплата не считается — платёж не покрывает проценты» вместо суммы; `debtFree.month` null и кредиты есть →
     «Долги не закрываются при текущих платежах»; кредитов нет → одна строка «Долгов нет».
   Склонения — `plural`; «1,5 зарплаты» — `inSalaries` с одной десятой (запятая — `toLocaleString('ru-RU')` как у
   ставок). Viewer видит и раскрывает так же (читает).
3. `Money.vue`: `stats = capitalStats(finance.monthPlanOf(key), { ...finance.planState(), plans: finance.plans,
   credits: finance.credits }, key)`; компонент под формулой при раскрытом состоянии (`v-if`).
4. `DESIGN.md` — абзац о плашке Капитала (формула, аккордеон, токены долей) в секции экрана «Деньги».

## Тесты

- `views/Money.b16.dom.test.ts` (или новый `Money.stats.dom.test.ts`): закрыто — есть `data-worth-formula` с суммами
  `assets`/`debt`, нет `data-stat-row`; клик по плашке — четыре строки, проценты, `data-growth`, `data-debt-free`;
  повторный клик — закрыто; viewer — раскрывает; семья без кредитов — три строки и «Долгов нет»; `income` 0 — строка
  «Нет дохода месяца». Мутация «тело `v-show`» → `Money.test.ts:321`/SSR-тест закрытого экрана красный.
- `views/Money.test.ts`: SSR закрытого экрана — формула есть, строк статистики нет; гвард :321 не ослаблен.

## Критерии приёмки

- Критерий брифа: на плашке без подсказки видно «счета − долги», нажатие раскрывает полоску, понятную без текста.
- Совпадает с утверждённым макетом (PN-03) в обеих темах; цвета — только токены; одна крупная цифра на экране.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд 390 px, обе темы, member и viewer, демо и семья
  без кредитов; консоль чистая.

## Вне скоупа

- Пересчёт «зарплат» по ритму — Блок 7 (PN-24). Статистика на «Мечтах» или «Месяце» — нет (Р-3: на плашке).
