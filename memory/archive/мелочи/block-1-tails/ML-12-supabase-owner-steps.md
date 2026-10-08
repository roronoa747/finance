# ML-12 — Инструкция владельцу: бэкап и уборка React в Supabase и Vercel (доки)

Блок 1 · MVP · Репо/каталог: `memory/backlog/мелочи/block-1-tails/supabase-cleanup.md` · Зависит от: ML-11 · Роли: владелец

## Контекст (что уже есть)

- Р-4: в Supabase удаляется **только React**: таблицы схемы `public` (`households`, `household_members`,
  `household_docs`, `private_docs`, `household_invites`) и функции (`my_households`, `can_write`, `create_household`,
  `create_invite`, `join_household`, `pull_doc`, `push_doc`, `push_private`, `my_membership` — по
  `supabase/migrations/20260907_init.sql`, удаляется ML-11 — список держать здесь), пользователи Supabase Auth, Edge
  Function `fx-rate`; в Vercel — env Preview ветки `mgv-block-6-prod`. **Схема `app` не трогается. Пауза и удаление
  проекта Supabase запрещены — это прод-база.**
- Агент секрет прод-БД не читает (память «prod-migrations-by-owner»): команды запускает владелец, агент проверяет
  после.
- Будильник базы до удаления переведён на `/api/health` (ML-10) — иначе он упадёт на `public.households`.

## Задача

1. `supabase-cleanup.md` — пошаговая инструкция владельцу, каждая команда готова к копированию, DSN — только именем
   переменной/ссылкой на `memory/secrets/` (значение не писать):
   1. **Бэкап**: `pg_dump --schema=public --no-owner -Fc "$PROD_DATABASE_URL" -f public-backup-2026-10.dump` и выгрузка
      `auth.users` (`\copy (select id, email, created_at from auth.users) to 'auth-users-2026-10.csv' csv header`);
      файлы — в `memory/secrets/backups/` (не в git), проверка `pg_restore --list` не пустой.
   2. **Сверка перед удалением**: `select count(*)` по каждой таблице `app.*` (записать числа) — после удаления те же.
   3. **Удаление**: `drop function … ; drop table public.… cascade;` (только перечисленные), удаление пользователей Auth
      (дашборд Supabase → Authentication → Users, или `delete from auth.users`), Edge Function `fx-rate` (дашборд →
      Edge Functions → Delete), Vercel → Settings → Environment Variables → Preview `mgv-block-6-prod` — удалить.
   4. **Проверка**: `select count(*)` по `app.*` — как в п. 2; `curl https://family-finance-ff.vercel.app/api/health`
      → 200; ручной запуск будильника — зелёный.
2. Шаги выполняются **после деплоя блока** (в приёмке, с «да» владельца) — в SESSION.md это строка промпта приёмки.

## Тесты

- Документ: каждая команда проверена на синтаксис (на локальной/одноразовой Postgres: `pg_dump` схемы и `drop` по
  testdata-копии — если под рукой нет, пометка «не проверено» у шага).
- Хук pre-commit проходит (нет значений DSN/паролей — см. память «secret-hook-password-colon»).

## Критерии приёмки

- Файл инструкции в git; в нём нет ни одного секрета; каждое удаление — после бэкапа и сверки.

## Вне скоупа

- Выполнение шагов — владелец в приёмке. Схема `app`, проект Supabase — не трогаются.
