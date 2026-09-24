# MGV-01 — Скелет Go-сервера, конфиг и подключение к PostgreSQL (бэкенд)

Блок 1 · MVP · Каталог: `backend/` · Зависит от: — · Роли: все

## Контекст (что уже есть)
- Проект мигрирует с Supabase на независимый Go-бэкенд.
- База данных: PostgreSQL.
- Порт по умолчанию: `8080`.

## Задача
1. Инициализировать модуль Go в каталоге `backend/` (`go mod init finance-backend`).
2. Настроить структуру каталогов:
   - `backend/cmd/server/main.go`
   - `backend/internal/config/config.go`
   - `backend/internal/db/db.go`
   - `backend/internal/handlers/health.go`
3. Реализовать чтение конфигурации из переменных окружения (`PORT`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`).
4. Настроить пул соединений с PostgreSQL с таймаутами и проверкой связи (`PingContext`).
5. Настроить HTTP-маршрутизатор (Chi / net/http) с middleware: Logger, Recoverer, CORS.
6. Реализовать эндпоинт `GET /api/health`, возвращающий статус `{"status":"ok","db":"connected"}`.

## Тесты
- Юнит-тест парсинга конфигурации (`config_test.go`).
- HTTP-тест эндпоинта `/api/health` (`health_test.go`).

## Критерии приёмки
- `cd backend && go build ./...` компилируется без ошибок.
- `cd backend && go test ./...` проходит успешно.
- Сервер стартует и отвечает `200 OK` на `/api/health`.

## Вне скоупа
- Таблицы и миграции (задача MGV-02).
- Авторизация (задача MGV-03).
