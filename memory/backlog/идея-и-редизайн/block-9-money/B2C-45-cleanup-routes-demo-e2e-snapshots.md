# B2C-45 — Уборка: пять экранов → редиректы, демо, e2e, снимки рядом с макетом (фронт)

Блок 9 · MVP · Каталог: `frontend/src/views/*`, `components/*`, `router/index.ts`, `views/Access.vue` (демо), `stores/operations.ts` (демо), `frontend/e2e/*` · Зависит от: B2C-42, B2C-43, B2C-44 · Роли: все

## Контекст (что уже есть)

- После B2C-41…B2C-44 всё из `Budget.vue` (571), `Capital.vue` (1 202), `DebtPlan.vue` (270),
  `Deposit.vue` (253), `History.vue` (75) живёт в `Money.vue` и листах. Их тесты:
  `views/Budget.test.ts` (13 упоминаний старых путей/текстов), `Capital.test.ts` (48),
  `DebtPlan.test.ts` (27), `Deposit.dom.test.ts`, `History.test.ts` (6), `monthMoments.test.ts`
  (12), `views.test.ts`, `router.test.ts` (10), `AppShell.test.ts`/`AppShell.dom.test.ts`,
  `PaidRow.test.ts` (12), `SalaryRow.test.ts` (10), `CapitalSheets.dom.test.ts`,
  `StrategyCompare.test.ts`, `src/test/screenState.ts`. Компоненты, которые могут остаться без
  потребителей: `Bar.vue`, `Legend.vue`, `Stat.vue` (кит), `Segmented` (если нигде больше),
  `ScheduleTable.vue` (остаётся у `CreditSheet`), `PhChartBar`-иконки.
- e2e (накопительный набор, `frontend/e2e/`, стенд «двух телефонов» `support/family.ts`;
  **адаптировать, не удалять** — каждое удаление в Handoff с причиной): `pv-block3-debt-plan`
  (36 упоминаний), `pv-block2-money-edit` (38), `block1-payments` (8), `pv-block5-shell-polish`
  (8), `block2-month-moments` (7), `block4-budget-ritual` (6), `block5-capital-goals` (5),
  `pv-block1-calculator` (4), `two-clients-sync` (4), `pv-block4-wishes-goals` (3),
  `block3-screens` (1), `b2c-block3-screens` (часть 9: «Деньги» спрашивают «Пришла зарплата» —
  остаётся, Р-39). Сценарии блока — новый файл `e2e/b2c-block9-money.test.ts`.
- Демо (`Access.vue` `startDemoMode()`, документ-пример; стор операций в демо — `demoUploads`,
  операций нет): лэндинг Блока 4 покажет «Попробовать» на «Деньгах» — «История» в демо должна быть
  не пустой.
- Снимки рядом с макетом — способ из Handoff Блока 3 «Возврат смоука» (`block-3-screens/SESSION.md`,
  строки ~642–649): скрипты в scratchpad (`mock.mjs` — `figure` макета → `.phone`; `stand.mjs` —
  стенд 390 px, тема через `colorScheme`, высота окна = высота прокрутки `<main>`; `pair.mjs` —
  склейка «макет | стенд»); `playwright-core` из корневого `node_modules`, Chromium
  `%LOCALAPPDATA%\ms-playwright\chromium-1223\chrome-win64\chrome.exe`, `MSYS_NO_PATHCONV=1`,
  `pathToFileURL` для кириллицы. Макет пивота — `pivot-3/index.html`: перед снимком выставить
  `localStorage` `ff-simplify-font=f3`, `ff-simplify-pal=neutral`, `ff-simplify-theme=light|dark`
  (скрипт страницы читает их при загрузке) — иначе снимется старый шрифт и тёплая палитра.
- Правило: сценарии приёмки накопительные; красный CI = блок не готов.

## Задача

1. **Удалить** `views/Budget.vue`, `Capital.vue`, `DebtPlan.vue`, `Deposit.vue`, `History.vue`, их
   тесты (проверки денег — уже перенесены в `Money.test.ts`/`finance.test.ts` задачами B2C-41…44;
   проверить, что ни одна проверка суммы не потерялась — список перенесённых в Handoff) и
   компоненты без потребителей (`grep` по импортам; `OpRow`/`Toggle` теперь с потребителями).
   `router/index.ts`: ленивые импорты удалённых экранов убрать; редиректы по B2C-41 остаются;
   старые `/budget`, `/capital`, `/capital/:id`, `/plan` ведут цепочкой на `/money…` (проверить
   `/capital/:id` → `/money?account=:id`). `AppShell.vue` — заголовки старых экранов (100–104) убраны.
2. **Демо**: документ-пример дополнить так, чтобы «Деньги» показывали все три квадрата с
   данными: план (`plans` с активным планом и кредитом), отметки за месяц (`payments` — оплата и
   зарплата), и **демо-операции** в сторе операций (сид вместе с `seedDemoUploads`: 15–20 строк за
   две недели по 4–5 разделам, продавцы из словаря, одна `internal`) — чтобы «История» и чипы были
   не пустые. Демо по-прежнему не зовёт `/api`.
3. **e2e**: адаптировать перечисленные файлы к новым адресам и текстам (`screen(pinia, Money,
   '/money/plan')` и т. п.), **сохранив проверки денег**; новый `e2e/b2c-block9-money.test.ts`:
   часть 1 — сводка: сумма = `untilPayday().dueTotal`, «Оплатил» из «Платежей» уменьшает K и видна
   партнёру ✓; часть 2 — план: «Выбрать этот план» → `Toggle` включён, «Шаг сделан» → досрочка и
   прогноз; часть 3 — история: раздел задним числом из «Истории» меняет `spendTotals` и
   «Свободно», партнёр видит отметку, не операцию; часть 4 — права: viewer на `/money`,
   `/money/plan`, `/money/history` без «Оплатил», «Добавить», полей и `Toggle`; часть 5 —
   редиректы старых адресов с query.
4. **Снимки «макет | стенд»** в обеих темах: «Капитал», «План», «История» (3 × 2) + листы «До
   зарплаты», счёт-вклад, кредит, «куда отнести?», итог месяца — в ряд; плюс главный и «Неделя»
   (шрифт и палитра — B2C-40) — таблица «экран → расхождение → правка → совпадает» в Handoff
   (формат Handoff «Возврат смоука» Блока 3). Снимки — в scratchpad, в репо не кладутся; пути — в
   Handoff; приёмка их пересняла и покажет владельцу.
5. **Правило 12 по экрану** в Handoff: главное действие «Денег» (сводка/«Пришла зарплата» или
   «Распределить»; Капитал — «Оплатил» тихие; План — «Шаг сделан»; История — нет), что ушло в
   подсказку (нагрузка, «откуда суммы», чистый капитал, инфляция вклада), что скрыто
   («Подробнее» ставки, «Копить или гасить?», «Шаги по месяцам», расчёт вклада, лист «До
   зарплаты»).

## Тесты

- Весь набор `npm test` (vitest, включая `e2e/`) зелёный после удалений и адаптаций; новый
  `b2c-block9-money.test.ts` части 1–5.
- `router.test.ts`: цепочки старых адресов; `views.test.ts`: `/money`, `/money/plan`,
  `/money/history` рендерятся в демо-состоянии без ошибок, «История» в демо не пуста.
- `pwa-build.test.ts`: сборка; главный чанк без предупреждения о размере; чанков удалённых
  экранов нет.

## Критерии приёмки

- `grep -rn "Budget.vue\|Capital.vue\|DebtPlan.vue\|Deposit.vue\|History.vue" frontend/src
  frontend/e2e` — пусто; `cd frontend && npm run build && npm test` зелёные; CI зелёный после
  push (с согласия владельца).
- Браузер: демо → «Деньги» — три квадрата с данными; старые адреса `/capital?credit=x`,
  `/budget`, `/plan`, `/money/capital/<id>` открывают нужное; экранов 15 → 10 (оставшиеся
  «Неделя»/«Мечты» — Блоки 10–11).
- Таблица снимков в Handoff: все строки ✅ или ≈ с записанной причиной.

## Вне скоупа

- «Неделя» и «Мечты» — Блоки 10–11. Удаление `OpRow`/`Toggle` — нет, они теперь в деле (хвост
  Н-17 закрывается этим блоком: `ScreenHeader` остаётся Блоку 4). Виртуализация, логотипы — после.
