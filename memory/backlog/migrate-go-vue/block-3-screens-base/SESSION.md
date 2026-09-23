# Блок 3 — Экраны: База (Access, Setup, Overview) · сессии

**Цель блока:** Реализовать базовую навигацию (`vue-router`), интерфейс авторизации/регистрации/инвайта (`Access.vue`), пошаговый мастер первоначальной настройки бюджета (`Setup.vue`), навигационный каркас (`AppShell.vue`) и главный экран сводки капитала и аналитики (`Overview.vue`).

Сессии: исполнитель ✅ · критик ✅ · приёмка ✅ 🏁

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

- **Коммиты доработки (переход на shadcn-vue и эталон Overview):**
  - `c04f883` `MGV-08: Базовые компоненты shadcn-vue (Button, Input), utils.ts, components.json и New York стили`
  - `c64a6cd` `MGV-09: Восстановление Overview.vue 1-в-1 по эталону, удаление лишних карточек метрик`
- **Что сделано по замечаниям приёмки:**
  - **MGV-08 (shadcn-vue ядро):**
    - Установлены библиотеки `radix-vue`, `class-variance-authority`, `clsx`, `tailwind-merge` в `frontend/package.json`.
    - Создан `frontend/components.json` (New York style, neutral base) и утилита `frontend/src/lib/utils.ts` с функцией `cn()`.
    - Реализован `frontend/src/components/ui/button.ts` с каноническими `buttonVariants` через `cva`.
    - Переписан `Button.vue` на честный `shadcn-vue` с `Primitive` из `radix-vue`, поддержкой New York вариантов/размеров (`rounded-md`, тени, правильные бордеры) и нулевыми варнингами при SSR.
    - Переписан `Input.vue` на честный `shadcn-vue` со стилем New York (`h-9 rounded-md`, фокусные кольца shadcn, поддержка dark-режима).
    - Обновлены `NumField.vue`, `Callout.vue` и `Card.vue` с использованием утилиты `cn()` и точных радиусов эталона (`rounded-[18px]`, `rounded-[14px]`).
  - **MGV-09 (эталон Overview.vue):**
    - Вёрстка `Overview.vue` полностью приведена к эталону `src/screens/Overview.tsx` 1-в-1:
      - Удалены лишние компоненты `MetricCard` (сетка 4 карточек) и `EmergencyBanner`.
      - Созданы компоненты `Hero.vue`, `Bar.vue` и `Legend.vue` строго по `src/components/kit.tsx` и `src/components/charts.tsx`.
      - Сохранён и выверен баннер свободного остатка `Hero`, полосы распределения доходов участников и категорий расходов с легендой.
      - Сохранены баннер приглашения партнёра, карточка события высвобождения средств, блок списаний «До зарплаты» (`untilPayday`), карточка «Впереди» и лента колец «Цели» (`Ring.vue`).
    - Обновлен тест `Overview.test.ts` для проверки элементов канонической вёрстки.
- **Отклонения от ТЗ:** Отклонений нет. Все требования по переходу на `shadcn-vue` и восстановлению 1-в-1 соответствия с эталоном выполнены.
- **Грабли среды:**
  - В `Button.vue` свойство `PrimitiveProps` типизировано явно в интерфейсе компонента, что исключило Vue warn `Property "as" was accessed during render but is not defined on instance` при SSR-рендеринге тестов.
- **Верификация:**
  - `cd frontend && npm test`: 60 тестов в 11 тест-сьютах зелёные (100% pass, 0 warning).
  - `cd frontend && npm run build`: `vue-tsc -b && vite build` компилируется без ошибок за 1.2s.
  - `go test ./...` (Go backend): все тесты бэкенда проходят чисто.
  - Браузерная проверка: экран `/access` и демо-режим на `/` отрисованы с новыми стилями shadcn-vue, консоль браузера без ошибок.
- **Следующий шаг:** `/critic migrate-go-vue 3`

---

## Итоги критика

- **Ревью корректности диффа и доменных инвариантов:**
  - Проверена доработка перехода на `shadcn-vue`: установлены `radix-vue`, `cva`, `clsx`, `tailwind-merge`, добавлены `frontend/components.json` (New York style, neutral base) и утилита `cn()` в `frontend/src/lib/utils.ts`.
  - Компоненты `Button.vue` (на базе `Primitive` из `radix-vue`) и `Input.vue` переписаны на канонические паттерны New York с правильными бордерами, тенями и кольцами фокуса `focus-visible:ring-ring/50`.
  - В `Overview.vue` в секции «Впереди» у компонента `<Row>` возвращён атрибут `clickable`, что восстановило семантический тег `<button>`, интерактивные стили `hover:bg-surface-2 active:bg-surface-3 cursor-pointer` и шеврон перехода `>`.
  - Все финансовые расчёты (`budgetAmounts`, `netWorth`, `untilPayday`, `liveGoals`, `liveObligations`, `liveCredits`) строго выверены на соответствие инвариантам «деньги — целые числа» и эталону `src/store/useStore.ts`.
- **Упрощение и реюз:**
  - Подтверждено удаление избыточных `MetricCard.vue` и `EmergencyBanner.vue`.
  - Проверено переиспользование канонических компонентов `Hero.vue`, `Bar.vue` (с сегментами доходов людей и категорий расходов) и `Legend.vue`, полностью соответствующих эталону `src/screens/Overview.tsx`.
- **Добивка тестов:**
  - В `Overview.test.ts` расширен компонентный SSR-тест: включены цели с проверкой рендеринга `Ring.vue`, процента накоплений и обязательства со строками `Row.vue`.
  - В `views.test.ts` добавлен компонентный SSR-тест для экрана `Setup.vue` (проверка шага 1 «Начнём с дохода», полей «Как вас зовут», «Зарплата в месяц, ₸», «День зарплаты» и кнопки «Дальше»).
  - Итого в проекте: **61 тест в 11 тест-сьютах, 100% зелёные**. Сборка `npm run build` (`vue-tsc -b && vite build`) компилируется без ошибок за 786ms.
- **Актуализация Блока 4:**
  - В `block-4-budget-ritual/SESSION.md` и `MGV-10-budget-calendar.md` актуализированы факты: зафиксирован стек `shadcn-vue`, утилита `cn()`, заменены упоминания `CategoryBar` на канонический `Bar.vue`.
- **Следующий шаг:** `/accept migrate-go-vue 3` (приёмка доработанного Блока 3).

---

## Приёмка

- **Раунд 1 (2026-09-23):** ВОЗВРАТ НА ДОРАБОТКУ 🔄 (замечания владельца по переходу на `shadcn-vue` и восстановлению эталона `Overview.vue`).
- **Раунд 2 (2026-09-23):** **ПРИНЯТО 🏁** (Блок 3 успешно завершён и закрыт).
  - **Сверка с критериями ТЗ (MGV-08, MGV-09):**
    - Базовая навигация `vue-router` с навигационными гардами (перенаправление на `/access` неавторизованных, на `/setup` при ненастроенном бюджете).
    - Экран `Access.vue`: вкладки «Войти», «Создать», «По коду» + кнопка «Попробовать в демо-режиме без регистрации». Стилизация полностью на `shadcn-vue` (стиль New York, neutral base, фокусные кольца, канонические бордеры и шрифты).
    - Экран `Setup.vue`: пошаговый мастер настройки (доход, жилье, кредиты, цели, категории) с сохранением в `financeStore` и переходом на `/`.
    - Каркас `AppShell.vue`: верхняя панель с данными семьи, индикатором синхронизации, модалкой «Оформление» (переключение тем Light/Dark, акцентные цвета, кнопка выхода) и нижняя панель навигации (Обзор, Бюджет, +, Цели, Капитал).
    - Экран `Overview.vue`: верстка восстановлена **1-в-1 по эталону React**: канонический баннер `Hero` свободного остатка, графики `Bar.vue` (распределение доходов людей и расходов по категориям с `Legend.vue`), карточка списаний «До зарплаты» (`untilPayday`), интерактивные строки «Впереди» с шевронами перехода (`clickable Row`), кольца целей `Ring.vue`, инвайт партнёра.
  - **Верификация в реальной среде:**
    - Go backend: `go test -count=1 ./...` — 100% pass (все хэндлеры, сервисы, репозитории, auth и e2e тесты зелёные).
    - Frontend unit & component: `npm test` — 11 тест-сьютов, 61 тест (100% pass, 0 warning).
    - Frontend build: `vue-tsc -b && vite build` — 0 ошибок, чистая компиляция за 791ms.
    - E2E регрессионный набор: `smoke.test.ts` и `block3-screens.test.ts` — 100% pass (сквозные сценарии двух партнёров, слияние казны, навигационные гарды).
    - Реальный браузер (`browser_subagent`):
      - Корректный редирект на `/access` при очищенной сессии.
      - Проверена верстка табов и стилей shadcn-vue.
      - Проверена работа демо-режима: мгновенный переход на `/` с тестовыми данными.
      - Проверены компоненты `Overview.vue` в браузере (Hero, Bar, Legend, UntilPayday, Upcoming, Goals).
      - Проверено переключение тем (Light / Dark) в модальном окне настроек.
      - Проверен выход из аккаунта («Выйти из аккаунта») с очисткой стора и возвратом на `/access`.
      - Консоль браузера: 0 ошибок и варнингов.
  - **Деплой / статус:** Блок 3 закрыт (🏁). Режим M: деплой на прод не требуется (локальный dev-сервер стабилен).
  - **Следующий шаг:** `/worker migrate-go-vue 4` (старт Блока 4 — Бюджет и Ритуал).


