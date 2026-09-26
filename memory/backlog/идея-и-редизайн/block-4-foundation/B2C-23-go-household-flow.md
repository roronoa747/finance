# B2C-23 — Go: «с кем» — создать семью / по коду без своей семьи, участники семьи (бэкенд)

Блок 4 · MVP · Каталог: `backend/` · Зависит от: B2C-22 · Роли: без семьи → member; member, viewer

## Контекст (что уже есть)

- Р-7 / Р-13: после входа — шаг «с кем» (один / создать семью / по коду); один человек — тоже
  семья; «по коду» без своей семьи работает (хвост «новые семьи»). Мульти-домохозяйства —
  не-скоуп: пользователь состоит максимум в одной семье.
- `internal/handlers/household.go`: `CreateInvite` (member), `JoinHousehold` (`code`,
  `display_name` → `householdRepo.JoinHousehold` → новый JWT с семьёй и слотом; ошибки
  `ErrInviteNotFound/AlreadyUsed/Expired/HouseholdFull`). Семью сейчас создаёт только
  `Register`. `HouseholdRepository`: `CreateHousehold(name, creatorID, displayName)`,
  `GetMembers(householdID)` (ручки нет — хвост PV «роль партнёра в шторке»), `GetMembership`.
  Моки: `MockHouseholdRepo.SetDocRepo` (документы инициализируются при создании семьи).
- После B2C-22: контекст без семьи; `RequireHousehold` → 409.

## Задача

1. `POST /api/household` `{name?, display_name}` — пользователь **без семьи** → создать семью
   (имя по умолчанию как в `Register`), участник слот `a`, документы; ответ 201 с новым JWT и
   `Household`/`Member` (как `AuthResponse`). Уже в семье → 409 `already in household`.
2. `POST /api/household/join` — работает для пользователя без семьи (проверить репозиторий:
   `JoinHousehold` для пользователя без членства); уже в семье → 409 (переход между семьями —
   не-скоуп); остальные ошибки как сейчас; ответ — токен с семьёй.
3. `GET /api/household/members` — member и viewer: `[{slot, display_name, role, joined_at}]`
   своей семьи (email не отдаём).
4. `runLiveServerE2EFlow`: пользователь Google → `POST /api/household` → код → второй
   пользователь Google → `join` без семьи → оба видят участников; `sync` до создания семьи → 409.
   README — ручки.

## Тесты

- Хендлеры на моках: создание без семьи 201 и токен с семьёй; повторное → 409; `join` без
  семьи → 200 и слот `b`; `join` из семьи → 409; `members` для member и viewer, чужая семья не
  видна; `display_name` пустое → 400.
- `TestPostgres…`: создание семьи пользователем без пароля (`password_hash NULL`); каскады.

## Критерии приёмки

- `go build/vet/test` + PG + корень `api/` зелёные; CI зелёный.
- Стенд: два пользователя Google (или два `Register`-пользователя, у одного семья удалена в
  базе) проходят «с кем» через ручки — сценарий в Handoff.

## Вне скоупа

- Фронт «с кем» — B2C-25. Выход из семьи, смена семьи, viewer-приглашения — не-скоуп.
