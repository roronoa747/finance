# PV-04 — Цель: накопленное не уходит в минус, прогноз «дорожает вместе с рынком» (фронт)

Блок 1 · MVP · Каталог: `frontend/` · Зависит от: — · Роли: member (взносы), все (просмотр)

## Контекст (что уже есть)

- Сверка А-6 (часть «минус»): `frontend/src/stores/finance.ts:1118-1129` `contribute(id, amount,
  by, note?)` — `push` движения, затем `:1126` `g.have = (g.seed ?? 0) + Σ movements` **без**
  `Math.max(0, …)`; `withdraw` (`:1131-1133`) = `contribute(id, −|amount|)`, UI снятия —
  `GoalDetail.vue:65-82` (`applyDeposit`), сумма не ограничена. Слияние `lib/merge.ts:90-102`
  `mergeGoal`: `have = Math.max(0, seed + sumMovements)` (`:100`) — локально минус, после
  слияния 0: экраны двух телефонов расходятся. React `src/store/useStore.ts:266-278`
  `contribute`: `have: Math.max(0, g.seed + total)` (`:275`).
  Где ещё читается `have` без обрезки: `GoalDetail.vue:39,41,141`; `Goals.vue:188,196,201`;
  `Overview.vue:426,433`; `Ritual.vue:59,89`. С обрезкой: `goalSavings` (`finance.ts:661-664`),
  `Capital.vue:424`.
- Сверка А-8: React `src/screens/GoalDetail.tsx:57-58` `remaining = max(0, need − have)`,
  `months = goalMonths(remaining, monthly)`; `:63-64` `indexed = Math.round(need × (1 +
  inflation)^(months/12))`; плашка `:145-148` (тон `warn`, после кнопки «Пополнить цель»
  `:141-143`, перед «Ритм цели»): «Цель дорожает вместе с рынком» — «При инфляции
  {(inflation*100).toFixed(1) с запятой}% в год к моменту достижения такая же покупка будет
  стоить около {money(indexed)}. Расчёт выше — в сегодняшних деньгах.» `goalMonths` при
  взносе 0 → `Infinity` (`finance.ts:152-155` React / Vue `:156`) — в React не обработано
  (`Infinity`).
  Vue `frontend/src/views/GoalDetail.vue:223-225`: `<Callout title="Дисциплина накоплений"
  tone="good">Регулярные пополнения помогают закрыть цель быстрее и защитить сбережения.</Callout>`
  на том же месте; `goal` `:35`, `remaining` `:39`, `months` `:40`, `goalMonths` и `money`
  импортированы (`:6-7`). Поля `deadline` у цели нет ни в React, ни во Vue.
- **Источник инфляции — Р-19:** константа `INFLATION = 0.102` в `lib/finance.ts` (React
  `defaultSettings.inflation = 0.102`, `useStore.ts:144-149`, в UI не правилась). Во Vue нет
  ни стора настроек, ни `settings` в `SyncDoc`; тип `Settings` (`types/finance.ts:299-304`) не
  используется — не подключать.
- `Callout` (kit): `title`, `tone?: 'warn' | 'good'` (дефолт `warn`).
- Тесты: `views/Goals.test.ts:165-196` — SSR `GoalDetail`, `:193` ждёт «Дисциплина накоплений»
  (сломается — поправить); `lib/merge.test.ts:40-97` — сумма 220 000, обрезку до 0 не покрывает;
  `stores/finance.test.ts` — есть `family()`-фикстура (`:720-734`).

## Задача

1. `stores/finance.ts` `contribute`: `have = Math.max(0, seed + Σ)` — одна формула с
   `mergeGoal`; движение пишется целиком (история не режется). Формулу вынести в
   `lib/finance.ts` (`goalHave(seed, movements)`) и использовать в обоих местах.
2. `lib/finance.ts`: `export const INFLATION = 0.102` (Р-19); `indexedNeed(need, months,
   inflation = INFLATION): number | null` — `null` при `!isFinite(months)`, иначе
   `Math.round(need × (1 + inflation)^(months/12))`.
3. `GoalDetail.vue`: плашку «Дисциплина накоплений» заменить плашкой React (текст дословно,
   тон `warn`, процент через `(INFLATION*100).toFixed(1)` с запятой); при `indexedNeed === null`
   (взнос 0) плашку не показывать.

## Тесты

- `stores/finance.test.ts`: `withdraw` больше накопленного → `have === 0`, движение записано
  полной суммой; следующий `contribute` считает от `seed + Σ` (не от 0).
- `lib/merge.test.ts`: цель с движениями в минус — `have` 0 с обеих сторон слияния (паритет
  стора и слияния).
- `lib/finance.test.ts`: `goalHave`; `indexedNeed(1_000_000, 24)` = `Math.round(1_000_000 ×
  1.102²)`; `months = Infinity` → `null`; результат целый.
- `views/Goals.test.ts`: SSR `GoalDetail` — «Цель дорожает вместе с рынком», «10,2%», «около
  {money(indexedNeed(...))}»; у цели с `monthly: 0` плашки нет; «Дисциплина накоплений» больше
  не ждать.

## Критерии приёмки

- Браузер: снять с цели больше, чем накоплено, → на экране 0, у второго профиля после синка 0;
  экран цели показывает «к моменту достижения … около N» и число совпадает с `indexedNeed`.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Поле «Уже накоплено» и правка `seed` через `updateGoal` — PV-19 (Блок 4).
- Порядок движений (React ставит новое в начало) — не потеря, не трогать.
- Настройка инфляции в UI — нет (Р-19).
