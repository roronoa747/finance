# RZ-05 — Разбор v3 в документе, временный показ в листе, e2e (фронт)

Блок 1 · MVP · Каталог: `frontend/src/types/finance.ts`, `api/client.ts`, `stores/ai.ts`, `stores/finance.ts`,
`components/ai/AiReviewSheet.vue`, `lib/demo.ts`, `e2e/` · Зависит от: RZ-04 · Роли: member, viewer, партнёр, демо

## Контекст (что уже есть)

- `stores/ai.ts` `requestReview(key, reason, client)` :133 — один запрос в полёте, `buildReviewFacts` → `client.aiReview({reason,
  ...payload})` → `finance.saveAiReview({… v: 2, step: {text, candidate: byId.get(res.step.candidate)}, sent: payload})`;
  `runReview`, `autoReview` (поводы, `ff_ai_auto`), `reviewUnseen`. `api/client.ts` `aiReview(body)` :195 → `AiReviewAnswer`
  (`types/api.ts`). `AiReview` (`types/finance.ts:42`): `v?: 2`, `step?`, `sent: MonthSummaryAI | ReviewPayload | null`.
  `saveAiReview` (`stores/finance.ts:1066`, живых ≤ 12), `aiReviewOf(month)`.
- Лист `components/ai/AiReviewSheet.vue` (240 строк): `v2` computed, `saved` / `done` (`shiftMade`) / `fresh`
  (`stepCandidates` по id) → «Сделать» → `DoSheet` (z 60) / «✓ Сделано»; `sentRows` («что ушло»: `factsLines` для v2,
  `sentLines` для v1), «Обновить», день разбора. Демо — `lib/demo.ts` `DEMO_REVIEW` :21, `demoReview(doc, input)` :32
  (строит v2 по фактам; `MonthPlan.vue:252`), тест `lib/demo.review.test.ts`.
- RZ-03: `buildReviewFacts` → `{payload (v3), doById, openById, findings, byAction}`, `openPath(target)`; RZ-02:
  `reviewWork`. Ответ ручки (RZ-04): `{where, advices[{title, text, figure: 'f<N>' | null, action: 'a<N>'}]}`.
- e2e: `e2e/au-block3-review-v2.test.ts` (8 сценариев: два телефона, `vi.fn` на `apiClient.aiReview` возвращает `ANSWER`
  v2, счётчик запросов, «Сделать», viewer), `e2e/au-block3-accept.test.ts`, `e2e/ai-block2-*.test.ts` (ответ v2);
  `components/ai/AiReview.dom.test.ts`, `ReviewDot.dom.test.ts`, тесты стора `stores/ai*.test.ts` (grep `aiReview`).
- Р-15 (документ v3 и временный показ), Р-12 (поводы и прочее без изменений), Р-19 (счётчик на момент разбора).

## Задача

1. Типы: `AiReview` — `v?: 2 | 3`; `advices?: AiAdvice[]`, `where?: string`, `work?: {ops: number; found: number; yearly:
   number}`; `AiAdvice = { title: string; text: string; figure: {about: string; value: string} | null; action: {kind: 'do';
   candidate: StepCandidate} | {kind: 'open'; target: OpenTarget} }`; `sent: MonthSummaryAI | ReviewPayload |
   ReviewPayloadV3 | null`. `types/api.ts` — `AiReviewAnswer` v3; `api/client.ts` `aiReview(body: {reason} &
   ReviewPayloadV3)`.
2. `requestReview`: тело v3; ответ → `saveAiReview({month, at, by, good: '', risk: '', steps: [], v: 3, reason, reasonKey,
   where, advices (figure → факт по id из payload: `{about, value}`; action → `doById` / `openById`; совет, чьё действие
   не нашлось, отбрасывается — пустой список = `'ai_failed'`), work: reviewWork(state, ctx, findings, used = находки
   советов по `byAction`), sent: payload})`. Факты пустые — `'ai_failed'` без запроса, как раньше.
3. `AiReviewSheet.vue` — **временный показ v3** (до отчёта Блока 2; пометить комментарием `RZ-05 временно, снимает RZ-07`):
   v3 → блок «Куда ушло» (строка `where`), затем советы списком: заголовок (`type-section`), строка текста, справа —
   `secondary sm` «Сделать» (участник, кандидат ещё применим — `stepCandidates` по `candidate.id`, как `fresh`; сделан —
   «✓ Сделано») или `RouterLink` «Открыть» → `openPath(target)` (лист закрывается); внизу — счётчик `work` одной строкой
   («Просмотрел N операций · нашёл K · ≈ X ₸ в год», без X при 0), «что ушло» — `factsLines` v3, «Обновить», день — как у
   v2. v2/v1 — без изменений.
4. `lib/demo.ts` `demoReview` — пока строит **v2** как раньше (заготовка v3 — RZ-09), но не падает на новых типах; тест
   `demo.review.test.ts` зелёный.
5. e2e `e2e/rz-block1-review-v3.test.ts` (по образцу `au-block3-review-v2`, два телефона, `apiClient.aiReview` = `vi.fn`):
   (а) первый вход в месяце → ровно 1 запрос, тело `{v: 3, reason: 'month', facts, actions}` без имён участников и без
   `raw` на верхнем уровне действий; ответ с 2 советами (`do` на `cushion`, `open` на `cat`) → в документе разбор v3 с
   `advices`, `work`; (б) телефон 2 после синка видит тот же разбор без запроса; в листе — «Куда ушло», 2 совета, кнопки
   «Сделать» и «Открыть»; (в) «Сделать» → `DoSheet` → подтвердил → «✓ Сделано» у совета, `planShifts` +1 у обоих;
   (г) «Открыть» ведёт на `openPath` (адрес роутера), лист закрыт; (д) viewer — «Открыть» есть, «Сделать» нет;
   (е) ответ с советом на неприсланное действие — разбор не сохраняется (`ai_failed`), запросов 1. Старые e2e Блока 3
   «ИИ-польза» и «ИИ» Блока 2 — ответ `vi.fn` переведён на v3 (сохранённые v2 в документах остаются и читаются).
6. Тесты стора (`stores/ai*.test.ts`): сохранение v3 (`figure` → факт, `action` → кандидат / цель, `work`), совет без
   действия отброшен, все отброшены → `ai_failed`; поводы и `ff_ai_auto` — без изменений (существующие тесты зелёные).

## Тесты

- Перечислены в задаче: e2e (а)–(е), тесты стора, `AiReview.dom.test.ts` — v3 временный показ (строка «Куда ушло»,
  советы, «Открыть» — ссылка на `openPath`, viewer без «Сделать», счётчик), v2 как раньше.
- Мутация: убрать проверку действия при сохранении → (е) красный.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные (весь `e2e/`).
- Стенд (Go RZ-04 на моках `:8161` + живой ключ, Vite `:5261`, Chrome 390, обе темы; семья — копия документа демо +
  `reviewFinds` из настоящей выписки или синтетические через загрузку): лист согласия v3 один раз → разбор сам (1 запрос)
  → ✦ → лист: «Куда ушло», 2–3 совета с кнопками; «Сделать» → `DoSheet` → «✓ Сделано»; «Открыть» → нужный экран;
  партнёр — тот же разбор без запроса; viewer — без «Сделать». Запросов за прогон — не больше поводов.
- В Handoff — обезличенный живой ответ v3 (советы, действия) и `work`.

## Вне скоупа

- Экран-отчёт, пилюля, «Куда ушло» картинкой, снятие листа — Блок 2. Заготовка демо v3 и `reviewFinds` демо — RZ-09.
  ✦ у предметов — Блок 3. Адреса `?cat` на «Месяце» и в истории — RZ-08 (пока «Открыть» ведёт на экран без листа —
  допустимо для временного показа; отметить в Handoff).
