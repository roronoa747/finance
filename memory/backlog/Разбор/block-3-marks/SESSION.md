# Блок 3 — ✦ у предметов · сессии

**Цель блока:** у раздела, платежа / подписки, мечты и долга, про которые есть совет свежего разбора, — маленький ✦;
нажатие открывает отчёт на карточке этого совета. Работа ИИ видна у самих предметов.

Сессии: исполнитель ⬜ · критик ⬜ · ux ⬜ · приёмка ⬜
<!-- M с `/ux`. Последний блок: приёмка — предложение закрыть бэклог (DoD) после деплоя владельцем. -->

---

## Промпт исполнителя — уровень build · Opus 5.5 · effort high

```
/worker Разбор 3
```

Блок-специфика:

- **Предусловие:** Блок 2 — приёмка ✅ (деплой может ждать дня). Дерево — worktree `C:\Users\SW\finance-razbor`; ветка
  `rz-block-3-marks` от `rz-block-2-report`; пуш ради CI; `main`, прод, `STATE.md` не трогать.
- Задачи: RZ-10 → RZ-11 → RZ-12. Стенд — §6 (Vite `:5261`, Go `:8161`); разбор v3 с советами всех видов — положить в
  документ стенда руками (без живого ключа).
- Правило 12: ✦ — зов издалека точкой/значком у предмета, не блок; строки и крупные цифры не сдвигаются.
- **Факты кода после Блока 2** (критик Блока 2, 2026-10-18; ветка `rz-block-2-report`, сводка — §6 индекса «После
  Блока 2»):
  - **Совет:** разбор месяца — `finance.aiReviewOf(monthKey())` (`AiReview`, `v === 3`; у v1/v2 советов нет — меток нет),
    `advices[i]: AiAdvice {title, text, figure: {about, value} | null, action}`; `action` — `{kind: 'do', candidate:
    StepCandidate}` (id `move:<categoryId>` — `shift.from {spend, categoryId}`, `shift.to {goalId}`; `prepay` — `to:
    'debt'`; `cushion` — `to {goalId}`) или `{kind: 'open', target: OpenTarget {kind: 'cat' | 'goal' | 'credit' |
    'obligation' | 'seller', id, name, categoryId?}}` (`seller`: `id` — ключ `normalizeMerchant`, `name` — короткое имя
    `shortMerchant` (Х-2), `categoryId` — раздел продавца). Номер карточки совета — `i + 1`.
  - **Демо:** разбора в документе нет — `MonthPlan.vue` берёт заготовку `demoReview(doc, input)` (`lib/demo.ts`; computed
    `demoReview` ≈ :254, `review` :262): советы — `seller` «Магазин у дома» (`sc_food`), `seller` «Онлайн-кинотеатр»
    (`sc_subscriptions`), `do` `cushion`. `adviceMarks` в демо — по той же заготовке (`auth.isDemo`), не по документу.
  - **Отчёт на карточке:** `router.push({ path: '/month', query: { review: '1', card: String(n) } })` — `MonthPlan`
    `useQuerySheet('review', ['card'])` + `reviewCard` (целое ≥ 1) → проп `card` у `AiReport` (`startIndex`: карточка
    `advice` с `row.i === n - 1`, нет такой — первая; открытый отчёт переходит на новый `card` — `watch`). Закрытие (✕,
    свайп, Escape, «Назад», любой переход) снимает `review` и `card`. Отчёт показывается только при `reviewShown` (текущий
    месяц): с «Денег» / «Мечт» адрес без `?month=` — верно. Открыли — разбор «увиден» (точка гаснет).
  - **Адреса «Открыть»** — `openPath(target)` (`lib/aiFacts.ts`): раздел `/month?cat=<id>` (лист раздела по адресу —
    `useQueryValue('cat')` в `MonthPlan`; нажатие строки ставит значение руками, адрес не меняется), мечта `/goals/<id>`,
    долг **`/money?credit=<id>`** (не `/money/debts` — лист долга живёт в `CapitalLists`), платёж `/money?obligation=<id>`,
    продавец `/money/history?cat=<categoryId>` (чип раздела + раскрытая лента «Все записи»).
  - **Строки для ✦ (номера строк — на `rz-block-2-report`):** раздел «Месяца» — `MonthPlan.vue` `:data-spend-row` ≈ :693
    (`@click="catFor = r.categoryId"`); платежи «Месяца» — `<DueRow` ≈ :623 и :658; «Деньги» — `CapitalLists.vue`
    `<PaymentLine` :275 и подписки :302; «Мечты» — `Dreams.vue` `DreamCenter` :146, `ThumbRow`; «Долги» — `DebtsWidget.vue`.
    Пилюля «✦ Разбор» при `reviewShown` — строкой **под** кольцом (`data-review-open`, `data-review-dot`), не в слоте
    `MonthRing`.
  - **Механизмы, общие с другими листами:** `useQuerySheet(key, also)` / `useQueryValue(key, also)`
    (`components/useQuerySheet.ts`: параметр ушёл с адреса — лист закрыт; `close()` снимает и `also`; закрытие отменяет
    ещё не дошедший переход на параметр) — тест `useQuerySheet.dom.test.ts`; стек окон `kit/sheetStack.ts` (`pushSheet` /
    `popSheet` / `isTopSheet`: Escape и жесты — верхнему окну, `html[data-sheet-open]` — пока открыто хоть одно; новый
    полноэкранный слой — только через него, иначе тост «Отменить» уходит под слой).
  - Тесты-образцы: `AiReport.dom.test.ts` (`open`, `openV3`, `savedV3`, `candidateOf`), e2e `rz-block2-report.test.ts`
    (`familyDoc`, `answerFor` — три совета: `do` подушка, `open` раздел `sc_cafe`, `open` продавец аптеки `sc_health`).
- Следующий шаг — `/critic Разбор 3`.

---

## Промпт критика — уровень review · Opus 5.5 · effort xhigh

```
/critic Разбор 3
```

Блок-специфика:

- Один источник меток (`adviceMarks`), один компонент ✦; кнопка не вложена в кнопку (DueRow, ThumbRow — проверить a11y);
  ✦ только у текущего месяца. Следующего блока нет → проверить готовность бэклога к закрытию (DoD): хвосты §4 с судьбой,
  доки, e2e. §6 — «После Блока 3».
- Следующий шаг — `/ux Разбор 3`.

---

## Промпт `/ux` — уровень review · Opus 5.5 · effort xhigh

```
/ux Разбор 3
```

Блок-специфика:

- Экраны: «Месяц» (разделы, платежи), «Деньги» (подписки), «Мечты» (герой, строки), экран цели, «Долги» — с ✦ и без;
  390 / 375, обе темы; member / viewer / демо. Проверить: ✦ заметен, но не шумит; попадание пальцем; строки ровные.
- Следующий шаг — `/accept Разбор 3`.

---

## Промпт приёмки — уровень review · Opus 5.5 · effort xhigh

```
/accept Разбор 3
```

Блок-специфика:

- Критерии брифа целиком (сводная проверка инициативы): находки на настоящих выписках, кнопки советов, числа, «Куда ушло»,
  счётчик, ✦, партнёр, согласие один раз, цена и лимит. Регрессия: весь `e2e/`, vitest, Go, CI.
- **Деплой — только с владельцем днём** (§5). Последний блок → после деплоя и 🏁 — предложение владельцу закрыть бэклог
  (DoD BACKLOG-GUIDE: хвосты с судьбой, `STATE.md`, каталог в `memory/archive/`).

---

## Handoff (заполняет исполнитель)

- **Коммиты:** …
- **Что сделано:** …
- **Правило 12 (по экранам):** …
- **Отклонения от ТЗ:** …
- **Грабли среды:** …
- **Верификация:** …

## Итоги критика

…

## Итоги `/ux`

…

## Приёмка

…
