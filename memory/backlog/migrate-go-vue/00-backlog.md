# Бэклог «Миграция на Go + Vue 3» (MGV)

> **Статус:** Блоки 1–5 🏁 (у Блока 1 деплой перенесён в Блок 6 решением владельца 2026-09-24; CI бэкенда зелёный на `mgv-ci`). Блок 6 «Прод-инфраструктура и cutover» ⬜ — задачи MGV-15…MGV-19 заведены 2026-09-24 по брифу Блока 6.
> Следующий шаг: `/worker migrate-go-vue 6 ultrathink` (промпты — `block-6-prod-cutover/SESSION.md`).

Источник: `migrate-go-vue-brief.md` (резюме интервью подтверждено владельцем 2026-09-23); Блок 6 — `migrate-go-vue-block-6-brief.md` (подтверждён 2026-09-24).
Формат — `memory/process/BACKLOG-GUIDE.md`. **Решения §2 зафиксированы — рабочие сессии их не пересматривают.**

---

## 1. Цель

Перевести полнофункциональное семейное финансовое приложение с React 19 + Supabase на независимый стек: **Go (REST API бэкенд) + Vue 3 SPA (фронтенд) + PostgreSQL**. Сохранить 100% бизнес-логики, алгоритмов слияния и финансовой математики без регрессий.

Режим процесса: **L** (архитектурная смена стека и безопасности; Блок 1 идёт по L-конвейеру с каталожным ревью).

---

## 2. Зафиксированные решения

- **Р-1. Стек бэкенда**: Go (Go 1.27+), стандартная библиотека + роутер Chi, чистая архитектура (handlers, service, repository). *(источник: бриф)*
- **Р-2. База данных**: PostgreSQL. Схема повторяет проверенную модель: `households`, `household_members`, `household_docs`, `private_docs`, `household_invites`. *(источник: выбор владельца)*
- ~~**Р-3. Фронтенд**: Vue 3 (Composition API, `<script setup>`), Vite, TypeScript, Pinia, Tailwind CSS 4, Phosphor Icons for Vue. *(источник: бриф)*~~ ➔ **Р-3 (в редакции от 2026-09-23)**: Vue 3 (Composition API, `<script setup>`), Vite, TypeScript, Pinia, Tailwind CSS 4, **shadcn-vue** (библиотека компонентов на базе `radix-vue`, стиль `new-york`, `neutral base`), Phosphor Icons for Vue. *(источник: решение владельца, см. [`memory/decisions/shadcn-vue.md`](../decisions/shadcn-vue.md))*
- **Р-4. Структура проекта (монорепозиторий)**:
  - `backend/` — исходники Go API.
  - `frontend/` — исходники Vue 3 SPA.
  - `src/` — текущий эталонный код React (не удаляется до успешной сквозной приёмки Блока 5). *(источник: решение архитектора)*
- **Р-5. Приватность и безопасность**:
  - `household_docs` — доступен обоим партнёрам домохозяйства.
  - `private_docs` — физически изолирован, доступен ТОЛЬКО владельцу (авторизованному `user_id`).
  - Пароли хэшируются через bcrypt, токены — JWT (HS256). *(источник: безопасность)*

Решения Блока 6 (бриф Блока 6, подтверждён владельцем 2026-09-24):

- **Р-6. Инфраструктура та же**: Vue и Go (Vercel-функция) на Vercel, PostgreSQL — Supabase (`tpkyopaovfdkcmdhauws`), бесплатные тарифы. *(ответ владельца, 2026-09-24)*
- **Р-7. Таблицы Go — в отдельной схеме `app`** того же проекта Supabase; таблицы React в `public` не трогаются до уборки. *(раунд 1 — рекомендация)*
- **Р-8. Пользователи переносятся с паролями**: `id`, `email`, bcrypt-хеш из `auth.users` в `app.users`; UUID и `rev` документов сохраняются. *(раунд 1 — рекомендация)*
- **Р-9. Cutover разом с окном**: репетиция + смоук на preview → окно (оба устройства синхронизированы → финальная копия → push в `main`) → тот же адрес. Откат — redeploy React-сборки + обратный скрипт для записей, сделанных в Go после переключения. *(раунд 1 — рекомендация)*
- **Р-10. PWA во Vue возвращается до cutover.** *(раунд 1 — рекомендация)*
- **Р-11. Курс Нацбанка — `GET /api/fx-rate` в Go** (с кэшем) до cutover; Vue не зависит от Supabase. *(раунд 3 — рекомендация)*
- **Р-12. Секреты и прод-шаги**: строку подключения Supabase владелец кладёт в `memory/secrets/`; агент генерирует `JWT_SECRET`, выставляет env в Vercel и выполняет SQL через коннекторы — **каждый прод-шаг только с согласия владельца**. *(раунд 2 — рекомендация)*
- **Р-13. Хвосты Блока 1**: fail-fast прода и коды ошибок 400/413 — в Блок 6; liveness/readiness (Н-10) закрывается как неактуальный для serverless. *(раунд 2 — рекомендация)*
- **Р-14. Переносятся все пять таблиц** (`households`, `household_members`, `household_docs`, `private_docs`, `household_invites`); сверка — и по `private_docs` (`rev` каждого участника). *(дефолт — владелец согласился, 2026-09-24)*
- **Р-15. Сессия Supabase не переносится**: после cutover каждый участник один раз входит заново старым паролем; кэш React в `localStorage` Vue не читает. *(дефолт — владелец согласился, 2026-09-24)*

---

## 3. Матрица прав

| Действие | Member (участник) | Viewer (наблюдатель) | Анонимный |
|---|---|---|---|
| Регистрация / Вход | — | — | ✅ |
| Чтение семейного бюджета (`household_docs`) | ✅ | ✅ | ❌ |
| Запись в семейный бюджет (`household_docs`) | ✅ | ❌ | ❌ |
| Доступ к личному кошельку (`private_docs`) | ✅ (только свой) | ✅ (только свой) | ❌ |
| Создание инвайта партнёру | ✅ | ❌ | ❌ |

---

## 4. Блоки и задачи

Статусы задач: ⬜ не начата · 🔄 в работе · ✅ готова. 
Статус блока (⬜ 🔄 ✅ принят · 🏁 закрыт).

| Блок | Задача | Файл | Зависит от | Статус |
|---|---|---|---|---|
| **1. Go Backend** 🏁 закрыт, деплой → Блок 6 *(L: безопасность, БД)* | MGV-01 Скелет Go-сервера, конфиг и подключение к PostgreSQL | `block-1-backend/MGV-01-go-skeleton-db.md` | — | ✅ |
| | MGV-02 Модели, миграции и репозитории данных | `block-1-backend/MGV-02-db-models-repo.md` | MGV-01 | ✅ |
| | MGV-03 Аутентификация, JWT и управление домохозяйством | `block-1-backend/MGV-03-auth-household.md` | MGV-02 | ✅ |
| | MGV-04 API синхронизации `household_docs` и `private_docs` с ревизиями | `block-1-backend/MGV-04-sync-api.md` | MGV-03 | ✅ |
| **2. Vue Core & Math** 🏁 закрыт *(M: фронтенд ядро)* | MGV-05 Скелет Vue 3 + Vite + Tailwind + Pinia | `block-2-vue-core/MGV-05-vue-skeleton.md` | MGV-04 | ✅ |
| | MGV-06 Портирование финансовой математики и слияния (`merge.ts`) | `block-2-vue-core/MGV-06-finance-merge-math.md` | MGV-05 | ✅ |
| | MGV-07 Клиент синхронизации API и хранилище Pinia | `block-2-vue-core/MGV-07-pinia-sync-store.md` | MGV-06 | ✅ |
| **3. Экраны: База** 🏁 закрыт *(M: фронтенд экраны)* | MGV-08 Экраны `Access.vue` (вход/инвайт) и `Setup.vue` (мастер) | `block-3-screens-base/MGV-08-access-setup.md` | MGV-07 | ✅ |
| | MGV-09 Экран `Overview.vue` (сводка, капитал, графики) | `block-3-screens-base/MGV-09-overview.md` | MGV-08 | ✅ |
| **4. Экраны: Бюджет** 🏁 закрыт *(M: фронтенд экраны)* | MGV-10 Экран `Budget.vue` (План, Календарь, Список) | `block-4-budget-ritual/MGV-10-budget-calendar.md` | MGV-09 | ✅ |
| | MGV-11 Экран `Ritual.vue` (высвобождение средств) | `block-4-budget-ritual/MGV-11-ritual.md` | MGV-10 | ✅ |
| **5. Капитал & Приёмка** 🏁 закрыт *(M: фронтенд экраны)* | MGV-12 Экран `Capital.vue` (счета, кредиты, досрочка) | `block-5-capital-goals/MGV-12-capital-credits.md` | MGV-11 | ✅ |
| | MGV-13 Экраны `Goals.vue`, `GoalDetail.vue`, `Deposit.vue` | `block-5-capital-goals/MGV-13-goals-deposit.md` | MGV-12 | ✅ |
| | MGV-14 Сквозная приёмка, E2E тесты двух клиентов | `block-5-capital-goals/MGV-14-e2e-acceptance.md` | MGV-13 | ✅ |
| **6. Прод-инфраструктура и cutover** 🔄 *(L: живые данные, пароли, секреты, прод; ревью — `backend`, `frontend`; деплой = cutover в клинапе)* | MGV-15 Go к проду: fail-fast, схема `app`, коды 400/413, `/api/fx-rate` | `block-6-prod-cutover/MGV-15-go-prod-ready.md` | Блоки 1–5 | 🔄 |
| | MGV-16 Vercel: Go-функция, сборка Vue, миграции отдельной командой, пулер, preview | `block-6-prod-cutover/MGV-16-vercel-go-function.md` | MGV-15 | 🔄 |
| | MGV-17 PWA во Vue, замена SW React, курс через `/api/fx-rate`, CI фронта | `block-6-prod-cutover/MGV-17-vue-pwa-fx.md` | MGV-16 | 🔄 |
| | MGV-18 Перенос данных Supabase → `app` и обратный скрипт | `block-6-prod-cutover/MGV-18-data-transfer.md` | MGV-15 | 🔄 |
| | MGV-19 Репетиция cutover на preview и ранбук `CUTOVER.md` | `block-6-prod-cutover/MGV-19-rehearsal-runbook.md` | MGV-16, MGV-17, MGV-18 | 🔄 |

Трассировка брифа Блока 6 → задачи: эскиз п.1 → MGV-15 (Р-7, Р-11, Р-13); п.2 → MGV-16 (Р-6, Р-12); п.3 → MGV-17 (Р-10, Р-11); п.4 → MGV-18 (Р-8, Р-9, Р-14); п.5 → MGV-19 (Р-9, Р-15); само переключение прода — клинап Блока 6 по `CUTOVER.md`. CI фронта (MGV-17) — не из брифа, а из инварианта гайда «CI обязателен».

### Хвосты и после MVP (идеи владельца от 2026-09-23)

| Хвост | Откуда | Судьба |
|---|---|---|
| Вход через Google OAuth и Apple ID | Запрос владельца | ⏳ новый бэклог после MVP миграции (не-скоуп Блока 6) |
| Биометрия / Face ID / Touch ID (Passkeys / WebAuthn) | Запрос владельца | ⏳ новый бэклог (требует HTTPS-домен и WebAuthn RP) |
| Демо-режим (песочница без регистрации для ознакомления) | Запрос владельца | ✅ сделан в Блоке 3 (экран `Access.vue`) |
| Публичный лэндинг с информацией о приложении | Запрос владельца | ⏳ новый продуктовый бэклог после релиза ядра |
| Разделение healthcheck на liveness/readiness (`/health/live`, `/health/ready`) | Ревью backend (Н-10) | не делаем — неактуально для serverless (Р-13) |
| Поддержка мульти-домохозяйств и переключение активной семьи | Ревью backend (Н-11) | ⏳ новый бэклог после MVP миграции |
| **Блокер деплоя**: fail-fast при `APP_ENV=production` без `DATABASE_URL` (иначе молча in-memory моки) и с дефолтным `JWT_SECRET` (подделка токенов) | Повторный клинап Блока 1 | ➡️ MGV-15 |
| Прод-инфраструктура Go (хостинг, прод-PostgreSQL, домен, env) + **перенос данных из Supabase** — задач в бэклоге нет | Повторный клинап Блока 1 | ➡️ MGV-16, MGV-18, MGV-19 + клинап Блока 6 |
| Коды ошибок синка: битый UTF-8 → 500 (надо 400), тело > лимита → 400 (надо 413) | Повторный клинап Блока 1 | ➡️ MGV-15 (Р-13) |
| **Уборка старого**: удаление React `src/` (и корневых `vite.config.ts`/`package.json` React), таблиц React в `public`, пользователей Supabase Auth, Edge Function `fx-rate` | Бриф Блока 6 | ⏳ через 2 недели стабильной работы после cutover и с «да» владельца |

---

## 5. Протокол

По `memory/process/BACKLOG-GUIDE.md`. 
- **Блок 1** проходит по регламенту **L**:
  1. `/worker migrate-go-vue 1` (реализация)
  2. `/critic migrate-go-vue 1` (проверка диффа и тестов)
  3. `/accept migrate-go-vue 1` (приёмка функционала)
  4. `/dir-review migrate-go-vue 1 backend` (каталожное ревью безопасности)
  5. `/cleanup migrate-go-vue 1` (финализация) ✅ 2026-09-24 — деплой перенесён в Блок 6
- **Блоки 2–5** идут по стандартному регламенту **M**.
- **Блок 6** — **L** (живые данные, пароли, секреты, прод): исполнитель → критик → приёмка → `/dir-review … 6 backend` → `/dir-review … 6 frontend` → `/cleanup migrate-go-vue 6`. Отклонения: деплой клинапа = **переключение прода по `CUTOVER.md`** (MGV-19); каждый шаг, пишущий в живую базу или Vercel, — только с согласия владельца (Р-12); блок ведётся в ветке `mgv-block-6-prod`, `main` не пушится до cutover.

---

## 6. Технический контекст

- Порт бэкенда: `8080` (дефолт `http://localhost:8080`).
- Порт фронтенда: `5173` (Vite дефолт).
- База данных: PostgreSQL. Таблицы создаются миграциями в `backend/migrations/`.
- Верификация Go: `cd backend && go test ./...`; на реальном PostgreSQL — `TEST_DATABASE_URL=<одноразовая БД> go test -p 1 -run Postgres ./...` (БД стирается).
- Верификация Vue: `cd frontend && npm run build && npm test`.
- **Прод (Блок 6)**: Vercel-проект `family-finance-ff.vercel.app` (деплой из `origin/main`, сейчас React из корня, `vercel.json` нет); Supabase `tpkyopaovfdkcmdhauws` — живые таблицы React в `public`, пользователи в `auth.users`, Go — в схеме `app` (Р-7).
- **Подключения к Supabase**: функции Vercel — транзакционный пулер Supavisor (порт 6543); миграции Go (`cmd/migrate`) и перенос (`cmd/transfer`) — сессионное/прямое подключение (5432; advisory lock сессионный). Строки подключения — только в `memory/secrets/` и env Vercel.
- **Env Go в проде**: `APP_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (32+ символа, свой для Preview и Production); `CORS_ORIGIN` не нужен — Vue и API на одном домене.
- **Ветка Блока 6** — `mgv-block-6-prod`; её push даёт CI и preview-деплой Vercel (с согласия владельца).
