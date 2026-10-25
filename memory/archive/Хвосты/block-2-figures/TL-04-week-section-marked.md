# TL-04 — Лист раздела платежей «Недели» без отмеченных строк (фронт)

Блок 2 · MVP · Репо/каталог: `frontend/` · Зависит от: Блок 1 🏁 · Роли: member, партнёр (свой лист) · Х-5, Р-8

## Контекст (что уже есть)

- `src/lib/finance.ts`:
  - `sectionWeek(ops, {week, categoryId, limit?, tops?, recurring?})` :5391 — фильтр только `isSpend` + раздел + `weekKey`
    (:5396), **параметра `marked`/`categories` нет** → в разделе платежей список берёт и отмеченные строки. Возвращает
    `{total, count, tops, days, more}`; `SECTION_TOPS = 3`, `SECTION_OPS = 5` :5383-5384.
  - `sectionMonth(…, marked?, categories?)` :5438 — у раздела платежей (`plannedElsewhere`) только неотмеченные
    (:5462: `!planned || (!!where.marked && !where.marked.has(op.id))`); `weekFeed` :5504 — тот же фильтр (:5513).
  - Крупная сумма строки «Недели» — `myWeek` :5278 → `factOf` :5261/`spentOf` :1364 = `unmarked` раздела платежей. Карта
    `later` :5294-5299 тоже не отсеивает отмеченные — проверить, нужна ли ей та же правка (если она питает лист).
- Лист — `src/components/week/SectionSheet.vue`: пропсы `{row: MyWeekRow | null, week, monthName}` :23; крупная сумма
  `money(row.amount)` :51 (`data-section-total`); список `detail = sectionWeek(store.shown, {...})` :35-44; «В платежи» у
  строк — при `planned` :34, :88. Монтаж — `views/Week.vue:685`; `weekFeed` с отметками — Week.vue:150-153
  (`store.totalMarks(store.shown)`).
- Демо-расхождение («Фидбек» Х-5): «Подписки» 1 990 ₸ крупно, в списке 4 990 + 1 990.

## Задача

1. `sectionWeek` принимает `marked` и `categories` (как `sectionMonth`) и у раздела платежей отсеивает отмеченные; `total`,
   `count`, `tops`, `days`, `more` считаются по тому же отсеянному списку.
2. `SectionSheet` передаёт `store.totalMarks(store.shown)`; крупная сумма и сумма строк списка равны.
3. Разделы не-платежей — без изменений.

## Тесты

- `src/lib/week.test.ts` (describe `sectionWeek` :211-249): раздел подписок с отмеченной 4 990 и неотмеченной 1 990 → в
  списке только 1 990, `total` = 1 990; без `marked` у раздела платежей — как у `sectionMonth` (строк нет); обычный раздел —
  как было (:241 «сумма недели из итогов и из операций сходится»).
- `src/views/Week.dom.test.ts` (:259-280): лист раздела подписок — `data-section-total` = сумма строк.
- e2e `e2e/tl-block2-figures.test.ts`: демо → «Неделя» → «Подписки» — крупная сумма равна сумме строк.

## Критерии приёмки

- На демо и семье на моках лист раздела платежей «Недели»: крупная сумма = сумма строк; отмеченные платежи в списке не видны.
- `npm run build && npx vitest run` зелёные; стенд Chrome 390.

## Вне скоупа

- «Месяц → Траты» — TL-05; листы «Наличные»/«Переводы людям» — TL-06.
