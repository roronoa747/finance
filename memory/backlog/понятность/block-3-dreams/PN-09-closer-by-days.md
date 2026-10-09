# PN-09 — «Ближе на N дней» после взноса (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/src/lib/finance.ts`, `views/GoalDetail.vue`, `views/Dreams.vue`, `components/money/MonthPlan.vue` · Зависит от: PN-08 · Роли: member (взнос), viewer (видит строку героя)

## Контекст (что уже есть)

- Взнос — `GoalMovement` в `Goal.movements` (`types/finance.ts:62-75`, сумма со знаком, `date` ISO); стор
  `contribute(id, amount, by, note?, at?)` (`stores/finance.ts:1918-1930`), `withdraw` (:1932); «Отложил» / «Отложил
  всё» в «Месяце» — `putPlan(saves, { by, note })` (:2031) → `writePlan` → `contribute` по целям; вызов —
  `money/MonthPlan.vue:102`. Экран цели: `applyDeposit()` (`GoalDetail.vue:197-214`) → `contribute` + сдвиг счёта.
- Темп: `Goal.monthly` (план взноса); месяц движения — `movementMonth(date)` (`finance.ts:2229`); серия —
  `contributionStreak` (:2231); остаток — `goalRemaining` (:772); срок — `goalTerm(item, goal, key, forecast?)`
  (:3300 → `{ off, afterPlan, need, remaining, doneMonth, months }`), `goalMonths(remaining, monthly)` (:212).
- Герой «Мечт» — `views/Dreams.vue:71-73, 123-136`: `DreamCenter` с `percent` (`heroPercent`) и `month`
  (`heroMonth` — только «на паузе», иначе null — Р-116: срок на экране цели); строки целей — `ThumbRow` + `%`.
- Тост — `kit/Toast.vue` (слот, `action?`; внутри `AppShell` встаёт в `#shell-toast`); образец — `views/Week.vue:492-493`
  («Загружено N · Отменить», `note`). Сколько висит — решает родитель (`setTimeout`, ~4 с у заметок).
- Р-15: «после взноса или прихода зарплаты у мечты — «Квартира ближе на 12 дней» вместо сухого процента (из темпа
  взносов)». Р-116: одна крупная цифра — процент остаётся; «ближе на N дней» — строка под ним.

## Задача

1. `finance.ts`: **`goalPace(goal, key): number`** — темп в месяц: `monthly > 0` → `monthly`; иначе среднее
   положительных движений за последние 3 месяца по `movementMonth` (0 → 0). **`closerDays(amount, pace): number |
   null`** — `pace > 0 ? Math.round(amount / pace × 30.4) : null`, `amount ≤ 0` → null. **`closerThisMonth(goal, key)`**
   — `closerDays(сумма положительных движений месяца key, goalPace)` (для героя). Целые дни.
2. `GoalDetail.vue`: после `applyDeposit` (пополнение, не снятие) — `Toast` «{имя} ближе на N дней» (`data-closer`),
   4 с; `closerDays` null — тоста нет. Снятие — без тоста.
3. `MonthPlan.vue`: после `putPlan` («Отложил» у строки и «Отложил всё») — один тост: одна цель — «{имя} ближе на N
   дней»; несколько — «{первая по очереди} ближе на N дней · и ещё M»; фонды и долг не считаются (у подушки
   «дней» нет). Нет ни одной цели с `closerDays` — тоста нет (не мешать).
4. `Dreams.vue`: `heroMonth` — если герой не на паузе и `closerThisMonth(hero, key) > 0` → «ближе на N дней»
   (строка под процентом, `data-hero-closer`); иначе как сейчас. Viewer видит ту же строку (чтение).
5. Тексты — склонение `plural(n, 'день', 'дня', 'дней')`.

## Тесты

- `finance.test.ts` (или `lib/closer.test.ts`): `goalPace` — `monthly`, среднее трёх месяцев, 0; `closerDays` —
  100 000 при темпе 50 000 → 61 день, null без темпа; `closerThisMonth` — только положительные движения месяца.
- `GoalDetail.test.ts`/DOM: тост после пополнения с верным числом, нет после снятия.
- `MonthPlan.dom.test.ts`: «Отложил всё» — тост с первой целью и «и ещё M»; без целей — нет.
- `Dreams.test.ts`: SSR — `data-hero-closer` при движении месяца; гвард `WEEKLY` (:53) не нарушен.

## Критерии приёмки

- Критерий брифа: после взноса — «ближе на N дней». `cd frontend && npm run build && npx vitest run` зелёные; стенд:
  пополнить цель → тост; «Мечты» — строка под героем.

## Вне скоупа

- Данных в документе нет. Пуш/уведомления — Блок 5 B2C. «Сегодня можно N» — не взято (Р-9).
