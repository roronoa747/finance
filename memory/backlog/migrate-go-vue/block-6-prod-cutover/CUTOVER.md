# Ранбук переключения прода React + Supabase → Go + Vue (клинап Блока 6)

Исполняет сессия `/cleanup migrate-go-vue 6`. Каждая точка **⛔ СТОП** — явное «да» владельца
в этой сессии (Р-12). Секреты — только из `memory/secrets/`, в чат, доки и коммиты не пишутся.

## Что где

| Что | Где |
|---|---|
| Прод-адрес | `family-finance-ff.vercel.app` (Vercel-проект `family-finance.vercel.app`, `prj_CScahy7DEmeEkg8rTBBoLPvWB6GP`, команда `team_PAe7UJfD8KH08YQtxCvh03hw`) |
| **Production-деплой React для отката** | `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` (коммит `b3e0dd9`, `main`) — перепроверить перед окном: `list_deployments target=production` |
| База | Supabase `tpkyopaovfdkcmdhauws` (ap-northeast-2): React — `auth.users` + `public.*`; Go — схема `app` |
| Строки подключения | `memory/secrets/supabase-db.md`: `DATABASE_URL_SESSION` (5432 — миграции, перенос), `DATABASE_URL_POOLER` (6543 + `binary_parameters=yes` — функция Vercel) |
| JWT | Preview — `memory/secrets/vercel-jwt.md`; **Production — новый**, генерируется в шаге 3 |
| Код | ветка `mgv-block-6-prod` (CI `ci-backend`, `ci-frontend` зелёные на HEAD) |

Команды переноса — из `backend/`, переменная берётся из файла (значение не печатается):

```sh
export DATABASE_URL="$(grep '^DATABASE_URL_SESSION=' ../memory/secrets/supabase-db.md | cut -d= -f2-)"
```

## 0. Перед окном

1. CI обоих workflow зелёный на HEAD `mgv-block-6-prod`; выполнены «клинап»-вердикты ревью.
2. `go run ./cmd/migrate` — «schema app is up to date» (миграции новее 000001 — применятся здесь).
3. `go run ./cmd/transfer forward -replace -dry-run` — `result: OK`.
4. Сверить ID Production-деплоя React (таблица выше) — записать фактический в Handoff клинапа.

## 1. Окно ⛔ СТОП — «да» владельца на начало окна

- Оба устройства **онлайн**, в React открыт экран, индикатор синхронизации — «синхронизировано».
- С этого момента **никто не правит в React** до конца смоука (правки после копии потеряются).

## 2. Финальная копия ⛔ СТОП — «да» владельца

```sh
go run ./cmd/transfer forward -replace
```

- Стирает репетиционные данные `app` и копирует `public` заново, в одной транзакции.
- Ожидаемо: все строки `reconciliation` — `OK`, `data intact` — `= app`, `private_docs revs` — `=`,
  `result: OK — committed`. Иначе — ничего не записано (ROLLBACK), разбираться, прод не трогать.
- Отчёт (без email) — в Handoff клинапа.

## 3. Production-env Vercel ⛔ СТОП — «да» владельца

Только **target = production** (Preview уже настроен, ветка `mgv-block-6-prod`):

| Имя | Тип | Значение |
|---|---|---|
| `APP_ENV` | plain | `production` |
| `DATABASE_URL` | sensitive | `DATABASE_URL_POOLER` из `memory/secrets/supabase-db.md` |
| `JWT_SECRET` | sensitive | **новый**, ≥ 32 символа: сгенерировать, сохранить в `memory/secrets/vercel-jwt.md` как `PRODUCTION_JWT_SECRET` |

Без этих переменных Go-функция в проде не стартует (fail-fast) — это ожидаемо и безопасно.

## 4. Переключение ⛔ СТОП — «да» владельца

```sh
git checkout main && git merge --no-ff mgv-block-6-prod && git push origin main
```

Vercel соберёт Production по `vercel.json` (Vue из `frontend/`, Go-функция `api/index.go`, регион `icn1`).
Дождаться `READY` Production-деплоя, записать его ID.

## 5. Смоук на `family-finance-ff.vercel.app`

| Проверка | Ожидание |
|---|---|
| `GET /api/health` | `{"status":"ok","db":"connected"}` |
| `GET /api/fx-rate` | курсы USD/EUR/RUB/CNY, дата |
| Телефон с установленной React-PWA: открыть | не более одной автоматической перезагрузки → Vue (экран входа); ручная чистка кэша не нужна |
| Оба участника входят **старыми паролями** (Р-15) | вход, экраны: имена, зарплаты, цели, обязательства, кредиты, капитал — как в React до окна |
| Правка на одном устройстве | видна на втором после синка |
| Режим полёта → открыть PWA | открывается, данные на месте |
| Форма счёта в валюте | курс Нацбанка подставлен |
| Установка PWA (Chrome → «Установить») | ставится; на preview это не проверить — там манифест закрыт SSO |

Все ✅ → cutover состоялся. Любой ❌ или «данные не те» от владельца → **Откат**.

## 6. После

- **`transfer forward` после переключения не запускать**: `-replace` сотрёт всё, что участники
  сделали в Go (флаг — единственная защита).
- Снять из памяти агента запись `no-push-main-during-migration`.
- `memory/STATE.md`, Handoff клинапа, статус блока.
- Хвост «Уборка старого» (React `src/`, таблицы `public`, `auth.users`, Edge Function `fx-rate`,
  env Preview ветки) — не раньше 2 недель стабильной работы и с «да» владельца.

## Откат ⛔ СТОП — «да» владельца

Триггер: красный смоук, «данные не те» от владельца, или Go-функция не поднимается.

0. Сказать участникам: **ничего не править**, пока не пройдёт шаг 3 — правку, сделанную в React
   до `back`, шаг 2 перезапишет документом из `app` (сверка этого не заметит).
1. **Vercel → Deployments → `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` → Promote** (Instant Rollback;
   коннектор: `request_rollback`/`request_promote`). React снова на прод-адресе.
   `main` при этом остаётся с Go — **не пушить `main`**, пока не решено, что дальше
   (следующий push снова выкатит Go).
2. Записи, сделанные в Go после переключения, — обратно в React:
   ```sh
   go run ./cmd/transfer back -dry-run   # посмотреть отчёт
   go run ./cmd/transfer back            # документы app → public; отказ, если есть семьи, созданные в Go (-force — вернуть остальное)
   ```
3. Сверка: `result: OK` в отчёте `back`; владелец видит свои данные в React (React-SW вернётся сам,
   тем же механизмом autoUpdate).
4. Handoff: причина отката, что вернули, что делать дальше.
