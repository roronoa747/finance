# Блок 4 — Экраны: Бюджет и Ритуал (Budget, Ritual) · сессии

**Цель блока:** Реализовать экран управления бюджетом `Budget.vue` с тремя режимами («План» расходов по категориям, интерактивный «Календарь» выплат месяца, хронологический «Список» списаний) и экран `Ritual.vue` для сценария высвобождения средств при снижении обязательств.

Сессии: исполнитель ✅ · критик ⬜ · приёмка ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high

```
/worker migrate-go-vue 4
```

Блок-специфика:
- Среда: Node.js 20+, каталог `frontend/`. Стек: Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS 4, Pinia, `@phosphor-icons/vue`, `vue-router`, `shadcn-vue` (`radix-vue`, стиль `new-york`, `neutral base`, утилита `cn()` из `@/lib/utils`).
- Факты Блоков 1, 2 и 3:
  - Готова навигационная основа `AppShell.vue` с переходом на `/budget`, модальными панелями и UI Kit (`Button.vue`, `Input.vue` на `shadcn-vue`, `NumField.vue`, `Segmented.vue`, `Card.vue`, `Row.vue`, `Section.vue`, `Callout.vue`, `Hero.vue`), компонентами графиков (`Bar.vue` с `Seg[]`, `Legend.vue`, `Ring.vue`).
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

- **Коммиты:**
  - `4b82627` — `MGV-10: Экран Budget.vue (План, Календарь, Список), управление окладами и SalaryDialog`
  - `bd4999c` — `MGV-11: Экран Ritual.vue (высвобождение средств)`
- **Сделанное:**
  - `MGV-10`:
    - В `frontend/src/lib/finance.ts` добавлена функция `nextSalaryChange(p, key)`.
    - В `frontend/src/stores/finance.ts` реализованы методы `correctSalary`, `amendSalary`, `setGoalMonthly`.
    - Добавлены недостающие компоненты UI Kit: `Stat.vue`, `Hint.vue`, `SavedMark.vue`, `NumFieldBlur.vue`, в `Row.vue` добавлен слот `#value`.
    - Реализован компонент `SalaryDialog.vue` (исправление оклада, планирование изменения с выбором месяца, расчётом дельты и причиной, история версий оклада).
    - Реализован экран `Budget.vue` с тремя режимами: «План» (доходы участников, категории d1-d4 с редактированием d4, свободный остаток d5, Callout о превышении), «Календарь» (показатели отложено/на обязательства, сетка дней недели и чисел месяца с точками событий, legenda, выбор дня и список dayEvents, блок нагрузки на доход), «Список» (хронологический список списаний/поступлений).
    - Маршрут `/budget` переведён на `Budget.vue`. Написаны тесты в `frontend/src/views/Budget.test.ts`.
  - `MGV-11`:
    - Реализован экран `Ritual.vue` по эталону `src/screens/Ritual.tsx`: проверка высвобождения (`delta < 0`), информативная заглушка при отсутствии, распределение шагами по 10 000 ₸ между целями, досрочным погашением кредита и качеством жизни, расчёт финансового эффекта в реальном времени, сохранение обновлённых взносов в цели через `setGoalMonthly` и синхронизация.
    - Маршрут `/ritual` переведён на `Ritual.vue`. Написаны тесты в `frontend/src/views/Ritual.test.ts`.
- **Отклонения от ТЗ:**
  - Нет. Реализация 1-в-1 соответствует эталонам React (`src/screens/Budget.tsx`, `src/screens/Ritual.tsx`) и доменным формулам.
- **Грабли среды:**
  - Для vitest в `frontend/vite.config.ts` настроен `testTimeout: 15000`, исключающий ложные тайм-ауты SSR-компиляции тяжелых вьюшек на Windows.
- **Верификация:**
  - Тесты: `cd frontend && npm test` — 13 тест-файлов, 70/70 тестов успешно (100% pass).
  - Билд: `cd frontend && npm run build` — `vue-tsc -b && vite build` проходит чисто (0 ошибок, 0 ворнингов).
  - Браузер: сценарии проверены через browser subagent (вкладка Бюджет, переключение План / Календарь / Список, выбор дня 10 с зарплатой, экран /ritual).
- **Следующий шаг:** `/critic migrate-go-vue 4`

---

## Итоги критика

---

## Приёмка
