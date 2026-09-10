import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bank, CalendarPlus, Coins, CreditCard, House, Plus, Wallet } from '@phosphor-icons/react'
import {
  Card, Field, NumField, NumFieldBlur, Row, SavedMark, Section, Segmented, useSavedMark,
} from '@/components/kit'
import type { Account, Currency, PersonId } from '@/store/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain, ratePct } from '@/lib/money'
import { cn } from '@/lib/utils'
import { annuityMonths, annuityTotal, rateFromSchedule } from '@/lib/finance'
import {
  amountAt, goalSavings, nextChange, liveAccounts, liveCredits, liveGoals, liveObligations, netWorth, useStore,
} from '@/store/useStore'
import { addMonths, monthFrom, monthKey, monthTitle } from '@/lib/dates'
import { fetchRates, type FxRates } from '@/lib/fx'

const ICONS = {
  deposit: <Bank size={17} />,
  card: <CreditCard size={17} />,
  cash: <Coins size={17} />,
  envelope: <Wallet size={17} />,
}

export function Capital() {
  const [addOpen, setAddOpen] = useState(false)
  const navigate = useNavigate()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  /*
    Что открыто, записано в адрес. «Внеплановый доход» живёт в меню «+», а
    обязательство и кредит — в строках «Обзора» и «Бюджета»: там они только
    показываются, а правятся здесь, и без адреса пришлось бы искать нужную
    строку глазами после каждого перехода.
  */
  const [params, setParams] = useSearchParams()
  const incomeOpen = params.get('income') === '1'
  const setIncomeOpen = (v: boolean) => setParams(v ? { income: '1' } : {}, { replace: true })
  const obligationId = params.get('obligation')
  const creditId = params.get('credit')
  const setObligationId = (id: string | null) =>
    setParams(id ? { obligation: id } : {}, { replace: true })
  const setCreditId = (id: string | null) => setParams(id ? { credit: id } : {}, { replace: true })
  const store = useStore()
  const accounts = liveAccounts(store.accounts)
  const credits = liveCredits(store.credits)
  const obligations = liveObligations(store.obligations)
  const key = monthKey()
  const total = netWorth(store.accounts, store.credits, store.goals)
  const saved = goalSavings(store.goals)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Card>
        <div className="text-[13px] text-ink-2">Чистый капитал</div>
        <div className="font-display text-[30px] font-semibold tracking-[-0.025em] num">{money(total)}</div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
          {accounts.length > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-2">На счетах</span>
              <b className="num">{money(accounts.reduce((a, x) => a + x.amount, 0))}</b>
            </div>
          )}
          {saved > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-2">Накоплено по целям</span>
              <b className="num">{money(saved)}</b>
            </div>
          )}
          {credits.length > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-2">Долги</span>
              <b className="num text-warn">−{plain(credits.reduce((a, c) => a + c.principal, 0))}</b>
            </div>
          )}
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          Всё, что есть, минус всё, что должны. Накопления по целям тоже считаются: это ваши
          деньги, даже если счёт под них ещё не заведён.
        </p>
      </Card>

      <Section title="Где лежат деньги" />
      <Card flush>
        {accounts.map((a) =>
          a.deposit ? (
            <Row
              key={a.id}
              icon={ICONS[a.kind]}
              title={a.name}
              note={`${a.note} · ${ratePct(a.deposit.annualRate, 1)} годовых`}
              value={money(a.amount)}
              sub="условия вклада"
              onClick={() => navigate(`/capital/${a.id}`)}
            />
          ) : (
            <Row
              key={a.id}
              icon={ICONS[a.kind]}
              title={a.name}
              note={a.currency ? `${plain(a.foreignAmount ?? 0)} ${a.currency} · курс ${String(a.rate).replace('.', ',')}` : a.note}
              value={money(a.amount)}
              onClick={() => setAccountId(a.id)}
            />
          ),
        )}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setAccountOpen(true)}>
        <Plus size={16} weight="bold" /> Добавить счёт или накопления
      </Button>

      <Section title="Обязательства" />
      <Card flush>
        {credits.map((c) => {
          const months = annuityMonths(c.principal, c.annualRate, c.payment)
          const overpay = annuityTotal(c.principal, c.annualRate, c.payment) - c.principal
          return (
            <Row
              key={c.id}
              icon={<CreditCard size={17} />}
              title={c.name}
              note={`${c.annualRate > 0 ? `ГЭСВ ${ratePct(c.annualRate, 1)}` : 'без процентов'} · ${Math.ceil(months)} платежей`}
              value={money(c.principal)}
              sub={overpay > 0 ? `переплата ${plain(Math.round(overpay))}` : undefined}
              onClick={() => setCreditId(c.id)}
            />
          )
        })}
        {obligations
          .filter((o) => !o.parentId)
          .map((o) => (
            <Row
              key={o.id}
              icon={<House size={17} />}
              title={o.name}
              note={o.estimate ? 'оценка · ' + o.note : o.note}
              value={money(amountAt(o, key))}
              sub={nextChange(o, key) ? 'сумма изменится' : 'в месяц'}
              onClick={() => setObligationId(o.id)}
            />
          ))}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setAddOpen(true)}>
        <Plus size={16} weight="bold" /> Добавить кредит
      </Button>

      <AddAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ExtraIncomeDialog open={incomeOpen} onOpenChange={setIncomeOpen} />

      <AddCreditDialog open={addOpen} onOpenChange={setAddOpen} />
      <ObligationDialog id={obligationId} onClose={() => setObligationId(null)} />
      <CreditDialog id={creditId} onClose={() => setCreditId(null)} />
      <AccountDialog id={accountId} onClose={() => setAccountId(null)} />
    </div>
  )
}

const KINDS: { value: Account['kind']; label: string }[] = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'deposit', label: 'Вклад' },
  { value: 'envelope', label: 'Конверт' },
]

/** Счёт, наличные, вклад или конверт — в том числе в валюте. */
function AddAccountDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const addAccount = useStore((s) => s.addAccount)

  const [name, setName] = useState('')
  const [kind, setKind] = useState<Account['kind']>('card')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('KZT')
  const [rate, setRate] = useState('')
  const [depositRate, setDepositRate] = useState('')
  // Курс тянем от Нацбанка, но оставляем возможность вписать свой.
  const [rateInfo, setRateInfo] = useState<FxRates | null>(null)
  const [rateBusy, setRateBusy] = useState(false)
  const [rateFailed, setRateFailed] = useState(false)

  const foreign = currency !== 'KZT'

  useEffect(() => {
    if (!open || !foreign || rateInfo || rateBusy) return
    setRateBusy(true)
    fetchRates()
      .then((r) => {
        if (r) setRateInfo(r)
        else setRateFailed(true)
      })
      .finally(() => setRateBusy(false))
  }, [open, foreign, rateInfo, rateBusy])

  // Подставляем курс выбранной валюты, пока человек не вписал свой.
  useEffect(() => {
    const auto = rateInfo?.rates?.[currency]
    if (auto && !rate) setRate(String(auto))
  }, [rateInfo, currency]) // eslint-disable-line react-hooks/exhaustive-deps
  const rateValue = parseFloat(rate.replace(',', '.'))
  const inTenge = foreign
    ? Math.round(parseMoney(amount) * (Number.isFinite(rateValue) ? rateValue : 0))
    : parseMoney(amount)
  const ready = parseMoney(amount) > 0 && (!foreign || inTenge > 0)

  function create() {
    if (!ready) return
    const annual = parseFloat(depositRate.replace(',', '.'))
    addAccount({
      name: name.trim() || KINDS.find((k) => k.value === kind)!.label,
      note: foreign ? `${plain(parseMoney(amount))} ${currency}` : '',
      amount: inTenge,
      kind,
      ...(foreign
        ? { currency, foreignAmount: parseMoney(amount), rate: rateValue, rateAt: new Date().toISOString() }
        : {}),
      ...(kind === 'deposit' && Number.isFinite(annual) && annual > 0
        ? { deposit: { annualRate: annual / 100, months: 12, monthlyTopUp: 0, capitalize: true } }
        : {}),
    })
    setName(''); setAmount(''); setRate(''); setDepositRate('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">Счёт или накопления</DialogTitle></DialogHeader>

        <Field label="Что это">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value)}
                aria-pressed={kind === k.value}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-[13.5px]',
                  kind === k.value ? 'border-brand bg-brand-soft font-medium' : 'border-line bg-surface-2 text-ink-2',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Kaspi Gold" />
        </Field>

        <Field label="Валюта">
          <div className="grid grid-cols-4 gap-2">
            {(['KZT', 'USD', 'EUR', 'RUB'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-[13.5px]',
                  currency === c ? 'border-brand bg-brand-soft font-medium' : 'border-line bg-surface-2 text-ink-2',
                )}
              >
                {c === 'KZT' ? '₸' : c === 'USD' ? '$' : c === 'EUR' ? '€' : '₽'}
              </button>
            ))}
          </div>
        </Field>

        <Field label={foreign ? `Сумма в ${currency}` : 'Сумма, ₸'}>
          <NumField value={amount} onValue={setAmount} />
        </Field>

        {foreign && (
          <>
            <Field label={`Курс: сколько тенге за 1 ${currency}`}>
              <NumField value={rate} onValue={setRate} kind="rate" placeholder="533" />
            </Field>
            <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-3">
              {rateBusy
                ? 'Запрашиваем курс Нацбанка…'
                : rateInfo
                  ? `Курс ${rateInfo.source} на ${new Date(rateInfo.date).toLocaleDateString('ru-RU')}. Можно заменить своим.`
                  : rateFailed
                    ? 'Курс Нацбанка сейчас недоступен — впишите вручную.'
                    : ''}
            </p>
            {inTenge > 0 && (
              <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px]">
                В капитале это <b className="num">{money(inTenge)}</b>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                  Курс запоминается вместе с датой. Прошлые цифры от скачков курса не поедут —
                  чтобы обновить, поменяете курс вручную.
                </p>
              </div>
            )}
          </>
        )}

        {kind === 'deposit' && (
          <Field label="Ставка по вкладу, % годовых — если есть">
            <NumField value={depositRate} onValue={setDepositRate} kind="rate" placeholder="16,5" />
          </Field>
        )}

        <Button onClick={create} disabled={!ready} className="w-full">Добавить</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Внеплановый доход: премия, подарок, возврат налога.
 *
 * Отдельный сценарий, потому что это ровно тот момент, когда отложить легче
 * всего — деньги ещё не считаются «своими». Если такие поступления просто
 * растворяются в бюджете, самая доступная возможность накопить проходит мимо.
 */
function ExtraIncomeDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { people, contribute, setAccountAmount } = useStore()
  const goals = liveGoals(useStore((s) => s.goals))
  const accounts = liveAccounts(useStore((s) => s.accounts))

  const [amount, setAmount] = useState('')
  const [by, setBy] = useState<PersonId>(people[0]?.id ?? 'a')
  const [target, setTarget] = useState('')

  const value = parseMoney(amount)
  const ready = value > 0 && Boolean(target)

  function apply() {
    if (!ready) return
    const [kind, id] = target.split(':')
    if (kind === 'goal') contribute(id, value, by)
    else {
      const acc = accounts.find((a) => a.id === id)
      if (acc) setAccountAmount(id, acc.amount + value)
    }
    setAmount(''); setTarget('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">Внеплановый доход</DialogTitle></DialogHeader>
        <p className="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-2">
          Премия, подарок, возврат налога — то, чего нет в плане месяца. Направьте сразу,
          пока деньги не разошлись по мелочам.
        </p>

        <Field label="Сумма, ₸">
          <NumField value={amount} onValue={setAmount} autoFocus />
        </Field>

        {people.length > 1 && (
          <Field label="Кому пришло">
            <Segmented<PersonId>
              value={by}
              onChange={setBy}
              options={people.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
        )}

        <Field label="Куда направить">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px]"
          >
            <option value="">Выберите…</option>
            {goals.length > 0 && (
              <optgroup label="В цель">
                {goals.map((g) => <option key={g.id} value={`goal:${g.id}`}>{g.name}</option>)}
              </optgroup>
            )}
            {accounts.length > 0 && (
              <optgroup label="На счёт">
                {accounts.map((a) => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}
              </optgroup>
            )}
          </select>
        </Field>

        {!goals.length && !accounts.length && (
          <p className="mb-3 text-[12.5px] text-ink-3">
            Сначала заведите цель или счёт — иначе деньги некуда положить.
          </p>
        )}

        <Button onClick={apply} disabled={!ready} className="w-full">Записать</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Обязательство: правка и запланированное изменение суммы.
 *
 * Здесь живёт главная механика приложения. Сумма не перезаписывается —
 * у обязательства копятся версии с месяцем вступления в силу. Из соседних
 * версий приложение само выводит событие «с ноября освободится 60 000 ₸»
 * и предлагает решить, куда эти деньги направить.
 *
 * Поэтому правка суммы и изменение суммы — РАЗНЫЕ действия:
 *   • «Исправить» — сумма была введена неверно, историю менять незачем;
 *   • «Запланировать» — сумма действительно меняется с какого-то месяца,
 *     и старая должна остаться, иначе не с чем сравнивать.
 * Если свалить их в одно поле, человек неизбежно затрёт прошлое, думая,
 * что меняет будущее.
 */
function ObligationDialog({
  id, onClose,
}: { id: string | null; onClose: () => void }) {
  const obligation = useStore((s) => s.obligations.find((o) => o.id === id))
  const { correctObligation, updateObligation, amendObligation, removeObligation } = useStore()
  const key = monthKey()

  const [amount, setAmount] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [fromMonth, setFromMonth] = useState(addMonths(key, 1))
  const [reason, setReason] = useState('')
  const [planning, setPlanning] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const current = obligation ? amountAt(obligation, key) : 0
  useEffect(() => {
    if (obligation) {
      setAmount(plain(amountAt(obligation, monthKey())))
      setNewAmount('')
      setReason('')
      setPlanning(false)
      setConfirm(false)
      setFromMonth(addMonths(monthKey(), 1))
    }
  }, [obligation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useSavedMark(obligation?.id, obligation?.updatedAt)

  if (!obligation) return null

  const months = Array.from({ length: 13 }, (_, i) => addMonths(key, i))
  const planned = parseMoney(newAmount)
  const delta = planned > 0 ? planned - current : 0

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        /* Правка существующей записи не должна выбрасывать клавиатуру и выделять название. */
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            {obligation.name}
            <SavedMark on={saved} />
          </DialogTitle>
        </DialogHeader>

        <Field label="Название">
          <Input
            defaultValue={obligation.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== obligation.name) updateObligation(obligation.id, { name: v })
            }}
          />
        </Field>

        <Field label="Сумма сейчас, ₸">
          <NumField
            value={amount}
            onValue={setAmount}
            onBlur={() => {
              const v = parseMoney(amount)
              if (v > 0 && v !== current) correctObligation(obligation.id, v)
            }}
          />
        </Field>
        <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
          Это исправление: сумма была введена неверно. Если платёж меняется
          с какого-то месяца — не трогайте это поле, а запланируйте изменение ниже.
        </p>

        <Field label="День платежа">
          <NumFieldBlur
            initial={String(obligation.day)}
            onCommit={(text) => {
              const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
              if (v !== obligation.day) updateObligation(obligation.id, { day: v })
            }}
            kind="int"
          />
        </Field>

        <label className="mb-3 flex items-center gap-2.5 text-[13.5px]">
          <input
            type="checkbox"
            checked={Boolean(obligation.estimate)}
            onChange={(e) => updateObligation(obligation.id, { estimate: e.target.checked })}
            className="size-4 accent-[var(--brand)]"
          />
          Сумма плавает — показывать как оценку
        </label>

        {!planning ? (
          <Button variant="outline" className="mb-3 w-full bg-surface-2" onClick={() => setPlanning(true)}>
            <CalendarPlus size={16} /> Запланировать изменение
          </Button>
        ) : (
          <div className="mb-3 rounded-xl border border-brand p-3.5">
            <Field label="Новая сумма, ₸">
              <NumField value={newAmount} onValue={setNewAmount} placeholder={plain(current)} autoFocus />
            </Field>
            <Field label="С какого месяца">
              <select
                value={fromMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px]"
              >
                {months.map((m) => (
                  <option key={m} value={m}>{monthTitle(m)}</option>
                ))}
              </select>
            </Field>
            <Field label="Причина">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Переезд, индексация…" />
            </Field>

            {planned > 0 && delta !== 0 && (
              <div className={cn(
                'mb-3 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed',
                delta < 0 ? 'bg-brand-soft text-ink-2' : 'bg-warn-soft text-ink-2',
              )}>
                {delta < 0
                  ? <>С {monthFrom(fromMonth)} освободится <b>{money(-delta)}</b> в месяц — {money(-delta * 12)} за год. Приложение предложит решить, куда их направить.</>
                  : <>С {monthFrom(fromMonth)} платёж вырастет на <b>{money(delta)}</b> в месяц.</>}
              </div>
            )}

            <p className="mb-3 text-[12px] leading-relaxed text-ink-3">
              Месяц, который выберете, оплачивается уже по новой сумме. Если переезд
              в середине месяца, ставьте следующий: за текущий вы платите по-старому.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPlanning(false)}>Отмена</Button>
              <Button
                className="flex-1"
                disabled={planned <= 0}
                onClick={() => {
                  amendObligation(obligation.id, fromMonth, planned, reason.trim() || undefined)
                  setPlanning(false)
                  setNewAmount('')
                }}
              >
                Запланировать
              </Button>
            </div>
          </div>
        )}

        {obligation.versions.length > 1 && (
          <>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">История суммы</div>
            <div className="mb-3 flex flex-col gap-1.5">
              {[...obligation.versions].sort((a, b) => b.from.localeCompare(a.from)).map((v) => (
                <div key={v.from} className="flex items-baseline gap-2 text-[13px]">
                  <span className="text-ink-3">{v.from <= key ? 'с' : 'станет с'} {monthFrom(v.from)}</span>
                  <b className="ml-auto num">{money(v.amount)}</b>
                  {v.reason && <span className="text-[12px] text-ink-3">{v.reason}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <Button onClick={onClose} className="mb-3 w-full">Готово</Button>

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Обязательство исчезнет у обоих участников вместе с историей суммы.
                Отменить нельзя.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeObligation(obligation.id); onClose() }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить обязательство
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Второй и последующие кредиты.
 *
 * В мастере заводится один, основной — там важно не утомить человека. Всё
 * остальное добавляется здесь, когда до этого дойдут руки.
 *
 * Ставку можно не знать: если указать, сколько платежей осталось, она
 * выводится из суммы, платежа и срока однозначно.
 */
function AddCreditDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const addCredit = useStore((s) => s.addCredit)

  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [payment, setPayment] = useState('')
  const [mode, setMode] = useState<'rate' | 'term'>('rate')
  const [rate, setRate] = useState('')
  const [term, setTerm] = useState('')
  const [day, setDay] = useState('12')

  const resolvedRate =
    mode === 'rate'
      ? (() => {
          const v = parseFloat(rate.replace(',', '.'))
          // Ноль — это рассрочка без процентов, а не «ставку не ввели».
          return Number.isFinite(v) && v >= 0 ? v / 100 : null
        })()
      : rateFromSchedule(parseMoney(principal), parseMoney(payment), parseMoney(term))

  const ready = parseMoney(principal) > 0 && parseMoney(payment) > 0 && resolvedRate !== null

  function create() {
    if (!ready) return
    // Сумму раздела «Кредиты» здесь не записываем: она складывается из платежей
    // сама. Хранить её вторым числом — это ровно тот случай, из-за которого
    // бюджет уже однажды остался в нулях.
    addCredit({
      name: name.trim() || 'Кредит',
      note: 'ежемесячный платёж',
      principal: parseMoney(principal),
      annualRate: resolvedRate ?? 0,
      payment: parseMoney(payment),
      day: Math.min(28, Math.max(1, parseMoney(day) || 1)),
    })
    setName(''); setPrincipal(''); setPayment(''); setRate(''); setTerm('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">Ещё один кредит</DialogTitle></DialogHeader>

        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, рассрочка на телефон" />
        </Field>
        <Field label="Остаток долга, ₸">
          <NumField value={principal} onValue={setPrincipal} placeholder="600 000" />
        </Field>
        <Field label="Платёж в месяц, ₸">
          <NumField value={payment} onValue={setPayment} placeholder="55 000" />
        </Field>

        <Field label="Что знаете про ставку">
          <Segmented<'rate' | 'term'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'rate', label: 'Знаю ставку' },
              { value: 'term', label: 'Знаю срок' },
            ]}
          />
        </Field>

        {mode === 'rate' ? (
          <Field label="Ставка (ГЭСВ), % годовых">
            <NumField value={rate} onValue={setRate} kind="rate" placeholder="23,4" />
          </Field>
        ) : (
          <Field label="Сколько платежей осталось">
            <NumField value={term} onValue={setTerm} kind="int" placeholder="12" />
          </Field>
        )}

        {mode === 'term' && parseMoney(term) > 0 && parseMoney(payment) > 0 && (
          resolvedRate !== null ? (
            <div className="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
              <span className="text-[12.5px] text-ink-2">Ставка получается</span>
              <div className="font-display text-[20px] font-semibold tracking-[-0.02em] num">
                {ratePct(resolvedRate, 1)} годовых
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
              При таком платеже долг за этот срок не закрывается — проверьте суммы.
            </div>
          )
        )}

        <Field label="День платежа">
          <NumField value={day} onValue={setDay} kind="int" />
        </Field>

        <Button onClick={create} disabled={!ready} className="w-full">Добавить</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Правка кредита. До этого кредит можно было только завести и удалить: строка
 * в списке никуда не вела, а платёж и остаток меняются постоянно.
 *
 * Остаток правится руками намеренно. Приложение не знает, сколько банк списал
 * на самом деле — там комиссии, страховки и досрочные погашения, — и подставлять
 * вместо человека расчётную цифру значит тихо разойтись с выпиской.
 */
function CreditDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const credit = useStore((s) => s.credits.find((c) => c.id === id))
  const updateCredit = useStore((s) => s.updateCredit)
  const removeCredit = useStore((s) => s.removeCredit)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => { setConfirm(false) }, [id])

  const saved = useSavedMark(credit?.id, credit?.updatedAt)

  if (!credit) return null

  const months = annuityMonths(credit.principal, credit.annualRate, credit.payment)
  const overpay = annuityTotal(credit.principal, credit.annualRate, credit.payment) - credit.principal
  const closes = Number.isFinite(months) && months > 0

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        /* Правка существующей записи не должна выбрасывать клавиатуру и выделять название. */
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            {credit.name}
            <SavedMark on={saved} />
          </DialogTitle>
        </DialogHeader>

        <Field label="Название">
          <Input
            defaultValue={credit.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== credit.name) updateCredit(credit.id, { name: v })
            }}
          />
        </Field>

        <Field label="Остаток долга, ₸">
          <NumFieldBlur
            initial={plain(credit.principal)}
            onCommit={(text) => {
              const v = parseMoney(text)
              if (v > 0 && v !== credit.principal) updateCredit(credit.id, { principal: v })
            }}
          />
        </Field>

        <Field label="Платёж в месяц, ₸">
          <NumFieldBlur
            initial={plain(credit.payment)}
            onCommit={(text) => {
              const v = parseMoney(text)
              if (v > 0 && v !== credit.payment) updateCredit(credit.id, { payment: v })
            }}
          />
        </Field>

        <Field label="Ставка (ГЭСВ), % годовых">
          <NumFieldBlur
            initial={(credit.annualRate * 100).toFixed(1).replace('.', ',')}
            kind="rate"
            onCommit={(text) => {
              const v = parseFloat(text.replace(',', '.'))
              // Ноль законен: рассрочка без процентов. Раньше он отбрасывался,
              // и правка на 0 молча не сохранялась.
              if (Number.isFinite(v) && v >= 0) updateCredit(credit.id, { annualRate: v / 100 })
            }}
          />
        </Field>

        <Field label="День платежа">
          <NumFieldBlur
            initial={String(credit.day)}
            kind="int"
            onCommit={(text) => {
              const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
              if (v !== credit.day) updateCredit(credit.id, { day: v })
            }}
          />
        </Field>

        <Field label="Примечание">
          <Input
            defaultValue={credit.note}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== credit.note) updateCredit(credit.id, { note: v })
            }}
          />
        </Field>

        {closes ? (
          <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-ink-2">Платежей осталось</span>
              <b className="num">{Math.ceil(months)}</b>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-ink-2">Переплата до конца</span>
              <b className="num text-warn">{money(Math.round(overpay))}</b>
            </div>
          </div>
        ) : (
          <div className="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
            При таком платеже долг не закрывается: проценты съедают его целиком.
            Проверьте остаток, платёж и ставку.
          </div>
        )}

        <Button onClick={onClose} className="mb-3 w-full">Готово</Button>

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Кредит исчезнет у обоих участников, и платёж перестанет учитываться
                в бюджете. Отменить нельзя.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeCredit(credit.id); onClose() }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить кредит
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Правка счёта. Раньше счёт можно было только завести: ни переименовать, ни
 * поправить сумму, ни удалить — и первый же заведённый по ошибке счёт оставался
 * в капитале навсегда.
 *
 * Валютный счёт хранит сумму в валюте и курс, а в капитал отдаёт уже тенге:
 * пересчёт живёт в одном месте, а не на каждом экране.
 */
function AccountDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const account = useStore((s) => s.accounts.find((a) => a.id === id))
  const updateAccount = useStore((s) => s.updateAccount)
  const removeAccount = useStore((s) => s.removeAccount)
  const goals = useStore((s) => s.goals)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => { setConfirm(false) }, [id])

  const saved = useSavedMark(account?.id, account?.updatedAt)

  if (!account) return null

  const foreign = Boolean(account.currency)
  const attached = liveGoals(goals).filter((g) => g.accountId === account.id)

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        /* Правка существующей записи не должна выбрасывать клавиатуру и выделять название. */
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            {account.name}
            <SavedMark on={saved} />
          </DialogTitle>
        </DialogHeader>

        <Field label="Название">
          <Input
            defaultValue={account.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== account.name) updateAccount(account.id, { name: v })
            }}
          />
        </Field>

        {foreign ? (
          <>
            <Field label={`Сумма в ${account.currency}`}>
              <NumFieldBlur
                initial={plain(account.foreignAmount ?? 0)}
                onCommit={(text) => {
                  const v = parseMoney(text)
                  const rate = account.rate ?? 1
                  updateAccount(account.id, { foreignAmount: v, amount: Math.round(v * rate) })
                }}
              />
            </Field>
            <Field label={`Курс: сколько тенге за 1 ${account.currency}`}>
              <NumFieldBlur
                initial={String(account.rate ?? '').replace('.', ',')}
                kind="rate"
                onCommit={(text) => {
                  const v = parseFloat(text.replace(',', '.'))
                  if (!Number.isFinite(v) || v <= 0) return
                  updateAccount(account.id, {
                    rate: v,
                    amount: Math.round((account.foreignAmount ?? 0) * v),
                    rateAt: new Date().toISOString(),
                  })
                }}
              />
            </Field>
            <p className="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-3">
              В капитале счёт стоит как {money(account.amount)} — по этому курсу.
            </p>
          </>
        ) : (
          <Field label="Сумма, ₸">
            <NumFieldBlur
              initial={plain(account.amount)}
              onCommit={(text) => updateAccount(account.id, { amount: parseMoney(text) })}
            />
          </Field>
        )}

        <Field label="Примечание">
          <Input
            defaultValue={account.note}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== account.note) updateAccount(account.id, { note: v })
            }}
          />
        </Field>

        <Button onClick={onClose} className="mb-3 w-full">Готово</Button>

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Счёт исчезнет у обоих участников. Отменить нельзя.
                {attached.length > 0 && (
                  <>
                    {' '}Накопления по {attached.length === 1 ? 'цели' : 'целям'}
                    {' «'}{attached.map((g) => g.name).join('», «')}{'» '}
                    останутся на месте: они снова будут считаться отдельно, а не
                    лежащими на этом счёте.
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeAccount(account.id); onClose() }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить счёт
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
