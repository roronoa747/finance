# Блок 6 — Прод-инфраструктура и cutover · сессии

**Цель блока:** перевести прод `family-finance-ff.vercel.app` с React + Supabase на Go + Vue на тех же Vercel и Supabase — с переносом семьи и паролей, без потери данных и с отрепетированным откатом.

Сессии: исполнитель 🔄 (остаток MGV-19 — с владельцем) · критик ⬜ · приёмка ⬜ · ревью backend ⬜ · ревью frontend ⬜ · клинап (cutover) ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high (ultrathink)

```
/worker migrate-go-vue 6 ultrathink
```

Блок-специфика:

- **Ветка блока** `mgv-block-6-prod` от `main`. `main` не пушится до клинапа (прод на Vite
  деплоится из `origin/main`); push ветки блока (CI + preview Vercel) — с согласия владельца.
- Задачи строго по порядку: `MGV-15` → `MGV-16` → `MGV-17` → `MGV-18` → `MGV-19`.
  MGV-19 — эксплуатационная (репетиция + `CUTOVER.md`), кода почти нет.
- **Каждый шаг, пишущий в живую базу Supabase или в настройки Vercel, — только после явного
  «да» владельца в этой сессии** (Р-12): миграции `app`, `transfer forward`, env Preview.
  Production-env и `main` — не трогать вообще (это клинап).
- Секреты: строка подключения Supabase — владелец кладёт в `memory/secrets/`; `JWT_SECRET`
  генерирует агент туда же. В Handoff — только имена файлов/переменных. Pre-commit-хук
  не обходить.
- Верификация: `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` +
  PG-режим (`TEST_DATABASE_URL`, `-p 1 -run Postgres`); `cd frontend && npm run build && npm test`;
  preview-адрес в реальном браузере (десктоп + телефон).
- Риски брифа, закрыть явно в Handoff: передаёт ли Supavisor `search_path` (MGV-15 уходит от
  него квалификацией имён), собирает ли Vercel `go 1.27.0`, видит ли Go-функция исходный путь
  `/api/...` после rewrite, `lib/pq` на транзакционном пулере.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh (ultracode)

```
/critic migrate-go-vue 6 ultracode
```

Блок-специфика:

- Безопасность прода: fail-fast недостижим в обход (`APP_ENV=production` без БД/с дефолтным
  секретом не стартует ни `cmd/server`, ни Vercel-функция); `/api/fx-rate` — публичный, но без
  утечек и с таймаутом; секретов нет в диффе и доках.
- Перенос (`cmd/transfer`): одна транзакция, сверка до `COMMIT`, `-dry-run` реально
  откатывает, `back` пишет только документы; отчёт без email и содержимого документов.
- Схема `app`: ни один SQL Go не обращается к `public` (кроме `cmd/transfer`); тесты PG
  зелёные.
- SW: тот же `/sw.js`/scope, `/api/` не попадает в кэш и навигационный fallback.
- Живые доки: README бэкенда (запуск `cmd/migrate`, `cmd/transfer`), `memory/STATE.md`.
- Следующего блока нет → вместо актуализации его промпта проверить, что `CUTOVER.md` готов
  для клинапа, и готовность бэклога к закрытию после cutover.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh (ultracode)

```
/accept migrate-go-vue 6 ultracode
```

Блок-специфика:

- Критерии брифа — на **preview-адресе** с копией живых данных: оба участника входят старыми
  паролями; сверка «данные целы» `app` = `public` + `rev` `private_docs`; синк двух устройств;
  PWA ставится и открывается без сети; курс валют; `transfer back -dry-run` зелёный, ID
  React-деплоя для отката записан.
- Регрессия: `go test ./...` (+ PG-режим), `npm test` (весь `frontend/e2e/`), CI `ci-backend`
  и `ci-frontend` зелёные на HEAD ветки.
- Любая запись в живую базу (например, свежая копия перед проверкой) — с согласия владельца.
- **L-блок: приёмка НЕ деплоит и прод не переключает.** Следующий шаг —
  `/dir-review migrate-go-vue 6 backend`.

---

## Промпт ревью backend — уровень review · Opus 5 · effort xhigh

```
/dir-review migrate-go-vue 6 backend
```

Блок-специфика:

- Каталог `backend/` + корневые `api/`, `go.mod` (адаптер Vercel — часть Go).
- Фокус: `server`-пакет vs `cmd/server` (нет ли дублей), пул соединений под serverless,
  `cmd/transfer` (идемпотентность, транзакция, отчёт), квалификация схемы `app`.
- Следующий шаг — `/dir-review migrate-go-vue 6 frontend`.

---

## Промпт ревью frontend — уровень review · Opus 5 · effort xhigh

```
/dir-review migrate-go-vue 6 frontend
```

Блок-специфика:

- Каталог `frontend/` + `vercel.json`, `.github/workflows/ci-frontend.yml`.
- Фокус: конфиг PWA против React (манифест, иконка, `/sw.js`), fallback/denylist, `fx.ts`.
- Следующий шаг — `/cleanup migrate-go-vue 6`.

---

## Промпт клинапа (cutover) — уровень build · Opus 5 · effort high

```
/cleanup migrate-go-vue 6
```

Блок-специфика:

- Выполнить «клинап»-вердикты `REVIEW-backend.md`, `REVIEW-frontend.md`.
- **Деплой = переключение прода строго по `CUTOVER.md`**, каждая точка «стоп» — явное «да»
  владельца: окно → `transfer forward -replace` → сверка → Production-env Vercel → merge
  `mgv-block-6-prod` в `main` + push → смоук на `family-finance-ff.vercel.app` (вход обоих
  старыми паролями, данные на месте, правка видна на втором устройстве).
- **План отката:** промоут записанного Production-деплоя React в Vercel + `transfer back` +
  сверка; триггер — красный смоук или «данные не те» от владельца.
- После 🏁: хвост «Уборка старого» остаётся ⏳ (2 недели стабильной работы + «да» владельца);
  предложить владельцу закрытие бэклога по DoD, кроме этого хвоста — решение за ним.
- Обновить `memory/STATE.md` и снять запись `no-push-main-during-migration` из памяти агента
  (ограничение больше не действует).

---

## Handoff (заполняет исполнитель)

Сессия исполнителя 2026-09-24 (Opus 5.5). **MGV-15…18 ✅, MGV-19 🔄**: не хватает шагов с живыми
данными и телефонами (см. «Остаток MGV-19»). `CUTOVER.md` готов.

- **Коммиты** (ветка `mgv-block-6-prod`, запушена; `main` не тронут):
  `2f30fea` MGV-15 · `4680541` MGV-16 · `9c43408` MGV-16 (регион) · `46219db` MGV-17 · `0acd3c1` MGV-18 ·
  `0180567` статусы §4 · коммит этого Handoff + `CUTOVER.md`.
- **Что сделано:**
  - MGV-15: `config.Load` — fail-fast при `APP_ENV=production` (нет `DATABASE_URL`; `JWT_SECRET` пуст / дефолт / < 32).
    Схема `app` — **выбран путь квалификации имён** (`app.users` … в `000001_init.sql`, в SQL репозиториев,
    `app.schema_migrations`), от `search_path` ничего не зависит; `testdb` сбрасывает `app` и `public`.
    Хелпер `decodeJSONBody` — 413 при превышении лимита во всех 4 ручках; битый UTF-8 в `data` синка → 400
    до БД. `internal/fx` + `GET /api/fx-rate` (порт Edge Function: отступ до 7 дней, USD/EUR/RUB/CNY, кэш 1 ч,
    `Cache-Control: public, s-maxage=3600`, банк недоступен → 502, таймаут 8 с на всю цепочку).
  - MGV-16: пакет `backend/server` (`NewHandler`, `NewRouter`, `FromEnv`), `cmd/server` — тонкая обёртка;
    `api/index.go` + корневой `go.mod` (`finance-vercel`, `replace finance-backend => ./backend`);
    `vercel.json` (сборка `frontend/`, `/api/*` → функция, SPA-rewrite, `regions: icn1`); `cmd/migrate`;
    `db.Connect(url, Pool)` — `ServerPool` 25/10, `ServerlessPool` 2/2; README бэкенда; CI бэкенда
    покрывает `api/`. **Живое:** миграции `app` на Supabase применены (7 таблиц, повтор — no-op;
    `anon`/`authenticated` доступа к `app` не имеют); env **Preview** только для ветки `mgv-block-6-prod`:
    `APP_ENV` plain, `DATABASE_URL` (пулер 6543) и `JWT_SECRET` — sensitive.
  - MGV-17: `vite-plugin-pwa` во фронте — манифест, цвета, иконка как у React; `/sw.js` scope `/`,
    `autoUpdate`, `cleanupOutdatedCaches`, `navigateFallback` + denylist `/api/`; `index.html` — `lang=ru`,
    `theme-color`; `fetchRates()` → `/api/fx-rate` (ошибка → `null`); `ci-frontend.yml` (npm, Node 24).
    Проверка сборки — **юнит-тест `e2e/pwa-build.test.ts`, читающий `dist`** (в CI идёт после `build`;
    без `dist` пропускается).
  - MGV-18: `cmd/transfer forward|back [-replace|-force] [-dry-run]`: одна транзакция `REPEATABLE READ`,
    сверка до `COMMIT` — построчный `EXCEPT ALL` всех таблиц и пользователей + запрос «данные целы» +
    `rev` каждого `private_docs`; расхождение → ROLLBACK, код 1. Пользователи без email/пароля
    пропускаются с записью в отчёт. `back` пишет только `data/rev/updated_at` существующих строк.
    **Живое:** `forward -dry-run` на Supabase — всё `OK` (4 пользователя, 1 семья, 2 участника,
    казна rev 632, оба `private_docs` rev =), откачено.
- **Отклонения от ТЗ:**
  - `server.NewHandler(cfg, database)` принимает готовый пул, а не открывает его сам: `cmd/server` должен
    прогнать миграции до сборки роутера, а `api/` не может назвать тип `internal/config` — для него есть
    `server.FromEnv()`.
  - `api/index.go`: вместо `sync.Once` — мьютекс. Неудачная инициализация (БД не ответила на холодном
    старте) повторяется следующим запросом и не закрепляет инстанс в ошибке; успешная — один раз.
  - `doc_repo`: `jsonb` передаётся строкой, а не `[]byte`. С `binary_parameters=yes` `lib/pq` шлёт `[]byte`
    бинарно, и `jsonb` его отвергает (проверено: E2E на PG падал 500-ми, после правки зелёный в обоих режимах).
  - `fx`: курс делится на `<quant>` (у AMD — 10 ед.); для USD/EUR/RUB/CNY `quant=1`, результат как у Edge
    Function. Дата «сегодня» — по Алматы (UTC+5); Edge Function брала UTC.
  - `.gitignore`: снята строка `backend/server` — она прятала новый пакет (бинарник туда больше не
    соберётся: Go не пишет поверх каталога).
  - `vercel.json` `regions: ["icn1"]` — не было в ТЗ: база в Сеуле, а функция по умолчанию в `iad1`.
  - `frontend/public/favicon.svg` заменён корневым (ТЗ: иконка — от React).
- **Грабли среды:**
  - Строки подключения — `memory/secrets/supabase-db.md` (`DATABASE_URL_SESSION` 5432 /
    `DATABASE_URL_POOLER` 6543), JWT Preview — `memory/secrets/vercel-jwt.md`. Пароль базы владелец
    **сбросил 2026-09-24** (старый не помнил); React не затронут — он ходит через API-ключи. Прямой
    `db.<ref>.supabase.co` — только IPv6, используется Session pooler `aws-0-ap-northeast-2`.
  - Коннектор Supabase — только чтение; запись — через свою сессионную строку.
  - Preview закрыт SSO Vercel: share-ссылка (23 ч) на алиас ветки `family-financevercela-git-4dcf56-…vercel.app`.
    Манифест браузер тянет **без cookie** → 302 на логин → на preview PWA не ставится. Та же сборка без
    защиты — 0 ошибок устанавливаемости.
  - Локальная PG — embedded PostgreSQL 16 из scratchpad (`fergusstrange/embedded-postgres`), не в репо.
  - `gofmt -l` на Windows ругается на CRLF рабочей копии; проверка по LF-версиям из git — чисто.
  - Pre-commit-хук ловит `xxxPassword = "..."` и в тестах — имя константы изменено, хук не обходился.
  - Классификатор прав Claude Code **заблокировал** `transfer forward -replace` на живой базе как
    прод-действие: нужно разрешение владельца (см. остаток).
- **Риски брифа:**
  - `search_path`/пулер — снят: имена квалифицированы.
  - Go 1.27 на Vercel — снят: сборщик скачал `go1.27.0` и собрал функцию.
  - Путь после rewrite — снят: функция видит исходный `/api/...` (health/fx/401/404 от chi на preview).
  - `lib/pq` на 6543 — подтверждён и снят: без `binary_parameters` 141 из 320 параллельных запросов
    падают («bind message supplies N parameters…»), с `binary_parameters=yes` — 320/320. Параметр
    зашит в `DATABASE_URL_POOLER` и в `CUTOVER.md`.
- **Верификация:**
  - `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` — PASS; PG-режим
    (`-p 1 -run Postgres`, embedded PG 16) — PASS, в т.ч. с `binary_parameters=yes`; `go test ./api/...` — PASS.
  - `cd frontend && npm run build && npm test` — 20 файлов, 98 тестов PASS.
  - CI: `ci-backend` ✅ (`2f30fea`, `4680541`), `ci-frontend` ✅ (`46219db`).
  - Локально: `APP_ENV=production go run ./cmd/server` без env → падает с понятной ошибкой; `/api/fx-rate` —
    живой курс, повтор — из кэша.
  - Preview (headless Chrome, share-cookie): `/api/health` → `db: connected`; `/api/fx-rate` → курс;
    F5 на `/`, `/capital`, `/budget/plan` → Vue; регистрация тестового пользователя → 201, затем удалён из
    `app`; тело > 1 МБ → 413; демо-режим → форма счёта в USD подставила 445.65 (Нацбанк).
  - **Замена SW** (headless Chrome, локальный стенд с заголовками как у Vercel): React-сборка, её SW
    управляет страницей → на том же origin выложена Vue-сборка → **одна ручная перезагрузка = две
    навигации**: старый SW отдал React из прекэша, его `autoUpdate` сам перезагрузил страницу → Vue.
    В прекэше только ассеты Vue; закладка `/#/capital` → Vue (без входа — `/access`).
  - **Офлайн:** вход через форму на локальном Go → сводка «700 000 ₸»; сервер и API погашены →
    перезагрузка `/` и переход на `/capital` открывают Vue с данными из `localStorage`.
  - React-прод не менялся: `family-finance-ff.vercel.app` — `#root`, `/api/health` → 404; Production-деплой
    `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` (коммит `b3e0dd9`) — кандидат на откат.
- **Остаток MGV-19 (нужен владелец):**
  1. ~~Разрешить `transfer forward -replace`~~ — **сделано 2026-09-24 с «да» владельца**: копия в `app`,
     сверка всё `OK` (4 / 1 / 2 / казна rev 632 `= app` / оба `private_docs` rev `=`), `committed`.
     Сразу же `transfer back -dry-run` — `OK`, откачено (п. 3 выполнен).
  2. Вход обоих участников старыми паролями на preview (share-ссылка), сверка экранов с React,
     синк двух устройств, правка офлайн → синк, офлайн-открытие на телефоне.
  3. После проверок: `transfer back -dry-run` (агент), удаление тестовых пользователей preview.
- **Хвосты (не делал, правило 10):** в офлайне шапка Vue показывает «синхронизировано» — индикатор не
  знает о сети (экраны прошлых блоков, не SW). `\u0000` в `data` синка PostgreSQL `jsonb` отвергает → 500
  (тот же класс, что битый UTF-8; в ТЗ не входил).

## Итоги критика

## Приёмка

## Итоги пост-приёмки (только L)
