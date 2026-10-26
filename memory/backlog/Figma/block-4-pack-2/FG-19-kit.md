# FG-19 — Кит по правилам пачки 2: кнопки 44, плашка «Удалить», сегменты 36, поля 44 с «₸» внутри, мета-подпись листа справа (фронт)

Блок 4 · MVP · Репо/каталог: `frontend/src` · Зависит от: — · Роли: участник, viewer (видят одинаково)

Общие правила владельца по всей ленте `46:2` (2026-10-26) — делаются **первой задачей блока**: остальные ТЗ (FG-20…FG-25)
стоят на этом ките. Эталон — любой лист ленты после правок: `48:2` «09.2 · Цель → Изменить» (поле «Сколько нужно» с «₸»
внутри, брендовая «Готово» 44, плашка «Удалить цель»), `48:458` «11.1 · Желания → желание» (мета «Вы · 26 октября» справа,
сегмент «Вы | Партнёр» 36), `47:365` «09.1 · Цель → Пополнить» (поле «Сумма» с «₸», «Внести» 44), `46:3` лэндинг
(«Попробовать» компактная 40 с окантовкой). Размер **S**: только кит и подписи, счёт денег не трогается.

## Контекст (что уже есть)

- **Кнопки** — `components/ui/button.ts` (`cva`): `default`/`lg` `h-13 px-6 text-[15.5px]` (52 px), `md` `h-11 px-4 text-[15px]`
  (44), `sm` `h-8` (32), `xs` `h-[26px]` (26), `icon*`; варианты `default` (бренд), `secondary` (`--surface-3`), `soft`, `ghost`,
  `outline` (`border-line-strong bg-surface`), `destructive`, `link`. Комментарий уровней — там же и в `DESIGN.md` §4 «Кнопки по
  уровню» (`memory/backlog/идея-и-редизайн/block-2-design/DESIGN.md:397-400`). Tailwind v4: `h-11` = 44, `h-10` = 40.
- **Белые второстепенные во всю ширину** (`w-full` + `secondary`/`ghost`/`outline`): `views/Landing.vue:63-72` «Попробовать»
  (свои классы `h-13 … bg-surface`, не `Button`), `views/Wishes.vue:269` «Сюрприз», `components/MarkSheet.vue:261-262, :275`,
  `components/money/PlanSquare.vue:208` «Пополнить подушку», `components/SalaryRow.vue:85-87` «Другая сумма или счёт» (ghost),
  `components/capital/PayoffSheet.vue` «Внёс досрочно» (ghost md w-full), `views/Start.vue` «Позже» (ghost md w-full).
  **Не трогать**: строки-переходы со стрелкой (`CapitalLists.vue:370-379` «Добавить …» `justify-start`, `GoalDetail` «На
  паузе …» `RouterLink`), пары подтверждения («Отмена | Удалить» в `DangerZone`, «Отмена | Снять» в `PayoffSheet`), главные
  брендовые `w-full` в листах и на пустых экранах (остаются во всю ширину, но 44).
- **«Удалить …»** — `components/kit/DangerZone.vue:78-85`: триггер `w-full … rounded-pill border border-destructive-line
  bg-destructive-soft px-4 py-2.5 text-[13px] font-medium text-destructive`; подтверждение — коробка ниже (не трогать).
  Все «Удалить …» приложения идут через него (11 вызовов: `GoalSheet:132`, `WishSheet:180`, `GiftSheet:161`, `HandSpendSheet:126`,
  `NoteSheet:77`, `AccountSheet:296`, `CreditSheet:197, :324`, `ObligationSheet:311`, `GroupSheets:138`, `SyncBadge:194`,
  `Settings:174`). Токены: `--destructive`, `--destructive-soft`, `--destructive-line` (`style.css:47-50`, тёмная `:112-115`).
- **Сегменты-плашки** («Вы | Партнёр», «Каждый месяц | Разово», «Пополнить | Снять») — `components/kit/Segmented.vue`: капсула
  `rounded-pill bg-surface-3 p-[3px]`, кнопки `rounded-pill px-2 py-2 text-[14px]` (≈ 44). 20 вызовов (`grep -rn "<Segmented"`).
  `kit/SegmentGroup.vue` (переключатели «Неделя | Месяц», «Капитал · Долги · История» с ползунком) — **другое, не трогать**.
- **Поля**: `components/ui/Input.vue:50` и `components/kit/NumField.vue` — `h-12` (48), `text-[16px]`, `px-3.5`; `NumField` —
  голый `<input>` + строка округления (`inheritAttrs: false`, `$attrs` на input), `numKind` = `'money' | 'int' | 'rate' | 'fx'`
  (`lib/num.ts:12`; `moneyKind(currency)` → `fx` для не-KZT), `CURRENCY_SIGN` из `lib/fx`. `NumFieldBlur` оборачивает
  `NumField` (`:initial`, коммит по blur). `kit/Field.vue` — подпись 12.5 над полем.
- **Подписи «, ₸»** — 20 полей (`grep -rn ", ₸" --include=*.vue`): `AccountSheet:202, :243`, `CreditSheet:165, :187, :190, :229,
  :245`, `ExtraIncomeSheet:57`, `NewDebtSheet:133, :136, :154, :157`, `PayoffSheet:146`, `PrepaySheet:109`, `GoalSheet:115, :118`,
  `TripFields:37`, `WishSheet:157`, `AffordSheet:42` (лист удаляется в FG-23), `TryCreditSheet:71`, `HandSpendSheet:101`,
  `NoteSheet:71`, `GoalDetail:596, :698`, `Week.vue:691` («Оклад, ₸» / «За неделю, ₸») и `:696` (aria-label «Сколько осталось,
  ₸»), `Wishes.vue:341`; `MonthPlan:1265` `'₸ в месяц'` / `` `${personName}, ₸ в месяц` ``, `:1275` «Сверх графика, ₸ в месяц».
  Курсы «Курс, ₸ за 1 €» (`AccountSheet:190`, `NbRateLine:23`, `SalaryExchange:162`) — поля `kind="rate"`, подпись остаётся.
- **Мета-подпись листа** под заголовком: `components/goals/WishSheet.vue:142` `<p class="mb-3 type-meta">{{ meta }}</p>` («Вы ·
  26 октября»), `components/OpSheet.vue:115` `data-op-meta` («25 октября · 6 800 ₸ · вернули …»).
- Токены цвета — `style.css` `:root` :17-84 / `.dark` :86-144, пары проверяет `style.tokens.test.ts`; `@theme` `--color-*` :160-220.
- Тесты, завязанные на текущее: `components/kit/kit-b2c.test.ts`, `components/kit/DangerZone.dom.test.ts`,
  `components/kit/NumField.test.ts`, `NumField.dom.test.ts`, `NumFieldEnter.dom.test.ts`, `components/kit/Field.test.ts`,
  `views/Admin.dom.test.ts` (`h-13`/`h-12`), `views/Landing.test.ts`, `views/authScreens.test.ts`, `style.tokens.test.ts`,
  тесты листов с «Сумма, ₸» по `getByLabelText`/тексту (`grep -rln ", ₸" src e2e --include=*.test.ts`).

## Задача

1. **Главные кнопки 44.** `button.ts`: `default` и `lg` → `h-11 px-6 text-[15px]` (радиус — `rounded-pill`, при 44 это 22);
   у варианта `default` — тонкая окантовка 1 px внутрь: `shadow-[inset_0_0_0_1px_var(--brand-edge)]`, токен **`--brand-edge`**
   в `style.css` (`:root` — чёрный 18 %: `rgb(0 0 0 / 0.18)`; `.dark` — своя пара, напр. `rgb(255 255 255 / 0.12)`) + `--color-brand-edge`
   в `@theme`. `md` → **40** (`h-10 px-4 text-[14.5px]`) — «компактная вторая». `sm`, `xs`, `icon*` — как были. Комментарий
   уровней в `button.ts` и `DESIGN.md` §4 — обновить (44 / 40 / 32 / 26).
2. **Второстепенные во всю ширину → компактные по центру с окантовкой**: в местах из Контекста — `Button variant="outline"
   size="md"` без `w-full`, по центру (`self-center` / обёртка `flex justify-center`); «Попробовать» на лэндинге — тот же вид
   своими классами или `Button`. Остальные вхождения — `grep -rn 'w-full' | grep -E 'secondary|ghost|outline'` и решить по
   правилу (строки-переходы и пары подтверждения не трогать); перечень — в Handoff.
3. **Плашка «Удалить …»** (`DangerZone` триггер): по центру, не во всю ширину — `mx-auto h-8 w-auto px-4 rounded-pill text-[13px]
   font-medium bg-destructive-soft text-destructive border border-destructive/45` (ширина — по тексту + 32). Коробка
   подтверждения — без изменений.
4. **Сегменты 36 / радиус 12** (`Segmented.vue`): капсула `rounded-[14px] p-[3px]`, кнопки `h-[30px] rounded-[12px] text-[14px]`
   (итого 36). `SegmentGroup` не трогать.
5. **Поля 44**: `Input.vue` и `NumField.vue` `h-12` → `h-11`.
6. **«₸» внутри денежного поля**: `NumField` рендерит обёртку `relative` и суффикс справа внутри поля
   (`pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-[16px] font-medium text-ink-3 num`,
   `data-num-suffix`) — «₸» при `numKind === 'money'`, знак валюты `CURRENCY_SIGN[currency]` при `fx`; `int`/`rate` — без суффикса;
   у input `pr-9`, чтобы число не заезжало под знак. `$attrs` (aria-label, data-*) остаются на `<input>`; строка округления —
   под полем, как была. `NumFieldBlur` — без правок (пропсы пробрасываются).
7. **Подписи без «, ₸»**: все 20 полей из Контекста — суффикс «, ₸» убрать («Сумма», «Цена», «Сколько нужно»…);
   `MonthPlan:1265` → `'В месяц'` / `` `${personName(spendEdit.by)} — в месяц` ``; `:1275` → «Сверх графика в месяц»;
   `Week.vue:691` → «Оклад» / «За неделю», `:696` aria-label «Сколько осталось». Подписи курсов — оставить. `AffordSheet` —
   не править (удаляется в FG-23).
8. **Мета-подпись листа — справа**: `WishSheet:142` и `OpSheet:115` → `text-right` (ширина строки прежняя); других
   `type-meta` сразу под заголовком `Sheet` — grep `mb-3 type-meta` и так же.

## Тесты

- `style.tokens.test.ts` — пара `--brand-edge` светлая/тёмная (гард пары ловит сам; проверить, что проходит).
- `components/kit/kit-b2c.test.ts` (или новый `components/ui/button.test.ts`): `buttonVariants({ size: 'default' })` содержит
  `h-11` и не содержит `h-13`; `md` → `h-10`; `default` — `--brand-edge`.
- `components/kit/DangerZone.dom.test.ts`: триггер без `w-full`, с `mx-auto` и `h-8`; подтверждение открывается как прежде.
- `components/kit/NumField.dom.test.ts`: `kind="money"` → `[data-num-suffix]` «₸»; `currency="EUR"` → «€»; `kind="rate"` и
  `kind="int"` → суффикса нет; aria-label остаётся на `input`; `input` имеет `pr-9` только с суффиксом.
- `components/kit/Field.test.ts` / тесты листов: подписи «Сумма», «Цена» без «, ₸» (адаптировать `getByLabelText`).
- `views/Admin.dom.test.ts` (`h-13`/`h-12`), `views/Landing.test.ts`, `views/authScreens.test.ts` — адаптировать под 44/40.
- Мутанты (откат копией файла): `h-13` обратно → тест кнопок красный; суффикс без условия `money` (всегда «₸») → тест `rate` красный.

## Критерии приёмки

- Стенд Chrome 390, обе темы, демо + семья из двух: главные кнопки листов («Внести», «Готово», «Закрыть», «Сохранить») — 44 px с
  тонкой окантовкой, текст 15; «Удалить …» — плашка по центру высотой 32 по тексту; «Вы | Партнёр» и «Каждый месяц | Разово» —
  36 px со скруглением 12; любое денежное поле — 44 px, «₸» (или «€») внутри справа серым, подпись над полем без «, ₸»;
  «Попробовать» на лэндинге — компактная 40 по центру с окантовкой; в листе желания «Вы · 26 октября» — справа.
- Ни одного цвета руками: окантовки — `--brand-edge`, `--destructive`; `npm run build && npx vitest run` зелёные.

## Вне скоупа

- Экраны и листы по отдельным правкам владельца — FG-20…FG-25 (они берут этот кит).
- `SegmentGroup` (переключатели с ползунком), `kit/Tabs`, кнопки «Оплатил»/«Отдал» `xs` в строках — не меняются.
- Значения чисел, расчёты — не трогаются; `lib/finance.ts` без диффа.
