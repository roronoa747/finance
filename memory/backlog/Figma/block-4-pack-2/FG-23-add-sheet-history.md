# FG-23 — Лист «+»: плитки «Доход» / «Расход», подлист «Расход»; «Хватит?» → «История» месяца, лист «Хватит?» убран (фронт)

Блок 4 · MVP · Репо/каталог: `frontend/src` · Зависит от: FG-19 · Роли: участник («+» и «История»); viewer — «+» нет, «История» не показывается

Эталон — `47:115` «08.1 · Мечты → Добавить», `74:178` «08.1.1 · Добавить → Расход», `18:105` «13 · Месяц» (чип «История» вместо
«Хватит?»); лист `50:646` «13.8 · Хватит?» владелец убрал из потока. Размер **S**: структура листа и новый лист истории месяца;
история ничего не считает (суммы операций — как в «Истории» недели).

## Контекст (что уже есть)

- **Лист «+»** — `components/AppShell.vue:157-175` `actions` (10 строк `Row` с иконкой, `title`, `note`; порядок: Трата, Заметка,
  Загрузить выписку, Новая мечта, Покупка в список желаний, Внеплановый доход, Подписка или платёж, Долг, Прикинуть кредит, Хватит
  ли?), шаблон `:241-247` (`Sheet title="Добавить"`, `Row … clickable dense`), `navigateAndClose(to)` `:177-180`, `addOpen` `:58`.
  Адреса: `/week?spend=1`, `/week?note=1`, `/week?upload=1`, `/goals/new`, `/wishes`, `/month?income=1`, `/money?add=payment`,
  `/money?add=debt`, `/money/debts?try=1`, `/month?afford=1`. У viewer «+» нет (`Tabs :plus`).
  `kit/Sheet.vue` — `title` (обязателен), `titleHidden` (заголовок только диктору); слота над заголовком нет.
- **«Хватит?»** — `components/money/MonthPlan.vue:287-290` (`useQuerySheet('afford')`), чип `:737` `Button secondary sm
  data-afford-open`, лист `:1131` `AffordSheet`; `components/money/AffordSheet.vue` (+ `AffordSheet.dom.test.ts`); чистые функции
  `lib/finance.ts:3865-3935` `canAfford`, `affordWhy`, `affordWhyText` (используются только листом и тестами `lib/affordWhy.test.ts`,
  `lib/estimate.test.ts`, `lib/demo.dreamLines.test.ts` — проверить grep-ом перед удалением); `components/useQuerySheet.ts:37` —
  комментарий про `?afford=1`.
- **«История» недели** — образец: `views/Week.vue` строка `data-week-feed` → `components/week/WeekFeedSheet.vue` (`Sheet
  title="История"`, `data-feed-meta` «N операций», дни `data-feed-day`, `OpRow` → `OpSheet` / `edit` для ручной); данные —
  `lib/finance.ts:5577-5608` `weekFeed(ops, { week, marked?, categories? })` → `{ count, total, days }` (фильтр
  `weekKey(op.date) === where.week`), `WeekFeedOp` `:5552`. «Месяц» знает `monthKey` (`MonthPlan` — `monthKey` текущего/выбранного
  месяца), операции — `useOperationsStore().all`, отметки — `totalMarks(all).marked`.
- Тесты: `components/AppShell.test.ts` (список 10 действий, «Хватит ли?»), `AppShell.dom.test.ts`, `components/money/MonthPlan.dom.test.ts`
  (`data-afford-open`), `components/ai/AiReport.dom.test.ts`, `views/Money.b16.dom.test.ts`, `components/useQuerySheet.dom.test.ts`;
  e2e по названиям пунктов «+» (`grep -rln "Загрузить выписку\|Новая мечта\|Покупка в список\|Внеплановый доход\|Подписка или
  платёж" e2e`): `b2c-block1-parser`, `b2c-block10-dreams-week`, `b2c-block17-polish`, `b2c-block3-screens`, `fb-block4-accept`,
  `fg-block2-*`, `fr-block1-setup`, `pn-block3-dreams`, `pn-block5-estimate`, `pn-block6-cushion`, `tl-block4-*`; по «Хватит?» —
  `ai-block2-accept`, `fb-block5-look`, `fr-block2-tips`, `pn-block5-estimate`.

## Задача

1. **Лист «+»** (`47:115`): сверху две плитки в ряд — **«Доход»** (`bg-ok-soft`, кружок `bg-ok text-on-photo` с «+», заголовок 17/600,
   подпись 12 `text-ink-2` «премия, возврат» → `/month?income=1`) и **«Расход»** (`bg-destructive-soft`, кружок `bg-destructive
   text-destructive-foreground` с «−», подпись «трата, выписка, платёж» → подлист п. 2); ниже список **без подписей** (`Row` без
   `note`): **Мечта** (`/goals/new`), **Желание** (`/wishes`), **Заметка** (`/week?note=1`), **Прикинуть кредит**
   (`/money/debts?try=1`). «Хватит ли?» из листа убран. Плитки `rounded-[16px] p-3.5`, цвета — только токены.
2. **Подлист «Расход»** (`74:178`) — тот же `Sheet`, вторая «страница» (`addPage: 'root' | 'expense'`): над заголовком тихая строка
   **«‹ Добавить»** (13, `text-brand`, `data-add-back`) — заголовок «Расход» и строку рисовать в теле листа с `title-hidden` (у
   `Sheet` нет слота над заголовком; второй лист поверх не заводить); пункты: **Трата** (`/week?spend=1`), **Выписка**
   (`/week?upload=1`), **Платёж или подписка** (`/money?add=payment`), **Долг** (`/money?add=debt`). Закрытие листа сбрасывает на
   «Добавить».
3. **«Месяц»: чип «История» вместо «Хватит?»** (`18:105`): `data-afford-open` → `data-month-feed` «История» (тот же `secondary sm`, у
   остатка; только `canEdit` — операции личные, у viewer их нет); открывает лист истории операций месяца: `WeekFeedSheet` получает
   данные месяца — в `lib/finance.ts` общее тело `feedOf(ops, inPeriod, where)` и две обёртки `weekFeed` (как была) и
   **`monthFeed(ops, { month, marked?, categories? })`** (фильтр `monthKey(op.date) === where.month`), лист — проп `emptyText`
   («За этот месяц трат нет»); имя файла и `data-feed-*` — те же (переименование не нужно). Ручная трата из истории месяца —
   лист «Трата» (как на «Неделе»: `edit` → `HandSpendSheet` через `?spend=`).
4. **Лист «Хватит?» убрать из потока** (`50:646`): `AffordSheet.vue`, его тест, `useQuerySheet('afford')` и чип — удалить; адрес
   `?afford=1` больше ничего не открывает (редирект не нужен); чистые `canAfford`/`affordWhy`/`affordWhyText` и их тесты — удалить,
   если после grep-а их никто не зовёт (демо-строки `demo.dreamLines`/`estimate` — проверить, что они не про эти функции).
5. Правило 12 — в Handoff: лист «+» — два предмета (доход/расход) плитками, остальное списком, ничего не объясняется подписями;
   «История» — у остатка месяца, как «Хватит?» была.

## Тесты

- `components/AppShell.test.ts` / `AppShell.dom.test.ts`: лист «+» — плитки «Доход» (→ `/month?income=1`) и «Расход», список из 4
  без подписей, «Хватит ли?» нет; «Расход» → страница с «‹ Добавить» и 4 пунктами с нужными адресами; «‹ Добавить» возвращает;
  закрыть и открыть — снова «Добавить». Viewer — «+» нет (как было).
- `lib/week.test.ts` (или новый `lib/monthFeed.test.ts`): `monthFeed` — только операции месяца, дни по убыванию, `count`/`total`
  как у `weekFeed` на тех же данных недели внутри месяца; операции соседнего месяца не входят.
- `components/money/MonthPlan.dom.test.ts`: чип «История» (`data-month-feed`) вместо `data-afford-open`, открывает лист с
  `data-feed-meta` «N операций»; viewer — чипа нет; `?afford=1` — ничего не открывает.
- e2e из Контекста — адаптировать названия пунктов «+» («Выписка», «Мечта», «Желание», «Доход», «Платёж или подписка») и путь
  через «Расход»; сценарии «Хватит?» — убрать или переписать на «Историю» (факт «вход для прикидки» исчезает по решению владельца).
- Мутант: `monthFeed` с фильтром по неделе → юнит красный; `addPage` не сбрасывается при закрытии → тест AppShell красный.

## Критерии приёмки

- Стенд Chrome 390, обе темы, демо: «+» → плитки «Доход»/«Расход» и 4 строки; «Расход» → «‹ Добавить» и 4 пункта, каждый ведёт
  куда ждёшь; «Месяц» → «История» у остатка → лист с операциями месяца по дням (цифры совпадают с «Неделей» для той же недели);
  «Хватит?» нигде нет (чип, «+», `?afford=1`). Viewer: «+» нет, «История» нет, «✦ Разбор» на месте.
- `npm run build && npx vitest run` зелёные; `grep -rn "afford" src` — пусто (кроме истории в доках).

## Вне скоупа

- Листы, куда ведут пункты («Трата», «Выписка», «Доход» и др.), — не меняются (кроме кита FG-19).
- «История» месяца для партнёра/viewer (операции личные, Р-5) — не показываем; «Статистика» месяца — нет.
- Удаление `rkShare`/РК-строки — FG-25.
