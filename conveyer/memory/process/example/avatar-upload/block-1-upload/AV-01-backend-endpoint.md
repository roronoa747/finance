# AV-01 — Ручка загрузки и раздачи аватара (бэкенд)

Блок 1 · MVP · Репо/каталог: `backend/` · Зависит от: — · Роли: любой залогиненный

## Контекст (что уже есть)

- Роутинг: `cmd/api/main.go`, Go 1.22-паттерны; auth-мидлварь `internal/auth.Require`
  кладёт `user_id` в context (`auth.FromContext`).
- Модель пользователя: `internal/users/user.go`, таблица `users` (pgx). Миграции
  goose в `migrations/` (занято ≤ 0007 — брать 0008).
- Ошибки API — plain-text `http.Error` (конвенция всего API, Р-2).
- Ресайз: стандартная `image/jpeg` + `golang.org/x/image/draw` (в go.mod ещё нет).

## Задача

1. Миграция `0008_avatar_version.sql`: `users.avatar_version int NOT NULL DEFAULT 0`
   (+ down).
2. `internal/avatars/` (плоско: handlers.go + store.go): `POST /profile/avatar`
   (auth) — multipart `file`; валидация Р-2 (тип по сигнатуре, не по расширению;
   ≤ 2 МБ через `http.MaxBytesReader`); ресайз 256×256 → JPEG на диск
   `var/avatars/<user_id>.jpg` (атомарно: tmp + rename); `avatar_version + 1` в БД;
   ответ `{"version": N}`.
3. `GET /avatars/{user_id}` (без auth): отдать файл, `Cache-Control: public,
   max-age=31536000, immutable`; нет файла → 404.
4. Путь каталога — env `AVATARS_DIR` (дефолт `var/avatars`), в `.env.example`.

## Тесты

- Юнит на валидацию: не-картинка → 400, >2 МБ → 413, PNG → JPEG-выход 256×256.
- Хендлер-тест `httptest`: POST без токена → 401; happy path → version растёт,
  файл существует; GET отдаёт JPEG с immutable-кэшем.

## Критерии приёмки

- `curl -F file=@face.png -H "Authorization: Bearer $T" :8080/profile/avatar` →
  `{"version":1}`; повтор → `{"version":2}`; `curl :8080/avatars/<id>` → JPEG 256×256.
- `go build ./... && go test ./...` зелёные; `goose up/down` проходят на чистой БД.

## Вне скоупа

- Удаление аватара, S3, rate-limit — после MVP / хвосты. UI — AV-02.
