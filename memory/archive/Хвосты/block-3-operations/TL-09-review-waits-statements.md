# TL-09 — Разбор ИИ ждёт выписки (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/` · Зависит от: — · Роли: member с включённым ИИ · Х-1, Р-6

## Контекст (что уже есть)

- `src/stores/syncEngine.ts`: `afterPull(pulled)` :98-106 — `linkPhotos()`, при `pulled`: `finance.ensureTermSnap()`,
  `useOperationsStore().settleFinds()`, `void useAiStore().autoReview()`; `sync()` :108-122 — `pullHousehold()` /
  `syncHousehold()` → `afterPull`, операции только `flush()`; старт :159-162 — `sync()` и отдельно `void
  useOperationsStore().pull()` **без порядка между ними**; `loadUploads` здесь не зовётся.
- Другие запуски — `components/AppShell.vue:80-82` (после своей отметки зарплаты), :86-91 (когда `ai.available` включился,
  при `financeStore.pulledOnce && status === 'idle'`).
- `src/stores/ai.ts:249-300` `autoReview(client)` — единственная проверка данных `if (!cardsOf(key).length) return null`
  :257 (`cardsOf` :143-147 — `useOperationsStore().all` + `finance.planInput`); запрос — `requestReview` :157+
  (`buildReviewFactsV4(…, useOperationsStore().all, …)`).
- Счётчик «K находок из N операций» — `components/ai/AiReport.vue:240-255` из `review.work`; `reviewWork` (`lib/finance.ts:
  6364-6377`) считает `ops` по итогам месяца и `usualMonths(…, ctx.uploads, …)`; `ctx.uploads` = `useOperationsStore().uploads`
  (finance.ts:323-331) = `serverUploads` (operations.ts:172) — `[]`, пока не отработал `loadUploads()` :995-1002 (`GET
  /api/statements`). `loadUploads` зовут только экраны (Week.vue:432, Money.vue:50, Month.vue:64, Dreams.vue:139) и
  operations.ts:861.
- Флаги: `finance.pulledOnce` (finance.ts:244), у операций `status` :158, приватные `pulling`/`lastPullAt` :167-168; `pull()`
  :877-883, `pullOnce` :885-928. Флага «выписки загружены» нет.
- Стенд «Фидбека» 4а: 7 находок и «0 операций» вместо 9 и 554.
- **Готовая заготовка — хотфикс FB-HF1**: ветка `origin/fb-hf1-review-waits`, коммит `ab08f7b2` (исполнитель сделал, критика
  не было, в `main` не влит; база — старый `main` `78c2e56c`, до Блоков 1–5 «Фидбека»). Суть: флаг `operations.loaded` (первый
  `pull` операций + `GET /api/statements` этого запуска), находки и автозапуск разбора — после него; не пришли — без запроса и
  без записи попытки (повтор следующим кругом); «Разобрать»/«Обновить» ждут того же, не пришли — прежнее «не вышло». 17 файлов
  (+185/−28): `stores/operations.ts`, `stores/ai.ts`, `stores/syncEngine.ts`, тесты `aiAuto`, `syncEngine`, `AiReport.dom`,
  фейки `e2e/support/family.ts` (пустые операции/выписки) и правки шести e2e. Посмотреть: `git show ab08f7b2`.

## Задача

1. Перенести FB-HF1 (`ab08f7b2`) на текущий `main` (cherry-pick с разрешением конфликтов или по образцу — на усмотрение;
   сверить с кодом после Блока 4б «Фидбека»: `autoReview` v4, `settleFinds`). Итог: автоматический разбор (`autoReview` из
   `afterPull` и из `AppShell`) стартует только после того, как подтянулись операции (`pull`) и список выписок
   (`loadUploads`) этого запуска — одна точка ожидания в сторе операций.
2. Без сети / ошибка выписок — разбор не стартует (как при пустых данных), без новых сообщений на экране (Р-6).
3. Ручной разбор («Разобрать»/«Обновить») может ждать ту же точку, как в FB-HF1, — только прежними текстами.
4. В Handoff — что взято из FB-HF1 и что изменено; ветку `fb-hf1-review-waits` не мёржить отдельно (её заменяет TL-09).

## Тесты

- `src/stores/syncEngine.test.ts` (:145, :159 — порядок разбора после пулла): разбор не зовётся, пока не завершились `pull`
  и `loadUploads`; после — один раз.
- `src/stores/aiAuto.test.ts` (с :89): запуск при `ai.available` до загрузки выписок ждёт их; ошибка выписок — разбора нет.
- Проверить помощник `src/test/reviewV4.ts` (`seedOwnMonth` зовёт `loadUploads` :36) — не сломан.
- e2e `e2e/tl-block3-operations.test.ts`: медленный `GET /api/statements` (задержка в `fakeServer`) → отчёт «Работа ИИ» с
  ненулевым числом операций.

## Критерии приёмки

- На стенде с задержкой выписок отчёт ИИ не показывает «из 0 операций»; число операций совпадает с загруженными.
- `npm run build && npx vitest run` зелёные.

## Вне скоупа

- Новые экраны ожидания или подписи — не делаем (Р-6).
- Ветку `fb-hf1-review-waits` не удалять — её судьбу решает владелец после 🏁 Блока 3.
- Серверная часть разбора и модель — без изменений.
