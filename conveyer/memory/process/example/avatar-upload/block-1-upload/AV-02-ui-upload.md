# AV-02 — UI загрузки и показ аватара (фронт)

Блок 1 · MVP · Репо/каталог: `web/` · Зависит от: AV-01 · Роли: любой залогиненный

## Контекст (что уже есть)

- Слои: `web/src/{domain,application,infrastructure,presentation,pages}`.
- Профиль: `pages/ProfilePage.vue`; шапка: `presentation/AppHeader.vue` — сейчас
  рендерят инициалы через `presentation/UserInitials.vue`.
- Стор пользователя: `application/useUser.ts` (`ref`-синглтон, поле `user` c
  `id`; после AV-01 бэкенд отдаёт и `avatar_version`).
- HTTP: `infrastructure/http.ts` — `api()` (Bearer, тело ошибки — текст);
  multipart шлётся `fetch`-ом через тот же хелпер (передать `FormData`).

## Задача

1. `domain/avatar.ts`: `avatarUrl(userId, version): string | null` — `null` при
   `version === 0`, иначе `/avatars/${userId}?v=${version}` (чистая функция).
2. `presentation/UserAvatar.vue`: показывает `<img>` по `avatarUrl`, при `null` —
   существующий `UserInitials`. Заменить использование в `AppHeader` и `ProfilePage`.
3. В `ProfilePage`: кнопка «Загрузить аватар» → `<input type=file accept=image/*>` →
   `POST /profile/avatar`; успех → обновить `avatar_version` в `useUser` (шапка
   обновится реактивно); ошибка → текст ошибки бэкенда рядом с кнопкой.

## Тесты

- Vitest на `avatarUrl` (0 → null; версия в query; смена версии меняет URL).
- Vitest на `UserAvatar`: version=0 → инициалы; version>0 → img с верным src.

## Критерии приёмки

- В браузере: загрузка PNG из профиля → аватар в профиле и шапке БЕЗ перезагрузки;
  после F5 остаётся (кэш пробит новой `?v=`). Ошибка >2 МБ показывает текст бэкенда.
- `pnpm build` (vue-tsc) + `pnpm test` зелёные.

## Вне скоупа

- Кроп/превью до загрузки, удаление аватара — после MVP.
