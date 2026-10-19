# RZ-03 — Факты и действия v3, согласие v3, политика (фронт)

Блок 1 · MVP · Каталог: `frontend/src/lib/aiFacts.ts`, `types/finance.ts`, `stores/ai.ts`, `components/ai/AiConsentSheet.vue`,
`views/Privacy.vue`, `views/Settings.vue` · Зависит от: RZ-02 · Роли: member

## Контекст (что уже есть)

- `lib/aiFacts.ts`: `buildReviewFacts(doc, input, reason)` → `{payload: {facts, candidates}, byId}` — факты v2 (доход и
  перемены, мечты и сдвиг, подушка, долги, 1–2 раздела, главный образ, итог прошлого месяца для `month`) и кандидаты
  `stepCandidates`; `fact(about, value, raw)` с `clip`/`nm` (40 знаков, 200 на строку), `maskNames` на `about`; `factsLines`
  («что ушло»). Типы — `types/finance.ts`: `ReviewFact` :65 (`raw: number | string | number[]`), `ReviewCandidate` :68,
  `ReviewPayload` :71, `ReviewReason` :58.
- RZ-02: `reviewFindings`, `reviewScenario`, `reviewWork`, `whereRows`. RZ-01: продавцы в находках — без людей и ИП.
- Ручка (RZ-04, Р-16): тело `{v: 3, reason, facts (1…40), actions (1…9)}`; `actions[i] = {id: 'a<N>', kind: 'do'|'open',
  about, value, effect}` (`do` — как кандидат v2; `open` — `about` без цифр, `value`/`effect` пустые); ответ
  `{where, advices[{title, text, figure, action}]}`.
- Согласие: `stores/ai.ts` — `AI_CONSENT_V = 2` :330, `consent` (`'unknown'` у «да» старой версии → лист ещё раз один раз;
  «Не надо» любой версии — `'off'`), `AI_SENDS` :339 (5 строк; лист `AiConsentSheet.vue` берёт иконки по индексу —
  `PhChartBar, PhStorefront, PhImage, PhReceipt, PhChatCircleText`), `AI_AUTO`, `AI_NO_TRAINING`; подсказка настроек
  `Settings.vue:33-34` собирает фразу из `AI_SENDS`; политика `Privacy.vue` RU :61 («…названия продавцов и подписок без
  сумм…»), EN :90; тест `Privacy.test.ts`, `AiConsent.dom.test.ts`. Разбор сам (`autoReview` :213) спрашивает v2 один раз
  на повод через `ff_ai_auto.asked` — механизм для v3 тот же, номер версии один (`AI_CONSENT_V`).
- Р-7, Р-18 (`OpenTarget`), Р-21 (слова согласия — черновик, финал `/ux` Блока 2).

## Задача

1. Типы (`types/finance.ts`): `OpenTarget = { kind: 'cat' | 'goal' | 'credit' | 'obligation' | 'seller'; id: string; name:
   string; categoryId?: string }`; `ReviewAction = { id: string; kind: 'do' | 'open'; about: string; value: string; effect:
   string }`; `ReviewPayloadV3 = { v: 3; facts: ReviewFact[]; actions: ReviewAction[] }`; локально в `aiFacts.ts` —
   `ReviewFactsV3 = { payload: ReviewPayloadV3; doById: Map<string, StepCandidate>; openById: Map<string, OpenTarget>;
   findings: ReviewFinding[]; byAction: Map<string, ReviewFinding | null> }` (какая находка стоит за действием — для
   счётчика Р-19).
2. `buildReviewFacts` → v3 (сигнатура та же; v2-ветка не остаётся): факты v2 **остаются** (доход, перемены, мечты,
   подушка, долги, разделы, образ, итог прошлого месяца), к ним — факты находок (`REVIEW_FACTS_MAX` → 40; порядок: сначала
   находки, потом остальное, обрезка хвоста):
   - `leak`: «частые траты у «<продавец>» — в месяц» (`money(monthly)`), «… — раз в месяц» (`count`), «… — за год»
     (`money(yearly)`), образ: «… за год — доля мечты «<мечта>»» (`pctText(share)`, raw share) или «… за год — это
     <мерка>» (`value` — название мерки, raw price);
   - `grew`: «траты на «<раздел>» выше обычного на» (`growth`), причина — покупки: «что раздуло «<раздел>»: «<покупка>»»
     (`money(amount)`) по каждой (до 2), частота: «покупок в «<разделе>» в этом месяце» (`count`) и «обычно покупок в
     месяц» (`usualCount`);
   - `recurring`: «новое регулярное списание «<продавец>», которого нет в плане — в месяц» (`amount`), «… — за год»
     (`yearly`); `pricier`: «подписка «<имя обязательства>» стала дороже: было» (`was`), «… стало» (`amount`); `double`:
     «списание «<продавец>» прошло дважды одной суммой» (`amount`);
   - сценарий: «если убрать «<продавец>» — мечта «<мечта>» раньше на» (`shiftSpan(days)`, raw days) или «… — процентов
     банку меньше на» (`money(saved)`, + «… — долг «<имя>» закроется раньше на» `monthsLabel`);
   - `about` — без цифр (регулярка в тесте), имена участников — `maskNames`; названия — в «ёлочках» (цифры в «» сервер
     пропускает); продавцы — как в находках (RZ-01 уже без людей и ИП).
3. Действия: `do` — `stepCandidates` как кандидаты v2 (`about`, `value`, `effect` — те же слова); `open` — по одной на
   находку: `grew` → `cat` (раздел); `leak`, `recurring`, `double` → `seller` (`id` — нормализованный продавец, `categoryId`,
   `name`); `pricier` → `obligation`; сценарий — `goal` или `credit`; `about`: «открыть траты «Кафе»», «открыть покупки у
   «<продавец>»», «открыть подписку «…»», «открыть мечту «…»», «открыть долг «…»»; одно действие на предмет (дубли по
   `kind:id` схлопываются); всего ≤ 9 (`REVIEW_ACTIONS_MAX`), `do` первыми.
4. `openPath(target: OpenTarget): string` (Р-18): `cat` → `/month?cat=<id>`, `goal` → `/goals/<id>`, `credit` →
   `/money/debts?credit=<id>`, `obligation` → `/money?obligation=<id>`, `seller` → `/money/history?cat=<categoryId>`
   (без раздела — `/money/history`). `factsLines(payload)` — факты и действия («шаг — …», «открыть — …»).
5. Согласие v3: `AI_CONSENT_V = 3`; `AI_SENDS[1]` → «Продавцы и суммы частых трат и списаний» (иконка та же); `Privacy.vue`
   RU/EN — в абзаце «Кому передаём» вместо «названия продавцов и подписок без сумм» — «названия продавцов, суммы и
   число повторяющихся трат и списаний (без дат, без людей)», дата политики — 2026-10-18; `Settings.vue` — фраза
   собирается сама. Тесты согласия/политики обновить.

## Тесты

- `lib/aiFacts.test.ts` (хелпер `inputOf` там же): на документе с `reviewFinds` — факты каждого вида находки и
  сценария; `about` без цифр и без имён участников (сито); `raw` согласован с `value`; действия: `do` = `stepCandidates`,
  `open` — по одному на предмет, `kind:id` без дублей, ≤ 9, `about` без цифр; `openPath` по каждому виду; `byAction` ведёт
  на находку; `factsLines` включает действия; пустая семья — факты v2, действий ≥ 0, без падений; длинные названия
  обрезаны (≤ 40 / ≤ 200).
- `stores/ai` (существующие тесты согласия): «да» v2 → `'unknown'` (лист ещё раз), «да» v3 → `'on'`, «Не надо» v2 → `'off'`;
  `setConsent` пишет `v: 3`. `AiConsent.dom.test.ts`: пять строк, вторая — новые слова. `Privacy.test.ts` — новые слова RU/EN.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные (ручка v3 ещё не готова — `requestReview` пока зовёт старое
  тело: его меняет RZ-05; сборка не ломается — типы совместимы или старый вызов временно приведён).
- Пример `ReviewPayloadV3` демо-семьи и документа стенда с настоящей выпиской (обезличенный: продавцы — типом) — в
  Handoff, размер JSON ≤ 8 КБ.

## Вне скоупа

- Запрос и сохранение v3 — RZ-05; ручка — RZ-04. Финальные слова согласия и политики — `/ux` Блока 2 с владельцем.
  Экран-источник по адресам «Открыть» (`?cat` на «Месяце» и в истории) — RZ-08.
