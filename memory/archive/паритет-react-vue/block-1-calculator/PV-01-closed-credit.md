# PV-01 — Закрытый кредит вне плана: бюджет, «Свободно», стратегия, Ритуал (фронт)

Блок 1 · MVP · Каталог: `frontend/` · Зависит от: клинап Блока 1 RP (ветка `rp-block-1-payments`) · Роли: все (просмотр)

## Контекст (что уже есть)

- Хвост §4 RP (критик Блока 1, судьба → PV-01 по Р-18): кредит, закрытый отметками
  (производный остаток 0, не удалён), продолжает входить в план. Места:
  - `frontend/src/lib/finance.ts:628-659` `budgetAmounts(state)`: d2 (`:648-652`) =
    `liveCredits(credits).reduce(a + c.payment)` + обязательства d2; `free` (`:656`) =
    `income − housing − debts − goals − living`. Читает только `payment` и `deletedAt`;
    `payments` в сигнатуре нет.
  - Вызовы с **сырым** документом: `views/Budget.vue:90` (`budgetAmounts(financeStore.householdDoc)`;
    `free` `:92`, d2 в шаблоне `:417-449`, «Свободно» `:265-281`, Callout «План не сходится»
    `:294-297`), `views/Overview.vue:53` (`free` `:55`, сегменты `:64-74`, Hero «Свободно в …»
    `:242`, Callout `:284-291`). Сырой `householdDoc.credits[i].principal` — база на момент
    ручного ввода, закрытость там не видна.
  - `views/Capital.vue:416-422` `stratDebts` и `:425-429` `stratMandatory` — все `credits`
    (геттер, производные), фильтра `principal > 0` нет. `rankedDebts` (`:381-390`) уже
    фильтрует `annualRate > 0 && principal > 0` и сортирует по ставке по убыванию.
  - `views/Ritual.vue:48` `credit = credits.value[0]` (первый по порядку документа);
    корзина «Досрочно по кредиту» `:94` (только если `credit` есть); `effectForCredit`
    `:66-73` через `prepayment(...)`. Может предложить досрочку по закрытому или по 0% долгу.
- Закрытость после RP-06: геттер `financeStore.credits` (`stores/finance.ts:130-132`) отдаёт
  копии с `principal = creditBalance(c, payments)`; **закрыт = производный `principal === 0`**.
  `liveCredits` (`finance.ts:477`) — только `!deletedAt`. `creditDueIn` (`:713`),
  `nextCreditDue` (`:824`), `untilPayday` (`:905`) закрытый уже пропускают. **Ловушка:**
  `creditBalance` на результате геттера вычитает отметки второй раз — не звать.
- `simulateStrategy` (`finance.ts:380-462`): `budget = Σ d.payment + saving` (`:398`) берёт
  платёж каждого долга, а в цикле долги с `principal ≤ 0.5` пропускает (`:426`) → платёж
  закрытого кредита становится «лишними деньгами» в обеих стратегиях. Функцию не менять —
  закрытые не передавать (Р-3).
- События Бюджета и «Впереди» уже получают производные кредиты (`Budget.vue:125-132`,
  `Overview.vue:118-128`); после клинапа Блока 1 RP они идут через `monthDues` (Н-3) —
  сверить по «Итогам пост-приёмки» `../развитие-приложения/block-1-payments/SESSION.md`.
- Тесты: `lib/finance.test.ts:780-791` — единственный тест `budgetAmounts` (группы RP-09);
  `views/Budget.test.ts:171-180`, `views/Overview.test.ts:150` зовут
  `budgetAmounts(store.householdDoc)`; `views/Ritual.test.ts` — 5 SSR-тестов
  (`createSSRApp(Ritual)` + `createAppRouter(createMemoryHistory())`);
  `stores/finance.test.ts:1203-1213` — закрытие досрочкой → `store.credits[0].principal === 0`.

## Задача

1. `lib/finance.ts`: `openCredits(credits: Credit[]): Credit[]` — `liveCredits` с
   `principal > 0`; JSDoc: принимает **производные** кредиты (геттер стора), сырому документу не
   давать. `costliestCredits(credits)` — открытые с `annualRate > 0`, по ставке по убыванию
   (правило `rankedDebts` из `Capital.vue:381-390` переезжает сюда; Капитал зовёт функцию).
2. `budgetAmounts`: d2 считает только `openCredits(state.credits)`. `Budget.vue` и
   `Overview.vue` передают производные кредиты
   (`budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits })` или
   аналогично — минимально). «Свободно» и Callout следуют из `free`.
3. `Capital.vue`: `stratDebts`, `stratMandatory` — по `openCredits(credits)`; `rankedDebts`
   — через `costliestCredits`.
4. `Ritual.vue`: `credit` = `costliestCredits(credits)[0]` вместо `credits[0]`; нет ни
   одного — корзины нет (как сейчас).

## Тесты

- `lib/finance.test.ts`: `budgetAmounts` — кредит с `principal: 0` не входит в d2 и не
  уменьшает `free`, с `principal > 0` входит; `openCredits` (удалённый и закрытый вне, 0%
  открытый — внутри); `costliestCredits` (0% и закрытые вне, порядок по ставке).
- `views/Budget.test.ts`, `views/Overview.test.ts`: кредит закрыт досрочкой на всю сумму
  (`store.applyPrepayment`) → «Свободно» выросло ровно на его платёж, строка d2 без него;
  до закрытия числа прежние (регрессия эталонов Блока 0/1).
- `views/Ritual.test.ts`: два кредита, первый по порядку документа закрыт (или 0%) →
  корзина «Досрочно по кредиту» считает эффект по открытому процентному.

## Критерии приёмки

- Браузер (стенд §6): закрыть тестовый кредит досрочкой на всю сумму → «Свободно в …» на
  Обзоре и в Бюджете выросло на его платёж, строка «Кредиты» без него; Ритуал не предлагает
  досрочку по закрытому; после PV-02 калькулятор его не учитывает. У второго профиля после
  синка — то же.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Момент «освободилось N ₸» в истории — RP-12 (Блок 2 RP); шаг плана в Ритуале — PV-16.
- Убирать закрытый кредит из списка Капитала — нет: строка остаётся с «долг закрыт».
- Правка `simulateStrategy` — нет (Р-3: закрытые просто не передаются).
