# B2C-40 — Системный шрифт и нейтральная палитра: токены, гвард, манифест (фронт)

Блок 9 · MVP · Каталог: `frontend/src/style.css`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/src/lib/storyCard.ts`, `frontend/src/style.tokens.test.ts` · Зависит от: — · Роли: все (оформление)

## Контекст (что уже есть)

- Цвет и шрифт — только токены `frontend/src/style.css` (CLAUDE.md п. 6): первый блок `:root` —
  цвета светлой темы, `.dark` — тёмной (пары обязательны), `@theme inline` — классы Tailwind
  (`--color-<имя>`, `--font-display`, `--font-sans`, радиусы, тени). Гвард —
  `style.tokens.test.ts` (читает CSS как текст: пары light/dark, класс на каждый цвет, и
  **проверяет направление А**: `--canvas` `#f3eee6`/`#17130f`, `--font-display` содержит
  `Piazzolla`, в файле нет `Onest`). Литералы цвета вне `style.css` ловит `style.literals.test.ts`.
- Типографика — `@utility` в `style.css` (строки ~253–332): `num`, `money`, `type-h1` (30/600,
  Piazzolla), `type-h2` (22), `type-h2-lg` (28), `type-sheet` (24), `type-h3` (17/600),
  `type-percent` (76/500), `type-big` (44/500), `type-big-md` (32/500), `type-section`,
  `type-meta`. Шрифты грузятся из Google Fonts в `frontend/index.html` (две строки `preconnect` и
  `<link rel="stylesheet" …Piazzolla…Golos+Text…>`); `body` — `var(--font-sans)`.
- Решение владельца (пивот 3, `memory/decisions/pivot-3-money-fonts.md`, Р-36): **шрифт системный**,
  **палитра нейтральная**; бренд «глина» `--brand`/`--brand-ink`, участники `--pa`/`--pb`, разделы
  трат `--s1…--s12`, `--s-unknown` (значения `--s-unknown` в нейтральной палитре другие — см.
  ниже), `--ok`/`--warn`/`--destructive` — без изменений. Эталон — `pivot-3/index.html`: класс
  `.f3` (шрифты) и блок `[data-pal="neutral"]` (светлая и тёмная).
- Значения из макета. Шрифты: `--fd` (заголовки) `-apple-system, BlinkMacSystemFont, 'SF Pro
  Display', system-ui, 'Segoe UI', Roboto, sans-serif`; `--fs` (текст) то же с `'SF Pro Text'`;
  `--fn` (крупные цифры) `ui-rounded, -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI',
  Roboto, sans-serif`; вес заголовков 700, трекинг `-.02em`; процент героя 64 px (было 76), вес
  крупных цифр 700. Палитра, светлая: `--canvas #f2f2f0`, `--surface #ffffff`, `--surface-2
  #f1f1ef`, `--surface-3 #e7e7e3`, `--line #e3e3df`, `--line-strong #cfcfca`, `--ink #19191b`,
  `--ink-2 #57575b`, `--ink-3 #86868b`, `--track #e6e6e2`, `--brand-soft #f6e6dd`, `--s-unknown
  #d3d3ce`; тёмная: `--canvas #121214`, `--surface #1c1c1f`, `--surface-2 #26262a`, `--surface-3
  #313136`, `--line #36363b`, `--line-strong #4a4a50`, `--ink #f1f1ee`, `--ink-2 #b4b4b0`, `--ink-3
  #8a8a86`, `--track #313136`, `--brand-soft #3a2418`, `--s-unknown #55555a`. Остальные токены
  (`--ok*`, `--warn*`, `--gold*`, `--destructive*`, `--scrim`, `--photo-scrim`, `--on-photo`,
  `--card-border`, тени, радиусы) — как есть.
- Сырые цвета вне `style.css` разрешены только в `lib/storyCard.ts` (canvas сторис; значения
  токенов светлой темы с комментарием): `NO_PHOTO_BG = '#e6ded2'` (= старый `--surface-3`) и
  соседние константы. PWA-манифест — `frontend/vite.config.ts`: `background_color: '#F3EEE6'`
  (старый холст), `theme_color: '#B4562F'` (бренд). Иконка `favicon.svg` — бренд, не меняется.

## Задача

1. `style.css`: заменить значения перечисленных токенов в `:root` и `.dark` на нейтральные;
   `--font-display` и `--font-sans` в `@theme inline` — на системные стеки (`--fd`, `--fs`);
   добавить `--font-num` (`--fn`, `ui-rounded …`) и перевести на него `type-percent`, `type-big`,
   `type-big-md` (вес 700; процент героя — 64/0.95). Заголовки (`type-h1`, `type-h2`, `type-h2-lg`,
   `type-sheet`) — вес 700, `letter-spacing: -0.02em`. Комментарий в шапке файла — про пивот 3 и
   запись решения вместо «направление А … перенос mockups/tokens.css».
2. `index.html`: убрать `preconnect` к Google Fonts и `<link>` шрифтов. Ничего внешнего при
   старте не грузится (проверить в сети браузера: нет запросов к `fonts.googleapis.com`).
3. `vite.config.ts`: `background_color` манифеста — новый холст `#F2F2F0` (`theme_color` — бренд, не
   трогать). `lib/storyCard.ts`: константы сырых цветов — на значения новых токенов светлой темы
   (`NO_PHOTO_BG` → `#e7e7e3`), комментарий сохранить.
4. `style.tokens.test.ts`: гвард направления переписать под пивот 3 — `--canvas` `#f2f2f0` /
   `#121214`, `--brand` без изменений, `--font-display` начинается с `-apple-system`, есть
   `--font-num` с `ui-rounded`, в `style.css` и `index.html` нет строк `Piazzolla`, `Golos`,
   `Onest`, `fonts.googleapis`. Пары light/dark и классы — как были.
5. Проверить глазами (390 px, обе темы) главный, «Неделю», «Деньги», цель, настройки: ничего не
   пропало при смене темы, крупные цифры скруглённые (на Windows `ui-rounded` может
   отсутствовать — тогда Segoe UI, это норма), контраст подписей `--ink-3` на `--surface` не хуже
   прежнего.

## Тесты

- `style.tokens.test.ts` — обновлённый гвард (п. 4): пары, классы, пивот 3, отсутствие Google Fonts.
- `style.literals.test.ts` остаётся зелёным (новых литералов вне `style.css` нет).
- `e2e/pwa-build.test.ts`: манифест с `background_color` `#F2F2F0`; сборка без ссылок на
  `fonts.gstatic.com` в `dist/index.html`.

## Критерии приёмки

- Светлая и тёмная темы на новых значениях; `--brand`, `--s1…--s12`, `--pa/--pb` не изменились;
  `grep -r "Piazzolla\|Golos" frontend/src frontend/index.html` — пусто.
- `cd frontend && npm run build && npm test` зелёные; в браузере нет запросов к Google Fonts.
- Снимок «Мечты — главный» в обеих темах рядом с макетом `pivot-3/index.html` (переключатели
  «Системный» + «Нейтральная») — шрифт и фон совпадают по характеру (точного совпадения шрифта на
  Windows не требуется — на стенде нет SF).

## Вне скоупа

- Перерисовка экранов под новую структуру — B2C-41…B2C-45. Макеты Блока 2
  (`block-2-design/mockups/`) не правятся — исторический артефакт. Импорт в Figma — хвост §4.
