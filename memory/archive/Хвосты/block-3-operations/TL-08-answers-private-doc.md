# TL-08 — Ответы «Нет, это другое» и «Потом» — в личный документ (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/` · Зависит от: — · Роли: member (свои ответы; партнёр их не видит) · Х-2, Р-5

## Контекст (что уже есть)

- Ключи устройства — `src/lib/storage.ts:20-32` `OPERATIONS_STORAGE_KEYS`: `declined: 'ff_match_declined'` :29 (формат
  `<opId>|<kind>:<targetId>:<period>`; старые записи `<kind>:<targetId>:<period>` — пара на месяц), `deferred:
  'ff_decisions_deferred'` :31. «Потом» — 24 часа: `DEFER_MS` :35, `readDeferred(now)` :38-44, `writeDeferred(keys, now)`
  :47-52, форма `{[decisionKey]: untilIso}`.
- `src/lib/statements/matching.ts`: `declineKey(c)` :189 = `${opId}|${key(c)}`, `isDeclined(c, declined)` :192-197.
- `src/stores/operations.ts`: `declined` ref :156 (читается только у копии этого владельца — `fresh`), `declineMatch(c)`
  :258-265 (ключ → `save()` → `writeTotals`), `save()` :281-287, `clear()` :295, `openMatches` с `isDeclined` :183-187,
  перенос отказа с пуша на строку выписки :622-627.
- `src/views/Week.vue`: `deferred` ref :288, `groupKey` = `unknownGroup:<неделя>:<JSON match>` :289, `isDeferred` :290,
  запись «Потом» :327, `declineMatch` :422. Ключи и тексты — `decisionQueue` (`lib/finance.ts:5735-5823`: match — «Потом» /
  «Нет, это другое» :5809; пачка — `unknownBatch:<неделя>` :5778, :5814-5823); `UnknownBatch.vue:224` эмитит `later`.
- Личный документ — `src/stores/finance.ts`: `privateDoc` :225, `mutatePrivateDoc(mutator)` :1186-1193 (→ `saveLocalState`,
  `syncPrivate`), `syncPrivate` :738-750 / `sendPrivate` :752-779 (409 → слияние и повтор), `pullPrivateDoc` :703-731.
  Слияние — `src/lib/merge.ts:258-286` `mergePrivateDocs`: новый список = `name: list('name')` в `known` :275-284 + строка
  комментария :264-269; `mergeList` :52-77 — по `id`, новее `updatedAt` побеждает, удаление (`deletedAt`) побеждает всегда.
- Образец — заметки FB-20: тип `Note` `types/finance.ts:318`; стор finance.ts:2146-2186 (`notes` без `deletedAt`, `writeNote`
  через `mutatePrivateDoc`, `addNote`, `removeNote` с надгробием), экспорт :2621; тесты `lib/merge.test.ts:932` (форма пустого
  документа — добавить ключ), :946.
- «Нет» на «Это ваш доход?» — отдельный ключ `ff_start_answered` (storage.ts:8, Week.vue:298-301) — не в этой задаче.

## Задача

1. Новый список личного документа для ответов (имя на усмотрение, например `answers`): элемент `{id: <ключ отказа или
   решения>, kind: 'declined' | 'deferred', until?: iso, updatedAt, deletedAt?}`; добавить в `known` `mergePrivateDocs`.
2. `declineMatch` и «Потом» пишут туда через `mutatePrivateDoc`; `isDeclined`/`isDeferred` читают оттуда (истёкший
   `deferred` — как не записан; чистить — надгробием при следующей записи, без фоновых задач).
3. **Переезд (Р-5):** при первом синке личного документа на устройстве значения `ff_match_declined` и
   `ff_decisions_deferred` (живые) переносятся в документ, ключи устройства удаляются. Повтор безопасен (по `id`).
4. Перенос отказа с пуша на строку выписки (:622-627) работает с документом.
5. `clear()` при выходе не удаляет ответы из документа (они на сервере), только локальную копию — как у прочих списков.

## Тесты

- `src/lib/merge.test.ts`: новый список сливается по `id`, надгробие побеждает; пустой документ (:932) — с ключом.
- `src/stores/operations.question-once.test.ts` (FB-01 :124-165, сид хранилища :167) и `operations.test.ts:400`: ожидание
  `ff_match_declined` → ожидание записи в личном документе; переезд старых ключей при первом синке, ключи удалены; второй
  «телефон» (тот же документ) не спрашивает об операции.
- `src/views/Week.dom.test.ts:534, :717`, `Week.screen.dom.test.ts:113`: «Потом» — 24 часа из документа.
- e2e `e2e/tl-block3-operations.test.ts`: два телефона одного человека (`phone` из `e2e/support/family.ts`) — «Нет, это другое»
  на первом → второй после синка вопрос не задаёт; «Потом» на первом → второй не показывает 24 часа; партнёр — свои вопросы.

## Критерии приёмки

- Ответы «Нет, это другое» и «Потом» видны всем телефонам человека и не видны партнёру; старые ответы с устройства не
  потерялись после обновления.
- `npm run build && npx vitest run` зелёные; стенд: два окна Chrome одного пользователя.

## Вне скоупа

- «Нет» на «Это ваш доход?» (`ff_start_answered`) — не трогаем; если сессия считает это той же ошибкой — хвост в §4.
- Сервер: личный документ уже хранится (Р-12) — ручек и миграций нет.
