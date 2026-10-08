# ML-10 — Будильник базы без React (CI)

Блок 1 · MVP · Репо/каталог: `.github/workflows/keep-supabase-awake.yml`, `backend/server` · Зависит от: ML-09 · Роли: —

## Контекст (что уже есть)

- `.github/workflows/keep-supabase-awake.yml`: cron `17 6 * * *` + ручной запуск, секретов GitHub не использует.
  Строки 35-37 читают корневой `./.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — публичный ключ React),
  строки 46-48 зовут `${VITE_SUPABASE_URL}/rest/v1/households?select=id&limit=1` — **React-таблицу `public.households`**.
  После уборки (ML-11, ML-12) будильник сломается.
- База Go-приложения — та же база Supabase, схема `app` (`backend/README.md:4-5`); бесплатный Supabase засыпает без
  обращений — будильник нужен.
- Ручка `/api/health` — `backend/server/server.go:122`. План «будильник → `/api/health`» уже записан в `memory/STATE.md:190`.
- Прод — `https://family-finance-ff.vercel.app` (не `family-finance.vercel.app` — чужой).

## Задача

1. Проверить, ходит ли `/api/health` в базу (ping/`SELECT 1`). Не ходит → добавить проверку базы в health с таймаутом
   (ответ 200 и `db: ok`/503) — минимально, без новых ручек.
2. Будильник: `curl -fsS https://family-finance-ff.vercel.app/api/health` (с проверкой кода ответа), без `.env` и без
   Supabase REST. Имя файла workflow сохранить.

## Тесты

- Go: тест health с моковой базой — ok и ошибка базы (`backend/server/*_test.go`).
- Workflow: ручной запуск после мёржа (в приёмке) — зелёный; до мёржа — `curl` той же командой с машины.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...` зелёные; в workflow нет `.env` и `rest/v1`.

## Вне скоупа

- Удаление `.env` и таблиц — ML-11/ML-12.
