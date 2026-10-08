# ML-11 — Уборка React из репо (репо)

Блок 1 · MVP · Репо/каталог: корень репо, `backend/cmd/transfer`, `CLAUDE.md`, `README.md` · Зависит от: ML-10 · Роли: —

## Контекст (что уже есть)

Инвентарь составителя (2026-10-08, `git ls-files`):

- **React, в git:** `src/` (38 файлов), `public/` (`favicon.svg`), `scripts/` (authtest, cloud-check, numtest.*,
  screentest.*, seed, themetest), `supabase/` (`email-templates/*.html`, `migrations/20260907_init.sql`,
  `20260907_02_lock_down_grants.sql`; Edge Function `fx-rate` в репо **нет** — только в проекте Supabase),
  `index.html`, `vite.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `components.json`,
  `tsconfig.tsbuildinfo`, `.env` + `.env.example` (только `VITE_SUPABASE_*`; `.env` нужен будильнику до ML-10).
- **React, вне git:** `node_modules/` (в нём `playwright-core` — им пользуются сессии ролей для браузерных проверок:
  `import 'file:///C:/Users/SW/finance/node_modules/playwright-core/index.js'`), `dist/`.
- **Живое — не трогать:** `api/`, `backend/`, `go.mod`, `go.sum`, `vercel.json` (сборка целиком через `--prefix
  frontend`, корень не читает), `frontend/`, `.github/workflows/ci-*.yml`, `memory/`, `.claude/`, `conveyer/`
  (шаблон фреймворка), `NEXT.md` (заметки владельца).
- **`backend/cmd/transfer/`** (+ `transfer_test.go`, `testdata/supabase_public.sql`) — разовый перенос `auth.users +
  public.* → app.*` и обратно; после удаления таблиц `public` (ML-12) бессмысленен — Р-14: удалить (история — в git).
  Живой сервер, `internal/*` и `cmd/migrate` читают только схему `app`.
- **Устаревшие строки доков:** `CLAUDE.md` — стек «React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, Supabase»
  (строки 3-4), команды правила 5 (`npm run typecheck`, `test:num`, `test:screens`), пути правила 6
  (`src/lib/finance.ts`, `src/index.css` → `frontend/src/lib/finance.ts`, `frontend/src/style.css`). `README.md`
  целиком описывает React.

## Задача

1. `git rm -r` React-файлов из списка выше и `backend/cmd/transfer/`; локально удалить `dist/` и корневой
   `node_modules/` (после п. 2).
2. `playwright-core` — devDependency `frontend/package.json` (та же версия, что в корневом `package-lock.json`);
   проверить браузерный запуск из `frontend/node_modules`. В §6 этого бэклога — новая строка пути.
3. `CLAUDE.md`: стек «Go + Vue 3 (Vite, Pinia), Postgres в Supabase (схема `app`)», команды правила 5 —
   `cd frontend && npm run build && npx vitest run`, `cd backend && go build ./... && go test ./...`; пути правила 6 —
   нынешние. Только эти строки (правила не переписывать).
4. `README.md` — короткий (до 40 строк): что это, как поднять (`frontend` dev, Go на моках), где доки (`memory/`).
5. `.gitignore` — `tsconfig.tsbuildinfo`, если остаётся генерироваться.

## Тесты

- `cd frontend && npm ci && npm run build && npx vitest run`; `cd backend && go build ./... && go vet ./... && go test ./...`;
  из корня `go test ./api/...`.
- `grep -rn "\.\./\.\./public\|from '\.\./\.\./src\|VITE_SUPABASE" frontend backend api .github` — пусто.
- Браузерный скрипт сессий с `playwright-core` из `frontend/node_modules` открывает стенд.

## Критерии приёмки

- В корне — только `api`, `backend`, `frontend`, `memory`, `conveyer`, `.claude`, `.github`, `go.mod`, `go.sum`,
  `vercel.json`, `CLAUDE.md`, `README.md`, `NEXT.md`, `.gitignore` (+ служебные dot-файлы).
- CI ветки зелёный (оба workflow); превью Vercel ветки собирается.

## Вне скоупа

- Удаление в Supabase и Vercel — ML-12 (владелец). `conveyer/`, `NEXT.md` — не трогать.
