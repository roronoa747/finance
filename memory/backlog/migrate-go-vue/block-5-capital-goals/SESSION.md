# Блок 5 — Капитал, Цели и Сквозная приёмка (Capital, Goals, Acceptance) · сессии

**Цель блока:** Реализовать экран управления активами и кредитами `Capital.vue` (счета, кредиты, симулятор досрочного погашения), экраны целей `Goals.vue`, `GoalDetail.vue`, `Deposit.vue` (пополнение и снятие), заменить оставшиеся `PlaceholderView` в роутере и провести финальную сквозную приёмку E2E-сценариев миграции.

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high

```
/worker migrate-go-vue 5
```

Блок-специфика:
- Среда: Node.js 20+, каталог `frontend/`. Стек: Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS 4, Pinia, `@phosphor-icons/vue`, `vue-router`, `shadcn-vue` (`radix-vue`, стиль `new-york`, `neutral base`, утилита `cn()` из `@/lib/utils`).
- Факты Блоков 1, 2, 3 и 4:
  - Закрыты бэкенд, ядро математики слияния, экраны `Access.vue`, `Setup.vue`, `Overview.vue`, `Budget.vue`, `Ritual.vue`.
  - В роутере `frontend/src/router/index.ts` маршруты `/capital` и `/goals` временно рендерят `PlaceholderView.vue`.
  - Хранилище `useFinanceStore`: `accounts`, `credits`, `goals`, методы `mutateHouseholdDoc`, `mutatePrivateDoc`, `syncHousehold`, `syncPrivate`.
  - Все финансовые функции готовы в `frontend/src/lib/finance.ts`: `netWorth`, `prepayment`, `amortization`, `goalMonths`, `liquidCash`.
- Эталонная верстка экранов для портирования:
  - `src/screens/Capital.tsx` ➔ `frontend/src/views/Capital.vue`
  - `src/screens/Goals.tsx` ➔ `frontend/src/views/Goals.vue`
  - `src/screens/GoalDetail.tsx` ➔ `frontend/src/views/GoalDetail.vue`
  - `src/screens/Deposit.tsx` ➔ `frontend/src/views/Deposit.vue`
- Задачи по порядку: `MGV-12` ➔ `MGV-13` ➔ `MGV-14`.
- Заменить `PlaceholderView` на созданные экраны в роутере.
- Верификация: `cd frontend && npm run build && npm test`.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh

```
/critic migrate-go-vue 5
```

Блок-специфика:
- Проверить расчет досрочного погашения кредитов (`prepayment`) и пересчет графиков платежей.
- Проверить приватность счетов (личные счета сохраняются только в `private_docs`, общие — в `household_docs`).
- Проверить операции по целям: пополнение (`Deposit.vue`), снятие, изменение параметров цели.
- Проверить сквозные E2E-тесты двух клиентов.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh

```
/accept migrate-go-vue 5
```

Блок-специфика:
- Финальная сквозная приёмка всего мигрированного приложения (DoD миграции):
  - Регистрация двух пользователей в одном домохозяйстве.
  - Первоначальная настройка через `Setup.vue`.
  - Сводка `Overview.vue`, переход во все разделы (`Budget`, `Capital`, `Goals`, `Ritual`).
  - Проверка синхронизации через Go API и PostgreSQL бэкенд.
  - Полный прогон всех накопленных E2E-тестов (`npm test`).
  - Чистота консоли браузера и отсутствие ошибок сборки.

---

## Handoff (заполняет исполнитель)

---

## Итоги критика

---

## Приёмка
