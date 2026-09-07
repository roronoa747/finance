import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bank, CalendarPlus, Coins, CreditCard, House, Plus, Wallet } from '@phosphor-icons/react'
import { Card, Field, Row, Section, Segmented } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain, ratePct } from '@/lib/money'
import { cn } from '@/lib/utils'
import { annuityMonths, annuityTotal, rateFromSchedule } from '@/lib/finance'
import {
  amountAt, goalSavings, nextChange, liveAccounts, liveCredits, liveObligations, netWorth, useStore,
} from '@/store/useStore'
import { addMonths, monthKey, monthTitle } from '@/lib/dates'

const ICONS = {
  deposit: <Bank size={17} />,
  card: <CreditCard size={17} />,
  cash: <Coins size={17} />,
  envelope: <Wallet size={17} />,
}

export function Capital() {
  const [addOpen, setAddOpen] = useState(false)
  const [obligationId, setObligationId] = useState<string | null>(null)
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
              note={o.estimate ? 'оценка · ' + o.note : o.note}
              value={money(amountAt(o, key))}
              sub={nextChange(o, key) ? 'изменится →' : 'в месяц'}
              onClick={() => setObligationId(o.id)}
            />
          ))}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setAddOpen(true)}>
        <Plus size={16} weight="bold" /> Добавить кредит
      </Button>

      <AddCreditDialog open={addOpen} onOpenChange={setAddOpen} />
      <ObligationDialog id={obligationId} onClose={() => setObligationId(null)} />
    </div>
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

  if (!obligation) return null

  const months = Array.from({ length: 13 }, (_, i) => addMonths(key, i))
  const planned = parseMoney(newAmount)
  const delta = planned > 0 ? planned - current : 0

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display">{obligation.name}</DialogTitle></DialogHeader>

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
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const v = parseMoney(amount)
              if (v > 0 && v !== current) correctObligation(obligation.id, v)
            }}
            inputMode="numeric"
            className="num"
          />
        </Field>
        <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
          Это исправление: сумма была введена неверно. Если платёж меняется
          с какого-то месяца — не трогайте это поле, а запланируйте изменение ниже.
        </p>

        <Field label="День платежа">
          <Input
            defaultValue={String(obligation.day)}
            inputMode="numeric"
            className="num"
            onBlur={(e) => {
              const v = Math.min(28, Math.max(1, parseMoney(e.target.value) || 1))
              if (v !== obligation.day) updateObligation(obligation.id, { day: v })
            }}
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
              <Input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} inputMode="numeric" placeholder={plain(current)} className="num" autoFocus />
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
                  ? <>С {monthTitle(fromMonth).toLowerCase()} освободится <b>{money(-delta)}</b> в месяц — {money(-delta * 12)} за год. Приложение предложит решить, куда их направить.</>
                  : <>С {monthTitle(fromMonth).toLowerCase()} платёж вырастет на <b>{money(delta)}</b> в месяц.</>}
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
                  <span className="text-ink-3">{v.from <= key ? 'с' : 'станет с'} {monthTitle(v.from).toLowerCase()}</span>
                  <b className="ml-auto num">{money(v.amount)}</b>
                  {v.reason && <span className="text-[12px] text-ink-3">{v.reason}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => { removeObligation(obligation.id); onClose() }}
          className="mb-1 self-center text-[13px] text-ink-3 hover:text-destructive"
        >
          Удалить обязательство
        </button>
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
