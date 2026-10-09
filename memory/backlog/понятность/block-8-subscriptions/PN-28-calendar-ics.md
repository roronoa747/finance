# PN-28 — «В календарь»: платежи и дни зарплаты файлом .ics (фронт)

Блок 8 · MVP · Репо/каталог: `frontend/src/lib/calendar.ts`, `lib/calendar.test.ts`, `components/money/CapitalLists.vue` · Зависит от: PN-27 · Роли: member, viewer (файл на своё устройство)

## Контекст (что уже есть)

- Данные: `liveObligations` (не группы, :734), `Obligation.day`, `every` (`month | year`), `month` (1–12 у годовых),
  `amountIn(o, key)` (:807 — сумма и валюта версии), `isSubscription`, `isPeoplePayment`; кредиты `openCredits` (:748),
  `Credit.day`, `payment`, `name`; участники — `payEvents(p, key)` (PN-22: события зарплаты по ритму: день, вид).
- Скачивание файла на устройство — образец `shareStory(blob, { title, fileName }, nav?)` (`lib/storyCard.ts:206-223`:
  Web Share с файлами, если `navigator.canShare({ files })`, иначе `downloadBlob` :226 `<a download>`). Вынести общий
  `shareFile(blob, { title, fileName })` в `lib/share.ts` и использовать в обоих местах (один механизм).
- iOS Safari/PWA: `.ics` открывается в «Календаре» («Добавить все»); через системный лист — «Календарь». Android —
  Google Calendar импортирует файл. Серверной подписки (webcal) нет — файл одноразовый, обновлять — заново.
- Р-7: «платежи и день зарплаты — файлом .ics в календарь телефона; напоминания без пуша до Блока 5 B2C».
  Правило 12: действие у предмета — у списка платежей.

## Задача

1. **`lib/calendar.ts`** (чистые функции, тесты в Node): `calendarEvents(state, now) → CalEvent[]`:
   - платёж месячный: `RRULE:FREQ=MONTHLY;BYMONTHDAY=<day>` (`day > 28` → `BYMONTHDAY=-1` — последний день);
     годовой: `FREQ=YEARLY;BYMONTH=<month>;BYMONTHDAY=<day>`; кредит — месячный по `Credit.day`; зарплата — по ритму:
     `month` → `BYMONTHDAY=payday`, `advance` → два события, `week` → `FREQ=WEEKLY;BYDAY=<MO…SU>`;
   - `SUMMARY`: «Аренда · 150 000 ₸» / «Kaspi кредит · 85 000 ₸» / «Зарплата · Ильяс» (сумму зарплаты не писать —
     чужой календарь); `DESCRIPTION` «Family Finance»; события на весь день (`DTSTART;VALUE=DATE` — ближайшая дата
     от `now`), `UID` стабильный `ff-<id>@family-finance`, `DTSTAMP`, `VALARM` DISPLAY `TRIGGER:PT9H` (9:00 в день
     платежа — напоминание без пуша);
   - **`icsText(events) → string`**: `BEGIN:VCALENDAR … PRODID:-//Family Finance//RU`, CRLF, экранирование `, ; \n \`,
     сворачивание строк по 75 октетов (RFC 5545 3.1).
2. `CapitalLists.vue`: у заголовка «Платежи» — тихая кнопка «В календарь» (`Button variant="ghost" size="sm"`,
   `data-calendar`): `shareFile(new Blob([icsText(calendarEvents(...))], { type: 'text/calendar' }), { title:
   'Платежи · Family Finance', fileName: 'family-finance.ics' })`; после — строка «Открыть в календаре — «Добавить
   все»» (`--ink-2`, 4 с). Viewer тоже (ничего не пишет).
3. `DESIGN.md` — «Капитал → Платежи»: фраза про «В календарь».

## Тесты

- `lib/calendar.test.ts`: месячный/годовой/31-е/кредит/зарплата трёх ритмов — ожидаемые `RRULE`; `UID` стабилен между
  вызовами; экранирование и сворачивание (строка > 75 октетов с кириллицей — по октетам, не символам); нет сумм
  зарплаты; `VALARM` есть; результат парсится простым разбором на `BEGIN/END` пары.
- `CapitalLists.test.ts`/DOM: кнопка зовёт `shareFile` с `text/calendar` и именем файла.

## Критерии приёмки

- Критерий брифа: платёж появляется в календаре телефона (смоук владельца на iPhone: файл → «Календарь» → «Добавить
  все», напоминание в 9:00). `cd frontend && npm run build && npx vitest run` зелёные; на стенде скачанный `.ics`
  открывается в Google Calendar/Outlook без ошибок.

## Вне скоупа

- Подписка-календарь (webcal, сервер) — нет. Пуш — Блок 5 B2C. Обновление календаря при смене сумм — заново файлом.
