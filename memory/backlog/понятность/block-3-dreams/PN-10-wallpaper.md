# PN-10 — «Сохранить как обои» в листе истории мечты (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/src/lib/storyCard.ts`, `frontend/src/components/goals/StorySheet.vue` · Зависит от: PN-09 · Роли: member, viewer (ничего не меняет)

## Контекст (что уже есть)

- Карточка для сторис (B2C-20): `lib/storyCard.ts` (236 строк) — `STORY_SIZE` 1080 × 1920 (:9), `StoryKind = 'goal' |
  'leaks'` (:10), `StoryData` (:11-18), `StoryTexts` (:19), `withoutMoney` (:37, сумм на карточке нет никогда),
  `storyText(kind, data)` (:50), `layoutStory` (:75), `drawStory(ctx, image, texts, layout)` (:110),
  `loadStoryImage(src)` (:177, `crossOrigin anonymous`), `renderStory(canvas, { image, texts })` → PNG `Blob` (:188),
  `STORY_FILE` (:201), `shareStory(blob, { title, fileName? }, nav?) → 'shared' | 'downloaded' | 'cancelled'` (:206;
  Web Share с файлами, иначе `downloadBlob` `<a download>`). Композиция и тексты — чистые функции (тесты в Node без
  canvas — `lib/storyCard.test.ts`), рисование — в браузере.
- Лист — `components/goals/StorySheet.vue` (90 строк): пропсы `open, kind, data, src`; `<canvas width=1080
  height=1920>` в масштабе 270 px; «Поделиться» (если `navigator.canShare`) и «Сохранить» → `shareStory`
  (`nav = null` — скачать). Открывается с экрана цели (`GoalDetail.vue:297-305` кнопка `data-goal-share`, :541
  `<StorySheet kind="goal" …>`, `storySrc` :273-277 — своё фото или CDN шаблона 1080).
- Р-15: «в листе «истории» мечты — «Сохранить как обои»». На iOS обои ставятся руками из «Фото» (API нет); «Поделиться»
  → «Сохранить изображение». Экран блокировки: верхняя треть — часы, текст класть ниже.

## Задача

1. `storyCard.ts`: `StoryKind += 'wallpaper'`; `WALLPAPER_SIZE = { width: 1170, height: 2532 }` (iPhone, 19.5:9 — на
   других телефонах масштабируется); `storyText('wallpaper', data)` = как `goal` (процент, имя без сумм, месяц);
   `layoutStory` для `wallpaper`: фото во весь кадр (`cover`), снизу затемнение-градиент, тексты в нижней трети
   (от ~68 % высоты): процент крупно, строка имени, без подписи приложения и «До мечты» сверху (верх — часам);
   без фото — фон `NO_PHOTO_BG`. `renderStory` берёт размер из `kind` (или параметром `size`).
2. `StorySheet.vue` (только `kind === 'goal'`): под «Поделиться / Сохранить» — тихая `Button variant="ghost"`
   «Сохранить как обои» (`data-story-wallpaper`): рисует вариант `wallpaper` в offscreen-canvas
   (`document.createElement('canvas')`) и зовёт `shareStory(blob, { title: 'Обои · <мечта>', fileName:
   'family-finance-wallpaper.png' })` (есть share — системный лист, иначе скачивание); строка результата —
   «Сохранено — поставьте на экран блокировки из «Фото»» / «Сохранено в загрузки». Предпросмотра обоев нет (одно
   нажатие); `busy` на время рисования.
3. `DESIGN.md` §7 (карточка для сторис) — одна фраза про обои.

## Тесты

- `storyCard.test.ts`: `storyText('wallpaper')` без сумм; `layoutStory('wallpaper')` — текстовый блок ниже 60 %
  высоты, подписи `app`/`label` отсутствуют, размер 1170 × 2532.
- `StorySheet.dom.test.ts`: кнопка есть у `goal`, нет у `leaks`; клик зовёт `shareStory` с именем файла обоев
  (`shareStory` — заглушка через `vi.mock`, canvas в happy-dom не рисует — `renderStory` замокать).

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные; на стенде (Chrome) скачанный PNG 1170 × 2532 с фото,
  процентом и именем в нижней трети; на iPhone (смоук владельца) — «Поделиться» → «Сохранить изображение».

## Вне скоупа

- Автоустановка обоев — невозможна в вебе. Обои для «утечек» — нет.
