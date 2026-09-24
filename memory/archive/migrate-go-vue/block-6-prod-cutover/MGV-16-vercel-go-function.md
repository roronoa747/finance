# MGV-16 — Vercel: Go-функция, сборка Vue, миграции отдельной командой, пулер (бэкенд + конфиг)

Блок 6 · MVP · Репо/каталог: `backend/`, корень репо (`vercel.json`, `api/`) · Зависит от: MGV-15 · Роли: —

## Контекст (что уже есть)

- Прод сейчас: Vercel-проект с `family-finance-ff.vercel.app`, деплой из `origin/main`,
  `vercel.json` в репо **нет** — Vercel сам распознаёт Vite React в корне (`npm run build`,
  выход `dist/`). Переключение прода = появление в `main` конфига этой задачи (это делает
  клинап, не исполнитель).
- `backend/cmd/server/main.go` — долгоживущий `http.Server` + миграции на старте; роутер
  собирается в `setupRouter(cfg, database, userRepo, householdRepo, docRepo, tokenService)`
  (пакет `main` — импортировать нельзя).
- `backend/internal/db/db.go` — `Connect()`: `SetMaxOpenConns(25)`, `SetMaxIdleConns(10)` —
  для serverless на бесплатном Supabase слишком много.
- `backend/internal/db/migrate.go` — сессионный `pg_advisory_lock`: через транзакционный пулер
  Supavisor (порт 6543) не работает → миграции только по сессионному/прямому подключению.
- Go-модуль `finance-backend` (`backend/go.mod`, `go 1.27.0`); пакеты в `internal/` — импорт
  снаружи модуля запрещён компилятором.
- Vue: `frontend/` (`npm run build` = `vue-tsc -b && vite build`, выход `frontend/dist`),
  роутер на `createWebHistory` → нужен SPA-rewrite на `index.html`. Клиент ходит на
  относительный `/api` (`frontend/src/api/client.ts`) → CORS не нужен.
- Vercel Go runtime: функции — `api/*.go` в корне проекта, экспортированный
  `func Handler(w http.ResponseWriter, r *http.Request)`.

## Задача

1. **Композиция роутера в импортируемый пакет**: вынести `setupRouter` + сборку репозиториев
   в не-`internal` пакет `backend` (например `backend/server`, `NewHandler(cfg) (http.Handler, error)`),
   `cmd/server/main.go` остаётся тонкой обёрткой (локальный запуск — как раньше).
2. **Адаптер Vercel**: `api/index.go` (корень репо) — ленивая однократная инициализация
   (`sync.Once`) и отдача в `server.NewHandler`; миграций **не** запускает. Модуль для `api/`:
   рекомендуемый путь — корневой `go.mod` с `replace finance-backend => ./backend`; иной рабочий
   путь — допустим, с записью в Handoff.
3. **`vercel.json`** в корне: сборка/установка — из `frontend/` (`installCommand`,
   `buildCommand`, `outputDirectory: frontend/dist`); rewrite `/api/(.*)` → Go-функция;
   SPA-rewrite всего остального (кроме файлов) на `/index.html`. Проверить, что Go-функция видит
   исходный путь `/api/...` (chi матчит по нему); если нет — минимальная правка + Handoff.
4. **Миграции отдельной командой**: `backend/cmd/migrate` — `db.RunMigrations` по `DATABASE_URL`
   (ожидается сессионное подключение, порт 5432). В README бэкенда/Handoff — одна строка «как
   запускать».
5. **Пул под serverless**: размеры пула настраиваемые (в функции — единицы соединений);
   совместимость `lib/pq` с транзакционным пулером — если подготовленные выражения мешают,
   `binary_parameters=yes` в DSN (проверить, записать вывод в Handoff).
6. **Preview-деплой ветки блока** с согласия владельца (Р-12): env Vercel **только для
   Preview** — `APP_ENV=production`, `DATABASE_URL` (пулер 6543, из `memory/secrets/`),
   `JWT_SECRET` (генерирует агент, 32+ байт, значение — в `memory/secrets/`, не в доки).
   Миграции `cmd/migrate` на живую базу — отдельным согласием владельца (создаёт только схему
   `app`). Production-env не трогать.

## Тесты

- `server.NewHandler`: тест роутинга на моках (health, 401 без токена, `/api/fx-rate` на стабе)
  — те же проверки, что шли через `setupRouter`, не потеряны.
- `api/index.go`: юнит-тест через `httptest` — `Handler` отвечает на `/api/health`, повторный
  вызов не переинициализирует.
- `cmd/migrate`: PG-тест — два прогона подряд идемпотентны.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` — зелёные; корневой
  модуль `api/` собирается (`go build ./api/...` из корня).
- Локально `vercel build` (или `vercel dev`, если CLI доступен) собирает Vue + функцию — иначе
  это проверяет preview.
- Preview-адрес ветки: `GET /api/health` → `db: connected`; открытие `/`, `/capital` напрямую
  (F5) отдаёт Vue; `GET /api/fx-rate` отдаёт курс; регистрация тестового пользователя работает
  (затем удалить его из `app`).
- React-прод на `family-finance-ff.vercel.app` не изменился (Production-деплой не тронут).
- Риск брифа закрыт: рантайм Go на Vercel собирает `go 1.27.0` — либо минимальное решение + Handoff.

## Вне скоупа

- PWA и service worker — MGV-17.
- Перенос данных — MGV-18.
- Production-env, push в `main`, переключение домена — клинап блока.
- Свой домен, другой хостинг (Р-6).
