# RZ-04 — Ручка разбора v3: тело, схема, инструкция JTBD, проверка (Go)

Блок 1 · MVP · Каталог: `backend/internal/handlers/ai.go`, `ai_test.go`, `backend/README.md` · Зависит от: RZ-03 · Роли: member
(гейт как в v2)

## Контекст (что уже есть)

- `handlers/ai.go`: границы :104-118, регулярки :120-132 (`factID` `^f[1-9][0-9]?$`, `candidateID` `^c[1-9]$`, `reviewRef`,
  `quotedName`), `reviewSystem` :137 (v2) и `reviewRetry` :149, тело `reviewFact` / `reviewCandidate` / `reviewRequest`
  :153-172, `shortText`, `validRaw` (число ≤ 1e15, месяц `YYYY-MM`, 1–5 чисел), `valid` :214, `modelText` :237 (без `raw`,
  `SetEscapeHTML(false)`), `numbers` :259 (вход второй проверки), `reviewSchema(candidates)` :276 (`enum` id + null),
  `ReviewAnswer` :312 / `usable` / `defects` :327 (ссылка на неприсланный факт, цифра вне ссылок кроме «названий в «»» из
  присланного) / `texts` / `filled` :378, `Review` :410-454 (две попытки, `reviewDeadline` 55 с, `MaxTokens` 16 000,
  effort `medium`, `Spend` при успехе `ok = true`). `ai.CheckNumbers(texts, input)` — вторая защита. Схема — каждый объект
  `additionalProperties: false`, без `minItems/maxItems`, `enum` можно (`ai.go` клиент).
- Тесты `ai_test.go`: `fakeClaudeQueue` :28 (очередь ответов, `sent[n]` — тела в Anthropic), `newReviewFixture` :91 (лимит
  2 000 000 µ$, месяц `2026-10`, `member`/`viewer` токены), `answer(...)` / `cleanAnswer` :75 — конструкторы ответа v2,
  `TestReviewSystemV2` :165, `TestReviewSendsOnlyInstructionFactsAndCandidates` :185, `TestReviewNoCandidatesSchemaIsNull`
  :245, `TestReviewDefectsRetry` :259 (таблица брака), `TestReviewTwoDefectsFail`, `TestReviewKeepsNamesAndDropsForeignCandidate`,
  `TestReviewModelErrorFailsWithoutSpend`, `TestReviewBilledFailures`, `TestReviewBody` :361 (строгое тело), `TestReviewGate`
  :417, живой `TestLiveReviewV2` :498 (`AI_LIVE=1`, `AI_LIVE_BODY`, `AI_LIVE_EFFORT`, `AI_LIVE_N`). README
  `backend/README.md:130-150` — абзац контракта v2.
- Р-16 (тело и схема v3), Р-6 (совет без кнопки невозможен), Р-1 и Р-24 (инструкция под JTBD), Р-11 (модель и effort те
  же), Р-12 (ничего не логировать и не хранить).

## Задача

1. Тело v3 (старое — 400 «invalid request body», как v1 при переходе на v2):
   ```go
   type reviewAction struct { ID, Kind, About, Value, Effect string }   // kind: do | open
   type reviewRequest struct { V int; Reason string; Facts []reviewFact; Actions []reviewAction }
   ```
   `valid`: `V == 3`; `reason` из `reviewReasons`; факты 1…40 (`maxReviewFacts` 40, `factID` — `^f[1-9][0-9]?$` уже даёт
   1…99), `raw` как раньше; действия 1…9 (`actionID` `^a[1-9]$`), `kind` ∈ {do, open}, `about` непустой ≤ 200; у `do` —
   `value` непустой, `effect` может быть пустым; у `open` — `value` и `effect` пустые; id без дублей (и с фактами).
   `maxReviewBody` → 48 КБ.
2. `modelText`: `{reason, facts (id, about, value), actions (id, kind, about, value, effect)}`; `numbers()` и `texts()` —
   все строки фактов и действий + `raw`.
3. Схема ответа `reviewSchema(facts, actions)`:
   ```json
   {"where": string,
    "advices": {"type":"array","items":{"type":"object","properties":{
        "title": string, "text": string,
        "figure": {"anyOf":[{"type":"string","enum":[присланные f<N>]},{"type":"null"}]},
        "action": {"type":"string","enum":[присланные a<N>]}},
      "required":["title","text","figure","action"],"additionalProperties":false}},
    "required":["where","advices"],"additionalProperties":false}
   ```
   `ReviewAnswer {Where string; Advices []ReviewAdvice{Title, Text string; Figure *string; Action string}}`.
   `usable`: `where` непустой, 1…3 совета с непустыми `title`/`text`. `defects` (к имеющимся): советов > 3 или 0 —
   «советов должно быть от одного до трёх»; одинаковый `action` у двух советов — «одно действие на совет»; `title` длиннее
   4 слов (`strings.Fields`) — «заголовок до четырёх слов»; `text` > 160 знаков — «совет — одно короткое предложение»;
   `figure` не из присланных фактов — брак (схема не пустит, но проверить); `action` не из присланных — брак (так же).
   `filled` — подстановка `{fN}` в `where`, `title`, `text`; `figure` и `action` — как пришли. Ответ 200 — `ReviewAnswer`
   с подставленными значениями.
4. Инструкция `reviewSystem` v3 (черновик; замер и финальный текст — RZ-06, в SESSION дословно):

   > Ты — семейный финансовый помощник в приложении для семейного бюджета. Тебя наняли сделать работу, на которую у
   > семьи ушли бы часы: приложение уже просмотрело операции и посчитало факты — твоя работа выбрать из них то, чего
   > семья сама не заметит, и сказать, что с этим сделать. Тебе дают JSON: reason — повод разбора (month — начался новый
   > месяц, salary — пришла зарплата, refresh — попросили обновить); facts — факты месяца, которые посчитало приложение:
   > id, about — о чём факт, value — значение, как его покажет приложение; actions — что приложение может сделать одной
   > кнопкой: id, kind (do — сделать само: перенести деньги из плана трат в мечту в этом месяце, внести досрочно в долг,
   > отложить в подушку; open — открыть экран предмета: раздел трат, покупки у продавца, подписку, мечту, долг), about —
   > что это, value — сумма (у do), effect — что это даст. Люди названы «участник 1», «участник 2».
   >
   > Напиши по-русски от лица семьи — «мы»:
   > - where — одно предложение до 14 слов к картинке «куда ушло»: что выросло и почему это важно для мечты, подушки или
   >   свободы от долгов;
   > - advices — от одного до трёх советов, самых ценных по деньгам в год; у каждого: title — заголовок до четырёх слов
   >   без точки; text — одно предложение до 20 слов: что нашли и почему это важно; figure — id факта с главным числом
   >   совета (сумма в год, доля мечты, срок) или null; action — id действия из actions, которое этот совет выполняет
   >   (do — если действие прямо отвечает на находку, иначе open экрана предмета совета). Два совета не могут вести на
   >   одно действие.
   > Ценное — то, чего не видно на экранах: частые траты у одного продавца с ценой в год, новое регулярное списание,
   > подорожавшая подписка, двойное списание, что именно раздуло раздел, сценарий «если убрать — мечта раньше». Факт
   > «потратили больше обычного» без причины и без действия — не совет. Остаток месяца и сроки без перемены — только
   > если находок нет.
   > Без упрёков и оценок людей. Не сравнивай участников между собой и не называй их.
   >
   > Числа. Не пиши ни одной цифры и ни одного числа словами. Каждую сумму, срок, время, долю или месяц пиши только
   > ссылкой на факт в фигурных скобках — {f3}: приложение подставит value факта как есть. Ссылайся только на id из
   > facts. value уже в своей форме: суммы — «80 000 ₸», сроки — «к июню 2028», время — «2 недели», доли — «11 %»;
   > строй фразу так, чтобы value встало без изменений: «за год это {f5}», «мечта раньше на {f6}». Ничего не вычисляй:
   > ни разниц, ни сумм, ни долей, ни сравнений «в N раз». Если для мысли нужно число, которого нет в facts, скажи её
   > без числа. Названия мечт, разделов, продавцов, подписок и долгов пиши как в about, в кавычках «».

   `reviewRetry` — тот же текст.
5. `Review`: без изменений в гейте и расходе; `MaxTokens` 16 000; две попытки; при браке — повтор с перечислением.
6. README: абзац контракта v2 → v3 (тело, действия, схема, проверки, брак ответа), строка про старый клиент (тело без `v`
   → 400); таблица env — без изменений.

## Тесты

- `TestReviewSystemV3` (слова инструкции: «наняли», «от одного до трёх советов», «не пиши ни одной цифры»);
  `TestReviewSendsOnlyInstructionFactsAndActions` — в Anthropic уходит ровно `{reason, facts без raw, actions}` и
  схема с `enum` присланных `a<N>` и `f<N>`; `TestReviewBody` v3 — таблица: без `v` → 400, `v: 2` → 400, 0 действий → 400,
  10 действий → 400, `open` с `value` → 400, `do` без `value` → 400, 41 факт → 400, дубль id → 400, лишнее поле → 400;
  `TestReviewDefectsRetry` — к таблице брака v2 (цифра, ссылка на неприсланный факт, слова-числа, месяц без года):
  4 совета → повтор; два совета с одним `action` → повтор; заголовок из 5 слов → повтор; второй брак → 502 и токены в
  лимит; `TestReviewFilled` — `{fN}` подставлены в `where`, `title`, `text`; `figure`/`action` вернулись как есть;
  название «iPhone 17» в «» — не брак; `TestReviewGate` — те же ветки с телом v3 (503 / 403 / 429 / 200 и расход);
  `TestLiveReviewV3` вместо `TestLiveReviewV2` (`AI_LIVE_BODY` — файл тела v3; лог: время, попытки, `where`, советы,
  действия, цена по `ai.CostMicros`).
- Мутация (откат копией): выключить проверку «одно действие на совет» → красный.

## Критерии приёмки

- `cd backend && go build ./... && go vet ./... && go test ./...` и в корне `go test ./api/...` зелёные.
- Живой прогон `TestLiveReviewV3` на payload демо (RZ-03, `AI_LIVE_N=3`) — 3/3 200 без второй попытки или с одним
  повтором; время и цена — в Handoff (полный замер на настоящих выписках — RZ-06).
- В логах сервера нет тела и ответа (как в v2 — проверить glазами по `log.Printf` в диффе).

## Вне скоупа

- Клиент и сохранение — RZ-05. Инструкцию дорабатывает RZ-06 по замеру; тексты слов владельцу — `/ux` Блока 2.
- Новые действия (урезать план, отменить подписку) — после MVP. Лимит, модель, effort — без изменений (Р-11).
