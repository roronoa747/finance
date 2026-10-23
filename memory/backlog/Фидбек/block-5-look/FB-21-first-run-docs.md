# FB-21 — Первый запуск «сначала траты»: мечта → «Тратьте как обычно»; через две недели — «Поставить план»; «Месяц» без дохода (фронт, lib)

Блок 5 · MVP · Каталог: `frontend/src/views/Start.vue`, `router/landing.ts`, `router/index.ts`, `lib/finance.ts`, `lib/statements/firstRun.ts`, `components/plan/PlanSwitch.vue`, `components/money/MonthPlan.vue`, `views/Week.vue` (+ новый `components/useIncomeAnswer.ts`), `views/Month.vue`, тесты рядом · Зависит от: FB-19 (строка «Траты» и сегмент), Р-30, Р-35…Р-37 · Роли: новая семья, партнёр по коду, любая семья без своего плана трат

## Контекст (что уже есть)

- **Эталон** — Figma `18:2`: «Первый запуск · день 1» `19:156`, «Через 2 недели · Поставить план» `19:178` (точка на сегменте
  «Месяц», строка «Траты» с маленькой брендовой «Поставить план» и подписью «обычно в месяц», лист «План трат» — три строки,
  «ещё 6 разделов · 135 000», брендовая «Поставить»). Решения — Р-35 (порядок шагов и куда уходят вопросы), Р-36 (расчёт
  «План по факту»), Р-37 («Месяц» без дохода).
- **Первый запуск** `views/Start.vue` (616 строк): шаги `intro → dream → salary → questions → invite` (партнёр по коду:
  `intro → salary → questions`), `OLD_STEPS` :46, `joining` :64, `resume` :71, `finish()` :409 (`onboardedAt`, `finishSetup`,
  `track('first_run_done')`, `/`), шаг `salary` с полями ритма и «Есть PDF из банка» → `pick` → `uploadParsed` (`ops.setDraft` +
  `ops.send`) → `questions` (`firstRunQuestions`: доход `answerIncome` :289-315 — оклад, правило зарплаты, отметка месяца;
  повторы `answerRecurring` :343-371 — обязательство/кредит + `markPaid` + `recategorize`), `answered` на устройстве
  (`START_ANSWERED_KEY`). Мечта — `GoalNew` с `next="/start/salary"`. Фото мечты — `usePhoto(goal.photoId)` (`lib/photos/usePhoto`,
  как `Dreams.vue:95`), образ — `kit/DreamHero.vue` (`line`, `src`, `size`).
- Роутер: `router/landing.ts` `landingPath` (без `setupDone` → `/start`, если нет `hasBudgetData` + `onboardedAt`); гард
  `router/index.ts:190-203` (`joining` = `setupDone && me && !me.onboardedAt`). Тесты `landing.test.ts`, `Start.dom.test.ts`
  (FR-01…FR-03 — поток «мечта → зарплата → партнёр»; переписать под новый поток), `Start.test.ts`.
- Apple Pay: `stores/applepay.ts` (`available`, `isIPhone`, `status`, `connected`, `load()`), подключение — лист
  `/settings?applepay=1` (образец условий — `applepay/ApplePayWeekLine.vue`).
- **«Неделя» — очередь вопросов** `views/Week.vue:243-374`: `decisionQueue(state, {canEdit, matches, unknown, answeredMonthEnd,
  week})` (`lib/finance.ts:5652`, `Decision {key, kind, question, meta, actions, …}`), `DecisionCard`, `defer`
  (`ff_decisions_deferred`), `onPrimary/onSecondary/onGhost`. Доход из выписки сейчас спрашивается только в `Start`.
- **Повторы**: `lib/statements/firstRun.ts` — `detectIncome` :125 (`IncomeCandidate`), `detectRecurring` :186, `recurringOf(op,
  ops, {rules, payments, today})` :236 → `RecurringPrefill`; стор `recurringFor(op)`; `components/AddPaymentSheet.vue` (проп
  `opId`, открывает `NewObligationSheet` с `prefill`; «Месяц» уже держит `<AddPaymentSheet :op-id="payOp">`, `MonthPlan.vue:1105`).
- **План трат**: `householdDoc.spendPlans` (`SpendPlan {by, categoryId, amount}`), стор `setSpendPlan(by, categoryId, amount)`
  :2134; лист «Сколько в месяц» `editSpend` (`MonthPlan.vue:542`); `monthPlan().spend` — строки плана и факт; «обычно» сейчас —
  `usualSpend` по **полным месяцам** (`usualMonths`, `monthCovered`, `finance.ts:4095-4143`); итоги недели — `SpendTotal kind
  'week'` (`period` `YYYY-Www`), `spentOf(t, live)` (без разовых), `oneOffOf`, `plannedElsewhere`, `UNKNOWN_CATEGORY`,
  `SPEND_LAST` (`sc_people`, `sc_cash`); загрузки — `UploadPeriod {slot, period_from, period_to}` (`finance.ts:5038`),
  `weekRange`, `coversWeek`.
- **Сегмент и точка**: `plan/PlanSwitch.vue` — пропы `view, month?, dot?` (`data-plan-dot` у «Месяца», сейчас только
  `ai.reviewUnseen`); `Week.vue:393`, `Month.vue:66`. Строка «Траты» — `sections` (`MonthPlan.vue:170-209`), подпись `meta`.
- **«Месяц» без дохода**: `monthPlan` — `income` пустой при окладе 0, `free = 0 − dues − spend` → `short > 0` → «Не хватает»
  красным; `salaries` пустые (участник без оклада в `income` не попадает) → карточка зарплат — только «+ Внеплановый доход»;
  оклад ставится через `SalaryDialog` (`components/SalaryDialog.vue`, проп `id` участника; его зовёт `SalarySheet` «Изменить
  оклад») или `/settings/me`.
- Данные владельца: первые выписки — Kaspi/Freedom за 1–3 месяца, то есть «две недели» часто покрыты первой же загрузкой.

## Задача

1. **Шаги первого запуска** (Р-35, владелец 2026-10-23): новая семья — `intro → dream → spend → invite`; партнёр по коду —
   `intro → spend`. Шаг `spend` (`/start/spend`, Figma `19:156`): «Пропустить» в шапке (= «Позже»); фото мечты семьи
   (`DreamHero size="preview"` с именем мечты; без мечты — плитка без фото); заголовок «Тратьте как обычно», строка «Через
   пару недель покажем, куда уходит»; две плитки-выбора `data-start-path` «Выписка» (по умолчанию) и «Apple Pay» (только
   `ap.available && ap.isIPhone`; значок + слово, без «Pay»-дублей); внизу одна брендовая кнопка по выбранной плитке:
   «Загрузить выписку» → выбор файла → `readStatementFiles` → `ops.setDraft` + `ops.send` (как `uploadParsed`) → дальше;
   «Подключить Apple Pay» → запомнить выбор (`ref`) → дальше; тихое «Позже» → дальше. «Дальше» = `afterSpend()`: новая семья —
   шаг `invite` (как сейчас: «Создать код» / «Готово», «Пропустить» до кода), партнёр по коду — `finish()`. `finish()` ведёт:
   была выписка → **`/week`** (неделя выписки на экране); выбран Apple Pay → `/settings?applepay=1`; иначе `/`. Ошибки
   чтения — `Callout warn` как были. Шаги `salary` и `questions` из `Start.vue` **убрать** вместе с формой оклада и карточками
   вопросов; `OLD_STEPS`: `upload/salary/questions → spend`, `month → invite`. `resume`: мечта есть — `spend`, иначе `intro`
   (партнёр — `spend`; «Пропустить» на `spend` ведёт на `invite`). «n из k» — «1 из 3 / 2 из 3 / 3 из 3» (мечта, траты,
   партнёр); у партнёра — без полосы.
2. **Вопрос о доходе — в очередь «Недели»** (Р-35): `decisionQueue` получает `income?: IncomeCandidate | null` и отдаёт
   `Decision {kind: 'income', key: 'income:<candidate.key>', question: 'Это ваш доход?', meta: <сумма · день · отправитель>,
   actions: {primary: 'Да, это зарплата', secondary: 'Нет', ghost: 'Потом'}}` первым в очереди; `Week.vue` передаёт кандидата
   `detectIncome(store.all)[0]`, когда у меня оклад 0 (`me.salary`), ключ не в `answered` (`START_ANSWERED_KEY`, как было) и не
   отложен. Логику «Да» (`setPerson` оклад/день/ритм, правило зарплаты, отметки месяцев — `answerIncome` + `markWeeks` из
   `Start.vue`) вынести в `components/useIncomeAnswer.ts` (поля суммы и дня — в `#inner` карточки, как было в `Start`);
   «Нет» — ключ в `answered`; «Потом» — `defer`. Оклад поставлен — вопрос исчезает, «Месяц» получает доход.
3. **Повторы — «нашли N в выписке»** (Р-35): `firstRun.ts` → `foundPayments(ops, ctx) : (RecurringPrefill & {opId: string;
   key: string})[]` — группы `detectRecurring` по своим операциям за 3 месяца, у которых `recurringOf(первая операция)` не
   null (то есть ещё не платёж и не отмечена), одна строка на группу, по сумме вниз. «Месяц»: подпись строки «Платежи» —
   «нашли N в выписке» (`data-section-found`), когда платежей месяца нет (`plan.dues.length === 0`) и N > 0; при раскрытии
   «Платежей» под платежами месяца — список «Нашли в выписке» (`data-found-row`: имя, «≈ день-го», сумма, маленькая `xs`
   `secondary` «В платежи») → `AddPaymentSheet :op-id` (существующий путь FB-09: форма с заполнением, «Сохранить» → платёж +
   отметка + правило). Строка пропадает, когда платёж заведён. Отдельных вопросов «Записать?» нет.
4. **«План по факту» — расчёт** (Р-36, `finance.ts`): `usualWeekly(totals, categories, uploads, by, today) : {weeks: string[];
   amounts: Map<categoryId, number>} | null` — мои **полные** недели (понедельник–воскресенье целиком внутри моих загрузок,
   неделя закончилась до `today`), не больше 8 последних; меньше 2 — null; сумма по разделу за неделю — `spentOf` итогов
   `kind 'week'` (без разовых; раздел без трат в неделе — 0); среднее за неделю → в месяц `× 52 / 12`, вверх до тысячи
   (`Math.ceil(x / 1000) * 1000`). `planByFact(state, ctx, by, today) : {rows: {categoryId, name, amount}[]; total} | null` —
   null, если у `by` уже есть живая строка плана (`spendPlans`), или мои загрузки покрывают меньше `PLAN_FACT_DAYS = 14` дней
   (объединение периодов, не позже `today`), или `usualWeekly` null; строки — без `UNKNOWN_CATEGORY`, `plannedElsewhere`,
   `SPEND_LAST`, с суммой > 0, по убыванию. Константы именованные (владелец правит числом).
5. **Призыв и лист «План трат»**: стор `planFactCall()` (функция, как `planCall`) → `planByFact(...)` для `me` или null;
   `PlanSwitch` на «Неделе» — `dot` = `ai.reviewUnseen || !!planFactCall()`; «Месяц»: строка «Траты» при `planByFact` — подпись
   «обычно в месяц», маленькая брендовая `xs` «Поставить план» `data-plan-fact` между подписью и суммой (сумма строки —
   `planByFact.total`), нажатие → `Sheet` «План трат» `data-plan-fact-sheet`: строки разделов (значок-буква, имя, сумма) — первые
   3 и тихая строка «ещё N разделов · Σ» (нажатие раскрывает все), внизу брендовая «Поставить» → `setSpendPlan(me, cat, amount)` по
   каждой строке → лист закрывается, тост «План поставлен»; дальше строка «Траты» — как обычно (план есть), точка гаснет. Семья
   с планом — ничего из этого не видит. Прошлые месяцы (`MonthPast`) — без кнопки.
6. **«Месяц» без дохода** (Р-37): `plan.income.total === 0` → подпись «Остаётся», число «—» `text-ink-2` (`data-rest-none`),
   без «Не хватает» и `--warn`, кольцо — только дорожка; `Hint` — «Доход месяца не указан.»; в карточке зарплат у участника без
   оклада (свой) — тихая строка `+ Зарплата` `data-add-salary` → `SalaryDialog :id="me"`; «Отложил всё», «Хватит?» — как были
   (считают по нулю). Партнёр без оклада в чужом телефоне — строки нет (его дело).
7. `landingPath`/гард: без изменений по смыслу (`setupDone` ставится в `finish()`); `hasBudgetData` — семья с одной мечтой и
   без оклада после `finish` открывает `/` (проверить тестом). События `first_run_done` — как были.
8. Комментарии-шапки `Start.vue`, `firstRun.ts` (раздел «первый запуск»), `PlanSwitch.vue`, `MonthPlan.vue` — обновить.

## Тесты

- `firstRun.test.ts`: `foundPayments` — группа с правилом `payment` не выходит; уже отмеченная — не выходит; одна строка на
  группу; порядок по сумме.
- `finance.test.ts` / `planByFact.test.ts`: `usualWeekly` — неполная неделя (загрузка со среды) не в счёт; текущая неделя не в
  счёт; одна полная неделя → null; две недели 20 000 и 30 000 по «Продукты» → 25 000 × 52/12 = 108 334 → 109 000; `planByFact`
  null при 13 днях покрытия и при наличии своей строки плана; «Не разобрано», платежи, люди/наличные и разовые — мимо; у
  партнёра — свой результат.
- `decisionQueue` (`finance.test.ts`): `income` — первым; без кандидата — как было (снимки прежних тестов не меняются).
- `Week.dom.test.ts`: карточка «Это ваш доход?» при окладе 0 и приходе в выписке; «Да» → оклад и правило (`useIncomeAnswer`),
  карточки нет; «Нет» — помнится; «Потом» — сутки; viewer/оклад есть — карточки нет.
- `MonthPlan.dom.test.ts`: «нашли N в выписке» и список с «В платежи» → `AddPaymentSheet`; после «Сохранить» строки нет;
  «Поставить план» и лист: три строки + «ещё N», «Поставить» → `spendPlans` по строкам, тост, кнопка и точка пропали; без
  дохода — «—», нет «Не хватает», «+ Зарплата» → `SalaryDialog`.
- `PlanSwitch.dom.test.ts`: точка при `planFactCall`.
- `Start.dom.test.ts`, `Start.test.ts`, `landing.test.ts` — переписать под поток `intro → dream → spend → invite`:
  «Пропустить»/«Позже» → шаг партнёра → «Пропустить» → `/`; выписка → операции в сторе → партнёр → «Готово» → `/week`;
  Apple Pay-плитка только на iPhone → после партнёра `/settings?applepay=1`; партнёр по коду — `intro → spend` → `finish`;
  старые адреса `/start/salary|questions` → `spend`, `/start/month` → `invite`; `finishSetup` и `onboardedAt` ставятся на всех
  выходах; тесты шага партнёра FR-01/FR-03 остаются по смыслу.
- Мутанты: `PLAN_FACT_DAYS` 14 → 0; округление вверх → вниз; `foundPayments` без фильтра `recurringOf`; `income` не первым —
  красные.

## Критерии приёмки

- Новая семья с нуля на стенде (регистрация моков, Chrome 390): вступление → мечта → «Тратьте как обычно» → выписка →
  «Пригласите партнёра» («Пропустить» или код) → «Неделя» с тратами; зарплату и план не спрашивают; «Месяц» показывает «—» без красного; в «Неделе» карточка «Это ваш доход?»
  (если приход есть) — «Да» даёт доход «Месяцу»; в «Платежах» — «нашли N в выписке» → «В платежи» заводит платёж.
- Выписка за ≥ 14 дней и нет плана → точка на сегменте «Месяц» и «Поставить план» в строке «Траты»; лист — разделы из
  «обычно по неделям»; «Поставить» пишет `spendPlans`, «Неделя» получает полосу плана (FB-19).
- Семья с планом (демо, владелец) — ничего нового не видит, кроме вида FB-19/20.
- `cd frontend && npm run build && npx vitest run` — зелёные.

## Вне скоупа

- e2e блока и DESIGN.md — FB-24. Серверных изменений нет.
- Пересчёт «обычно» в листе раздела (`usualSpend` по месяцам) — не меняем; `usualWeekly` — только для «Плана по факту».
- Повторное предложение плана (план есть, но факт ушёл) — карточка «Поставить план» разбора v4 (Р-24), не здесь.
- Шаг «Пригласите партнёра» не меняется (остаётся по решению владельца 2026-10-23) — только его место в порядке шагов.
- Вопрос о доходе для партнёра по коду в семье, где оклад уже стоит, — не задаётся (оклад есть).
