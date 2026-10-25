# FG-04 — «Деньги»: капитал, долги, история + листы (Figma, без кода)

Блок 0 · MVP · Figma · Зависит от: FG-03 · Роли: —

## Контекст (что уже есть)

- Правила сборки, стенд, бюджет — FG-01 «Контекст». `19:2` «Деньги» (капитал) **переезжает** в ленту (Р-2), содержимое правит
  FG-13 (валюта) — не трогать.
- Экраны (`frontend/src/`): `views/Money.vue` + сегмент `money/MoneySquares.vue` (Капитал · Долги · История; после FG-09 — с
  ползунком); **Капитал** — `money/CapitalLists.vue` (капитал `data-worth` с `Hint`, списки «Счета» (строка с «Траты отсюда»
  у карты), «Цели · N», «Платежи» (`PaymentLine`), группы) — листы `capital/AccountSheet.vue` (сверка остатка, «Траты отсюда»
  с выбором хозяина, валютный счёт с курсом), `capital/NewAccountSheet.vue`, `money/FxRateSheet.vue`, `capital/GroupSheets.vue`;
  **Долги** — `money/DebtsWidget.vue` (строки кредитов и долгов людям с «Оплатил»/«Отдал» в строке и ✓, полоса), «Закрыть
  быстрее» `views/DebtFaster.vue` (`/money/debts/faster`), листы `capital/CreditSheet.vue` («Оплатил», «Внёс досрочно»,
  «подробнее» → калькулятор), `capital/PrepaySheet.vue` (взнос → «Молодец!» было → стало), `capital/PayoffSheet.vue`
  (калькулятор), `capital/NewDebtSheet.vue`, `capital/ObligationSheet.vue`, `capital/NewObligationSheet.vue`,
  `components/AddPaymentSheet.vue` («Подписка или платёж»), `money/TryCreditSheet.vue` («Прикинуть кредит»); **История** —
  `money/HistorySquare.vue` + `money/HistoryMonths.vue` (месяцы, `money/CapitalStats.vue` статистика капитала за «подробнее»).

## Задача

Макеты по порядку ленты: 16 Деньги · Капитал (**переместить `19:2`**) · 16.1 → счёт (`AccountSheet`, карта с «Траты отсюда»)
· 16.2 → валютный счёт (`AccountSheet` с курсом) · 16.3 → новый счёт (`NewAccountSheet`) · 17 Деньги · Долги (`DebtsWidget`:
кредит с «Оплатил», долг человеку с «Отдал», оплаченный с ✓) · 17.1 → кредит (`CreditSheet`) · 17.2 → «Внёс досрочно»
(`PrepaySheet`, итог «было → стало») · 17.3 → калькулятор (`PayoffSheet`) · 17.4 → новый долг (`NewDebtSheet`) · 17.5 → платёж
(`ObligationSheet`) · 17.6 → подписка или платёж (`AddPaymentSheet`) · 17.7 Закрыть быстрее (`DebtFaster`) · 17.8 → прикинуть
кредит (`TryCreditSheet`) · 18 Деньги · История (`HistorySquare`) · 18.1 → статистика капитала (`CapitalStats`, раскрыто).
`GroupSheets`, `FxRateSheet`, `NewObligationSheet` — при остатке бюджета.

Правила — FG-01 п. 3. Handoff: вызовы MCP, id, где остановились.

## Тесты

- Кода нет; один `get_screenshot` новых фреймов в конце.

## Критерии приёмки

- Лента «Капитал → счета → Долги → кредит → досрочка → калькулятор → История»; `19:2` на месте 16 с теми же id/комментарием
  К-9 (пока приёмка Блока 1 его не удалила).

## Вне скоупа

- Содержимое `19:2` (FG-13); тёмная тема; viewer; админ-экраны Apple Pay (`applepay/Admin*`).
