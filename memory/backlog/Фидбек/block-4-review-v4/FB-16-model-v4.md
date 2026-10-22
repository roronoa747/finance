# FB-16 — Модель v4: одна главная мысль, ручка v4, разбор свой у каждого в личном документе (фронт + Go)

Блок 4, часть 4б · MVP · Каталог: `frontend/src/lib/aiFacts.ts`, `stores/ai.ts`, `stores/finance.ts`, `lib/merge.ts`, `types/finance.ts`, `api/client.ts`, `backend/internal/handlers/ai.go`, `ai_test.go` · Зависит от: FB-15 · Роли: участники семьи с ИИ; viewer — нет

## Контекст (что уже есть)

- Решение — Р-26, Р-27, Р-28 (§2). Цена: оценка Г ≈ 9 ₸ за разбор на Opus 5.5 (Sonnet 5 ≈ 4 ₸, Haiku 5.5 ≈ 0,2 ₸);
  модель — env `AI_MODEL_REVIEW` (`backend/internal/config/config.go:98`, дефолт `DefaultAIModelReview`), выбирается
  по живому замеру FB-23. Лимит семьи — $2 в месяц (`AIGate`, `ai.go:29`), «свой у каждого» — ×2 на пару (≈ 54 ₸ в месяц
  на Opus), лимит не меняется.
- Ручка `POST /api/ai/review` (`ai.go:471`): тело `reviewRequest {v, reason, facts, actions}` (:174), проверки `valid`
  :221, инструкция `reviewSystem` :142 (v3: где + 1–3 совета), схема `reviewSchema` :297, брак `defects` :369 → повтор
  `reviewRetry` :153 один раз, подстановка `{fN}` — `filled` :448; лимиты — константы :111-120. Тесты — `ai_test.go`
  (`reviewBody` :78, `TestReviewDefectsRetry` :286, живой — `TestLiveReviewV2`/v3 по ключу из env; см. грабли «замер
  инструкции — TestLiveReviewV2»).
- Факты — `lib/aiFacts.ts`: `buildReviewFacts(doc, input, reason)` :267 → `ReviewFactsV3 {payload, doById, openById,
  findings, byFact, byAction, labels}`; базовые факты `baseFacts` :172 (остаток, мечты, «мечта сдвинулась» :200);
  `maskNames` (участники → «участник 1/2»); `REVIEW_FACTS_MAX` 40.
- Стор — `stores/ai.ts`: `requestReview` (:141, собирает `AiAdvice` по ответу, `finance.saveAiReview` → **общий**
  документ), `runReview`, `autoReason` / `staleReview` (повод «на семью»: `month:<key>`, `salary:<slot>:<key>`),
  `autoReview` (попытки `ff_ai_auto`), `adviceMarks` / `markFor` (✦ у предмета), `reviewUnseen`. Хранение —
  `stores/finance.ts:1059 aiReviewOf` (последний живой по `at` из общего документа), `saveAiReview` :1070 (живых ≤
  `AI_REVIEWS_KEPT`, старшие — надгробия). Тип `AiReview` — `types/finance.ts:43` (`v?: 2|3`, `advices`, `work`, `sent`).
- Личный документ — `privateDoc` (`stores/finance.ts:220`), слияние `lib/merge.ts:258 mergePrivateDocs` (`mergeList` по
  `id`; новый список — в `known`).

## Задача

1. **Факты v4** — `buildReviewFactsV4(doc, input, ops, by, reason)`: карточки FB-15 (`reviewCards(…, by)`) → факты
   `{fN}` (число карточки, «Куда ушло» частями — доли, выходные) + базовые (`baseFacts`, мечты общие); `cards` —
   `[{id: 'c1'…, kind, about}]` (about — как в v3: продавцы по `sellerOk`, **люди и наличные — только «переводы людям» /
   «наличные» без имён**, Р-28). Возврат — `{payload, cardById, labels}`; `maskNames` как было.
2. **Ручка v4 (Go).** `v: 4` — тело `{v, reason, facts, cards}`; ответ `{title, text, figure, next}`: одна карточка — главная
   мысль месяца (заголовок ≤ 4 слов, текст ≤ 25 слов, числа только `{fN}`), `figure` — id факта или null, `next` — id
   карточки, которую показать второй. Новая инструкция `reviewSystemV4` (одна мысль: что в месяце главное и почему для
   мечты / свободы от долгов; без упрёков, без имён, без чисел — как v3), схема по `facts`/`cards`, брак (`defects`: цифры
   в тексте, чужие ссылки, длины, `next` не из `cards`) → тот же один повтор. **v3-тело принимается как было** (PWA
   держит прошлую сборку). Лимиты — константы рядом с v3.
3. **Стор и хранение (Р-27).** `requestReview` v4: тело v4, ответ → `AiReview {v: 4, lead: {title, text, figure}, next:
   <kind:key карточки>, work, sent}` — в **личный документ** `privateDoc.aiReviews` (живых ≤ `AI_REVIEWS_KEPT`, надгробия
   как в `saveAiReview`; `mergePrivateDocs` — в `known`). `aiReviewOf(month)` — свой v4 из личного, нет — как было из
   общего (v1–v3). Повод — свой: `autoReason` смотрит свой v4 месяца (`month:<key>`, `salary:<key>`); общий v3 месяца
   повод не закрывает (переход: каждый участник получает свой первый v4 сам). Брак обоих ответов / сеть / лимит — разбор
   **не сохраняется**, а отчёт всё равно показывает карточки кода без первой (FB-17); `ai_failed` больше не значит «пустой
   отчёт». `work` — `reviewWork(…, by)`.
4. **Семья без ИИ / без согласия / viewer (Р-27).** Запроса нет, карточки кода — да (участник); viewer — отчёта v4 нет.
   `adviceMarks` / `markFor` (✦ у предмета) у v4 — по карточкам с предметом на «Месяце» (раздел — `cat`, платёж —
   `obligation`), номер — место карточки в отчёте; v3 — как было.
5. `client.aiReview` — тип тела/ответа v4 рядом с v3.

## Тесты

- `aiFacts.test.ts`: v4 — факты карточек и `cards`; **ни одно `about`/`value` не содержит имени человека из переводов,
  имени участника, 6+ цифр** (семья с переводами «Имя Ф.» и наличными); `by` — чужие находки не уходят.
- Go `ai_test.go`: v4 — таблица брака (цифра в тексте, `{f99}`, `next` не из `cards`, длинный заголовок) → повтор → второй
  брак → 502 `ai_failed`; v3-тело по-прежнему 200 (регрессия); схема v4. Живой `TestLiveReviewV4` (skip без ключа) — для
  FB-23.
- `ai.store.test.ts` (или рядом): v4 пишется в личный документ, партнёр (второй стор) его не видит; повод свой — разбор
  партнёра не закрывает мой; общий v3 месяца не закрывает повод v4; брак → не сохранён, `reviewState` failed.
- `merge.test.ts`: `privateDoc.aiReviews` сливается по id, надгробие побеждает.

## Критерии приёмки

- Ручка: v4 работает, v3 не сломан (`go build ./... && go vet ./... && go test ./...`).
- В модель не уходят имена людей и участников (тест на тело), разбор v4 лежит только в личном документе.
- `cd frontend && npm run build && npx vitest run` — зелёные.

## Вне скоупа

- Экран, листы, демо — FB-17; замер моделей и выбор модели — FB-23 (владелец, env `AI_MODEL_REVIEW` на деплое).
- Удаление ветки v3 ручки и старых разборов общего документа — после MVP (хвост, когда старые сборки PWA ушли).
- Изменение лимита $2 и согласия (`AI_CONSENT_V`): состав «что уходит» — те же виды данных (доли, суммы, продавцы),
  людей больше не уходит — версию согласия не поднимаем.
