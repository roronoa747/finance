# PN-23 — Формы ритма: первый запуск, «Изменить оклад», лист и кнопка «Пришла» (фронт)

Блок 7 · MVP · Репо/каталог: `frontend/src/components/SalaryDialog.vue`, `views/Start.vue`, `components/money/SalarySheet.vue`, `components/SalaryRow.vue`, `components/money/MonthPlan.vue`, `components/money/CapitalSalaries.vue`, `components/MarkSheet.vue` · Зависит от: PN-22 · Роли: member (своя зарплата), viewer (чтение)

## Контекст (что уже есть)

- «Изменить оклад» — `components/SalaryDialog.vue` (237 строк, проп `id`): «Имя» (:154), «Оклад сейчас, ₸» →
  `correctSalary` (:158-163), «День зарплаты» → `setPerson({ payday })` 1–28 (:165-167), подформа «Изменить оклад»
  (:176-219: валюта `CurrencyChips`, «Новый оклад» + `NbRateLine`, «С какого месяца», «Причина» → `amendSalary`),
  «История оклада» (:221-234).
- Первый запуск — `views/Start.vue` (шаги `upload | questions | month | dream | invite`, :43, :61): ручной ввод
  «Зарплата в месяц, ₸» + «День зарплаты (1–28)» (:366-378, `manualNext()` :108-114 → `setPerson(slot, { name,
  salary, payday })`); карточка «Это ваш доход?» из выписки (:383-391, `answerIncome` :196-219 — месячный ритм по
  найденному приходу); запасной ввод без найденного дохода (:404-414, `manualAfterQuestions` :277-282).
- Лист зарплаты — `money/SalarySheet.vue` (84 строки): сумма, «Когда», «Хватает», обмены, `<SalaryRow button>`
  «Пришла зарплата» (:67), «Другая сумма или снять» → `MarkSheet open="paid" kind="salary"` (:69, :74-82), «Изменить
  оклад» (:70). `components/SalaryRow.vue`: `tap()` (:112-125, одна отметка на прошлый счёт — после PN-02 вынесен в
  composable `useSalaryTap`), `mark()` (:95-104 → `markSalary(personId, { period, amount, accountId })`), `openMore()`
  (:127-132 → `MarkSheet` другая сумма/счёт), режим `button` (:136-148). `MarkSheet.vue` для зарплаты — `markSalary`
  (:179-181), `editPaid` (:174), `unmarkPaid` (:188); у неё есть поле суммы.
- Строки зарплат: `MonthPlan.vue:365-394` (`data-salary`, `data-can-mark`, ✓ `data-came`, после PN-02 — кнопка
  `data-salary-came-btn`), `CapitalSalaries.vue:26-48`; строки — `monthSalaries` (PN-22: `events`, `cameCount`,
  `eventCount`, `open`).
- Кит: `Segmented`, `Chip`, `Toggle` (`tone`), `Field`, `NumField`, `Select`, `Hint`, `useFormCheck`; названия дней —
  `lib/dates.ts` (`weekdayShort`), склонения `plural`.
- Правило 12: «Пришла» — кнопкой у своей строки; текста минимум; механика — в `Hint`.

## Задача

1. **`SalaryDialog.vue`** — блок «Как приходит» над «День зарплаты»: `Segmented` «Раз в месяц · Аванс и зарплата ·
   Каждую неделю» (`payRhythm`); поля по ритму: `month` — «День зарплаты» (как есть); `advance` — «День аванса»,
   «Аванс, ₸» (`salary2`, в валюте оклада), «День зарплаты» (остаток, подпись «остальное — {salaryOf − salary2}»);
   `week` — чипы дня недели «пн … вс» (`weekday`), подпись оклада «Оклад сейчас — за неделю, ₸» и подформа «Изменить
   оклад» тоже «за неделю» (`NbRateLine` — курс за неделю). Переключение ритма пишет `setPerson` сразу (по уходу /
   выбору, `SavedMark`); `week` → `salary` трактуется как недельный: при переключении месяц → неделя предложить
   «оклад ÷ 4,33» в поле (подсказка, не автозапись). `Toggle` «Сумма меняется» (`floating`, `tone="ok"`) с `Hint`
   «„Пришла“ спросит сумму; в плане — среднее трёх последних».
2. **`Start.vue`** ручной ввод (:366-378 и :404-414): тот же блок ритма в компактном виде — `Segmented` + поля по
   ритму (общий компонент `components/PayRhythmFields.vue`, используемый и в `SalaryDialog`); карточка «Это ваш
   доход?» из выписки — без ритма (месяц), после неё можно сменить в «Изменить оклад».
3. **Лист зарплаты** для `advance`/`week`: вместо одной суммы — список событий месяца (`line.events`): «пт 3 окт ·
   150 000 · ✓» / «пт 10 окт · 150 000 · Пришла» (кнопка у своего открытого события — `useSalaryTap` с `period`
   события); итог месяца крупно (`line.amount`), «Когда» → «{cameCount} из {eventCount} пришли»; «Другая сумма или
   снять» — на выбранное событие (`MarkSheet` с `period` события). `month` — без изменений.
4. **Кнопка «Пришла» в строке** (`MonthPlan`, `CapitalSalaries`, после PN-02): для `advance`/`week` отмечает ближайшее
   открытое событие; у строки — «✓ 2 из 4» вместо одной галочки (`data-came-count`); сумма строки — месяц.
5. **Плавающий (Р-6):** `floating` → кнопка «Пришла» (строка и лист) открывает `MarkSheet open="mark"` с полем суммы
   (прошлый счёт подставлен, сумма — пустая, обязательная), одной отметки без суммы нет; подпись ожидаемой суммы в
   строке — «≈ {среднее}» (`--ink-2`).
6. `DESIGN.md` — «Месяц»/«Капитал» строки зарплат, лист, «Изменить оклад»: абзац «ритм».

## Тесты

- `SalaryDialog.dom.test.ts`: ритм пишет `payRhythm`/`payday2`/`salary2`/`weekday`; `floating` — `Toggle`; недельная
  подпись; viewer — без формы.
- `Start.dom.test.ts`: ручной ввод с ритмом «неделя» → `setPerson` с `weekday` и недельным окладом; путь по выписке —
  без ритма.
- `CapitalSheets.dom.test.ts`/новый `SalarySheet.dom.test.ts`: лист недельной зарплаты — события, «Пришла» у открытого,
  «2 из 4»; плавающая — `MarkSheet` с суммой, без одной отметки.
- `MonthPlan.dom.test.ts`: строка «✓ 2 из 4», кнопка отмечает ближайшее событие (`period` ISO-дня).

## Критерии приёмки

- Критерий брифа: участник с недельной зарплатой видит верный план и «Пришла» по неделям. `cd frontend && npm run
  build && npx vitest run` зелёные; стенд обе темы: три ритма, плавающий, viewer.

## Вне скоупа

- Выписка и полоска — PN-24. Несколько источников — после MVP.
