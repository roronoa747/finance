# FB-13 — Месяц вместо года: `monthly` у находок, факты, счётчик, Go-инструкция, демо (фронт + Go)

Блок 4, часть 4а · MVP · Каталог: `frontend/src/lib/finance.ts`, `lib/aiFacts.ts`, `stores/ai.ts`, `components/ai/AiReport.vue`, `lib/demo.ts`, `types/finance.ts`, `backend/internal/handlers/ai.go`, `ai_test.go` · Зависит от: — (своя ветка `fb-block-4a-monthly`, деплой раньше блока) · Роли: семьи с ИИ (отчёт), демо

## Контекст (что уже есть)

- Р-8, Р-19 (§2); решение — `memory/decisions/fb-review-monthly.md` (отменяет Р-8 «X — сумма годовых эффектов» и Р-19
  бэклога «Разбор», `memory/decisions/rz-grew-yearly.md`). Владелец на скриншотах советов («38 040 ₸ за год», «442 116 ₸ за
  год»): «Годовые цифры тут не надо».
- Где год: `ReviewFinding` (`finance.ts:5910-5924`, у всех видов `yearly`; утечка ещё `monthly`); `reviewFindings` (:5959 —
  утечка `yearly = monthly × 12` :5980, образ `share = yearly × 100 / dream.need` :5984, `measureFor(yearly)`; «раздуло»
  `yearly: growth` :6016; новое `amount × 12` :6033; подорожание `(amount − was) × (year ? 1 : 12)` :6039; двойное
  `amount × (count − 1) × 12` :6043; сортировка по `yearly` :6046); `reviewScenario` (:6063, `monthly = yearly / 12`);
  `reviewWork` (:6084, `yearly` = Σ по советам). Факты — `lib/aiFacts.ts` `findingFacts` :119 (утечка «— за год» :127 с
  подписью `за год · <продавец>`, образ «за год — доля мечты / это» :128-129; новое «— за год» :144); `labels`.
  Экран — `AiReport.vue` `work` :129-143 («в год уходит на найденное»), подпись `figureLabel` :116; `figure` в сторе
  `stores/ai.ts:157-166`; тип `AiReview.work {ops, found, yearly}` (`types/finance.ts:61`), `AiAdvice.figure` :68.
  Go — `reviewSystem` `ai.go:142-150` («самых ценных по деньгам в год», «figure — … сумма в год», «за год это {f5}»),
  тесты `ai_test.go` `reviewBody` :78-90 (f7 «за год»), `TestReviewSystemV3` :187, `TestReviewDefectsRetry` :311. Демо —
  `lib/demo.ts:24 DEMO_REVIEW` («за год»), `demo.review.test.ts`.
- Тесты с годом: `reviewFindings.test.ts` (:129, :144-160, :182, :249-258), `aiFacts.test.ts` (:344-347, :384-386, :410),
  `aiAuto.test.ts` (:529-567), `AiReport.dom.test.ts` (:506, :539-541, :772-783), e2e `rz-block1…3`, `ap-block2-month-razbor`.

## Задача

1. `ReviewFinding`: `yearly` → `monthly` у всех видов (утечка — среднее за месяц; «раздуло» — `growth`; новое — `amount`;
   подорожание — `amount − was` при `every` месяц, при `every: 'year'` — та же разница с полем `every: 'year'` для подписи
   «раз в год»; двойное — `amount × (count − 1)`); сортировка, `LEAKS_MAX`, `REVIEW_FINDINGS_MAX` — по `monthly`;
   образ утечки — `share` = доля `monthly` в **месячном взносе** главной мечты (`goal.monthly`/темп; нет темпа — доля
   `monthly × 12 / need` не показывать, мерка `measureFor(monthly)`); `reviewScenario` — `monthly` напрямую; `reviewWork`
   → `{ops, found, monthly}`; тип `AiReview.work` — `monthly` (старые записи с `yearly` читаются: `work.monthly ??
   Math.round(work.yearly / 12)` в одном месте чтения).
2. `aiFacts.ts`: факты «— за год» убрать; у утечки, нового, двойного — «— в месяц» (подпись `в месяц · <продавец>`);
   подорожание — «стало дороже на» (месяц / «раз в год»); образ — «в месяц — это N % взноса в мечту» или мерка.
   `REVIEW_FACTS_MAX`/слоты не менять.
3. `AiReport.vue`: «≈ X ₸» + «в месяц уходит на найденное»; подпись цифры совета — из `label`; старые разборы (подпись
   «за год · …») показываются как сохранены.
4. Go `reviewSystem`: «по деньгам в месяц», «сумма в месяц», пример «в месяц это {f5}»; `TestReviewSystemV3` — новые фразы;
   `reviewBody`/таблица брака — факты «в месяц». Схема ответа не меняется.
5. Демо `DEMO_REVIEW` и `demoReview` — «в месяц»; `demo.review.test.ts`.
6. Живой замер: 3 разбора на выписках владельца с ключом (`memory/secrets/anthropic.md` основного дерева) — ни одной цифры
   «в год» в тексте, крупная цифра — месяц; цена за разбор — в Handoff.

## Тесты

- `reviewFindings.test.ts`: `monthly` каждого вида, сортировка, сценарий, `reviewWork.monthly`; чтение старого `work.yearly`.
- `aiFacts.test.ts`: нет фактов «за год»; подписи «в месяц · …»; образ.
- `AiReport.dom.test.ts`: «в месяц уходит на найденное»; старый разбор с «за год» не падает.
- Go: `TestReviewSystemV3`, `TestReviewFilled`, таблица брака — зелёные с новыми фразами.
- Мутант: `× 12` возвращён в утечку — тест красный.

## Критерии приёмки

- Ни на одной карточке отчёта (новый разбор, демо) нет «в год»/«за год»; крупная цифра совета и счётчика — за месяц; старые
  разборы открываются без ошибок.
- `npm run build && npx vitest run` (весь e2e) зелёные; `go build/vet/test` зелёные; живой замер 3/3 без годовых слов.
- Деплоится отдельно (оркестратор, после «да» владельца): фронт + Go, миграций нет; откат — promote предыдущего Production.

## Вне скоупа

- Новые инсайты и действия с призывом — FB-14…FB-17. Переписывание сохранённых разборов — нет.
