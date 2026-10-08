# Family Finance

**Сайт:** https://family-finance-ff.vercel.app — деплоится из `main` (Vercel).

Семейные финансы на двоих: мечты и цели, план месяца, платежи и долги, выписки банка.
Мобильный интерфейс в первую очередь.

## Устройство

- `frontend/` — Vue 3 SPA (Vite, Pinia, Tailwind CSS 4). Все денежные расчёты — `src/lib/finance.ts`,
  цвета — токены `src/style.css`.
- `backend/` — Go API (chi); `api/index.go` — функция Vercel поверх него.
- База — Postgres в Supabase, схема `app` (`backend/migrations/`). Состояние семьи — один
  JSON-документ с версией; клиент сливает свой и серверный и повторяет при конфликте.

## Запуск локально

```bash
cd backend && go run ./cmd/server             # API на :8080, без DATABASE_URL — моки в памяти
cd frontend && npm ci && npm run dev          # приложение; «Попробовать в демо-режиме» — без сервера
```

## Проверки

```bash
cd frontend && npm run build && npx vitest run   # типы, сборка, юнит/DOM/e2e (frontend/e2e)
cd backend && go build ./... && go vet ./... && go test ./...
go test ./api/...                                # из корня — функция Vercel
```

## Документы

Процесс, бэклоги и статус — в `memory/` (начать с `memory/STATE.md`), правила проекта —
`CLAUDE.md`, бэкенд подробно — `backend/README.md`.
