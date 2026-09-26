# RP-01 — «Еда и быт»: коммит только изменённого значения (фронт)

Блок 0 · MVP · Каталог: `frontend/` · Зависит от: — · Роли: member

## Контекст (что уже есть)

- Баг из смоука cutover (владелец: «слетел опять»): партнёр тапнул по полю «Еда и быт» и
  ушёл из него, ничего не меняя, — его устройство закоммитило старое значение со свежим
  `updatedAt`, и слияние LWW (`lib/merge.ts`) затёрло правку владельца.
- `components/kit/NumFieldBlur.vue:36-43`: `onBlur` → `emit('commit', text.value)` **всегда**,
  без сравнения с исходным; `onEnter` эмитит и вызывает `.blur()` → второй эмит. Локальный
  `text` сбрасывается из `props.initial` watch-ем (`:29-34`).
- Использования `NumFieldBlur`: `views/Budget.vue:240` («Еда и быт» →
  `handleD4Commit` → `financeStore.setCategoryAmount('d4', parseMoney(text))`, `:151-153`);
  `components/SalaryDialog.vue:169` (оклад → `correctSalary`), `:177` (день зарплаты,
  `kind="int"`); `views/Capital.vue:903` (`setAccountAmount`); `views/Deposit.vue:134, 138,
  147, 155`.
- Стор `stores/finance.ts`: `setCategoryAmount` (`:364-381`) всегда ставит `amount` и
  `updatedAt`; `correctSalary` (`:422`), `setAccountAmount` (`:518` → `updateAccount`),
  `setPerson`, `setDeposit` (`:522`) — тоже без проверки равенства. `mutateHouseholdDoc`
  всегда `dirty` + `scheduleSync`.
- React-эталон (`src/components/kit.tsx:306-328`) с той же ошибкой — не образец.

## Задача

1. `NumFieldBlur`: эмитить `commit`, только если распарсенное значение отличается от
   значения при входе в поле (от `initial`); один коммит на одно действие (Enter + blur —
   не два).
2. Защита в сторе (второй рубеж — поле не единственный путь): `setCategoryAmount`,
   `correctSalary`, `setAccountAmount`, `setPerson` и `setDeposit` при значении, равном
   текущему, ничего не меняют — ни `updatedAt`, ни `dirty`, ни `scheduleSync`.
3. Проверить остальные поля с коммитом по blur (`Capital.vue`: имя/заметка счёта через
   `updateAccount`) — тот же принцип «нет изменения — нет записи»; чинить только то, что
   пишет `updatedAt` без изменения.

## Тесты

- Юнит `NumFieldBlur` без DOM нельзя — логику сравнения вынести в чистую функцию рядом
  (например, в `lib/num.ts`) и покрыть: то же значение с другим форматированием
  («150 000» vs «150000») → нет коммита; другое → коммит.
- `stores/finance.test.ts`: `setCategoryAmount('d4', <текущее>)` не меняет `updatedAt` и
  статус; новое значение — меняет. То же для `correctSalary` и `setAccountAmount`.
- `lib/merge.test.ts` или `e2e/two-clients-sync.test.ts`: сценарий бага — клиент A меняет
  «Еда и быт», клиент B (старое значение) «коммитит» то же старое значение → после синка у
  обоих значение A.

## Критерии приёмки

- Сценарий бага на двух клиентах (разные профили браузера, локальный стенд из §6): A меняет
  «Еда и быт», B тапает по полю и уходит → у обоих значение A.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Смена стратегии слияния категорий (LWW остаётся — Р-7 касается записей, не полей).
- Переделка `NumField`/`NumFieldBlur` в один компонент.
