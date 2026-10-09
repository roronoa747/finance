# PN-19 — Шаблон «Подушка» → фонд семьи; «хватит на N месяцев» (фронт)

Блок 6 · MVP · Репо/каталог: `frontend/src/lib/finance.ts`, `views/GoalNew.vue`, `stores/finance.ts` · Зависит от: Блок 5 🏁 (шаблоны — Блок 3) · Роли: member

## Контекст (что уже есть)

- **Фонд уже есть** (Р-82 `идея-и-редизайн`, факт кода в Р-12): `Goal.fund?: 'reserve' | 'cushion'`, `fundMonths?`
  (`types/finance.ts:125-128`); `fundsOf(doc) → { reserve, cushion }` (`finance.ts:2835` — живой с `fund`, первый по
  id; иначе копилка `moneySettings.potGoalId`), `fundMonthsOf(kind, g, settings)` (:2846; умолчание
  `DEFAULT_MONEY_SETTINGS.cushionMonths = 3` :1132), очередь `queueOf` помечает `kind: 'fund'` (:2882-2887); в
  `monthPlan` «нужно» фонда = `fundMonthsOf × monthSpend`, где `monthSpend = duesTotal + spendTotal` (платежи + траты
  планов, :3130, :3157); `PlanQueueItem.need` — это оно. `goalTerm(item, goal, key)` даёт `need`/`remaining` экрану
  цели (`GoalDetail.vue:104-113`); для фонда — «Соберём в …»/«Собрано», поле «Месяцев трат» в «Подробнее»
  (`GoalDetail.vue:151-165, 423-431`, `setFundMonths` стора :1913).
- Стор `ensureFund(kind, need = 0): string` (`stores/finance.ts:1879-1910`) — одна на семью: есть — её id; копилка
  Блока 11 помечается фондом; иначе новая цель «Подушка» `template: 'cushion'`, `fund: 'cushion'`, `hue: 'teal'`.
  Сегодня зовётся только из «Месяца» (`MonthPlan.vue:336-339` — кнопки «+ фонд» для отсутствующих `reserve`/`cushion`).
- «Новая мечта» `views/GoalNew.vue`: шаг `pick` (плитки `GOAL_TYPES`, `pickType` :91-96) → шаг `form` (имя, сумма,
  срок → `monthly`) → `create()` :120-142 (`addGoal({ name, need, monthly, hue, template })` → фото `attachTemplate`).
  Выбор плитки «Подушка» сейчас создаёт **обычную мечту** с картинкой подушки — не фонд. `PhotoPicker` у существующей
  цели — только фото.
- Демо: `g-pot` «Подушка» `fund: 'cushion'` (`demo.ts:202-217`). «Мечты» фонды не показывают (Р-84: фонд героем не
  бывает; `Dreams.vue:47` — только `kind: 'goal'`); фонд виден в «Месяц → Цели и фонды», «Капитал → Цели · N» и на
  своём экране.
- Р-12: «нужно» считается само (3 месяца платежей и быта, поправимо), «есть» — накопленное, подпись «хватит на 1,2
  месяца», одна на семью. Новых полей не заводим.

## Задача

1. `finance.ts`: **`cushionCover(item: PlanQueueItem | undefined, goal: Goal, settings: MoneySettings): CushionCover`**
   — `{ need: item?.need ?? 0, have: goal.have, monthSpend: item ? need / fundMonthsOf('cushion', goal, settings) : 0,
   monthsNeeded: fundMonthsOf(...), months: monthSpend > 0 ? round1(have / monthSpend) : null }` (`round1` — одна
   десятая; «хватит на 1,2 месяца»); `need` — из строки очереди плана (не пересчитывать). Экспорт `round1`, если его
   нет (Блок 2 завёл в `inSalaries` — переиспользовать).
2. `GoalNew.vue`: плитка «Подушка» (`pickedType === 'cushion'`) — шаг формы **пропускается** (сумма считается сама):
   `create()` → `id = ensureFund('cushion')`; если фонд уже был (`fundsOf(doc).cushion` до вызова) — переход на его
   экран и тост «Подушка уже есть» (одна на семью); новая — `attachTemplate` с выбранным вариантом фото (`themePhotos`
   «cushion»), переход `/goals/:id`. В шаге `pick` под плиткой «Подушка» подпись плитки — как у всех (без текста).
3. Стор: `ensureFund` без изменений; `addGoal` для `template: 'cushion'` больше не зовётся из «Новой мечты» (тест).
4. Старые обычные цели с `template: 'cushion'` (созданы до блока) — не трогать (остаются мечтами).

## Тесты

- `finance.test.ts`: `cushionCover` — `need` из строки плана, `months` 1,2 при 360 000 / 300 000, null без трат;
  `monthsNeeded` — свой `fundMonths` или умолчание 3.
- `GoalNew.variants.dom.test.ts`: «Подушка» → `ensureFund`, формы нет, переход на экран фонда; второй раз — тот же
  id и тост; другая тема — прежний путь через форму.
- `stores/finance.test.ts`: `ensureFund` повторно — тот же id (есть — проверить).

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные; стенд: «Новая мечта → Подушка» → экран фонда с «нужно»,
  посчитанным само.

## Вне скоупа

- Экран подушки — PN-20. «Запас» — не трогаем (тот же код, если бесплатно; задачи нет). Показ фондов на «Мечтах» — Р-84.
