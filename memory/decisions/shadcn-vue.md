# Изменение зафиксированного решения: Р-3 (Стек UI фронтенда)

- **Дата:** 2026-09-23
- **Инициатор:** Владелец проекта
- **Решение:** Р-3 (Стек фронтенда)

## Было ➔ Стало

- **Было:**
  `Р-3. Фронтенд: Vue 3 (Composition API, <script setup>), Vite, TypeScript, Pinia, Tailwind CSS 4, Phosphor Icons for Vue. (источник: бриф)`
- **Стало:**
  `Р-3. Фронтенд: Vue 3 (Composition API, <script setup>), Vite, TypeScript, Pinia, Tailwind CSS 4, shadcn-vue (radix-vue, стиль new-york, neutral base), Phosphor Icons for Vue. (источник: решение владельца от 2026-09-23)`

## Причина изменения

Владелец указал на изменение дизайна по сравнению с эталоном React и подтвердил требование использовать библиотеку **shadcn** (честный `shadcn-vue` на базе `radix-vue`). Самописный mini-UI kit с нестандартными скруглениями (`rounded-xl`/`rounded-2xl`) и добавление лишних карточек метрик на экран `Overview.vue` нарушили точное 1-в-1 соответствие с эталоном `src/screens/Overview.tsx`.

## Что затронуто

1. Зависимости `frontend/package.json`: добавление `radix-vue`, `class-variance-authority`, `clsx`, `tailwind-merge`.
2. Конфигурация: создание `frontend/components.json` (стиль `new-york`) и `frontend/src/lib/utils.ts` с `cn()`.
3. Базовые компоненты `frontend/src/components/ui/`: перевод на канонический `shadcn-vue` (`Button`, `Input`, `Card`).
4. Экран `Overview.vue`: возврат структуры дашборда к эталону `src/screens/Overview.tsx` (удаление 4 карточек `MetricCard` и баннера подушки, восстановление чистого Hero и списков).
5. Экраны `Access.vue`, `Setup.vue`, каркас `AppShell.vue`: использование компонентов shadcn-vue.
6. Блок 3 возвращается исполнителю на доработку (`/worker migrate-go-vue 3`).
