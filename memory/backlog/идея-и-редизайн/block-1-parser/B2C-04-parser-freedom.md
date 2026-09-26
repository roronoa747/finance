# B2C-04 — Парсер Freedom (фронт)

Блок 1 · MVP · Каталог: `frontend/src/lib/statements/parsers/` (+ `lib/statements/xlsx.ts`, если формат xlsx) · Зависит от: B2C-02 (и B2C-03 — реестр) · Роли: —

## Контекст (что уже есть)

- `CORPUS.md` (B2C-01) — фактический формат выписки Freedom (Freedom Bank / Freedom Finance):
  PDF или xlsx, шапка, колонки, форматы. **Формат брать оттуда.**
- Р-4: «Excel — если такой формат окажется в корпусе». Зависимости для xlsx в репо нет; ТЗ
  разрешает **одну** библиотеку чтения xlsx (`xlsx` (SheetJS) или `exceljs` — выбор исполнителя с
  обоснованием в Handoff: размер чанка, чтение в браузере из `ArrayBuffer`, работа в Node для
  тестов), подключается ленивым чанком, как pdf.js.
- Реестр парсеров и образец — B2C-03 (`parsers/kaspi.ts`, `parsers/index.ts`); модель — B2C-02.
- Фикстуры — `lib/statements/fixtures/freedom-NN.rows.json` (для xlsx — строки листа в том же
  виде `cells[]`, снятые скриптом B2C-01, дополненным чтением xlsx в этой задаче).

## Задача

1. Если формат xlsx: `lib/statements/xlsx.ts` — `xlsxToRows(data: ArrayBuffer): Promise<PdfRow[]>`
   (тот же тип строк: `page` = лист, `y` = номер строки, `cells` по колонкам), ленивый импорт
   библиотеки; скрипт `statement-rows.mjs` (B2C-01) учится читать xlsx.
2. `parsers/freedom.ts`: `isFreedom(rows)`, `parseFreedom(rows): ParsedStatement` — по тем же
   правилам, что Kaspi (период, колонки по заголовку, дата, сумма в целых тенге со знаком, вид
   операции, `merchant` / `counterparty` / `note`, `fingerprint` с `ordinal`, `sanitize`,
   `skipped`, ошибки `StatementFormatError`). Особенности Freedom (валютные операции, если есть;
   комиссии отдельной строкой; переводы между своими счетами) — по `CORPUS.md`; валюта не тенге
   → операция с `note` о валюте и суммой в тенге по строке выписки, если банк её печатает, иначе
   `skipped` с причиной (валюты кроме тенге — не-скоуп).
3. Реестр: `detectBank` различает Kaspi и Freedom; неизвестный файл → `null`.

## Тесты

- `parsers/freedom.test.ts` на всех фикстурах Freedom — как в B2C-03 (количество, период,
  проверенные строки, суммы по видам, идемпотентность, гвард цифр).
- `xlsx.test.ts` (если xlsx): чтение маленького синтетического файла из тестовых данных
  (сгенерировать той же библиотекой в тесте) → строки.
- `parsers/index.test.ts`: Kaspi-фикстура → `kaspi`, Freedom → `freedom`, пустые строки → `null`.

## Критерии приёмки

- `cd frontend && npm run build && npm test` зелёные; библиотека xlsx (если добавлена) — в
  отдельном чанке, не в главном.
- Прогон по всему корпусу Freedom локально: число операций против итога банка, `skipped`
  объяснён; в Handoff.

## Вне скоупа

- Категории — B2C-07. Валюты кроме тенге — не-скоуп брифа.
