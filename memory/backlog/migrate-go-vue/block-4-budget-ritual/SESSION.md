# Блок 4 — Экраны: Бюджет и Ритуал (Budget, Ritual) · сессии

**Цель блока:** Реализовать экран управления бюджетом `Budget.vue` с тремя режимами («План» расходов по категориям, интерактивный «Календарь» выплат месяца, хронологический «Список» списаний) и экран `Ritual.vue` для сценария высвобождения средств при снижении обязательств.

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high

```
/worker migrate-go-vue 4
```

Блок-специфика:
- Среда: Node.js 20+, каталог `frontend/`. Стек: Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS 4, Pinia, `@phosphor-icons/vue`, `vue-router`.
- Факты Блоков 1, 2 и 3:
  - Готова навигационная основа `AppShell.vue` с переходом на `/budget`, модальными панелями и UI Kit (`Button.vue`, `Input.vue`, `NumField.vue`, `Segmented.vue`, `Card.vue`, `Row.vue`, `Section.vue`, `Callout.vue`), компонентом полосы `CategoryBar.vue`.
  - Маршруты `/budget` и `/ritual` зарегистрированы в `frontend/src/router/index.ts` и временно рендерят `PlaceholderView.vue`.
  - Хранилище `useFinanceStore`: реактивное состояние казны (`people`, `categories`, `obligations`, `credits`, `goals`), методы `setCategoryAmount`, `mutateHouseholdDoc`, `syncHousehold`.
  - Все финансовые расчёты производятся функциями из `frontend/src/lib/finance.ts`, форматирование — через `money.ts`, даты и сетка календаря — через `dates.ts`.
- Эталонная верстка экранов для портирования:
  - `src/screens/Budget.tsx` ➔ `frontend/src/views/Budget.vue`
  - `src/screens/Ritual.tsx` ➔ `frontend/src/views/Ritual.vue`
- Задачи по порядку: `MGV-10` ➔ `MGV-11`.
- Заменить `PlaceholderView` на созданные экраны в `frontend/src/router/index.ts`.
- Верификация: `cd frontend && npm run build && npm test`.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh

```
/critic migrate-go-vue 4
```

Блок-специфика:
- Проверить корректность сетки календаря и смещения пустых клеток (`leadingBlanks`, `daysInMonth`).
- Проверить строгое соблюдение инвариантов сумм по категориям `d1`..`d5` и доменной формулы `budgetAmounts`.
- Проверить, что распределение в `Ritual.vue` не допускает отрицательного остатка (`left >= 0`) и корректно модифицирует цели в `financeStore`.
- Проверить адаптивность и тему на мобильных разрешениях.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh

```
/accept migrate-go-vue 4
```

Блок-специфика:
- Сквозной тест сценариев:
  - Переход во вкладку «Бюджет» ➔ переключение между «План», «Календарь» и «Список».
  - Выбор конкретного дня в календаре и проверка списка запланированных на этот день оплат.
  - Изменение лимита категории «Еда и быт» (`d4`) и мгновенное отражение на свободном остатке (`d5`).
  - Переход в экран ритуала `/ritual`, интерактивное распределение шагов и сохранение результата.
- Прогон Vitest и проверка консоли браузера.

---

## Handoff (заполняет исполнитель)

---

## Итоги критика

---

## Приёмка
