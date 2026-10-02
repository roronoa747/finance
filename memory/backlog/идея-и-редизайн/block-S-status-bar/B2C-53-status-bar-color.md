# B2C-53 — Системная строка в цвет фона (фронт)

Блок S · MVP · Репо/каталог: `frontend/` · Зависит от: Блок 10 🏁 · Роли: все (оформление устройства)

## Контекст (что уже есть)

- Владелец (пожелание п. 4 после 🏁 Блока 10): строка сверху на iPhone (Dynamic Island, время, заряд) —
  коричневая. Причина — бренд `#B4562F` вместо цвета фона:
  - `frontend/index.html:7` — `<meta name="theme-color" content="#B4562F" />`, статичный; рядом
    `apple-mobile-web-app-capable` и `-title`, `apple-mobile-web-app-status-bar-style` нет;
  - `frontend/vite.config.ts` ~28–29 — манифест PWA: `background_color: '#F2F2F0'`, `theme_color: '#B4562F'`.
- Фон экрана — токен `--canvas` (`src/style.css`): светлая `#f2f2f0` (`:root` ~18), тёмная `#121214` (`.dark` ~81).
- Тема — класс `.dark` на `<html>`, ставит только `applyTheme` (`src/lib/palette.ts` ~60); выбор
  `auto | light | dark` — `src/lib/theme.ts` (`setThemeChoice`, `watchSystemTheme`, `applyCurrentPalette`, ключ
  `ff_theme`); `src/main.ts` ~11 зовёт до монтирования.
- Гварды: `e2e/pwa-build.test.ts` ~21 сверяет манифест (`theme_color '#B4562F'`), ~54–59 — «заливка иконки =
  `theme_color`»; `src/style.tokens.test.ts` — токены в обеих темах; `src/lib/theme.test.ts`, `palette.test.ts`.

## Задача

1. `index.html`: два мета-тега `theme-color` с `media="(prefers-color-scheme: light)"` / `(… dark)` и значениями
   `--canvas` светлой и тёмной темы — строка верна до загрузки JS.
2. При выборе темы вручную (не «авто») — цвет строки следует выбранной теме: `applyTheme` (единственное место,
   где тема попадает в DOM) выставляет `content` мета-тегов из вычисленного `--canvas` (не литералом в TS —
   правило 6 CLAUDE.md: цвет из токена). Смена системной темы под «авто» — тоже.
3. Манифест: `theme_color` = светлый `--canvas` (`#F2F2F0`, как `background_color`) — заставка и строка
   установленной PWA до загрузки не коричневые.
4. iPhone в режиме PWA: проверить, что строка берёт `theme-color`; если нет — добавить
   `apple-mobile-web-app-status-bar-style` с минимальным значением, при котором строка в цвет фона в обеих темах
   (`black-translucent` — только если контент уже уважает `safe-area-inset-top`; иначе `default`). Решение и
   причину — в Handoff.
5. Гвард «заливка иконки = `theme_color`» переписать по смыслу: иконка — цвет бренда (`--brand` светлой темы
   из `style.css`), строка — цвет фона.

## Тесты

- `e2e/pwa-build.test.ts`: манифест — `theme_color` = `background_color` = светлый `--canvas`; иконка = `--brand`.
- `src/lib/palette.test.ts` (или `theme.test.ts`, где живёт `applyTheme`): после `applyTheme` светлой / тёмной /
  авто мета-теги несут `--canvas` своей темы (jsdom: значения токенов подставить так же, как соседние тесты).
- Гвард: в `index.html` и `vite.config.ts` нет `#B4562F` (бренд живёт в `style.css` и иконке).

## Критерии приёмки

- На iPhone владельца (Safari и установленная PWA) строка сверху — цвет фона экрана в светлой и тёмной теме,
  при «авто» меняется вместе с системной; на Android Chrome — то же.
- `cd frontend && npm run build && npm test` зелёные (с `e2e/pwa-build` после сборки); CI ✅.

## Вне скоупа

- Цвет бренда, иконка, сплэш-скриншоты — без изменений.
- Шапки экранов и прозрачность под строкой — не трогаем (только если п. 4 потребует `safe-area`, и тогда —
  запись в Handoff, а не переделка шапок).
