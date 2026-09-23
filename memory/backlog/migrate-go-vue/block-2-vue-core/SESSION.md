# Блок 2 — Vue Core & Math · сессии

**Цель блока:** Инициализировать Vue 3 SPA приложение (`frontend/`), перенести финансовую математику (`finance.ts`) и алгоритм бесконфликтного слияния (`merge.ts`), реализовать клиент взаимодействия с Go API и хранилище Pinia с поддержкой офлайн-режима и синхронизации.

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high (ultrathink)

```
/worker migrate-go-vue 2 ultrathink
```

Блок-специфика:
- Среда: Node.js 20+, каталог `frontend/`. Стек: Vue 3 (Composition API, `<script setup>`), Vite, TypeScript, Pinia, Tailwind CSS 4.
- Факты Блока 1 (Go API контракт `http://localhost:8080`):
  - `POST /api/auth/register` — `{ email, password, display_name, household_name }` ➔ `{ token, user, household, member }` (201 Created)
  - `POST /api/auth/login` — `{ email, password }` ➔ `{ token, user, household, member }` (200 OK)
  - `GET /api/auth/me` — заголовок `Authorization: Bearer <token>` ➔ `{ user, household, member }`
  - `POST /api/household/invites` — ➔ `{ code, expires_at }` (201 Created)
  - `POST /api/household/join` — `{ code, display_name }` ➔ `{ token, member }` (200 OK)
  - `GET /api/sync/household` ➔ `{ household_id, rev, data, updated_at, updated_by }`
  - `POST /api/sync/household` — `{ last_seen_rev, data }` ➔ 200 OK с новым `rev` либо 409 Conflict `{ error: "conflict", server_doc: { rev, data } }`
  - `GET /api/sync/private` ➔ `{ household_id, user_id, rev, data, updated_at }`
  - `POST /api/sync/private` — `{ last_seen_rev, data }` ➔ 200 OK либо 409 Conflict
- Доменные инварианты финансов:
  - Деньги строго целые числа (минорные единицы / тенге). Никаких float в состоянии.
  - Математика переносится 1-в-1 из `src/lib/finance.ts` и `src/lib/merge.ts` с полным сохранением юнит-тестов Vitest.
- Задачи по порядку: `MGV-05` ➔ `MGV-06` ➔ `MGV-07`.
- Верификация: `cd frontend && npm run build && npm test`.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh

```
/critic migrate-go-vue 2
```

Блок-специфика:
- Проверить 100% совпадение результатов расчётов финансов между React версией и Vue/TS версией.
- Проверить обработку конфликтов 409: клиент должен автоматически выполнять слияние через `merge.ts` и повторять отправку.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh

```
/accept migrate-go-vue 2
```

Блок-специфика:
- Верификация взаимодействия Pinia store с запущенным Go бэкендом (через mock/сервер).
- Все юнит-тесты математики и слияния зелёные.

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
