# PV-12 — Счета: валютный счёт (Б-16), удаление с предупреждениями и отвязкой целей (Б-21), повторный «+» (Б-15) (фронт)

Блок 2 · MVP · Каталог: `frontend/` · Зависит от: PV-09 · Роли: member (правка), viewer (просмотр)

## Контекст (что уже есть)

- **Б-16.** React `src/screens/Capital.tsx` `AddAccountDialog` `:210-354`: `fetchRates()`
  (`:228-237`), автоподстановка курса (`:240-243`), `inTenge = round(amount × rate)` (`:245-247`),
  запись `{currency, foreignAmount, rate, rateAt: now}` (`:258-260`); поля «Сумма в {currency}»
  (`:314`), «Курс: сколько тенге за 1 {currency}» (`:320-322`); тексты (`:323-331`):
  «Запрашиваем курс Нацбанка…», «Курс {source} на {date по ru-RU}. Можно заменить своим.»,
  «Курс Нацбанка сейчас недоступен — впишите вручную.»; (`:332-339`) «В капитале это
  **{money(inTenge)}**» + «Курс запоминается вместе с датой. Прошлые цифры от скачков курса не
  поедут — чтобы обновить, поменяете курс вручную.»; метка вклада «Ставка по вкладу, % годовых —
  если есть» (`:345`). Правка `AccountDialog` `:989-1098` (курс не запрашивает): «Сумма в
  {currency}» (`:1028-1037`) → `updateAccount(id, {foreignAmount: v, amount: round(v × (rate ??
  1))})`; «Курс…» (`:1038-1052`, `v > 0`) → `{rate: v, amount: round(foreignAmount × v), rateAt:
  now}`; текст «В капитале счёт стоит как {money(amount)} — по этому курсу.» (`:1053-1055`);
  для тенге — «Сумма, ₸» (`:1058-1063`).
  Vue: добавление `:1019-1031` (поле курса, «В капитале это»); `rateInfo`/`rateBusy`/`rateFailed`
  в script (`:197-199`, запрос `:220-230`, `formRate` `:236-238`) в шаблон не выведены; метка
  вклада `:1033` без «— если есть». Правка `:1043-1091`: только «Сумма на счёте, ₸» →
  `setAccountAmount` (`:1069-1075`) — и для валютного; `foreignAmount`/`rate` устаревают, а строка
  списка `:711` показывает `${foreignAmount} ${currency} · курс ${rate}`. `activeAccountSaved`
  (`:461`) не сбрасывается при смене счёта. `Account` (`types/finance.ts:168-203`): `amount`
  (тенге, база), `amountSetAt?`, `kind`, `currency?` (`KZT|USD|EUR|RUB`), `foreignAmount?`,
  `rate?`, `rateAt?`, `deposit?`. Стор: `updateAccount(id, patch)` (`:738-756`, `unchanged`,
  якорь при `amount` в patch `:734-736`), `setAccountAmount` (`:759-761`), `addAccount(a,
  isPrivate)` (`:679-726`). `payableAccounts` (`finance.ts:480`) исключает валютные из оплат —
  якорь при смене курса безопасен. Курс: `lib/fx.ts` `fetchRates()` → `GET /api/fx-rate`
  (`null` при ошибке), `formRate(info, currency, current, touched)`; Go отдаёт `{rates, date,
  source: "Национальный банк РК"}` (Р-15 — не менять).
- **Б-21.** React тексты: обязательство (`:682-686`) — PV-11; кредит (`:971-975`) — PV-10;
  счёт (`:1078-1094`): «Удалить счёт» / «Счёт исчезнет у обоих участников. Отменить нельзя.» +
  при привязанных целях (`attached = liveGoals(goals).filter(g => g.accountId === id)` `:1000`):
  « Накопления по {цели|целям} «A», «B» останутся на месте: они снова будут считаться отдельно,
  а не лежащими на этом счёте.» `useStore.ts:462-469` `removeAccount`: надгробие + `goals.map(g
  => g.accountId === id ? touch({...g, accountId: null}) : g)`. Vue `removeAccount(id)`
  (`stores/finance.ts:824-841`): только `deletedAt` (приватный — в `privateDoc`, общий — в
  `householdDoc`), **цели не отвязывает** → `goalSavings` (`finance.ts:661-664`, только
  `!accountId`) теряет их накопления из капитала; отвязку делать в `householdDoc` и для
  приватного счёта. Vue-тексты: счёт `:1085-1089` («Счёт будет удален. Это действие нельзя
  отменить.»), вклад `views/Deposit.vue:175-179`. `kit/DangerZone.vue`: `label`, `warning:
  string`, `confirmLabel`, emit `confirm` — для списка целей вычислить строку.
- **Б-15.** Vue `Capital.vue:145-156` `watch(() => route.query, …, {immediate: true})` только
  ставит флаги; при закрытии query не чистится (крестик, `@click.self`, Escape — `:639-652`);
  исключение — `applyExtraIncome` удаляет `income` через `router.replace` (`:180-184`).
  Повторный переход на тот же URL — дубликат навигации, watch не срабатывает. React
  `:58-71`: закрытие → `setParams({}, {replace: true})`. Ссылки «+» — `AppShell.vue:171-246`
  (`/capital?income=1`, `/capital?add=payment`, `/capital?add=debt`; `navigateAndClose` `:45-48`);
  ещё `Budget.vue:122, :137`, `Overview.vue:116, :127` (`?obligation=`, `?credit=`).
- Кит после PV-09: `Sheet`, `useSavedMark`, `NumFieldBlur`.

## Задача

1. `lib/finance.ts`: `fxToTenge(foreignAmount, rate)` → `Math.round(...)` целое (единственное
   место умножения на курс).
2. Добавление счёта: тексты о курсе (три состояния), «В капитале это …» + «Курс запоминается
   вместе с датой…», метка вклада «— если есть» (React дословно).
3. Правка счёта на `Sheet`: для валютного — «Сумма в {currency}» и «Курс: сколько тенге за 1
   {currency}» (`updateAccount` с `foreignAmount`/`rate`/`rateAt` и `amount = fxToTenge`), текст
   «В капитале счёт стоит как … — по этому курсу.»; для тенге — «Сумма, ₸» через
   `setAccountAmount`. `SavedMark` через `useSavedMark` (сбрасывается при смене счёта).
4. Удаление счёта: текст React с перечнем привязанных целей; `removeAccount` отвязывает цели
   (`accountId: null`, `updatedAt`) в `householdDoc` — и для приватного счёта. Тексты вклада —
   сверить с React `Deposit.tsx` (если отличаются — выровнять).
5. Б-15: при закрытии любой модалки, открытой из query (`add`, `income`, `credit`,
   `obligation`, `payoff`), — `router.replace` без этих параметров (одна функция закрытия);
   повторный «+» открывает форму снова.

## Тесты

- `lib/finance.test.ts`: `fxToTenge(100, 512.34)` = 51 234, целое.
- `stores/finance.test.ts`: `removeAccount` общего и приватного счёта → у привязанных целей
  `accountId null`, `goalSavings` снова их учитывает; `updateAccount` валютного с новым курсом
  → `amount` пересчитан, `rateAt` обновлён.
- `views/Capital.test.ts` (SSR): модалка USD-счёта — оба поля и текст «по этому курсу»; KZT —
  «Сумма, ₸»; `DangerZone` счёта с привязанной целью — текст с именем цели.
- e2e (файл блока, маршрут через `createMemoryHistory`): `/capital?add=debt` → закрыть →
  снова `/capital?add=debt` → форма открыта (`addDebtOpen`), query очищен после закрытия.

## Критерии приёмки

- Браузер: завести USD-счёт — курс подставился с датой и источником (стенд без сети: текст
  «недоступен — впишите вручную»); поправить сумму в валюте — тенге пересчитались, строка
  списка согласована; удалить счёт с привязанной целью — текст с её именем, накопления цели
  остались в капитале; «+» → «Кредит или рассрочка» дважды подряд — форма открывается оба раза.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Ручка курса в Go, новые валюты — нет (Р-15).
- Личные счета в «До зарплаты» — так задумано (Handoff Блока 1 RP).
- Правка `Goal.accountId` из UI — нет (никто не ставит; отвязка — на всякий случай, паритет).
