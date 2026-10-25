# TL-10 — Шаг «Тратьте как обычно» без выбора из одного (фронт)

Блок 4 · MVP · Репо/каталог: `frontend/` · Зависит от: Блок 3 🏁 · Роли: новая семья (member), партнёр по коду · Х-22, Р-10

## Контекст (что уже есть)

- `src/views/Start.vue` (маршрут `/start/:step`): `Step = 'intro' | 'dream' | 'spend' | 'invite'` :34; старые адреса
  upload/salary/questions → `spend` :36; партнёр по коду — `['intro', 'spend']` :54.
- Скрипт шага трат :105-150: `dream = financeStore.heroGoal`, `dreamSrc = usePhoto(…)` :107-108; `path =
  ref<'statement' | 'applepay'>('statement')` :111; `applePayShown = ap.available && ap.isIPhone` :112, `onMounted(() =>
  ap.load())` :113; `pick`/`uploadParsed` :121-141; `chooseApplePay`/`afterSpend` :142-150 → `finish()` :172-178.
- Разметка :239-284: `DreamHero size="preview" :line="dream.name" :src="dreamSrc" data-start-dream` :240 (без мечты —
  заглушка «Мечта» :241); сетка `grid-cols-2` при `applePayShown`, иначе `grid-cols-1` :246 — **одна плитка «Выписка»
  (`data-start-path="statement"`) с рамкой выбора**; плитка Apple Pay `data-start-path="applepay"` :257-267; подсказка «Файл
  остаётся на телефоне» :270; кнопки `data-start-upload` «Загрузить выписку» / `data-start-applepay` «Подключить Apple Pay» и
  `data-start-later` «Позже» :277-283.
- Платформа — `src/stores/applepay.ts`: `isIPhone = /iPhone/.test(userAgent)` :47, `available = canUse && !!link &&
  (iosMajor === null || iosMajor >= 17)` :57 (`link` — после `ap.load()`); отдельной проверки Android нет — всё не-iPhone
  получает одну плитку.
- Макет Figma «Первый запуск · день 1» — `qBsIBtTRI4MIaRa6b8Eli9`, узел `19:156` (две плитки, iPhone).

## Задача

1. При `!applePayShown` плиток нет: фото мечты (`DreamHero`), заголовок шага, одна главная кнопка «Загрузить выписку» и тихое
   «Позже» — как в макете, без рамки выбора.
2. При `applePayShown` (iPhone) — две плитки, как сейчас.
3. Пока `ap.load()` не ответил, показывать вариант с одним путём (без мигания плиток на Android); на iPhone плитки появляются
   после ответа.

## Тесты

- `src/views/Start.test.ts` (:68; Apple Pay :98-115) и `src/views/Start.dom.test.ts` (:108; Apple Pay :148): Android-UA — нет
  `data-start-path`, есть `data-start-dream`, `data-start-upload`, `data-start-later`; iPhone-UA с ярлыком — две плитки,
  выбор переключает кнопку.
- Проверить e2e первого запуска: `e2e/fr-block1-setup.test.ts`, `e2e/b2c-block3-screens.test.ts`,
  `e2e/fb-block5-look.test.ts`, `e2e/fb-block5-accept.test.ts` — где ждут `data-start-path="statement"` на не-iPhone,
  адаптировать (факт «загрузка выписки ведёт дальше» — сохранить).
- e2e `e2e/tl-block4-first-run.test.ts`: Android-UA новая семья → шаг трат без плиток → «Загрузить выписку» → «Неделя».

## Критерии приёмки

- На Android и в браузере шаг трат — фото мечты, заголовок, одна кнопка и «Позже»; на iPhone — две плитки.
- `npm run build && npx vitest run` зелёные; стенд Chrome 390 с Android- и iPhone-UA, обе темы. Handoff — правило 12.

## Вне скоупа

- Порядок шагов первого запуска и «Пригласите партнёра» — без изменений (Р-35 «Фидбека»).
- Подсказка «Файл остаётся на телефоне» — без изменений.
