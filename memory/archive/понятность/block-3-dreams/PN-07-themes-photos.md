# PN-07 — Библиотека: +8 тем × 5 фото (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/src/lib/goalTemplates.ts`, `goalTemplates.test.ts` · Зависит от: Блок 2 🏁 · Роли: member (выбор фото)

## Контекст (что уже есть)

- `lib/goalTemplates.ts` (126 строк): `GoalTemplateType` (:15) — 11 типов `car | home | travel | tech | health |
  wedding | baby | study | renovation | cushion | hajj`; `interface GoalTemplate` (:17-32) — `{ id, name, type, photo:
  { unsplashId, pageId, author, authorUrl, place? }, hue: HueKey }`; хелпер `photo(unsplashId, pageId, author, authorUrl,
  place?)` (:48); `GOAL_TYPES` (:34-46) — плитки с именами; `GOAL_TEMPLATES` (:50-106): базовые плитки :52-63, варианты
  `<type>-2…4` :65-94, направления путешествий :95-105. `themePhotos(type)` (:112) — плитка + варианты (у travel —
  `[]`); `templateImageUrl(t, width = 1200)` (:119) — CDN `images.unsplash.com/<unsplashId>?w=&q=80&fm=jpg&fit=crop`;
  `templateCredit(t)` (:124) — автор и страница `https://unsplash.com/photos/<pageId>` (лицензия Unsplash — через
  страницу фото, отдельного поля нет).
- Оттенки — `HueKey = 'blue' | 'teal' | 'green' | 'ochre' | 'brick' | 'plum' | 'indigo' | 'steel'` (`lib/palette.ts:13`).
- Тесты `goalTemplates.test.ts`: уникальность `unsplashId`/`pageId` по всему пулу, формат `authorUrl`
  (`https://unsplash.com/@…`), `pageId` 11 символов, у темы (кроме travel) 3–5 фото `<type>-N` того же имени и
  оттенка; тест :50 жёстко перечисляет 11 типов — расширить.
- Где плитки показываются: `components/goals/PhotoPicker.vue` (:80-88 — сетка 3 колонки по `GOAL_TYPES` + «Своё фото»)
  и `views/GoalNew.vue` (:150-165 сетка, :175-190 варианты `themePhotos`). `GOAL_TYPES` порядок = порядок плиток.
- Фото при выборе качается телефоном с CDN и загружается своим (`lib/photos/goalPhoto.ts` `attachTemplate` →
  `compressImage` → `uploadPhoto`); `retryTemplatePhotos` догружает офлайн-цели.
- Подбор фото — вручную на unsplash.com через Chrome (память: «Unsplash — через Chrome»), как в B2C-64/64-а: без лиц
  крупно, без логотипов и текста, горизонтальные или квадратные (плитка `fit=crop`), уместные для Казахстана
  («Той / юбилей» — праздник в нашем духе, «Дача / земля» — участок, не вилла). Р-4: ≈40 новых фото.

## Задача

1. `GoalTemplateType` += `'business' | 'moving' | 'furniture' | 'sport' | 'celebration' | 'gift' | 'dacha' | 'pet'`;
   `GOAL_TYPES` += после существующих, в этом порядке: Бизнес, Переезд, Мебель, Спорт, Той / юбилей, Подарок,
   Дача / земля, Животное (Р-4). Оттенок темы — из `HueKey`, чтобы соседние плитки не сливались.
2. `GOAL_TEMPLATES` += по **5** фото на тему: базовая плитка `<type>` + `<type>-2…-5`, то же имя и оттенок; каждое —
   `photo(unsplashId, pageId, author, authorUrl)` со страницы Unsplash (автор и страница — обязательны, Р-4).
   Уникальность картинок и страниц по всему пулу (существующий тест).
3. Разово проверить скриптом (в scratchpad, не в репо), что `templateImageUrl(t, 400)` и `(t, 1200)` всех 40 новых
   отдают 200 и картинку ≥ 300 px по меньшей стороне; итог — в Handoff.
4. `goalTemplates.test.ts`: список типов (:51) — 19 в порядке п. 1; у восьми новых — ровно 5 фото; `GOAL_TYPES`
   содержит имена из Р-4.

## Тесты

- Правки `goalTemplates.test.ts` по п. 4; существующие гварды уникальности и форматов — должны пройти на новом пуле.

## Критерии приёмки

- В `PhotoPicker` и «Новой мечте» видны 19 плиток, у новой темы — ряд из пяти вариантов; выбор загружает фото с автором.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд: новая цель «Той» с фото, автор на герое.

## Вне скоупа

- Поиск по API Unsplash/Pexels — после MVP (бриф). Демо-картинки в бандле (`assets/demo`) не добавляются.
  Плитка «По ссылке» — PN-08.
