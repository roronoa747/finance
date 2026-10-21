# FB-08 — «Разовая» в листах: чип в `OpSheet`, переключатель в «Трата», пометка в ленте и листах (фронт)

Блок 2 · MVP · Каталог: `frontend/src/components/OpSheet.vue`, `components/week/HandSpendSheet.vue`, `components/week/WeekFeedSheet.vue`, `components/week/SectionSheet.vue`, `components/money/SpendCategorySheet.vue`, `components/kit/OpRow.vue`, `lib/finance.ts` (`weekFeed`, `sectionWeek`, `sectionMonth`) · Зависит от: FB-07 · Роли: member

## Контекст (что уже есть)

- Р-5, Р-16 (§2); правило 12. `OpSheet` (Блок 1): ряд тихих чипов под чипами раздела — «Мне вернули»; `editOp(id, {oneOff})`.
- «Трата» — `HandSpendSheet.vue`: поля «Сколько», «Раздел», «Что или где», «Когда», «Сохранить»; `useFormCheck`; у ручной
  правки `oneOff` живут в `opEdits` по её id (FB-02 п. 6).
- Строки: `OpRow` (`kit/OpRow.vue`: продавец, раздел точкой, сумма, значок телефона), лист раздела «Недели»/«Месяца»
  (`SectionSheet`, `SpendCategorySheet` после FB-05), `WeekFeedOp`/`sectionWeek`/`sectionMonth` — строки с `hand`, `refund`.

## Задача

1. `OpSheet`: чип «Разовая» рядом с «Мне вернули» (`on` при `oneOff`), нажатие — `editOp(id, {oneOff: !oneOff})`; подпись
   не нужна — при включённом чипе строка «не входит в обычные» одной строкой `type-meta` под чипами (решает `/ux`: можно
   убрать).
2. «Трата»: под «Когда» — `Toggle` «Разовая» (tone ok, `data-hand-oneoff`); при правке — текущее значение; «Сохранить» →
   `saveHand` + `editOp(id, {oneOff})` (одной операцией стора — `saveHand(op, {oneOff})`).
3. Пометка в строках: `WeekFeedOp.oneOff`, `sectionWeek`/`sectionMonth` строки `oneOff` → `OpRow`/строки листов — короткая
   метка «разовая» (`type-meta`, `--ink-2`) после имени; телефонный значок — как был.
4. «Неделя»: ничего нового (Р-16) — сумма и строки с разовыми.

## Тесты

- `components/OpSheet.dom.test.ts`: чип → `editOp({oneOff: true})` → `on`; повторно — снимает.
- `views/Week.hand.dom.test.ts`: «Трата» с «Разовая» → `opEdits` с флагом; правка показывает включённым; снятие.
- `views/Week.dom.test.ts`: метка «разовая» в ленте и листе раздела.
- Мутант: `saveHand` теряет `oneOff` при правке.

## Критерии приёмки

- «Разовая» ставится в два нажатия из любой своей траты и в форме «Трата»; видна меткой в ленте и листах; «Месяц» показывает
  её в «Разовые» (FB-07). Правило 12: чип тихий, у предмета; `Toggle` — в форме, без новых кнопок.
- `cd frontend && npm run build && npx vitest run` зелёные; стенд 390 px, обе темы.

## Вне скоупа

- Массовая отметка; «Разовая» у партнёра; автодогадка «это разовая» (идея для Блока 4).
