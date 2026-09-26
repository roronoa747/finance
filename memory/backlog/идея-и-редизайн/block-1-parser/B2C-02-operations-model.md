# B2C-02 — Модель операций: типы, отпечаток, словарь, правила, внутренние переводы (фронт)

Блок 1 · MVP · Каталог: `frontend/src/lib/statements/`, `types/finance.ts`, `lib/merge.ts`, `lib/dates.ts`, `stores/finance.ts` · Зависит от: B2C-01 (`CORPUS.md`) · Роли: member (правила), viewer (видит итоги)

## Контекст (что уже есть)

- Р-5 (операции личные; итоги по категориям в общем документе; внутренние переводы; отпечаток),
  Р-21 (таблицы операций, записи `spendTotals`), Р-22 (разделы трат `spendCategories` в общем
  документе, стартовый словарь — данные в коде, память семьи `merchantRules` — в личном
  документе), Р-23 (нет цифр 6+ и ФИО).
- Разделы бюджета `d1…d5` (`CategoryKey`, `DEFAULT_CATEGORY_NAMES` в `lib/palette.ts`) — это
  доли планирования (Жильё, Кредиты, …), **не** разделы трат; новые разделы трат — отдельный
  список, с ними не смешивать.
- Документ: §6 «Правило для новых данных» — новый список верхнего уровня: тип `SyncDoc` →
  `defaultSyncDoc()` (`stores/finance.ts`) → явно в `known` `mergeDocs` (`lib/merge.ts`,
  `mergeList` по id, `Tracked`). Личный документ — `privateDoc: Record<string, unknown>`
  (`accounts`); его слияние — B2C-05 (список `merchantRules` там объединяется по id).
- Время: `lib/dates.ts` — `today()`, `monthKey()` по Алматы (UTC+5). ISO-недели нет.
- Деньги — целые тенге (`amount` в тенге, тиын отбрасываются при разборе — Р-19).

## Задача

1. Типы `lib/statements/types.ts`:
   - `BankId = 'kaspi' | 'freedom'`; `OperationKind = 'purchase' | 'transfer-out' |
     'transfer-in' | 'income' | 'cash' | 'fee' | 'other'`.
   - `Operation = { id; bank; date: 'YYYY-MM-DD'; amount: number /* целые тенге, минус —
     списание */; kind; merchant: string /* как печатает банк, очищено */; counterparty?: string
     /* имя и инициал у переводов людям */; note?: string; categoryId: string | null;
     internal: boolean; uploadId?: string }`.
   - `SpendCategory = Tracked & { id; name; hue: HueKey; order: number }`;
     `MerchantRule = Tracked & { id; match: { merchant?: string; counterparty?: string } /* нормализованные */;
     to: { categoryId: string } | { internal: true } | { person: string /* «кому → что» */ }; by: PersonId }`;
     `SpendTotal = Tracked & { id /* `${by}:${kind}:${period}:${categoryId}` */; by: PersonId;
     kind: 'week' | 'month'; period: string; categoryId: string /* или '_unknown' */; amount:
     number /* > 0, сумма списаний */; ops: number }`.
   - `ParsedStatement = { bank; from: string; to: string; operations: Operation[] }`.
2. `sanitize(text)`: убрать последовательности из 6+ цифр, схлопнуть пробелы, обрезать до 120
   символов; `normalizeMerchant(raw)`: `sanitize` + нижний регистр + убрать хвосты города/страны
   («ALMATY KZ», «KAZ»), терминалы, множественные точки. Правила — данные в модуле, с тестами.
3. `fingerprint({ bank, date, amount, merchant }, ordinal)` → hex-строка стабильного хеша
   (cyrb53 или FNV-1a, без зависимостей) от `bank|date|amount|normalizeMerchant(merchant)|ordinal`,
   где `ordinal` — порядковый номер одинаковых операций того же дня в той же выписке (две одинаковые
   покупки в день — разные id; повторная загрузка того же периода — те же id).
4. Словарь `lib/statements/dictionary.ts` (данные): `DEFAULT_SPEND_CATEGORIES` (продукты; кафе и
   рестораны; транспорт; связь и интернет; подписки; здоровье и аптеки; дом и быт; одежда и
   покупки; развлечения; переводы людям; кредиты и рассрочки; коммуналка; образование;
   путешествия; наличные; комиссии; прочее — id вида `sc_food`, оттенки из `HUES`) и
   `DICTIONARY: { test: RegExp; categoryId }[]` для типичных продавцов Казахстана (Magnum, Small,
   Galmart, Arbuz, Wolt, Glovo, Yandex Go, inDrive, Beeline, Kcell, Tele2, Activ, Netflix, Spotify,
   Яндекс Плюс, ivi, Kaspi Red/рассрочка, Onay, аптеки, АЗС и т.д. — расширить по `CORPUS.md`).
5. `categorize(op, rules, dictionary)` → `{ categoryId | null, internal, personLabel? }`: приоритет —
   правило семьи по `counterparty` → правило по `merchant` → словарь → `null` (незнакомое).
   `applyRules(ops, rules)` — пересчёт всех операций после нового правила.
6. Внутренние переводы: `pairInternalTransfers(ops)` — пары `transfer-out` / `transfer-in` одного
   человека с равной суммой и датой ±1 день (между своими банками) → обе `internal`; переводы
   партнёру — правило `{ internal: true }` по `counterparty` (предлагается автоматически, если
   `counterparty` совпадает с именем участника из `people` — точное совпадение первой части);
   поступления от партнёра — так же.
7. `weekKey(date)` → `YYYY-Www` (ISO-неделя, понедельник, по Алмати) и `weekRange(key)` в
   `lib/dates.ts`; `spendTotals(ops, by, kind, period)` → `SpendTotal[]` (только `amount < 0`,
   не `internal`, по `categoryId` или `_unknown`; суммы положительные, целые).
8. Документ: `SyncDoc.spendCategories?: SpendCategory[]`, `SyncDoc.spendTotals?: SpendTotal[]`;
   `defaultSyncDoc()`; `mergeDocs` `known` — оба `mergeList` по id; `seedSpendCategories(doc)` —
   если списка нет, записать `DEFAULT_SPEND_CATEGORIES` (зовётся при первой загрузке, B2C-07).
   Личный документ: `privateDoc.merchantRules?: MerchantRule[]` — геттер и `addMerchantRule` /
   `removeMerchantRule` в сторе через `mutatePrivateDoc`.

## Тесты

- `lib/statements/model.test.ts`: `fingerprint` стабилен и различает `ordinal`; `sanitize` режет
  6+ цифр и не трогает 5; `normalizeMerchant` («MAGNUM ALMATY KZ» и «Magnum» → одно);
  `categorize` — приоритет правил над словарём, `_unknown`; `pairInternalTransfers` — пара
  ±1 день, разные суммы не пара, одна операция не в две пары; `spendTotals` исключает `internal`
  и приходы, сумма по категориям = сумма списаний.
- `lib/dates.test.ts` (новый или рядом): `weekKey` на границах года и недели по Алматы
  (`vi.setSystemTime`), `weekRange`.
- `lib/merge.test.ts`: `spendCategories`/`spendTotals` сливаются по id, надгробие побеждает,
  старый документ без ключей не ломается; `defaultSyncDoc()` содержит оба ключа.

## Критерии приёмки

- `cd frontend && npm run build && npm test` зелёные; ни один экран не тронут.
- Чистые функции не импортируют стор и Vue; деньги — целые.

## Вне скоупа

- Разбор файлов — B2C-03/04; слияние личного документа — B2C-05; сервер — B2C-06; UI — B2C-07.
- Правка названий и цветов разделов трат в интерфейсе — Блок 3 (B2C-21).
