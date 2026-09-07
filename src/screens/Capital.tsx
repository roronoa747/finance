import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bank, Coins, CreditCard, House, Plus, Wallet } from '@phosphor-icons/react'
import { Card, Field, Row, Section, Segmented } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain, ratePct } from '@/lib/money'
import { annuityMonths, annuityTotal, rateFromSchedule } from '@/lib/finance'
import {
  amountAt, liveAccounts, liveCredits, liveObligations, netWorth, useStore,
} from '@/store/useStore'
import { monthKey } from '@/lib/dates'

const ICONS = {
  deposit: <Bank size={17} />,
  card: <CreditCard size={17} />,
  cash: <Coins size={17} />,
  envelope: <Wallet size={17} />,
}

export function Capital() {
  const [addOpen, setAddOpen] = useState(false)
  const store = useStore()
  const accounts = liveAccounts(store.accounts)
  const credits = liveCredits(store.credits)
  const obligations = liveObligations(store.obligations)
  const key = monthKey()
  const total = netWorth(store.accounts, store.credits)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Card>
        <div className="text-[13px] text-ink-2">Чистый капитал</div>
        <div className="font-display text-[30px] font-semibold tracking-[-0.025em] num">{money(total)}</div>
        <p className="mt-2 text-[12.5px] text-ink-3">
          Всё, что есть, минус всё, что должны. Возвратный депозит за квартиру — это не расход,
          а замороженные деньги, поэтому он остаётся в капитале.
        </p>
      </Card>

      <Section title="Где лежат деньги" />
      <Card flush>
        {accounts.map((a) =>
          a.deposit ? (
            <Link key={a.id} to={`/capital/${a.id}`} className="block">
              <Row
                icon={ICONS[a.kind]}
                title={a.name}
                note={`${a.note} · ${ratePct(a.deposit.annualRate, 1)} годовых`}
                value={money(a.amount)}
                sub="условия →"
              />
            </Link>
          ) : (
            <Row key={a.id} icon={ICONS[a.kind]} title={a.name} note={a.note} value={money(a.amount)} />
          ),
        )}
      </Card>

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
              note={`ГЭСВ ${ratePct(c.annualRate, 1)} · ${Math.ceil(months)} платежей`}
              value={money(c.principal)}
              sub={`переплата ${plain(Math.round(overpay))}`}
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
              note={o.note}
              value={money(amountAt(o, key))}
              sub="в месяц"
            />
          ))}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setAddOpen(true)}>
        <Plus size={16} weight="bold" /> Добавить кредит
      </Button>

      <AddCreditDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
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
  const credits = useStore((s) => s.credits)
  const setCategoryAmount = useStore((s) => s.setCategoryAmount)

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
          return Number.isFinite(v) && v > 0 ? v / 100 : null
        })()
      : rateFromSchedule(parseMoney(principal), parseMoney(payment), parseMoney(term))

  const ready = parseMoney(principal) > 0 && parseMoney(payment) > 0 && resolvedRate !== null

  function create() {
    if (!ready) return
    const pay = parseMoney(payment)
    addCredit({
      name: name.trim() || 'Кредит',
      note: 'ежемесячный платёж',
      principal: parseMoney(principal),
      annualRate: resolvedRate ?? 0,
      payment: pay,
      day: Math.min(28, Math.max(1, parseMoney(day) || 1)),
    })
    // В корзине «Кредиты» должна стоять сумма всех платежей, а не последнего.
    const total = liveCredits(credits).reduce((a, c) => a + c.payment, 0) + pay
    setCategoryAmount('d2', total)
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
          <Input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="numeric" placeholder="600 000" className="num" />
        </Field>
        <Field label="Платёж в месяц, ₸">
          <Input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="numeric" placeholder="55 000" className="num" />
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
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="23,4" className="num" />
          </Field>
        ) : (
          <Field label="Сколько платежей осталось">
            <Input value={term} onChange={(e) => setTerm(e.target.value)} inputMode="numeric" placeholder="12" className="num" />
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
          <Input value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" className="num" />
        </Field>

        <Button onClick={create} disabled={!ready} className="w-full">Добавить</Button>
      </DialogContent>
    </Dialog>
  )
}
