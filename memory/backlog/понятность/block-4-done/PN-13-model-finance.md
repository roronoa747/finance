# PN-13 — Модель и расчёты «Сбылось»: `doneAt`, деньги как покупка (фронт)

Блок 4 · MVP · Репо/каталог: `frontend/src/types/finance.ts`, `lib/finance.ts`, `stores/finance.ts`, `lib/merge.ts` · Зависит от: PN-12 (ворота ✅) · Роли: member

## Контекст (что уже есть)

- `Goal` (`types/finance.ts:77-131`): `have` = `seed` + Σ `movements` (всегда пересчитывается: `goalHave` `finance.ts:207`,
  стор `contribute` :1928, `mergeGoal` `lib/merge.ts:87-107` — движения объединяются по id), `accountId?` (деньги цели
  лежат на счёте — тогда в `goalSavings`/`capitalGoals` не входят: :1254-1257, :1275-1283), `pausedAt?`, `fund?`.
  Дат у цели нет (кроме `seedSetAt`, `pausedAt`, `updatedAt`); дата создания не хранится — есть даты движений.
- Новое необязательное поле записи регистрировать нигде не нужно (`mergeList` несёт поля; очистка — `null`, не
  удаление ключа; разведка составителя). Поля верхнего уровня `SyncDoc` — другое дело (не нужны здесь).
- Фильтры: `liveGoals(goals)` = без `deletedAt` (:728). Точки вызова (нужно решить по каждой — «активные» или «все
  живые»): `finance.ts` :685 (`strategyInputs`), :1111 (`hasBudgetData`), :1243 (`budgetAmounts`), :1255
  (`goalSavings`), :1277 (`capitalGoals`), :1940 (`progressMoments`), :2098 (`monthSummary`), :2315 (`pausedGoals`),
  :2520/:2647/:2711 (подушка плана), :2836 (`fundsOf`), :2866 (`queueOf`), :3489/:3613/:4208 (карты целей для
  записей); `lib/photos/goalPhoto.ts:96` (`retryTemplatePhotos`); `components/AppShell.vue:79` (заголовок);
  `views/Money.vue:29` (`netWorth`); `PlanSquare.vue:56`; `GoalDetail.vue:72`; `ExtraIncomeSheet.vue:22`;
  `GoalSheet.vue:31`; `AccountSheet.vue:92` (`accountGoals`).
- Стор: `updateGoal(id, patch)` (:1736-1755), `removeGoal`, `shiftAccountAmount(accountId, delta)` (сдвиг базы счёта;
  `GoalDetail.applyDeposit` :204 — пополнение со счёта сдвигает `-v`, снятие `+v`), `pauseGoal`, `queue`/`heroGoal`
  (:1772-1778, через `queueOf`).
- Даты: `movementMonth` (:2229), `monthsBetween(from, to)` (:2249), `monthKey`.
- Р-13: «деньги цели уходят как покупка»; Р-21: новые поля необязательны, старые документы читаются как есть.

## Задача

1. Тип: `Goal.doneAt?: string | null` — ISO момента «Сбылось»; `null` — вернули в мечты (очистка — `null`).
2. `finance.ts`: **`openGoals(goals)`** = `liveGoals` без `doneAt`; **`doneGoals(goals)`** = живые с `doneAt`, новые
   первыми. Перевести на `openGoals`: `goalSavings`, `capitalGoals` (капитал: деньги ушли покупкой), `queueOf`,
   `fundsOf`, `pausedGoals`, подушка плана (:2520/:2647/:2711), `strategyInputs`, `budgetAmounts`,
   `progressMoments`, `monthSummary`; экраны — `Money.vue:29`, `PlanSquare`, `ExtraIncomeSheet`, `AccountSheet`
   (деньги со счёта ушли — цель не на счёте). Оставить `liveGoals`: `hasBudgetData`, карты целей для записей истории
   (:3489/:3613/:4208), `retryTemplatePhotos` (альбому нужны фото), `AppShell` заголовок, `GoalDetail`/`GoalSheet`
   (сбывшаяся открывается). Каждое решение — комментарием в одну строку у места.
3. **`doneTerm(goal): number`** — месяцев от первого положительного движения (`movementMonth`) до `monthKey(doneAt)`,
   нет движений — от `seedSetAt`, нет — 1; минимум 1. **`doneLabel`** — на экране («за 14 месяцев», `plural`).
4. Стор: **`markGoalDone(id, { at?, by })`** — `updateGoal(id, { doneAt: at ?? now })`; если `accountId` →
   `shiftAccountAmount(accountId, -have)` (покупка списана со счёта; без счёта — накопление просто перестаёт быть
   активом через `openGoals`). **`undoGoalDone(id)`** — `doneAt: null`; был `accountId` → `shiftAccountAmount(+have)`.
   `heroGoal`/`queue` сбывшуюся не видят сами (через `queueOf`). `goalOrder.ids` — id сбывшейся выпадает из очереди
   без правки порядка (`queueOf` пропускает неизвестные). `pausedAt` не трогать.
5. Слияние: ничего не добавлять — `doneAt` едет полем записи (LWW по `updatedAt` цели); тест, что взнос партнёра
   офлайн после «Сбылось» не воскрешает активность (`doneAt` остаётся, `have` пересчитан). Двойной сдвиг счёта при
   «Сбылось» с двух телефонов офлайн — принятое ограничение, как у пополнений (записать в Handoff и §6).

## Тесты

- `moneyScreens.test.ts`: `netWorth` без сбывшейся (вне счёта — минус `have`); сбывшаяся на счёте — `capitalGoals` её
  не показывает, счёт сдвинут на `-have` (тест стора); `undoGoalDone` возвращает.
- `finance.test.ts`: `queueOf` и `fundsOf` без сбывшейся (сбывшаяся подушка не фонд семьи); `doneTerm` — 14 месяцев по
  движениям, 1 без движений; `doneGoals` порядок.
- `merge.test.ts`: `doneAt` переживает слияние со взносом партнёра; `null` очищает.
- Мутация «`goalSavings` считает сбывшиеся» — красная.

## Критерии приёмки

- Все числа — `finance.ts`; старый документ без `doneAt` — прежние числа (тест). `cd frontend && npm run build && npx
  vitest run` зелёные.

## Вне скоупа

- Экраны — PN-14. Событие `goal_done` в `/api/events` — нет: `CHECK kind` в миграции `000006`, новая миграция
  запрещена (Р-17) — хвост §4 с судьбой владельца.
