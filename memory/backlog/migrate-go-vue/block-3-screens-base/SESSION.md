# Блок 3 — Экраны: База (Access, Setup, Overview) · сессии

**Цель блока:** Реализовать базовую навигацию (`vue-router`), интерфейс авторизации/регистрации/инвайта (`Access.vue`), пошаговый мастер первоначальной настройки бюджета (`Setup.vue`), навигационный каркас (`AppShell.vue`) и главный экран сводки капитала и аналитики (`Overview.vue`).

Сессии: исполнитель ✅ · критик 🔄 · приёмка ⬜

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

- **Ревью корректности и инвариантов:**
  - В `Access.vue` исправлен отсутствовавший импорт иконки `PhSparkle` из `@phosphor-icons/vue` в секции демонстрационного режима (приводило к Vue warn о неразрешённом компоненте).
  - В `AppShell.vue` исправлен баг вычисления `memberCount`: ранее использовалось ошибочное выражение `authStore.household ? 2 : people.value.length`, из-за которого при наличии созданного домохозяйства пункт «Пригласить партнёра» в меню добавления (`+`) скрывался даже когда в семье был только 1 участник. Исправлено на честный `computed(() => people.value.length)`.
  - В `AppShell.vue` исправлен путь навигации для пункта «Пригласить партнёра»: переход перенаправлен на `/` (где находится интерактивный баннер генерации инвайт-кода) вместо `/setup` (который при завершённой настройке редиректил обратно на `/`).
  - Устранена неиспользуемая переменная `authStore` в `AppShell.vue` (устранена ошибка `TS6133` в `vue-tsc -b`).
  - Все математические расчёты (`budgetAmounts`, `netWorth`, `untilPayday`, `cushionMonths`, `liquidCash`, `mandatoryMonthly`) строго проверены на соответствие эталонным алгоритмам из `src/store/useStore.ts` и инвариантам «деньги — целые числа».
- **Упрощение и реюз:**
  - Проверено переиспользование UI Kit (`Button.vue`, `Input.vue`, `NumField.vue`, `Segmented.vue`, `Card.vue`, `Row.vue`, `Section.vue`, `Callout.vue`) и графических компонентов (`CategoryBar.vue`, `EmergencyBanner.vue`, `Ring.vue`, `MetricCard.vue`). Дублирования логики нет.
- **Добивка тестов:**
  - В `Overview.test.ts` добавлен компонентный SSR-тест рендеринга `Overview.vue` с моковыми данными хранилища (проверка отображения ключевых метрик, свободного остатка, баннеров подушки и приглашения партнёра).
  - В `views.test.ts` добавлен компонентный SSR-тест разметки экрана `Access.vue` (проверка вкладок авторизации/регистрации/инвайта, формы и кнопки песочницы).
  - Итого в проекте: **60 тестов в 11 тест-сьютах, 100% зелёные**. Сборка `npm run build` проходит за 500ms без ошибок.
- **Подготовка Блока 4:**
  - Создан каталог `memory/backlog/migrate-go-vue/block-4-budget-ritual/` с ТЗ `MGV-10-budget-calendar.md`, `MGV-11-ritual.md` и планом сессий `SESSION.md`.
- **Следующий шаг:** `/accept migrate-go-vue 3` (приёмка функционала Блока 3).

---

## Приёмка

- **Вердикт:** ВОЗВРАТ НА ДОРАБОТКУ 🔄 (по замечанию владельца и решению от 2026-09-23).
- **Причина возврата:**
  1. **Смена UI-стека на shadcn-vue:** Владелец подтвердил обязательное требование использовать библиотеку `shadcn` (оформлено решение [`memory/decisions/shadcn-vue.md`](../../decisions/shadcn-vue.md), обновлено Р-3 в `00-backlog.md`). Самописный mini-UI kit с `rounded-xl` должен быть заменён на честный `shadcn-vue` (`radix-vue`, `cva`, `clsx`, `tailwind-merge`, стиль `new-york`, `baseColor: neutral`).
  2. **Расхождение экрана `Overview.vue` с эталоном:** Сетка из 4 карточек `MetricCard` и баннер `EmergencyBanner` добавлены сверх эталона `src/screens/Overview.tsx`. Экран перегружен и визуально изменился.
- **Конкретные расхождения исполнителю на доработку:**
  1. Установить в `frontend/`: `radix-vue`, `class-variance-authority`, `clsx`, `tailwind-merge`.
  2. Создать `frontend/components.json` (стиль `new-york`, neutral) и `frontend/src/lib/utils.ts` с функцией `cn()`.
  3. Перевести компоненты `Button.vue` и `Input.vue` на канонический `shadcn-vue` со стилем New York (`rounded-md`, тени, правильные бордеры).
  4. Восстановить вёрстку `Overview.vue` 1-в-1 по эталону `src/screens/Overview.tsx`: убрать `MetricCard` и `EmergencyBanner`, оставить чистый Hero, полосы распределения с легендой, событие высвобождения, блок «До зарплаты», карточку «Впереди» и кольца «Цели».
  5. Обеспечить прохождение всех тестов и билда (`npm run build && npm test`).
- **Следующий шаг:** `/worker migrate-go-vue 3`


