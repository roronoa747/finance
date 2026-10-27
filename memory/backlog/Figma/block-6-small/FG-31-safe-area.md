# FG-31 — iPhone: обложка «Мечт» под строкой статуса, шапка на фото ниже выреза, панель над жестом (safe-area) (фронт)

Блок 6 · MVP · Репо/каталог: `frontend/src`, `frontend/index.html` · Зависит от: — · Роли: все; PWA на iPhone

Находка владельца **со скрина настоящего iPhone** (PWA, прод после Блока 4, 2026-10-27): на «Мечтах» с обложкой под строкой
статуса — светлая размытая полоса, фото начинается ниже неё, а шапка на фото («Мечты» + аватары + шестерёнка) **не видна вовсе**
(под строкой статуса). Причина — приложение не объявляет `viewport-fit=cover` и не учитывает `env(safe-area-inset-*)`
(отложенный хвост **FG-Х1**, Блок 1); обложка `DreamHero size="cover"` рисует шапку в своих верхних 12 px — ровно там, где у
iPhone строка статуса. **Решение владельца (через оркестратора):** обложка уходит под строку статуса, шапка на фото — ниже
выреза (отступ `safe-area-inset-top`), без светлой полосы; нижняя панель — тем же механизмом (`safe-area-inset-bottom`).
Судьба FG-Х1 → эта задача (целиком: верх и низ — один механизм `env()`). Режим блока M; задача — вид, `/ux` смотрит.

## Контекст (что уже есть)

Пути — от `frontend/`; `main` `19f46bff`.

- **`index.html`** `:6` — `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` (без `viewport-fit=cover` →
  `env(safe-area-inset-*)` = 0 на iPhone); `:8-9` `theme-color` по теме (светлая `#f2f2f0`, тёмная `#121214`; дальше ведёт
  `applyTheme`, `src/lib/theme.ts`, тест `lib/theme.test.ts` читает оба мета-тега); `:10` `apple-mobile-web-app-capable`; тега
  `apple-mobile-web-app-status-bar-style` **нет** (iOS рисует строку статуса своей полосой над контентом — та самая «светлая размытая»).
- **Оболочка** — `src/components/AppShell.vue`: корень `h-dvh … overflow-hidden bg-canvas` `:189-191`; шапка `<header v-if="!heroHeader"
  … px-5 pb-2 pt-4 data-shell-header>` `:192`; `<main … px-4 [overscroll-behavior:contain] pb-24 | pb-6>` `:218` (запас под капсулу);
  тосты `#shell-toast` `bottom-[84px] | bottom-4` `:229`; капсула `Tabs` `:231` → `src/components/kit/Tabs.vue` `<nav class="absolute
  inset-x-0 bottom-0 … px-4 pb-2 pt-2.5">` `:29`, плашка `h-[58px]` `:30`. `noTabs` `:97`.
- **Шапка на фото** — `src/views/Dreams.vue` `:159-183`: `<DreamHero size="cover" class="-mx-4 -mt-1" …>` с `#top` → `<header>` («Мечты»
  25 + `ShellPeople`); флаг `useShellHero` `:98` (оболочка свою шапку не рисует). `src/components/kit/DreamHero.vue`: слот `top` —
  `<div class="absolute inset-x-0 top-0 z-10 px-4 pt-3">` `:58`; полоса читаемости сверху `photo-scrim-top` `h-28` (с `top`) / `h-14
  opacity-60` `:50-56`; подпись автора `top-[62px] | top-3` `:60`; высота `cover` `min-h-[480px] rounded-b-hero` `:33`.
- **Уже с `env()`** (образец записи в Tailwind): `src/views/Start.vue:207` — `pt-[max(24px,calc(env(safe-area-inset-top)_+_8px))]`
  (FG-09; без `viewport-fit=cover` не работает — об этом хвост FG-Х1), `ai/AiReport.vue:569, :604`, `goals/ThemePhotoViewer.vue:58`
  (`pb-[max(28px,env(safe-area-inset-bottom))]`).
- **Листы** — `src/components/kit/Sheet.vue:300`: панель `rounded-t-[28px] … px-5 pb-9 pt-5 … sm:pb-5` (снизу 36 px; на iPhone с жестом —
  должна учитывать `safe-area-inset-bottom`); логика клавиатуры по `visualViewport` `:205` — не трогать.
- **Эмуляция на стенде** (приёмка Блока 1, `block-1-pack-1/SESSION.md:314-316`): Chrome `playwright-core` `channel: 'chrome'`, iPhone
  390 × 844 DPR 3, вырез через CDP **`Emulation.setSafeAreaInsetsOverride`** (верх 59 px, низ 34 px) — `env()` отдаёт значения только при
  `viewport-fit=cover`; формула `max(24, inset + 8)` проверялась так.
- **Тесты**: `components/AppShell.hero.dom.test.ts` (шапка на обложке, `[data-shell-header]` нет), `AppShell.test.ts` (SSR, классы),
  `kit/kit-b2c.test.ts` (`DreamHero`: полоса сверху есть с фото), `kit/Tabs.dom.test.ts`, `lib/theme.test.ts` (читает `index.html`).

## Задача

1. **`index.html`:** viewport → `width=device-width, initial-scale=1.0, viewport-fit=cover`; добавить
   `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />` — контент PWA уходит под строку статуса, своей
   полосы iOS не рисует. `theme-color` оставить (вкладка Safari/Android). Комментарий одной строкой: зачем и что отступы берёт `env()`.
2. **Верх:** шапка оболочки `AppShell` — `pt-4` → `pt-[max(16px,calc(env(safe-area-inset-top)_+_8px))]`; слот `top` обложки
   `DreamHero` — `pt-3` → `pt-[max(12px,calc(env(safe-area-inset-top)_+_8px))]`, полоса `photo-scrim-top` с `top` —
   `h-[calc(112px+env(safe-area-inset-top))]`, подпись автора при `top` — `top-[calc(62px+env(safe-area-inset-top))]`; обложка
   по-прежнему от самого верха (`-mt-1`, `-mx-4`) — фото под строкой статуса, «Мечты» и аватары под вырезом. Без `top` (экран цели,
   превью) — отступы прежние. Экраны без оболочки, у которых свой верх (`Start` — уже; лэндинг `Landing`, `/access` — проверить на
   стенде с вырезом: заголовок не под строкой статуса; у кого `pt-*` фиксированный — та же формула `max(…, env + 8px)`).
3. **Низ:** `Tabs` `pb-2` → `pb-[max(8px,env(safe-area-inset-bottom))]` (плашка 58 над индикатором жеста); `main` `pb-24` →
   `pb-[calc(96px+env(safe-area-inset-bottom))]`, `pb-6` → `pb-[max(24px,env(safe-area-inset-bottom))]`; тосты `bottom-[84px]` →
   `bottom-[calc(84px+env(safe-area-inset-bottom))]`, `bottom-4` → `bottom-[max(16px,env(safe-area-inset-bottom))]`; `Sheet` панель
   `pb-9` → `pb-[max(36px,calc(env(safe-area-inset-bottom)_+_20px))]` (`sm:pb-5` как было). Горизонтальные `inset` не трогаем (вырезов
   по бокам в портрете нет; альбом не поддерживаем).
4. **Проверка на стенде-обёртке** (как приёмка Блока 1): Chrome 390 × 844 с `setSafeAreaInsetsOverride` {top 59, bottom 34} и без
   (0/0 — как Android/десктоп: ничего не сдвинулось), обе темы: «Мечты» с обложкой — фото от y 0, «Мечты»/аватары/шестерёнка с y ≈ 67
   видны целиком, светлой полосы нет; «План», цель — шапка оболочки с y ≈ 67; капсула вкладок над полосой 34; лист «+» — кнопки не
   под жестом; «Тратьте как обычно» — «Пропустить» как в FG-09 (теперь включается). Снимки — в Handoff (без данных семьи).
5. **Риск — цвет текста строки статуса:** с `black-translucent` iOS сам рисует часы/батарею поверх контента; на новых iOS (стеклянная
   строка статуса) цвет подстраивается под фон, на старых может быть белым на светлом холсте «Плана». В Chrome не проверить — только
   смоук владельца на телефоне (вопрос «да?» приёмки называет это явно: «после установки обновления посмотрите часы на «Плане» в
   светлой теме»). Нечитаемо → откат одной строкой: убрать `black-translucent` (контент снова под полосой iOS, обложка ниже неё,
   шапка на фото уже под вырезом не прячется — п. 2 остаётся полезным). Пометка в Handoff.
6. `DESIGN.md` — §5 «Оболочка»: одна строка про `viewport-fit=cover` и `env(safe-area-inset-*)` (шапка, обложка, капсула, листы).

## Тесты

- `lib/theme.test.ts` (уже читает `index.html`) или новый `index.test.ts`: viewport содержит `viewport-fit=cover`, есть
  `apple-mobile-web-app-status-bar-style` = `black-translucent`.
- `components/AppShell.test.ts` (SSR): класс `[data-shell-header]` содержит `env(safe-area-inset-top)`; `main` и `#shell-toast` —
  `env(safe-area-inset-bottom)`; `kit/Tabs.dom.test.ts` — у `nav` `env(safe-area-inset-bottom)`; `kit/kit-b2c.test.ts` — у слота `top`
  `DreamHero` (`cover` с `#top`) `env(safe-area-inset-top)`, у `data-hero-top-scrim` — `calc(112px+env(…))`; без `#top` — `pt-3`/`top-3`
  как были; `Sheet` — панель с `env(safe-area-inset-bottom)` (SSR-тест кита).
- e2e `fg-block6-small.test.ts`: «Мечты» с обложкой — `header` внутри `[data-dreams-cover]` один, класс с `safe-area-inset-top`;
  `[data-shell-header]` нет; переход на «План» — шапка оболочки с тем же `env()`.
- Мутанты (откат копией): (1) `pt-3` у слота `top` (как было) → `kit-b2c` красный; (2) viewport без `viewport-fit=cover` → тест
  `index.html` красный.
- **Реальная среда** — п. 4 стенда (Chrome с `setSafeAreaInsetsOverride`), скрипт — в scratchpad, числа — в Handoff.

## Критерии приёмки

- Стенд-обёртка Chrome 390 × 844, вырез 59/34, обе темы, демо и своя семья: «Мечты» — фото от верхнего края, шапка на фото ниже
  выреза и видна целиком, полосы нет; экраны с шапкой оболочки — заголовок с y ≈ 67; капсула и листы над полосой жеста; с вырезом 0 —
  пиксель в пиксель как до задачи (сравнить снимок «до» с `main`). Десктопная рамка `md:` не изменилась.
- Смоук владельца на iPhone после деплоя (закрыть PWA и открыть заново; при необходимости — переустановить с главного экрана, iOS
  кеширует мета-теги): обложка под строкой статуса, шапка видна, часы читаемы на «Плане» в светлой теме.
- `cd frontend && npm run build && npx vitest run` зелёные; бэкенд не тронут.

## Вне скоупа

- Альбомная ориентация, боковые `safe-area-inset-left/right` — нет.
- Полноценная липкая/плавающая шапка на обложке при прокрутке — нет (не просили).
- Цвет строки статуса под тему через отдельные мета-теги/`color-scheme` — только если смоук владельца покажет нечитаемость (тогда
  хвост с вариантами, не правка вслепую).
- Магазины и нативная оболочка — бриф iOS (FG-Х1 из его списка снимается: закрыт этой задачей).
