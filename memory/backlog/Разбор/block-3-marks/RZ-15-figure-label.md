# RZ-15 — Подпись крупной цифры совета кодом; «не повторяй figure» в инструкцию; замер (фронт + Go)

Блок 3 · MVP · Каталог: `frontend/src/lib/aiFacts.ts`, `stores/ai.ts`, `lib/demo.ts`, `types/finance.ts`,
`components/ai/AiReport.vue`; `backend/internal/handlers/ai.go` (`reviewSystem`), `ai_test.go` · Зависит от: RZ-14 · Роли: все

Источник: вопрос 3 артефакта `/ux` Блока 2 — **владелец 2026-10-19 «А»** (`memory/decisions/rz-ux2-owner.md`). Инструкция
модели — не §2 (Р-24: текст — замеренный, в SESSION дословно).

## Контекст (что уже есть)

- Совет v3 — `AiAdvice.figure: {about, value} | null` (готовый факт из своего `payload`, `requestReview` в `stores/ai.ts`;
  демо — `demoReview` в `lib/demo.ts`); отчёт показывает `figure.value` крупно и `figure.about` подписью
  (`data-review-figure-about`). `about` — служебная строка для модели (`findingFacts` / `scenarioFacts` в `aiFacts.ts`:
  «новое регулярное списание «…», которого нет в плане — за год»). Живой ответ RZ-06 повторял ту же сумму в тексте.
- Ручка — `reviewSystem` (`handlers/ai.go`), тест слов инструкции — `ai_test.go` (`strings.Contains(reviewSystem, …)`),
  живой — `TestLiveReviewV3` (`AI_LIVE=1`, `AI_LIVE_BODY`, `AI_LIVE_N`; ключ — env `ANTHROPIC_API_KEY` или
  `memory/secrets/anthropic.md`).

## Задача

1. `aiFacts.ts`: у фактов находок и сценария — короткая подпись `label` по виду («за год · Магазин у дома», «в месяц ·
   …», «выше обычного · Кафе», «было · …» / «стало · …», «дважды · …», «мечта раньше · …»); в тело ручки не уходит —
   отдельной картой `labels` (id факта → подпись) в `ReviewFactsV3`.
2. Совет хранит подпись: `AiAdvice.figure.label?` (`requestReview`, `demoReview`); отчёт показывает `label`, нет — `about`
   (разборы до RZ-15).
3. `reviewSystem` — одна фраза в описании `figure`: «Число из figure приложение покажет крупно над текстом — в text его не
   повторяй.»; тест слов инструкции.
4. Замер: `TestLiveReviewV3` ≥ 8 прогонов на теле настоящих выписок (≈ $0,40): 200 с первой попытки, повторов, советов с
   повтором числа figure в тексте (было — замер RZ-06), цена. Финальный текст инструкции — в SESSION дословно. Ключ не
   пускает классификатор — записать в Handoff, замер — приёмке.

## Тесты

- `aiFacts`: подписи фактов утечки, «раздуло», нового списания, подорожания, двойного, сценария; в `payload.facts` полей
  `label` нет.
- `stores/ai` / DOM: совет с крупной цифрой — `label` сохранён и показан; разбор без `label` — подпись `about`.
- Go: `reviewSystem` содержит фразу; прежние проверки инструкции зелёные.

## Критерии приёмки

- `npm run build && npx vitest run`, `cd backend && go build ./... && go vet ./... && go test ./...` зелёные.
- Замер в SESSION: ≥ 8 живых, повтор числа figure в тексте — реже, чем до фразы (RZ-06), 200 с первой попытки ≥ 6/8.

## Вне скоупа

- Проверка «повтор figure» в Go (брак → повтор) — только если замер покажет, что фразы мало (решение — владельцу).
