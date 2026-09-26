# PV-09 — Кит окон: `Sheet`, `Select`, `Row` со слотом действия, токен затемнения, `Field`, `useSavedMark` (фронт)

Блок 2 · MVP · Каталог: `frontend/` · Зависит от: Блок 1 · Роли: все

## Контекст (что уже есть)

- Р-13; хвосты RP Н-9, Н-10 и «`Field` оборачивает группы кнопок» (судьба → PV-09 по Р-18).
  `REVIEW-frontend.md` Блока 1 RP, Н-9/Н-10 — рекомендации.
- **Хром модалок — 19 копий в 7 файлах** (`fixed inset-0 … bg-black/40 backdrop-blur-xs`,
  карточка `max-h-[88dvh] … shadow-2xl`, шапка с `PhX`): `AppShell.vue:174, 251` (листы
  снизу, `items-end`), `SalaryDialog.vue:143`, `PaidRow.vue:229` (`z-[60]`, единственный
  `<Teleport to="body">` `:226-335`, закрытие `@click.self`, крестик `:235-242`, Escape нет),
  `SyncBadge.vue:78`, `Capital.vue:912, 1010, 1060, 1146, 1210, 1288, 1406, 1445, 1534, 1729`,
  `GoalDetail.vue:294, 355`, `Goals.vue:300, 352`. Escape: только `Capital.vue:625-650` (общий
  обработчик на `document`, закрывает все модалки; при открытом листе `PaidRow` закрывает и
  модалку под ним), `SalaryDialog.vue:120-137`, `kit/Hint.vue:27-42`. `bg-black/40` — цвет не из
  токена (правило 6 CLAUDE.md); в `style.css` есть `--shadow-2` / `shadow-lift`, модалки его не
  используют.
- **`<select>`** — одна строка классов в 8 местах, 6 в Капитале (месяц годовой `:1245-1252`,
  группа подписки `:1316-1326`, «С какого месяца» `:1353`, «Добавить подписку» `:1511`, счёт
  досрочки `:572, 1641`, «Куда направить» `:1768`); вне Капитала — `SalaryDialog.vue:192`,
  `GoalDetail.vue:317`.
- **`kit/Field.vue:7-12`**: `<label class="mb-3.5 flex flex-col gap-1.5 text-left"><span …>{{
  label }}</span><slot/></label>`; группа кнопок внутри `<label>` → имя первой кнопки включает
  подпись («Как вносите Разово»), тап по подписи жмёт первую кнопку (Капитал: «Как вносите»
  `:1564`, «Приватность счёта» `:928`, «Что это» `:947`, «Как часто» `:1230`, также «Валюта»
  `:965`, «Чьё это» `:1258`, «Кому пришло» `:1753`; Блок 1 PV — «Горизонт»
  `components/StrategyCompare.vue:107`, «Проценты» `Capital.vue:1086` — форма долга, теперь
  `Segmented`). В мастере `views/Setup.vue` те же группы в `Field`: «Как живёте» `:273`, «Есть
  действующий кредит или рассрочка?» `:296`, «Что знаете про ставку» `:313`, «Цвет» `:371` —
  Setup не экран блока, по Р-13 его не переводят.
- **`kit/Row.vue`**: props `title`, `note?`, `value?`, `sub?`, `accent?`, `clickable?`
  (`:4-11`); emit `click` с защитой от свайпа > 8px (`:17-35`); слоты `icon`, `value`; при
  `clickable` — `<button>` (вложенный `<button>` недопустим — поэтому `PaidRow.vue:152-189`
  скопировал разметку и потерял `hover:bg-surface-2 active:bg-surface-3`, шеврон, `dragged`;
  в Бюджете у платежей пропал знак «−» — `PaidRow.vue:185`, было `−plain` в `Budget.vue`).
- «Сохранено»: `kit/SavedMark.vue` только рисует (`on`, переход 200 мс); таймер повторён в
  `SalaryDialog.vue:44-73`; React `useSavedMark(id, stamp)` (`src/components/kit.tsx:106-139`):
  загорается при смене `updatedAt` той же записи, гаснет через 1 800 мс, при смене id
  сбрасывается. Нужен PV-10, PV-11, PV-12, PV-18, PV-19, PV-23.
- `Segmented` — generic по строкам (boolean не принимает). Чипы `border-brand bg-brand-soft`
  ~14 копий — Н-9: не трогать, пока нет третьего вида.
- Токены — `style.css` `:root` (`:11`) / `.dark` (`:74`); новый — в оба блока.
- Тесты SSR-компонентов — образец `components/PaidRow.test.ts`.

## Задача

1. **`kit/Sheet.vue`**: `Teleport to="body"`, оверлей на новом токене затемнения `--scrim`
   (пара light/dark в `style.css`) + `backdrop-blur-xs`, карточка `shadow-lift`, шапка с
   `title` и крестиком, закрытие по крестику, `@click.self` и **Escape** (свой обработчик, не
   через `document` Капитала), пропсы `open`, `title`, `z?` (вложенный лист поверх модалки —
   как `PaidRow` `z-[60]`), emit `close`, слот тела и слот `footer`. Одна геометрия для
   телефона (лист снизу, `max-h-[88dvh]`) и для широкого экрана (по центру) — как сейчас у
   листов/модалок Капитала.
2. **`kit/Select.vue`**: `<select>` с общей строкой классов, `v-model`, `options: { value,
   label }[]` или слот `<option>`, `disabled`.
3. **`kit/Row.vue`**: слот `action`, рендерится вне кнопки строки (кнопка `Оплатил` внутри
   `Row`); `PaidRow` перестроить на `Row` (Н-10): отклик, шеврон, `dragged`; в Бюджете у
   платежей вернуть знак «−» (проверить ожидания `PaidRow.test.ts` и e2e).
4. **`kit/Field.vue`**: проп `group` — рендер `<div role="group" aria-label>` вместо `<label>`;
   применить ко всем группам кнопок в Капитале и к «Горизонт»/«Проценты» из Блока 1.
5. **`kit/useSavedMark.ts`**: `useSavedMark(id: Ref<string | undefined>, stamp: Ref<string |
   undefined>)` → `saved: Ref<boolean>` по правилу React; `SalaryDialog.vue` перевести на него.
6. Перевести на `Sheet`/`Select` **только экраны блока**: все 10 модалок `Capital.vue`, лист
   `PaidRow.vue`, 6 `<select>` Капитала. Общий Escape-обработчик Капитала `:625-650` убрать
   (Escape живёт в `Sheet`). `AppShell`, `SyncBadge`, `SalaryDialog`(хром), `Goals`,
   `GoalDetail` — не трогать (Р-13: их переведут PV-18/PV-19/PV-21/PV-23).
7. Цвет только из токенов; проверить глазами обе темы.

## Тесты

- `components/kit/Sheet.test.ts` (SSR): при `open` рендерит `title`, кнопку закрытия и слот;
  при `!open` — ничего; оверлей без `bg-black` в классах.
- `components/kit/Select.test.ts` (SSR): опции и выбранное значение.
- `components/kit/Field.test.ts` (SSR): без `group` — `<label>`, с `group` — нет `<label>`,
  есть `role="group"`.
- `components/PaidRow.test.ts`: строка содержит шеврон/классы отклика `Row`; в Бюджете сумма
  платежа с «−»; существующие ожидания зелёные.
- `lib/palette.test.ts` или новый тест: `style.css` содержит `--scrim` в `:root` и в `.dark`
  (чтение файла, как в `e2e/pwa-build.test.ts`).
- `components/SalaryDialog.test.ts` или стор-тест `useSavedMark`: загорается при смене `stamp`
  того же `id`, гаснет по таймеру (`vi.useFakeTimers`), сбрасывается при смене `id`.

## Критерии приёмки

- Браузер: все модалки Капитала и лист «Оплатил» открываются/закрываются крестиком, фоном и
  Escape; Escape при открытом листе поверх модалки закрывает только лист; тёмная тема — оверлей
  и тень из токенов; тап по подписи «Как вносите» ничего не нажимает; регрессия Блока 1 RP
  (e2e) зелёная.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Чипы-переключатели в кит — нет (Н-9: ждать третий вид).
- Модалки вне Капитала/PaidRow — PV-18, PV-19, PV-21, PV-23 (каждая на своём экране).
- Общий `AccountChoice` (Н-11) — RP-10.
