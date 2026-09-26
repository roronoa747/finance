# PV-22 — Оформление: имя без отката, «Цвета разделов» (остаток Б-19) (фронт)

Блок 5 · MVP · Каталог: `frontend/` · Зависит от: PV-08 · Роли: все

## Контекст (что уже есть)

- Сверка Б-19 (тема на старте и «Авто» — PV-08, сделано). Р-20: оформление — дело устройства.
- **Имя.** `components/AppearancePanel.vue:29` `userName = ref(authStore.member?.display_name ||
  email-префикс || '')` — из аккаунта, **не** из `people[slot].name` (переименование в
  `SalaryDialog` не видно); `saveName` (`:51-55`): пустое → `return` без отката;
  `financeStore.setPerson(slot, {name})` (с `unchanged`, `stores/finance.ts:450`); подпись
  (`:108-110`) без фразы «По умолчанию подставляется начало адреса почты.» React
  `AppearancePanel.tsx:45-64`: `me = people.find(p => p.id === slot)`, `defaultValue={me?.name}`,
  blur → `setPerson`, только непустое и изменённое; текст `:61-64`.
- **«Цвета разделов».** React `:94-113`: по каждой категории (`c.name`) ряд `Swatch` из
  `HUE_KEYS` / `HUES[h].light`, активный = `settings.categories[c.key]`, клик →
  `setCategoryHue(c.key, h)` (только настройки устройства); примечание (`:115-118`): «Каждый цвет
  задан парой значений — для светлой и тёмной темы. Свободного выбора HEX нет намеренно: так
  нельзя получить сочетание, которое станет нечитаемым при смене темы.» Токены `--d1..d5`
  пишет `applyTheme` (`lib/palette.ts:102-105`); дефолт `{d1:'blue', d2:'brick', d3:'green',
  d4:'ochre', d5:'steel'}`. Во Vue категории зашиты в `applyCurrentPalette` (после PV-08 — в
  `lib/theme.ts`); `Settings.categories` (`types/finance.ts:299-304`) не используется.
- Кнопки акцента без `aria-pressed` (`:133-145`; React `:22` есть). `Segmented` темы `:117-125`.
- Список категорий — `financeStore.categories` (может быть пустым → запасные имена из
  `DEFAULT_CATEGORY_NAMES`, PV-11).

## Задача

1. Имя: источник — `people[slot].name` (реактивно), blur → `setPerson` только при непустом и
   изменённом; пустое — вернуть прежнее в поле; подпись как React.
2. «Цвета разделов» (Р-20): `lib/theme.ts` — `readCategoryHues()` / `setCategoryHue(key, hue)`
   в `localStorage` (`ff_category_hues`, `try/catch`, дефолт как выше), `applyCurrentPalette`
   читает их; панель — ряд образцов по категориям (имена из `categories`/запасные), активный
   выделен, `aria-pressed`; примечание дословно; акцент — `aria-pressed`.

## Тесты

- `lib/theme.test.ts`: `setCategoryHue('d2', 'blue')` → `applyCurrentPalette` пишет `--d2` =
  `HUES.blue.light` (тёмная тема — `.dark`); сломанный `localStorage` → дефолты.
- `components/AppearancePanel.test.ts` (SSR): имя из `people`, ряд «Цвета разделов» с именами
  категорий, примечание.

## Критерии приёмки

- Браузер: переименовать себя в «Оформлении» → имя в шапке/зарплатах обновилось; очистить поле
  и уйти — прежнее имя вернулось; выбрать цвет «Жилью» → полосы Бюджета/Обзора перекрасились,
  после перезагрузки цвет на месте, в тёмной теме — тёмная пара.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Хранение оформления в документе — нет (Р-20).
- Выход и повторный вход (Н-6) — хвост §4 RP.
