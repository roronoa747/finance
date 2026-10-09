# PN-01 — Аватары в шапке ведут в Настройки (фронт)

Блок 1 · MVP · Репо/каталог: `frontend/src/components/AppShell.vue`, `frontend/src/views/Settings.vue` · Зависит от: — · Роли: member, viewer

## Контекст (что уже есть)

- Шапка — `components/AppShell.vue` (193 строки). Корневые экраны `ROOTS` (:51): `/`, `/week`, `/month`, `/money`,
  `/money/debts`, `/money/history`. Аватары участников рисуются на корневых экранах, кроме `/week` (:148-165):
  ```vue
  <div v-if="people.length && route.path !== '/week'" class="flex">
    <RouterLink v-for="(p, i) in people" :key="p.id" :to="`/people/${p.id}`" :aria-label="`Желания · ${p.name}`" …>
      <Avatar :id="p.id" :name="p.name" />
    </RouterLink>
  </div>
  <RouterLink v-if="route.path === '/'" to="/settings" aria-label="Настройки" …><IconBox><PhGearSix :size="20" /></IconBox></RouterLink>
  ```
  `people = financeStore.people.filter(p => !p.deletedAt)` (:48). Заголовки экранов — `header` (:67-91): `/people/*` →
  «Желания», `/settings` → «Настройки» (подзаголовок — почта), `/settings/me` → «Свой кружок». `goBack()` (:60-64):
  `/settings/me` → `/settings`.
- Маршруты (`router/index.ts`): `settings` (:124), `settings/me` → `MyCircle` (`memberOnly`, :126), `people/:slot` →
  `views/Wishes.vue` (:120; та же вкладка, что `/wishes?tab=`), `admin` (:127). `OPEN_ANYTIME = ['/settings', '/admin']`
  (:151) — настройки открыты и без семьи.
- `views/Settings.vue` (156 строк): карточки «Оформление» (`AppearancePanel section="look"` — там поле «Ваше имя»,
  :89-99 панели, `setPerson(slot, { name })`), **«С кем»** (:74-119: строки участников из `useMembers()`, своя строка —
  ссылка на `/settings/me` «Свой кружок», код для партнёра / «Создать код» из `useInvite()`, `SyncBadge`), «Разбор
  трат» (`<details>`), карточка аккаунта (выход, «Цифры» → `/admin`, политика, `DangerZone`).
- «Желания» участника остаются доступны с «Мечт»: `views/Dreams.vue:181-185` — «Желания · Все N» → `/wishes`; там
  `Segmented` вкладок по людям + «Общие» (`Wishes.vue:180`).
- Тесты шапки: `components/AppShell.test.ts`, `AppShell.dom.test.ts` (ссылки `/people/…` — проверить и переписать).
  `DESIGN.md` §2 описывает шапку (аватары → желания, B2C-18) — абзац обновить.

## Задача

1. `AppShell.vue`: аватары на корневых экранах ведут на `/settings` — свой и партнёра одинаково (Р-1);
   `aria-label` — «Настройки · <имя>». Условие показа (корневые экраны, не `/week`) не менять. Шестерёнка на «Мечтах»
   остаётся (Р-1) — два входа на одном экране допустимы: аватары — «кто мы», шестерёнка — «настройки».
2. `Settings.vue`: раздел «С кем» — первым на экране (над «Оформлением»): человек нажал на лица — видит лица.
   Внутри порядок прежний: строки участников (своя — → «Свой кружок» `/settings/me`), код для партнёра.
   **Имя переезжает в «Свой кружок»:** в `MyCircle.vue` над кружком — поле «Имя» (тот же `setPerson(slot, { name })`,
   что сейчас в `AppearancePanel.saveName` :40-47, по уходу из поля, `SavedMark`); поле «Ваше имя» из «Оформления»
   убрать — одно место правки имени (дубль = дрейф). Так «имя, свой кружок, код» — не дальше второго нажатия от
   аватара (Р-1). Заголовок `/settings/me` в шапке остаётся «Свой кружок».
3. Маршрут `/people/:slot` оставить (вкладки «Желаний» и старые ссылки), заголовок «Желания» — без изменений.
4. `DESIGN.md` §2 (шапка): одна фраза — аватары → Настройки (Р-1 «понятность»), желания — с «Мечт».

## Тесты

- `AppShell.test.ts` / `AppShell.dom.test.ts`: на `/`, `/month`, `/money` ссылки аватаров — `/settings` с
  `aria-label` «Настройки · <имя>»; на `/week` аватаров нет; шестерёнка — только на `/`.
- `views/Settings.test.ts`: «С кем» выше «Оформления» в SSR-разметке; поля имени в «Оформлении» нет.
- `views/MyCircle.dom.test.ts`: поле «Имя» пишет `setPerson(slot, { name })` по blur; viewer поля не видит
  (`/settings/me` — `memberOnly`, но тест на `canEdit` не лишний).

## Критерии приёмки

- С любого корневого экрана (кроме «Недели») в настройки — одно нажатие на аватар; имя, кружок и код — не дальше
  второго нажатия (критерий брифа «≤ 2 нажатий»).
- `cd frontend && npm run build && npx vitest run` зелёные; стенд 390 px, обе темы, member и viewer: аватары
  ведут в «Настройки», «С кем» первым, «Свой кружок» с полем имени.

## Вне скоупа

- Переделка «Желаний» и вкладок по людям — нет (Р-1: желания — с «Мечт»). Хвост 1022 — PN-02.
