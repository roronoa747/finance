# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

## Разбор месяца v4 (бэклог «Фидбек», Блок 4б)

Разбор свой у каждого участника. Карточки — находки и кнопки — считает код на телефоне по своим операциям:
`lib/statements/finds.ts` (люди, наличные, не разобрано, похоже на разовую, дорогая неделя, мелочь, выходные) и
`lib/finance.ts` (`reviewCards` — таблица видов, порогов и кнопок; `whereSplit` — «Куда ушло» на всю сумму). Модель
пишет только первую карточку — одну главную мысль месяца и какую карточку показать следом: тело — `lib/aiFacts.ts`
(`buildReviewFactsV4`, без имён людей и участников), ручка — `POST /api/ai/review` с `v: 4`
(`backend/internal/handlers/ai.go`, модель — env `AI_MODEL_REVIEW`). Разбор хранится в личном документе
(`privateDoc.aiReviews`); экран — `components/ai/AiReport.vue`, листы кнопок открывает «Месяц» (`MonthPlan.vue`).
Без ИИ — те же карточки без мысли.
