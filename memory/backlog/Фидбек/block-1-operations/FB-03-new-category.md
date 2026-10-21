# FB-03 — Новый раздел из чипов: `addSpendCategory`, «+ Раздел» (фронт)

Блок 1 · MVP · Каталог: `frontend/src/stores/finance.ts`, `lib/statements/dictionary.ts`, `lib/palette.ts`, `components/CategoryChips.vue`, `components/week/HandSpendSheet.vue`, `components/ParseSettings.vue` · Зависит от: — · Роли: member (создаёт), партнёр (видит — общий документ), viewer (нет)

## Контекст (что уже есть)

- Р-3, Р-13 (§2). Разделы трат — `householdDoc.spendCategories` (`SpendCategory` `types.ts:46`: `id, name, hue, order,
  plannedElsewhere?, slot?, article?`), засев — `seedSpendCategories` (`model.ts:386`) из `DEFAULT_SPEND_CATEGORIES`
  (`dictionary.ts:13-32`, 18 разделов, `hue` из `HueKey` палитры); имя и цвет правятся `updateSpendCategory`
  (`stores/finance.ts:2157`); **создания раздела в коде нет** («+ Раздел» в `MonthPlan.vue:749` — строка плана по
  существующему разделу через `editSpend`). Цвет раздела — `spendColor(c)` (`lib/palette.ts`), слоты `SPEND_SLOTS`.
- Чипы разделов — `components/CategoryChips.vue` (54 строки): `shown` первые `top` (6, в доке пачки 3), «Ещё N ▾», «Кому →
  что» (поле + «Запомнить»), «Между своими», «Не помню»; ответ — `emit('choose', to)`. Форма «Трата» —
  `components/week/HandSpendSheet.vue` (свои чипы с `on`, «Ещё N ▾» `data-hand-more`, `TOP` 6).
- Настройки «Разбор выписок» — `components/ParseSettings.vue` (список разделов, цвет слотами).
- `liveSpendCategories` (`lib/finance.ts`) — живые разделы по `order`; сервер `category_id` ≤ `maxCategoryRunes`
  (`handlers/statements.go:180`) — id `sc_` + 8 hex проходит.

## Задача

1. `addSpendCategory(name): string` в `stores/finance.ts`: имя — `trim`, ≤ 24 знаков, пустое — не создаёт; совпадение с живым
   разделом без регистра — вернуть его id; иначе запись `{ id: 'sc_' + 8 hex, name, hue: следующий по кругу HueKey после
   последнего раздела, order: max + 1, slot: null, updatedAt }` в общий документ (`mutateHouseholdDoc`; документа без
   разделов — сначала `seedSpendCategories`). Возвращает id.
2. `CategoryChips`: тихий чип «+ Раздел» в конце ряда (после «Ещё N ▾», до «Кому → что»); нажатие — строка с `Input`
   (placeholder «Подарки») и кнопкой «Готово» (как «Кому → что»); «Готово» → `addSpendCategory` → `choose({categoryId})`
   (тот же путь, что чип). Пустое имя — ничего. Чип виден только при `canEdit` (viewer не отвечает на вопросы — чипы ему и
   так не показывают; проверить `HistorySquare`).
3. `HandSpendSheet`: тот же «+ Раздел» среди чипов раздела (общий кусочек `components/NewCategoryChip.vue` — чип + поле +
   «Готово», событие `created(id)`; обе формы его используют); созданный раздел становится выбранным (`categoryId`).
4. `ParseSettings`: новый раздел появляется в списке сам (общий документ); добавлять туда «+ Раздел» не нужно.

## Тесты

- `stores/finance.test.ts`: `addSpendCategory` — id формат, `order` max + 1, hue по кругу, дубль по имени → тот же id,
  пустое имя → ничего, документ без разделов → засев + новый; партнёр получает раздел слиянием (`mergeList`).
- `components/CategoryChips.dom.test.ts`: «+ Раздел» → поле → «Готово» → `choose({categoryId: <новый>})`; пустое — нет события;
  «Подарки» второй раз → тот же id.
- `views/Week.hand.dom.test.ts`: в «Трата» «+ Раздел» → «Подарки» выбран → «Сохранить» → строка «Подарки» на «Неделе».
- Мутант: `addSpendCategory` без дубля по имени — тест дубля красный.

## Критерии приёмки

- Из листа «куда отнести?» и из «Трата» новый раздел создаётся за два нажатия («+ Раздел» → имя → «Готово»); ответ
  ложится в него; раздел виден партнёру и в настройках; цвет — токен палитры.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд 390 px, обе темы — чип не ломает ряд (переносится).

## Вне скоупа

- Удаление, слияние, порядок разделов; `plannedElsewhere` у нового (всегда false); `article` (умолчание словаря — «Жизнь»).
