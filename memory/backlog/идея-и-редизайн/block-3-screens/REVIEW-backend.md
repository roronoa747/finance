# Ревью backend — пост-приёмка блока 3 (B2C-16)

**2026-09-28.** Дифф: `28310cb..13805d2 -- backend api go.mod go.sum` — три коммита B2C-16 (`58d9dd7`, `2e44d70`,
`d81b9d6`, последний — правки критика), 14 файлов, +798/−10; корень `api/` и `go.mod` блок не трогал. После первой
приёмки бэкенд не менялся. На своей машине: `go build ./... && go vet ./...` ✅; `go test -count=1 ./...` (моки) ✅ и
`./api/...` ✅; **PG-режим**, Postgres 16 из `/usr/lib/postgresql/16` в одноразовом кластере, оба DSN (`''` и
`&binary_parameters=yes`): `TEST_DATABASE_URL=… go test -count=1 -p 1 ./...` ✅ (migrate, transfer, repository,
handlers, server). Живой стенд `cmd/server` + PG (`cmd/migrate` применил `000003`) + curl — для Н-1 и Н-2.

**Резюме:** блокеров нет. Фото легли рядом с выписками аккуратно: те же `member`/`caller`/`errorJSON`, репозиторий по
образцу `statement_repo.go`, миграция только добавляет (индексы FK на месте, CHECK типа и размера = лимиту
хендлера), `transfer -replace` чистит `app.photos`, моки и PG-тесты покрывают роли, 404 vs 403, лимит, байты через
`[]byte` и каскад. Две правки в клинап — обе про «молча не то»: флаг скрытого фото открыт по умолчанию (Н-1) и
старый брат бага `urn:uuid:` в операциях (Н-2); плюс одна мелкая (Н-3).

## Проверено независимо (не по Handoff-у)

- **Роли и 404 vs 403** — по коду `handlers/photos.go` и тестам: `Upload`/`Delete` через `member` (viewer → 403
  «only members can change data»), `Get` через `caller` (viewer читает); чужая семья, чужое скрытое и неизвестный id —
  одинаково 404, в том числе в `Delete` (существование не раскрывается). Сверил со стендом: партнёр по семье
  читает и удаляет не-скрытое фото (решение B2C-16).
- **Лимит**: `MaxBytesReader(512 << 10)` → 413; `CHECK (size <= 524288)` в `000003` — то же число, вторая линия.
- **`canonicalUUID`** (правка критика): Postgres принимает `{…}` и hex без дефисов, но не `urn:uuid:` — хендлер
  отсекает всё неканоническое до базы. Проверил, есть ли такой же вход в старом коде — есть (Н-2).
- **Миграция `000003`**: `gen_random_uuid()` как в `000001`/`000002`, `IF NOT EXISTS` везде, повторный прогон ничего
  не трогает (`TestPostgresPhotosMigrationAndBytes`), в `public` ничего; `cmd/migrate` ждёт 10 таблиц.
- **Сборка сервера**: `Repos.Photos` заведён и в PG-, и в мок-ветке `NewHandler`; `api/index.go` строит API через
  `server.FromEnv` → тот же `NewHandler`, отдельной разводки фото Vercel-функции не нужно.
- **Хвосты уже в §4**: фото-сироты при сбросе (→ B2C-24) и потолок фото на семью (→ B2C-26) — новых находок по ним нет.

## Находки

### Н-1 · средняя · `hidden` принимает только `1`, любое другое значение молча делает фото видимым семье

`backend/internal/handlers/photos.go:68` — `hidden := r.URL.Query().Get("hidden") == "1"`. Подарок-сюрприз,
загруженный с `?hidden=true` (или `yes`, `on`), сохраняется как обычное фото: партнёр его читает и удаляет.
Проверил на стенде (Go + PG): `POST /api/photos?hidden=true` → `201 {"hidden":false,…}`, партнёр `GET` → **200**,
`DELETE` → **204**. Сейчас не стреляет — клиент шлёт ровно `?hidden=1` (`frontend/src/api/client.ts:201`), — но это
флаг приватности, открытый по умолчанию: любая будущая правка клиента (`?hidden=${bool}`, Android/iOS из Блоков 7–8)
раскроет сюрприз без единой ошибки. Тесты (`photos_test.go:106`, `server_e2e_test.go:515`) проверяют только `1`.

**Рекомендация.** Разбирать строго: `""` и `"0"` → не скрытое, `"1"` → скрытое, всё остальное → **400**
«hidden must be 0 or 1». В `TestPhotosUploadRolesAndValidation` — строка `?hidden=true` → 400 и в базе ничего.

**Вердикт: клинап** (3 строки + тест; закрывает приватность до мобильных клиентов).

### Н-2 · низкая · `upload_id` операций принимает `urn:uuid:…` → 500 (тот же баг, что критик закрыл в фото)

`backend/internal/handlers/statements.go:170` — `uuid.Validate(*op.UploadID)`: `uuid.Validate` пропускает
`urn:uuid:…`, Postgres его не принимает. Проверил на стенде: `POST /api/operations/batch` с
`"upload_id":"urn:uuid:<id загрузки>"` → **500** «failed to save operations», в логе `pq: invalid input syntax for
type uuid … (22P02)`; весь батч отвергнут кодом «сервер сломался» вместо 400. Код до блока, но в блоке появился
готовый ответ — `canonicalUUID` (`photos.go:143`), — и сейчас одна и та же проверка живёт в двух видах.

**Рекомендация.** Перенести `canonicalUUID` к общим хелперам (рядом с `member`/`caller` в `statements.go`) и
использовать в `validateOperation`: `op.UploadID != nil && !canonicalUUID(*op.UploadID)` → «invalid upload_id».
Тест в `statements_test.go`: `urn:uuid:` и `{…}` → 400.

**Вердикт: клинап** (одна строка + перенос функции + тест; клиент такого не шлёт — прод не горит).

### Н-3 · низкая · правило доступа к фото записано дважды

`backend/internal/handlers/photos.go:96` и `:128` — одно и то же условие
`err != nil || photo.HouseholdID != householdID || (photo.Hidden && photo.UserID != userID)` в `Get` и `Delete`.
Это и есть правило приватности сюрприза; правка в одном месте без другого (например, B2C-23 «участники семьи»)
разведёт чтение и удаление.

**Рекомендация.** Функция `visibleTo(photo *models.Photo, householdID, userID string) bool` в `photos.go`, оба
места — `if err != nil || !visibleTo(photo, householdID, userID)`. Тесты уже покрывают обе ветки.

**Вердикт: клинап** (механический, в той же правке, что Н-1).

### Н-4 · низкая · `Delete` читает байты фото (до 512 КБ) только чтобы проверить доступ

`backend/internal/handlers/photos.go:122` — `h.repo.Get` тянет `bytes` из `bytea` ради трёх полей.
Можно `GetMeta` без `bytes` или один `DELETE … WHERE id = $1 AND household_id = $2 AND (NOT hidden OR user_id = $3)`.

**Вердикт: не делаем** — удаление фото редкое (смена или удаление цели двумя людьми), 512 КБ из своей же базы;
новый метод интерфейса и мок ради этого — абстракция «на будущее» (CLAUDE.md п. 10).

### Н-5 · низкая · JSON-теги `models.Photo` не используются

`backend/internal/models/photo.go:7–14` — теги `json:"…"` (`content_type`, `created_at`) не участвуют в ответах:
`Upload` отдаёт карту `{id, hidden, size}` (`photos.go:75`), `Get` — байты. В выписках (`CreateUpload`) хендлер
отдаёт саму модель.

**Вердикт: не делаем** — контракт ответа явный и покрыт тестами; теги безвредны, `HouseholdID`/`UserID` закрыты
`json:"-"` на случай, если модель когда-то уйдёт в ответ целиком.

## Для клинапа — короткий список

1. **Н-1** `photos.go:68` — `hidden` строго `""`/`0`/`1`, иначе 400; тест `?hidden=true` → 400.
2. **Н-2** `statements.go:170` — `canonicalUUID` к общим хелперам и в `validateOperation`; тест `urn:uuid:`/`{…}` → 400.
3. **Н-3** `photos.go:96,128` — `visibleTo(photo, householdID, userID)` вместо двух копий условия.

Верификация клинапа: `go build/vet/test -count=1 ./...` на моках и PG (оба DSN), `./api/...`; миграций нет.
