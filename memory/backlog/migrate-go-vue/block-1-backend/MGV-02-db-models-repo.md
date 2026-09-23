# MGV-02 — Модели, миграции и репозитории данных (бэкенд)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: MGV-01 · Роли: все

## Контекст (что уже есть)
- Эталонная схема базы данных задокументирована в `supabase/migrations/20260907_init.sql`.
- Сущности:
  - `users`: ID, email, password_hash, created_at.
  - `households`: ID, name, created_by, created_at.
  - `household_members`: household_id, user_id, slot ('a', 'b', 'c'), display_name, role ('member', 'viewer'), joined_at.
  - `household_docs`: household_id, rev (bigint), data (jsonb), updated_at, updated_by.
  - `private_docs`: household_id, user_id, rev (bigint), data (jsonb), updated_at.
  - `household_invites`: code, household_id, created_by, created_at, expires_at, used_by, used_at.

## Задача
1. Создать миграции схемы в `backend/migrations/000001_init.sql`.
2. Реализовать простой раннер миграций при старте сервера (`internal/db/migrate.go`).
3. Создать Go-структуры моделей в `internal/models/`.
4. Реализовать репозитории (`internal/repository/`):
   - `user_repo.go`: создание пользователя, поиск по email и ID.
   - `household_repo.go`: создание семьи, участников, инвайтов.
   - `doc_repo.go`: чтение/запись `household_docs` с проверкой `rev`, чтение/запись `private_docs`.

## Тесты
- Юнит-тесты репозиториев с использованием моков или sqlmock/pgxmock.
- Тест корректности десериализации JSONB в Go-структуры и обратно.

## Критерии приёмки
- Миграции создают все таблицы и внешние ключи без ошибок.
- `cd backend && go test ./internal/repository/...` успешно проходит.

## Вне скоупа
- HTTP-эндпоинты и JWT (задачи MGV-03 и MGV-04).
