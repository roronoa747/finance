# B2C-12 — Токены, шрифты и кит по `DESIGN.md` (фронт)

Блок 3 · MVP · Каталог: `frontend/src/style.css`, `frontend/index.html`, `components/kit/*`, `lib/palette.ts` · Зависит от: Блок 2 🏁 (`DESIGN.md` §4–§5) · Роли: —

## Контекст (что уже есть)

- Спецификация — `../block-2-design/DESIGN.md` §4 (токены, типографика) и §5 (компоненты →
  кит). Р-19: цвет только из токенов; каждый токен — в `:root` и `.dark`.
- `frontend/src/style.css`: `@import 'tailwindcss'`, `@custom-variant dark (&:is(.dark *))`,
  `:root { --canvas … --scrim; --background … --radius }`, `.dark { … }`, `@theme inline`
  (классы `bg-surface`, `text-ink-2`, `border-line`, …). Тема/акцент/цвета разделов —
  `lib/palette.ts` (`applyTheme({ theme, accent, categories })` ставит `--brand*`, `--d1..d5`;
  `HUES`, `ACCENTS`), `lib/theme.ts` (`applyCurrentPalette`, `ff_theme`, `ff_accent`,
  `ff_category_hues`). Шрифты — `frontend/index.html` (Google Fonts Onest, Golos Text; классы
  `font-display`).
- Кит `components/kit/*`: Callout, Card, DangerZone, Field (`group`), Hero, Hint, NumField,
  NumFieldBlur, Row (слоты `action`, `note`), SavedMark, Section, Segmented, Select, Sheet
  (слот отдаёт `close`, стек, ловушка фокуса, `--scrim`), Stat, Tag, `useSavedMark`;
  `components/ui/Button.vue`, `Input.vue` (shadcn-vue). Тесты кита — SSR `*.test.ts` и DOM
  `*.dom.test.ts` (happy-dom).
- Существующие экраны продолжают работать на старых именах токенов до своих задач — переименовывать
  токены нельзя, только менять значения и добавлять новые.

## Задача

1. Токены: значения из `DESIGN.md` §4 в `:root` и `.dark` (пары обязательны), новые токены —
   в оба блока и в `@theme inline`; радиусы, тени; `HUES`/`ACCENTS` — под новую палитру, если
   §4 их меняет (цвета участников `--pa/--pb` и разделов `--d1..d5` — через `applyTheme`, как
   сейчас). `theme_color` манифеста и `<meta name="theme-color">` — под новый бренд.
2. Шрифты по §4 (Google Fonts, `preconnect` есть); классы типографики (крупные цифры, заголовки)
   — утилиты в `style.css` (`@utility` Tailwind 4) или классы кита, без инлайновых размеров в
   экранах.
3. Новые компоненты кита по §5 (имена — из `DESIGN.md`; ожидаемо: герой мечты с фото и
   процентом, полоса недели по разделам, карточка решения «да / нет / позже», плитка шаблона,
   строка операции, вкладки нижней навигации). Пропсы — данные, не расчёты (деньги считает
   `finance.ts`/`lib/statements`). Существующие компоненты меняют вид по §5, не ломая экраны.
4. Тест-гвард токенов `style.tokens.test.ts`: каждая переменная `--x` из `:root` есть в `.dark`
   и наоборот (читает `style.css` как текст).

## Тесты

- SSR-тесты новых компонентов (рендер пропсов, пустые состояния); DOM-тесты для интерактивных
  (карточка решения — три действия, клавиатура; вкладки — `aria-current`).
- Гвард токенов п. 4; существующие тесты кита зелёные.

## Критерии приёмки

- `cd frontend && npm run build && npm test` зелёные; в браузере (стенд, 390px) обе темы —
  существующие экраны читаемы на новых токенах (без белых пятен, контраст текста), новые
  компоненты показаны на любом экране (временно или через следующую задачу) — снимки обеих
  тем в Handoff.

## Вне скоупа

- Экраны и навигация — B2C-13…B2C-21. Удаление старых токенов — после переноса всех экранов
  (клинап блока по ревью).
