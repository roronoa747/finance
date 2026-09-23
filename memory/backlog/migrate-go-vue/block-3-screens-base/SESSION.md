# Блок 3 — Экраны: База (Access, Setup, Overview) · сессии

**Цель блока:** Реализовать базовую навигацию (`vue-router`), интерфейс авторизации/регистрации/инвайта (`Access.vue`), пошаговый мастер первоначальной настройки бюджета (`Setup.vue`), навигационный каркас (`AppShell.vue`) и главный экран сводки капитала и аналитики (`Overview.vue`).

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high

```
/worker migrate-go-vue 3
```

Блок-специфика:
- Среда: Node.js 20+, каталог `frontend/`. Стек: Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS 4, Pinia, `@phosphor-icons/vue`, `vue-router`.
- Факты Блоков 1 и 2 (готовая база):
  - `useAuthStore` (`frontend/src/stores/auth.ts`): методы `login`, `register`, `joinHousehold`, `createInvite`, `fetchMe`, `logout`, реактивные геттеры `isAuthenticated`, `isMember`, `isViewer`, `slot`.
  - `useFinanceStore` (`frontend/src/stores/finance.ts`): реактивное состояние казны (`people`, `categories`, `goals`, `obligations`, `accounts`, `credits`), методы `mutateHouseholdDoc`, `syncHousehold`, `pullHousehold`, `resetDoc`.
  - Дизайн-токены: в `frontend/src/style.css` (цвета `--canvas`, `--surface`, `--ink`, `--brand`, `--d1`..`--d5`, поддержка `.dark`). Не писать литеральные HEX цвета в компонентах — использовать токены или Tailwind классы `bg-canvas`, `text-ink`, `bg-brand` и т.д.
  - Математика: все финансовые расчёты производятся функциями из `frontend/src/lib/finance.ts`, форматирование валюты — через `frontend/src/lib/money.ts`.
- Эталонная верстка экранов для портирования:
  - `src/screens/Access.tsx` ➔ `frontend/src/views/Access.vue`
  - `src/screens/Setup.tsx` ➔ `frontend/src/views/Setup.vue`
  - `src/screens/Overview.tsx` ➔ `frontend/src/views/Overview.vue`
  - `src/components/AppShell.tsx` ➔ `frontend/src/components/AppShell.vue`
- Задачи по порядку: `MGV-08` ➔ `MGV-09`.
- Верификация: `cd frontend && npm run build && npm test`.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh

```
/critic migrate-go-vue 3
```

Блок-специфика:
- Проверить корректность навигационных гардов (неавторизованный пользователь не может попасть на `/` в обход `/access`; не настроивший бюджет перенаправляется на `/setup`).
- Проверить совпадение всех расчётов дашборда `Overview.vue` с доменными инвариантами `finance.ts`.
- Проверить адаптивность и работу тёмной темы на созданных экранах.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh

```
/accept migrate-go-vue 3
```

Блок-специфика:
- Сквозной тест сценария: открытие приложения ➔ регистрация нового домохозяйства ➔ прохождение мастера настройки ➔ отображение экрана сводки `Overview.vue` с реальными данными.
- Проверка генерации инвайт-кода и экрана присоединения партнёра.
- Прогон Vitest и проверка отсутствия ошибок в консоли браузера.

---

## Handoff (заполняет исполнитель)

- **Коммиты:**
- **Что сделано:**
- **Отклонения от ТЗ:**
- **Грабли среды:**
- **Верификация:**

---

## Итоги критика

---

## Приёмка
