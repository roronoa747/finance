# Блок 6 — Прод-инфраструктура и cutover · сессии

**Цель блока:** перевести прод `family-finance-ff.vercel.app` с React + Supabase на Go + Vue на тех же Vercel и Supabase — с переносом семьи и паролей, без потери данных и с отрепетированным откатом.

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜ · ревью backend ⬜ · ревью frontend ⬜ · клинап (cutover) ⬜

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

- **Коммиты:** <репо/каталог · хеш · ветка · ID задачи>
- **Что сделано:** по задачам, коротко.
- **Отклонения от ТЗ:** <что и почему; нет — «нет».>
- **Грабли среды:** <креды/DSN — ссылкой на `memory/secrets/`, значения сюда не писать.>
- **Риски брифа:** `search_path`/пулер · Go 1.27 на Vercel · путь после rewrite · `lib/pq` на 6543.
- **Верификация:** <команды и результаты; preview/браузер/телефоны.>

## Итоги критика

## Приёмка

## Итоги пост-приёмки (только L)
