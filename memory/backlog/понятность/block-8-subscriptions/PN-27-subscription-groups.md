# PN-27 — «Подписки»: «Общие · N», «<имя> · N», пакеты внутри (хвост 1024) (фронт)

Блок 8 · MVP · Репо/каталог: `frontend/src/lib/finance.ts`, `components/money/CapitalLists.vue`, `components/money/MonthPlan.vue` · Зависит от: PN-26 · Роли: member, viewer

## Контекст (что уже есть)

- Группа подписок: `SubsItem = { obligation, amount, paid, day }` (`finance.ts:3521`), `SubsGroup<T> = { count, total,
  paid, allPaid, day, parts: { groupId, name, rows }[] }` (:3524-3534), `SUBS_GROUP_MIN = 2` (:3537),
  `subscriptionGroup(items, all)` (:3544), `peopleGroup` (:3552), `rowsGroup` (:3556-3574 — по `parentId` против
  `liveGroups`), `monthSubscriptions(dues, all) → { rest, subs }` (:3577-3581). Хвост 1024: «подписки: «3 странные
  категории», группировать».
- Экраны: `CapitalLists.vue` «Платежи» → «Подписки · N» (`data-subs`, :259-280 — заголовки ручных групп открывают
  `GroupSheets`), строки групп (:281-289); `MonthPlan.vue:435-468` «Подписки · N», «N из M списались», подзаголовки
  ручных групп (`data-subs`, `data-subs-status`, `data-subs-done`); строка — `money/DueRow.vue`.
- Участники — `financeStore.people` (`name`); `who` пусто — общая.
- Р-7: «список «Подписки» сворачивается в «Общие · N», «<имя> · N»; ручные пакеты остаются внутри».

## Задача

1. `finance.ts`: **`subscriptionsByWho<T extends SubsItem>(items, all, people) → { who: PersonId | 'all'; name: string;
   group: SubsGroup<T> }[]`** — разбивает подписки по `obligation.who` (пусто → `'all'` «Общие»), внутри каждой части
   — `subscriptionGroup` (пакеты по `parentId` остаются внутри части; пакет с подписками разных `who` — в части
   владельца пакета по первой подписке, остальное — как есть, без разрыва пакета: пакет целиком в одной части —
   «Общие», если `who` разные). Порядок: «Общие», затем участники по порядку `people`. Часть без подписок — нет.
   `monthSubscriptions` — отдаёт `subs` как раньше (сумма и «N из M» для строки «Подписки · N»), плюс `byWho`.
2. `CapitalLists.vue` «Подписки · N» раскрыта → подразделы «Общие · N», «{имя} · N» (`data-subs-who`), внутри — пакеты
   и строки как сейчас; один `who` на всех — подраздела нет (как сейчас). `MonthPlan.vue` — так же (одна функция,
   «N из M списались» — на уровне «Подписки»).
3. Хвост 1024 в §4 `идея-и-редизайн` — закрыть ссылкой на PN-26/PN-27 (в приёмке).

## Тесты

- `finance.test.ts`: `subscriptionsByWho` — две части при разных `who`, пакет не рвётся, порядок, одна часть при
  одинаковом `who`; `monthSubscriptions.subs` прежний.
- `CapitalLists.test.ts`, `MonthPlan.dom.test.ts`: подразделы в разметке, `data-subs-who`; viewer видит.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные; стенд: демо с подпиской партнёра → «Общие · 2», «Партнёр · 1».

## Вне скоупа

- Перенос подписки между «чья» перетаскиванием — нет (лист правки).
