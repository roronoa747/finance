import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bank, CalendarPlus, Coins, CreditCard, House, Plus, Wallet } from '@phosphor-icons/react'
import {
  Card, DangerZone, Field, Hint, NumField, NumFieldBlur, Row, SavedMark, Section, Segmented, useSavedMark,
} from '@/components/kit'
import type { Account, Credit, Currency, Obligation, Person, PersonId } from '@/store/types'
import type { CategoryKey } from '@/lib/palette'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain, ratePct } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  annuityMonths, annuityTotal, debtCost, halfOverpayExtra, lumpSum, prepayment, rateFromSchedule,
} from '@/lib/finance'
import {
  amountAt, goalSavings, nextChange, liveAccounts, liveCredits, liveGoals,
  liveObligations, netWorth, useStore,
} from '@/store/useStore'
import { MONTHS_NOM, addMonths, monthFrom, monthKey, monthTitle } from '@/lib/dates'
import { fetchRates, type FxRates } from '@/lib/fx'

/**
 * Подпись под названием платежа. Собирается из того, что человек про него
 * сказал: чей он, как часто списывается и точна ли сумма. Чужая подписка,
 * висящая в общем списке без имени, выглядит как общая трата.
 */
function obligationNote(o: Obligation, people: Person[]): string {
  const parts: string[] = []
  const owner = o.who ? people.find((p) => p.id === o.who)?.name : null
  if (owner) parts.push(owner)
  if (o.every === 'year') parts.push('раз в год')
  if (o.estimate) parts.push('оценка')
  if (o.note && !parts.length) parts.push(o.note)
  return parts.join(' · ')
}

const ICONS = {
  deposit: <Bank size={17} />,
  card: <CreditCard size={17} />,
  cash: <Coins size={17} />,
  envelope: <Wallet size={17} />,
}

export function Capital() {

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
  const addOpen = params.get('add') === 'debt'
  const paymentOpen = params.get('add') === 'payment'
  const setAddOpen = (v: boolean) => setParams(v ? { add: 'debt' } : {}, { replace: true })
  const setPaymentOpen = (v: boolean) => setParams(v ? { add: 'payment' } : {}, { replace: true })
  const setIncomeOpen = (v: boolean) => setParams(v ? { income: '1' } : {}, { replace: true })
  const obligationId = params.get('obligation')
  const creditId = params.get('credit')
  const payoffId = params.get('payoff')
  const setPayoffId = (v: string | null) => setParams(v ? { payoff: v } : {}, { replace: true })
  const setObligationId = (id: string | null) =>
    setParams(id ? { obligation: id } : {}, { replace: true })
  const setCreditId = (id: string | null) => setParams(id ? { credit: id } : {}, { replace: true })
  const store = useStore()
  const accounts = liveAccounts(store.accounts)
  const credits = liveCredits(store.credits)
  const obligations = liveObligations(store.obligations)
  const people = store.people
  const key = monthKey()
  const total = netWorth(store.accounts, store.credits, store.goals)
  const saved = goalSavings(store.goals)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Card>
        <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
          Чистый капитал
          <Hint>
            Всё, что есть, минус всё, что должны. Накопления по целям тоже считаются:
            это ваши деньги, даже если счёт под них ещё не заведён.
          </Hint>
        </div>
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
              note={obligationNote(o, people)}
              value={money(amountAt(o, key))}
              sub={nextChange(o, key) ? 'сумма изменится' : 'в месяц'}
              onClick={() => setObligationId(o.id)}
            />
          ))}
      </Card>

      <div className="flex flex-col gap-2">
        <Button variant="outline" className="w-full bg-surface-2" onClick={() => setPaymentOpen(true)}>
          <Plus size={16} weight="bold" /> Подписка или услуга
        </Button>
        <Button variant="outline" className="w-full bg-surface-2" onClick={() => setAddOpen(true)}>
          <Plus size={16} weight="bold" /> Долг или рассрочка
        </Button>
      </div>

      <DebtAdvice credits={credits} onPayoff={setPayoffId} />

      <AddAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ExtraIncomeDialog open={incomeOpen} onOpenChange={setIncomeOpen} />

      <AddDebtDialog open={addOpen} onOpenChange={setAddOpen} />
      <AddObligationDialog open={paymentOpen} onOpenChange={setPaymentOpen} />
      <ObligationDialog id={obligationId} onClose={() => setObligationId(null)} />
      <CreditDialog id={creditId} onClose={() => setCreditId(null)} onPayoff={setPayoffId} />
      <AccountDialog id={accountId} onClose={() => setAccountId(null)} />
      <PayoffDialog id={payoffId} onClose={() => setPayoffId(null)} />
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
  const people = useStore((s) => s.people)
  const key = monthKey()

  const [amount, setAmount] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [fromMonth, setFromMonth] = useState(addMonths(key, 1))
  const [reason, setReason] = useState('')
  const [planning, setPlanning] = useState(false)

  const current = obligation ? amountAt(obligation, key) : 0
  useEffect(() => {
    if (obligation) {
      setAmount(plain(amountAt(obligation, monthKey())))
      setNewAmount('')
      setReason('')
      setPlanning(false)
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

        <Field label="Как часто">
          <Segmented<'month' | 'year'>
            value={obligation.every === 'year' ? 'year' : 'month'}
            onChange={(v) => updateObligation(obligation.id, {
              every: v,
              month: v === 'year' ? obligation.month ?? Number(key.split('-')[1]) : undefined,
            })}
            options={[
              { value: 'month', label: 'Каждый месяц' },
              { value: 'year', label: 'Раз в год' },
            ]}
          />
        </Field>

        {obligation.every === 'year' && (
          <>
            <Field label="Месяц списания">
              <div className="grid grid-cols-4 gap-1.5">
                {MONTHS_NOM.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={(obligation.month ?? 1) === i + 1}
                    onClick={() => updateObligation(obligation.id, { month: i + 1 })}
                    className={cn(
                      'rounded-lg border px-1 py-1.5 text-[12px]',
                      (obligation.month ?? 1) === i + 1
                        ? 'border-brand bg-brand-soft font-semibold text-brand'
                        : 'border-line text-ink-2',
                    )}
                  >
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </Field>
            <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
              В плане месяца этот платёж занимает {money(Math.round(current / 12))} —
              годовая сумма делится на двенадцать.
            </p>
          </>
        )}

        {people.length > 1 && (
          <Field label="Чьё это">
            <Segmented<'all' | PersonId>
              value={obligation.who ?? 'all'}
              onChange={(v) => updateObligation(obligation.id, { who: v === 'all' ? null : v })}
              options={[
                { value: 'all', label: 'Общее' },
                ...people.map((p) => ({ value: p.id as 'all' | PersonId, label: p.name })),
              ]}
            />
          </Field>
        )}

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

        <DangerZone
          label="Удалить обязательство"
          warning="Обязательство исчезнет у обоих участников вместе с историей суммы. Отменить нельзя."
          onConfirm={() => { removeObligation(obligation.id); onClose() }}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Долг: кредит, рассрочка, займ у родителей.
 *
 * Слово «кредит» здесь не годится. Рассрочка на телефон — не кредит, процентов
 * в ней нет, и заказчик справедливо не хотел заводить её под этим словом.
 *
 * Главное правило этой формы: она не отказывает. Человек переносит цифры из
 * банковского приложения, а не сочиняет их, и если они не сходятся, виновата
 * не форма и не человек — где-то в выписке комиссия, страховка или лишний
 * платёж. Раньше кнопка «Добавить» просто гасла, и записать долг было нельзя
 * вовсе. Теперь запись проходит, а расхождение показано словами и цифрой.
 */
function AddDebtDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const addCredit = useStore((s) => s.addCredit)

  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [payment, setPayment] = useState('')
  const [mode, setMode] = useState<'none' | 'rate' | 'term'>('none')
  const [rate, setRate] = useState('')
  const [term, setTerm] = useState('')
  const [day, setDay] = useState('12')

  const left = parseMoney(principal)
  const pay = parseMoney(payment)
  const months = parseMoney(term)

  const typed = (() => {
    const v = parseFloat(rate.replace(',', '.'))
    return Number.isFinite(v) && v >= 0 ? v / 100 : null
  })()
  const derived = mode === 'term' ? rateFromSchedule(left, pay, months) : null

  /*
    Рассрочка — это ноль, а не «неизвестно». Если срок указан, но ставку из него
    вывести нельзя, тоже считаем долг беспроцентным: это ближе к правде, чем
    выдуманный процент, и человек всегда может поправить ставку потом.
  */
  const resolvedRate = mode === 'none' ? 0 : mode === 'rate' ? typed ?? 0 : derived ?? 0

  // Сколько платежей выходит, если процентов нет. С этим числом сверяем срок,
  // названный человеком: расхождение почти всегда означает лишний платёж.
  const plainMonths = pay > 0 ? Math.ceil(left / pay) : 0
  const mismatch =
    mode === 'term' && months > 0 && pay > 0 && left > 0 && derived === null
      ? { paid: months * pay, gap: left - months * pay, suggest: plainMonths }
      : null

  const ready = left > 0 && pay > 0

  function create() {
    if (!ready) return
    // Сумму раздела «Кредиты» здесь не записываем: она складывается из платежей
    // сама. Хранить её вторым числом — это ровно тот случай, из-за которого
    // бюджет уже однажды остался в нулях.
    addCredit({
      name: name.trim() || 'Долг',
      note: resolvedRate > 0 ? 'ежемесячный платёж' : 'рассрочка',
      principal: left,
      annualRate: resolvedRate,
      payment: pay,
      day: Math.min(28, Math.max(1, parseMoney(day) || 1)),
    })
    setName(''); setPrincipal(''); setPayment(''); setRate(''); setTerm(''); setMode('none')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">Долг или рассрочка</DialogTitle></DialogHeader>

        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, рассрочка на телефон" />
        </Field>
        <Field label="Остаток долга, ₸">
          <NumField value={principal} onValue={setPrincipal} placeholder="600 000" />
        </Field>
        <Field label="Платёж в месяц, ₸">
          <NumField value={payment} onValue={setPayment} placeholder="55 000" />
        </Field>

        <Field label="Проценты">
          <Segmented<'none' | 'rate' | 'term'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'none', label: 'Без них' },
              { value: 'rate', label: 'Знаю ставку' },
              { value: 'term', label: 'Знаю срок' },
            ]}
          />
        </Field>

        {mode === 'none' && (
          <p className="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-3">
            Рассрочка: платите ровно столько, сколько должны. Приложение посчитает,
            что долг закроется за {plainMonths || '—'} платеж{plainMonths === 1 ? '' : 'ей'}.
          </p>
        )}

        {mode === 'rate' && (
          <Field label="Ставка (ГЭСВ), % годовых">
            <NumField value={rate} onValue={setRate} kind="rate" placeholder="23,4" />
          </Field>
        )}

        {mode === 'term' && (
          <Field label="Сколько платежей осталось">
            <NumField value={term} onValue={setTerm} kind="int" placeholder="12" />
          </Field>
        )}

        {mode === 'term' && months > 0 && pay > 0 && derived !== null && (
          <div className="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
            <span className="text-[12.5px] text-ink-2">Ставка получается</span>
            <div className="font-display text-[20px] font-semibold tracking-[-0.02em] num">
              {ratePct(derived, 1)} годовых
            </div>
          </div>
        )}

        {mismatch && (
          <div className="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              {months} платеж{months === 1 ? '' : 'ей'} по {plain(pay)} — это {plain(mismatch.paid)} ₸,
              а остаток вы указали {plain(left)} ₸.
              {mismatch.gap > 0
                ? ` Не хватает ${plain(mismatch.gap)} ₸: похоже, платежей ${mismatch.suggest}, а не ${months}.`
                : ' Выходит больше остатка — видимо, в платёж входит что-то ещё.'}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              Записать всё равно можно: сохраним как рассрочку без процентов, а ставку
              поправите, когда сверитесь с банком.
            </p>
          </div>
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
function CreditDialog({
  id, onClose, onPayoff,
}: { id: string | null; onClose: () => void; onPayoff: (id: string) => void }) {
  const credit = useStore((s) => s.credits.find((c) => c.id === id))
  const updateCredit = useStore((s) => s.updateCredit)
  const removeCredit = useStore((s) => s.removeCredit)

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

        <Button
          variant="outline"
          className="mb-3 w-full bg-surface-2"
          onClick={() => { onClose(); setTimeout(() => onPayoff(credit.id), 0) }}
        >
          Посчитать досрочное погашение
        </Button>

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

        <DangerZone
          label="Удалить кредит"
          warning="Кредит исчезнет у обоих участников, и платёж перестанет учитываться в бюджете. Отменить нельзя."
          onConfirm={() => { removeCredit(credit.id); onClose() }}
        />
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

        <DangerZone
          label="Удалить счёт"
          warning={
            <>
              Счёт исчезнет у обоих участников. Отменить нельзя.
              {attached.length > 0 && (
                <>
                  {' '}Накопления по {attached.length === 1 ? 'цели' : 'целям'}
                  {' «'}{attached.map((g) => g.name).join('», «')}{'» '}
                  останутся на месте: они снова будут считаться отдельно, а не
                  лежащими на этом счёте.
                </>
              )}
            </>
          }
          onConfirm={() => { removeAccount(account.id); onClose() }}
        />
      </DialogContent>
    </Dialog>
  )
}


/**
 * Какой долг гасить первым и что это даст.
 *
 * Порядок — по ставке, а не по остатку и не по абсолютным процентам. Это не
 * придирка: у большого кредита процентов в тенге больше, но каждый тенге долга
 * там стоит дешевле, и свободные деньги выгоднее нести туда, где ставка выше.
 * Из четырёх долгов заказчика самый дорогой — кредитная карта с наименьшим
 * платежом: её остаток почти не двигается, потому что половину платежа
 * съедают проценты.
 *
 * Сумма досрочного взноса берётся из свободных денег месяца, а не выдумывается.
 * Если их хватает на весь остаток, предлагаем закрыть долг целиком: советовать
 * «добавьте 390 000 к платежу 8 400» — значит не понимать собственный расчёт.
 */
function DebtAdvice({ credits, onPayoff }: { credits: Credit[]; onPayoff: (id: string) => void }) {
  const ranked = credits
    .map((c) => ({ credit: c, cost: debtCost(c.principal, c.annualRate, c.payment) }))
    .filter((x) => x.credit.annualRate > 0 && x.credit.principal > 0)
    .sort((a, b) =>
      b.credit.annualRate - a.credit.annualRate ||
      b.cost.monthlyInterest - a.cost.monthlyInterest)

  const worst = ranked[0]
  if (!worst) return null

  const { credit, cost } = worst
  const share = Math.round(cost.interestShare * 100)
  /*
    Сумму берём не из свободного остатка в плане. Плановый остаток — это то,
    что осталось после расписанных статей, а не деньги в кармане: заказчик
    ответил на такой совет коротко — «сумм таких нету».

    Опорой служит добавка, снимающая половину переплаты: она считается из
    самого долга и обычно оказывается небольшой, потому что отдача падает
    быстро. Сколько вносить на самом деле, человек решает в калькуляторе.
  */
  const half = halfOverpayExtra(credit.principal, credit.annualRate, credit.payment)
  const gain = half ? prepayment(credit.principal, credit.annualRate, credit.payment, half) : null

  return (
    <>
      <Section title="Что гасить первым" />
      <Card>
        <div className="text-[13px] text-ink-2">Самая дорогая ставка</div>
        <div className="font-display text-[19px] font-semibold tracking-[-0.02em]">{credit.name}</div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-ink-2">Ставка</span>
            <b className="num">{ratePct(credit.annualRate, 1)}</b>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">Проценты в месяц</span>
            <b className="num text-warn">{money(Math.round(cost.monthlyInterest))}</b>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">Это доля платежа</span>
            <b className="num">{share}%</b>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">{cost.closes ? 'Переплата до конца' : 'Долг не закрывается'}</span>
            <b className="num text-warn">
              {cost.closes ? money(Math.round(cost.overpay)) : 'платёж меньше процентов'}
            </b>
          </div>
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {share >= 50
            ? 'Больше половины платежа уходит в проценты, поэтому остаток почти не двигается. Такой долг выгоднее закрыть раньше остальных, даже если он самый маленький.'
            : 'Здесь самая высокая ставка из ваших долгов, поэтому каждый лишний тенге, внесённый сюда, экономит больше, чем в любом другом.'}
        </p>

        {gain && half && Number.isFinite(gain.monthsSaved) ? (
          <div className="mt-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
            <div className="text-[12.5px] text-ink-2">
              Половину переплаты снимает добавка в
            </div>
            <div className="mt-1 font-display text-[19px] font-semibold tracking-[-0.02em] num">
              {money(half)} в месяц
            </div>
            <div className="mt-0.5 text-[13px] text-ink-2 num">
              это {Math.round(gain.monthsSaved)} мес. и {money(Math.round(gain.saved))}
            </div>
          </div>
        ) : null}

        <Button
          variant="outline"
          className="mt-3 w-full bg-surface-2"
          onClick={() => onPayoff(credit.id)}
        >
          Посчитать на свою сумму
        </Button>
      </Card>
    </>
  )
}

/**
 * Регулярный платёж: подписка, тариф на связь, страховка, абонемент.
 *
 * До этого обязательство заводилось только в мастере настройки — то есть
 * жильё и коммуналка, и больше ничего. Всё остальное записывать было некуда,
 * и заказчик заводил подписки кредитами, где у них появлялись остаток долга и
 * ставка, которых у подписки нет.
 *
 * Справочника видов нет намеренно: заказчик запретил хардкод. Название
 * свободное, а периодичность, месяц списания и владелец — поля.
 */
function AddObligationDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const addObligation = useStore((s) => s.addObligation)
  const categories = useStore((s) => s.categories)
  const people = useStore((s) => s.people)

  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(String(new Date().getMonth() + 1))
  const [day, setDay] = useState('10')
  const [who, setWho] = useState<'all' | PersonId>('all')
  const [category, setCategory] = useState<CategoryKey>('d4')
  const [estimate, setEstimate] = useState(false)

  // Цели и свободный остаток — не корзины для платежей: первая считается из
  // планов, вторая и есть то, что осталось.
  const buckets = categories.filter((c) => c.key !== 'd3' && c.key !== 'd5')
  const ready = name.trim().length > 0 && parseMoney(amount) > 0

  function create() {
    if (!ready) return
    addObligation({
      name: name.trim(),
      note: every === 'year' ? 'раз в год' : 'ежемесячно',
      day: Math.min(28, Math.max(1, parseMoney(day) || 1)),
      category,
      estimate,
      every,
      month: every === 'year' ? Math.min(12, Math.max(1, parseMoney(month) || 1)) : undefined,
      who: who === 'all' ? null : who,
      amount: parseMoney(amount),
    })
    setName(''); setAmount(''); setEstimate(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">Регулярный платёж</DialogTitle></DialogHeader>

        <Field label="Что оплачиваем">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, интернет или абонемент"
          />
        </Field>

        <Field label="Как часто">
          <Segmented<'month' | 'year'>
            value={every}
            onChange={setEvery}
            options={[
              { value: 'month', label: 'Каждый месяц' },
              { value: 'year', label: 'Раз в год' },
            ]}
          />
        </Field>

        <Field label={every === 'year' ? 'Сумма за год, ₸' : 'Сумма в месяц, ₸'}>
          <NumField value={amount} onValue={setAmount} placeholder="5 000" />
        </Field>

        {every === 'year' && parseMoney(amount) > 0 && (
          <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
            В плане месяца это займёт {money(Math.round(parseMoney(amount) / 12))} — годовая сумма
            делится на двенадцать, чтобы не завышать одиннадцать месяцев и не удивляться
            на двенадцатый.
          </p>
        )}

        {every === 'year' && (
          <Field label="Месяц списания">
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS_NOM.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={parseMoney(month) === i + 1}
                  onClick={() => setMonth(String(i + 1))}
                  className={cn(
                    'rounded-lg border px-1 py-1.5 text-[12px]',
                    parseMoney(month) === i + 1
                      ? 'border-brand bg-brand-soft font-semibold text-brand'
                      : 'border-line text-ink-2',
                  )}
                >
                  {m.slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="День платежа">
          <NumField value={day} onValue={setDay} kind="int" />
        </Field>

        {people.length > 1 && (
          <Field label="Чьё это">
            <Segmented<'all' | PersonId>
              value={who}
              onChange={setWho}
              options={[
                { value: 'all', label: 'Общее' },
                ...people.map((p) => ({ value: p.id as 'all' | PersonId, label: p.name })),
              ]}
            />
          </Field>
        )}

        <Field label="В какой раздел бюджета">
          <div className="flex flex-wrap gap-1.5">
            {buckets.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => setCategory(c.key)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px]',
                  category === c.key
                    ? 'border-brand bg-brand-soft font-semibold text-brand'
                    : 'border-line text-ink-2',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Field>

        <label className="mb-3 flex items-center gap-2.5 text-[13.5px]">
          <input
            type="checkbox"
            checked={estimate}
            onChange={(e) => setEstimate(e.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          Сумма плавает — показывать как оценку
        </label>

        <Button onClick={create} disabled={!ready} className="w-full">Добавить</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Калькулятор досрочного погашения.
 *
 * Заказчик сказал прямо: «сумм таких нету». Приложение считало добавку от
 * свободного остатка в плане, а плановый остаток — это не деньги в кармане, а
 * то, что осталось после расписанных статей. Советовать вносить сто тысяч
 * человеку, у которого их нет, — не совет, а раздражение.
 *
 * Поэтому сумму называет человек, а приложение показывает, что она даёт. И
 * показывает главное: отдача падает быстро. На кредитной карте первые пять
 * тысяч убирают половину переплаты, а вчетверо большая добавка — только вдвое
 * больше. Ради этой мысли калькулятор и сделан: она превращает «надо копить и
 * гасить» в конкретную посильную сумму.
 */
function PayoffDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const credit = useStore((s) => s.credits.find((c) => c.id === id))
  const [mode, setMode] = useState<'monthly' | 'once'>('monthly')
  const [amount, setAmount] = useState('')

  const principal = credit?.principal ?? 0
  const rate = credit?.annualRate ?? 0
  const pay = credit?.payment ?? 0

  const cost = credit ? debtCost(principal, rate, pay) : null
  const half = credit ? halfOverpayExtra(principal, rate, pay) : null

  // Подсказки — не круглые числа из воздуха: половина платежа, платёж целиком
  // и точка, снимающая половину переплаты.
  const chips = Array.from(new Set([
    Math.round(pay / 2 / 1000) * 1000,
    Math.round(pay / 1000) * 1000,
    ...(half ? [half] : []),
  ].filter((v) => v > 0))).sort((a, b) => a - b)

  const value = parseMoney(amount)
  const result = credit && value > 0
    ? mode === 'monthly'
      ? prepayment(principal, rate, pay, value)
      : lumpSum(principal, rate, pay, value)
    : null

  // Небольшая таблица рядом: по одному числу невидно, что отдача падает.
  const ladder = credit && cost?.closes
    ? [0.5, 1, 2, 4].map((k) => {
        const extra = Math.round((pay * k) / 1000) * 1000
        return { extra, ...prepayment(principal, rate, pay, extra) }
      }).filter((r) => r.extra > 0 && Number.isFinite(r.monthsAfter))
    : []

  useEffect(() => { setAmount(''); setMode('monthly') }, [id])

  if (!credit || !cost) return null

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-display">Досрочное погашение</DialogTitle>
        </DialogHeader>

        <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px]">
          <div className="mb-1 font-medium">{credit.name}</div>
          <div className="flex justify-between">
            <span className="text-ink-2">Осталось платежей</span>
            <b className="num">{cost.closes ? Math.ceil(cost.months) : '—'}</b>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-ink-2">Переплата, если не трогать</span>
            <b className="num text-warn">{cost.closes ? money(Math.round(cost.overpay)) : 'долг не закрывается'}</b>
          </div>
        </div>

        <Field label="Как вносите">
          <Segmented<'monthly' | 'once'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'monthly', label: 'Каждый месяц' },
              { value: 'once', label: 'Разово' },
            ]}
          />
        </Field>

        <Field label={mode === 'monthly' ? 'Сколько добавите к платежу, ₸' : 'Сколько внесёте разом, ₸'}>
          <NumField value={amount} onValue={setAmount} placeholder={String(chips[0] ?? 5000)} />
        </Field>

        {mode === 'monthly' && chips.length > 0 && (
          <div className="-mt-1 mb-3 flex flex-wrap gap-1.5">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(plain(v))}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12.5px] num',
                  value === v ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2',
                )}
              >
                +{plain(v)}
                {v === half && <span className="ml-1 text-[11px]">половина переплаты</span>}
              </button>
            ))}
          </div>
        )}

        {result && Number.isFinite(result.monthsAfter) ? (
          <div className="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
            <div className="font-display text-[19px] font-semibold tracking-[-0.02em]">
              {result.monthsSaved >= 1
                ? `Закроется на ${Math.round(result.monthsSaved)} мес. раньше`
                : 'Срок почти не изменится'}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-2 num">
              экономия {money(Math.max(0, Math.round(result.saved)))}
            </div>
            <div className="mt-1.5 text-[12.5px] text-ink-3">
              Останется {Math.max(0, Math.ceil(result.monthsAfter))} платеж
              {Math.ceil(result.monthsAfter) === 1 ? '' : 'ей'} вместо {Math.ceil(result.monthsNow)}.
            </div>
          </div>
        ) : (
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">
            Впишите сумму, которую действительно можете внести. Приложение не
            станет предлагать больше — считать по деньгам, которых нет, смысла нет.
          </p>
        )}

        {ladder.length > 0 && (
          <>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
              Отдача падает
            </div>
            <div className="mb-3 flex flex-col gap-1.5 text-[13px]">
              {ladder.map((r) => (
                <div key={r.extra} className="flex items-baseline gap-2">
                  <span className="num text-ink-2">+{plain(r.extra)}</span>
                  <span className="ml-auto num">−{Math.round(r.monthsSaved)} мес.</span>
                  <span className="w-[92px] text-right num text-brand">
                    {money(Math.max(0, Math.round(r.saved)))}
                  </span>
                </div>
              ))}
            </div>
            {half && (
              <p className="mb-1 text-[12.5px] leading-relaxed text-ink-3">
                Половину переплаты снимает уже добавка в {money(half)} — дальше каждая
                следующая тысяча даёт меньше предыдущей. Если больших сумм нет, начинать
                стоит отсюда.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
