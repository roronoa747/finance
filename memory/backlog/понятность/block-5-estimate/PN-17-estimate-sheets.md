# PN-17 — Листы «Прикинуть кредит» и «Хватит?» (фронт)

Блок 5 · MVP · Репо/каталог: `frontend/src/components/money/`, `components/AppShell.vue`, `components/money/DebtsWidget.vue`, `views/Money.vue`, `views/Month.vue` · Зависит от: PN-16 · Роли: member («+»), viewer («Прикинуть кредит» с «Долгов»)

## Контекст (что уже есть)

- Меню «+» — `components/AppShell.vue:110-120` (`actions`: шесть пунктов `{ to, title, note, icon }`, у viewer «+»
  нет :183; лист «Добавить» :185-191; `navigateAndClose`). Пункты ведут на адрес с query, экран открывает лист:
  `/money?add=payment` → `CapitalLists.vue:145-159` (`watch` на `?add=`), `/month?income=1` → `MonthPlan.vue:187-194`.
- «Долги» — `components/money/DebtsWidget.vue`: строки долгов, «Как закрыть быстрее» (:156-163), «+ Долг» (:167-169,
  `data-add-credit`), листы внизу (:171-175). Форма долга — `capital/NewDebtSheet.vue` (поля «Проценты: Без них /
  Знаю ставку / Знаю срок», `rateFromSchedule`) — образец полей суммы/срока/ставки.
- Кит: `Sheet`, `Field` + `NumField`/`NumFieldBlur` (`kind`/`:currency`), `Segmented`, `Hint`, `Card`, `Callout`;
  правила форм — `useFormCheck`. Деньги — `money()`, `plain()`; проценты — `ratePct`.
- Стор: `planInput(key)` → `{ state, ctx }` (`stores/finance.ts:278`), `planState()`, `heroGoal`, `monthPlanOf`.
- Правило 12 / Р-18: листы, не экраны; одно главное действие — тут его нет (результат считается от ввода); текста
  минимум — три строки результата; Р-116 — крупная цифра одна (платёж в месяц / «останется N»).

## Задача

1. **`money/TryCreditSheet.vue`** (`open`, `close`): поля «Сколько, ₸», «На сколько месяцев» (чипы 6 · 12 · 24 · 36 ·
   свой), `Segmented` «Знаю ставку · Рассрочка 0 %», при ставке — «Ставка, % годовых» (`NumField kind="rate"`,
   запятая как у кредитов). Ниже — карточка результата, живая от ввода (без кнопки «Посчитать»): крупно «{payment} в
   месяц»; три строки: «Нагрузка станет {loadPct} % дохода · сейчас {loadNowPct} %» (`--warn`, если ≥ 50 %),
   «{hero.name} отодвинется на {delayMonths} {мес.}» (0 → «не сдвинется»; `Infinity` → «не соберётся»; героя нет —
   строки нет), «Переплата {money(overpay)} · {overpaySalaries} {зарплаты}» (рассрочка — «без переплаты»). Пустые поля
   — результата нет, подсказка «Введите сумму и срок». Ничего не пишет; «Закрыть» — лист. Viewer видит так же.
2. **`money/AffordSheet.vue`** (`open`, `close`): поле «Сколько стоит, ₸»; результат живой: ok — «Да» крупно, строка
   «до зарплаты останется {left}» (+ «через {inDays} дн.» если есть); иначе — «Нет» (`--warn`), строка «не хватает
   {short}», вторая — «{goal} отодвинется на {days} {дней}» (есть). Без счетов — та же логика от остатка плана
   (`canAfford` решает), подпись не нужна.
3. **Входы:** `AppShell.actions` += «Прикинуть кредит · нагрузка, мечта, переплата» → `/money/debts?try=1` и «Хватит
   ли? · покупка до зарплаты» → `/month?afford=1` (`PhCalculator`, `PhQuestion`); `DebtsWidget` — тихая кнопка
   «Прикинуть кредит» (`data-try-credit`, `Button variant="ghost"`) рядом с «+ Долг», открыта и viewer; `Money.vue`
   / `DebtsWidget` следят за `?try=1` (как `?add=`), `MonthPlan.vue` — за `?afford=1`; после закрытия query
   снимается (`router.replace`).
4. `DESIGN.md` §2 (меню «+») и «Долги» — по фразе.

## Тесты

- `TryCreditSheet.dom.test.ts`: ввод → строки из `tryCredit` (сверить числа с функцией на той же семье); рассрочка —
  «без переплаты»; пустые поля — подсказка; ничего не пишется в документ (снимок `householdDoc` до/после равен).
- `AffordSheet.dom.test.ts`: «Да» / «Нет» по `canAfford`; без счетов — от `rest`.
- `AppShell.test.ts`: два новых пункта у member, «+» нет у viewer; `Money.b16.dom.test.ts` — `?try=1` открывает лист,
  кнопка `data-try-credit` видна viewer.

## Критерии приёмки

- Критерий брифа: «Прикинуть кредит» на реальном кредите владельца даёт правдоподобную нагрузку и сдвиг мечты;
  «Хватит?» отвечает «да/нет» с числом. `cd frontend && npm run build && npx vitest run` зелёные; стенд обе темы,
  member и viewer, демо.

## Вне скоупа

- Переход «Взять этот кредит» в форму долга — нет (без записи, Р-11). Сохранение прикидок — нет.
