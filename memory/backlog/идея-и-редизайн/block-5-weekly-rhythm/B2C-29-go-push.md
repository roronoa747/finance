# B2C-29 — Go: подписки на пуш, рассылка по cron, «без выписки партнёра» (бэкенд)

Блок 5 · MVP · Каталог: `backend/` (+ корень `go.mod`/`go.sum`: `github.com/SherClockHolmes/webpush-go`), `.github/workflows/` · Зависит от: Блок 4 🏁 · Роли: member, viewer (подписка своя); настройка дня/часа — member

## Контекст (что уже есть)

- Р-15: Web Push обоим; подписки в Postgres; по умолчанию воскресенье вечером по Алматы, день и
  час настраиваются; партнёр не загрузил — повторный пуш ему; ничего не блокируется. Р-26:
  `webpush-go`; таблица `app.push_subscriptions` (`web` / `fcm`); день и час — поля семьи;
  расписание — GitHub Actions cron ежечасно → `GET /api/cron/weekly` с `Authorization: Bearer
  <CRON_SECRET>`; секрет — env Vercel и Secrets GitHub.
- Образцы: внешний HTTP `internal/fx/fx.go`; будильник базы
  `.github/workflows/keep-supabase-awake.yml` (cron, `curl`, комментарий про отключение
  расписаний через 60 дней без активности). Записи загрузок — `app.statement_uploads`
  (`household_id`, `user_id`, `period_from/to`, `created_at`); участники — `GetMembers`.
  Время — Алматы (UTC+5 без перехода), как `internal/fx`.
- Конфиг: новые переменные опциональны — без `VAPID_*`/`CRON_SECRET` пуш выключен (503 на
  подписке, cron → 404).
- Vercel Hobby: функция с дефолтным таймаутом — рассылка батчами с ограничением времени (при
  сотнях подписок — продолжить на следующем запуске; `last_sent_at` как курсор).

## Задача

1. Миграция `000007_push.sql` (номер по каталогу): `app.push_subscriptions` — `id uuid pk`,
   `household_id` FK CASCADE, `user_id` FK CASCADE, `kind text` CHECK (`web`, `fcm`),
   `endpoint text UNIQUE` (для fcm — токен), `p256dh text`, `auth text`, `created_at`,
   `last_sent_at timestamptz`, `last_kind text`, `failures int default 0`; `app.households` —
   `reminder_weekday int default 0` (0 = воскресенье), `reminder_hour int default 19`.
2. Ручки (защищённые, семья обязательна): `GET /api/push/config` → `{enabled, vapid_public_key}`;
   `POST /api/push/subscription` `{endpoint, keys: {p256dh, auth}}` — upsert по `endpoint` (своя);
   `DELETE /api/push/subscription` `{endpoint}`; `GET/PUT /api/push/settings` `{weekday, hour}`
   — member (viewer — только GET).
3. Отправка `internal/push`: `Sender` над `webpush-go` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` mailto), полезная нагрузка JSON `{title, body, url}`; 404/410 от службы →
   подписка удаляется; иные ошибки → `failures++`, ≥ 5 → удаляется. HTTP-клиент внедряется
   (`httptest` в тестах). `kind = fcm` — пропускать (Блок 7 добавит отправителя).
4. `GET /api/cron/weekly` (без JWT; заголовок с `CRON_SECRET`, иначе 401; без переменной — 404):
   чистая функция `due(now, households, subs, uploads)` решает, кому что слать: (а) семьям, у
   которых по Алматы сейчас `reminder_weekday` и `reminder_hour` → всем подпискам семьи, не
   получавшим `weekly` за последние 6 дней — «Пора загрузить выписку: неделя <даты>» → `/week`;
   (б) на следующий день в тот же час — участникам семьи, у которых нет загрузки, покрывающей
   прошедшую неделю, при том что у партнёра есть, — «<имя> уже загрузил(а) выписку — без вашей
   картина недели неполная» → `/week`; один человек в семье — только (а). Ответ `{sent, removed}`.
   Ограничение времени работы ~8 с; остаток — следующий час.
5. Workflow `.github/workflows/weekly-push.yml`: cron `7 * * * *` + `workflow_dispatch`; `curl`
   на `<домен>/api/cron/weekly` с секретом из Secrets GitHub (`CRON_SECRET`, домен — переменная
   репозитория); не падать на 404 (пуш выключен) — писать в лог.
6. README: переменные, ручки, как сгенерировать VAPID-ключи (`webpush-go` умеет; значения — в
   `memory/secrets/push.md` и env).

## Тесты

- `due(...)` — таблица случаев: час совпал / нет; уже слали на этой неделе; партнёр без
  загрузки на следующий день; одиночка; семья без подписок; загрузка покрывает неделю
  частично.
- Sender на `httptest`: запрос с VAPID-заголовками и шифрованным телом; 410 → удалена; 500 ×5 →
  удалена.
- Хендлеры: подписка upsert; чужой `endpoint` не удалить; настройки member/viewer; cron без
  секрета 401, без переменной 404; PG: миграция, уникальность endpoint, каскад при удалении
  пользователя (B2C-24 расширить).

## Критерии приёмки

- `go build/vet/test` + PG + корень `api/` зелёные; CI зелёный.
- Стенд: `go run ./cmd/server` с тестовыми VAPID-ключами + Chrome (localhost) — подписка из
  фронта B2C-30, вызов cron с секретом в нужный час (часы — параметр `?now=` только в
  dev-режиме, в проде игнорируется) → уведомление пришло.

## Вне скоупа

- FCM (оболочки) — Блок 7 (B2C-35). E-mail-напоминания — после MVP.
