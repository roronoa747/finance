# RZ-11 — ✦ на мечтах, экране цели и долгах (фронт)

Блок 3 · MVP · Каталог: `frontend/src/views/Dreams.vue`, `components/kit/DreamCenter.vue`, `components/kit/ThumbRow.vue`,
`views/GoalDetail.vue`, `components/money/DebtsWidget.vue` · Зависит от: RZ-10 · Роли: member, viewer, партнёр, демо

## Контекст (что уже есть)

- RZ-10: `useAiStore().markFor(kind, id)`, `components/ai/AdviceMark.vue` (проп `n`).
- «Мечты» — `views/Dreams.vue`: герой `DreamCenter` :146 (главная мечта; пропы — grep `defineProps` в
  `kit/DreamCenter.vue`), строки остальных — `ThumbRow` :186 (внутри `SortableList`, пропы `title, src, tone, clickable,
  index, fit, divided`; слоты — grep `<slot`), ещё одна `ThumbRow` :235 (желания/собранные). Экран цели —
  `views/GoalDetail.vue`: карточка срока (`term` :144, `doneMonth` :148; разметка — grep `data-goal-term` / «Будет вашей»),
  метка сдвига мечты (`shiftLabel`, DreamShift — grep `data-dream-shift`). «Долги» — `components/money/DebtsWidget.vue`:
  строки кредитов :100-101 (`r.creditId`, название — grep `r.name`), подпись «первым — …» :93.
- Р-23: ✦ после названия / у срока, отдельной кнопкой, `@click.stop`; viewer видит.

## Задача

1. `ThumbRow` — слот `after-title` (или проп `mark`) → `AdviceMark` после названия; `Dreams.vue` передаёт `markFor('goal',
   id)` строкам мечт (не желаниям). `DreamCenter` — ✦ рядом с названием главной мечты (проп `mark`), не перекрывая фото и
   крупную цифру.
2. `GoalDetail.vue` — ✦ у карточки срока (рядом с заголовком срока / меткой сдвига), `markFor('goal', goal.id)`.
3. `DebtsWidget.vue` — ✦ после названия в строке кредита (`markFor('credit', r.creditId)`); карточка долга очереди
   (`prepay`) — тот же кредит.
4. Геометрия: ✦ не меняет высоту строк и не сдвигает крупные цифры (снимки до/после в Handoff).

## Тесты

- `Dreams.*.dom.test.ts`: ✦ у мечты из совета (герой и строка), у желания — нет; нажатие → отчёт с `card`, строка не
  открылась. `GoalDetail.term.dom.test.ts`: ✦ у срока при совете, без совета — нет. `DebtsWidget`-тест (grep
  `data-debts` в `*.dom.test.ts`): ✦ у кредита из совета `prepay`/`open credit`.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные.
- Браузер 390, обе темы, member / viewer / демо: ✦ у мечты (герой, строка, экран цели) и у долга из советов; нажатие
  открывает отчёт на карточке совета; высота строк и крупные цифры без сдвигов.

## Вне скоупа

- e2e и доки — RZ-12. ✦ на «Неделе» и в желаниях — нет.
