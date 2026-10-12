# PN-08 — Фото по ссылке у цели (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/src/components/goals/`, `frontend/src/views/GoalNew.vue` · Зависит от: PN-07 · Роли: member

## Контекст (что уже есть)

- У желаний фото по ссылке есть (B2C-65/66/68): composable `lib/photos/useLinkPreview.ts` —
  `useLinkPreview(client?, measure?) → { busy, note, load, schedule(text, apply), clearNote, reset }`; `LinkFound = {
  url, title, file: File | null }` (:27-32); `linkIn(text)` вытаскивает ссылку из текста; пауза ввода 300 мс (:25);
  маленькая картинка (< 300 px, `lib/photos/linkPhoto.ts` `bigEnough`) → `file: null` и `note = LINK_PHOTO_MISSED`.
  Клиент: `apiClient.linkPreview(url) → { title, blob }` (`api/client.ts:289-298`, `POST /api/photos/preview`,
  ошибки `LinkPreviewError` — `bad url | blocked | no image | too large | timeout | unavailable | offline`); Go —
  `backend/internal/handlers/preview.go` (member only, страница 1 МБ, картинка 2 МБ, 6 с) — **не трогается** (Р-4).
- Образцы UI: `views/Wishes.vue:118-125, 308-314` (поле ссылки в листе «Новое желание», `watch(wishUrl) →
  link.schedule(text, applyLink)`, `PhotoSlot`), `components/goals/WishSheet.vue:94-108, 160-169` (`onUrlInput` →
  `onLink` → `onFile`).
- Выбор фото цели: `components/goals/PhotoPicker.vue` (107 строк) — ничего не грузит, отдаёт `template` / `file`
  родителю; родители (`GoalDetail.vue:249-256 onFile`, `Dreams.vue:88-93`) зовут `attachFile(store, id, file)`
  (`lib/photos/goalPhoto.ts:79-90`: `compressImage` → `uploadPhoto` → `setGoalPhoto(id, …, null)` → `template: null`).
  «Новая мечта» `views/GoalNew.vue` — своя сетка (:150-165), своё фото через `onFile` (:100-111: `ownFile`,
  `ownPreview` object URL, `next()`), создание :120-142 (`attachFile` после перехода).
- Кит: `Field` (`name`, слот `#hint`), `Input`, `useFormCheck`; `TemplateTile` (`name`, `camera`, `src`).
- Правило 12: одно главное действие в листе («Выбрать это»); ссылка — тихий вход.

## Задача

1. Новый `components/goals/LinkPhotoField.vue`: поле «Ссылка на картинку или страницу» (`Field name="link"` + `Input`,
   `inputmode="url"`), `useLinkPreview()`; ввод → `schedule(text, found => found.file ? emit('found', found) :
   показать note)`; `busy` — тихий индикатор у поля; `note` — строкой под полем (`LINK_PHOTO_MISSED` = «картинки нет /
   маленькая — загрузите своё»). Эмит `found(found: LinkFound)`. Один компонент — два места.
2. `PhotoPicker.vue`: плитка «По ссылке» (`TemplateTile` с иконкой `PhLink`, рядом со «Своё фото»); нажатие
   раскрывает `LinkPhotoField` под сеткой; `found` → `emit('file', found.file)` (родитель грузит как своё фото —
   `attachFile`, шаблон снимается). Лист закрывает родитель, как при файле.
3. `GoalNew.vue` шаг «pick»: та же плитка и поле; `found` → как `onFile`: `ownFile = found.file`, превью, `template =
   null`, `next()`; имя цели — `found.title`, если пусто (как у желаний: название со страницы).
4. Правило формы: пустая ссылка — ничего; ссылка без картинки — note, лист не закрывается. Демо (`isDemo`) и офлайн —
   note «при сети» (клиент вернёт `offline`/`unavailable`), без падений.
5. `DESIGN.md` §5 `PhotoPicker` — одна фраза про «По ссылке».

## Тесты

- `LinkPhotoField.dom.test.ts` (новый): клиент-заглушка `linkPreview` → `found` с `File`; маленькая картинка → note
  без `found`; ошибка → note. Пауза ввода — `vi.useFakeTimers`.
- `PhotoSlot`/`PhotoPicker` DOM: плитка «По ссылке» показывает поле; `found` → `emit('file')`.
- `GoalNew.variants.dom.test.ts`: ссылка → шаг «form» с превью и именем со страницы; `addGoal` с `template: null`,
  затем `attachFile`.

## Критерии приёмки

- Критерий брифа: ссылка на картинку становится фото цели (новой и существующей); автор у такого фото — null.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд с Go-сервером (превью — ручка Go): ссылка на
  страницу магазина → фото цели.

## Вне скоупа

- Go `linkpreview` — не меняется. Фото по ссылке у желаний — как было (общий компонент туда не переносим — правило 10).
