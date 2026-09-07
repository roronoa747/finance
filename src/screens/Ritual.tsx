import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { money, plain } from '@/lib/money'
import { goalMonths, prepayment, emergencyCoverage } from '@/lib/finance'
import { monthAfter, monthFrom, monthFromAfter, monthInAfter, monthKey } from '@/lib/dates'
import {
  amountAt, liveCredits, liveGoals, liveObligations, mandatoryMonthly, nextChange, useStore,
} from '@/store/useStore'
import { cn } from '@/lib/utils'

const STEP = 10_000

export function Ritual() {
  const navigate = useNavigate()
  const store = useStore()
  const { categories, setGoalMonthly, people } = store
  const goals = liveGoals(store.goals)
  const credits = liveCredits(store.credits)
  const obligations = liveObligations(store.obligations)
  const key = monthKey()

  const freed = useMemo(
    () =>
      obligations
        .map((o) => ({ o, change: nextChange(o, key) }))
        .find((x) => x.change && x.change.delta < 0),
    [obligations, key],
  )

  const total = freed?.change ? Math.abs(freed.change.delta) : 0
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [done, setDone] = useState(false)

  const used = Object.values(alloc).reduce((a, v) => a + v, 0)
  const left = total - used
  const mandatory = mandatoryMonthly(categories)
  const credit = credits[0]

  if (!freed?.change) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] text-ink-2">
          Сейчас нет запланированных изменений, которые высвобождают деньги. Событие появится
          само, когда у обязательства будет версия с будущей датой и меньшей суммой.
        </p>
        <Button variant="outline" onClick={() => navigate('/')}>На главную</Button>
      </div>
    )
  }

  const set = (id: string, delta: number) => {
    setAlloc((prev) => {
      const cur = prev[id] ?? 0
      if (delta > 0 && left < STEP) return prev
      return { ...prev, [id]: Math.max(0, cur + delta) }
    })
  }

  function effectForGoal(goalId: string, extra: number) {
    const g = goals.find((x) => x.id === goalId)!
    const remaining = Math.max(0, g.need - g.have)
    const base = goalMonths(remaining, g.monthly)
    if (!extra) return `Сейчас закрывается в ${monthInAfter(base - 1)}`
    const now = goalMonths(remaining, g.monthly + extra)
    return `${monthAfter(now - 1)} вместо ${monthFromAfter(base - 1)}. Быстрее на ${base - now} мес.`
  }

  function effectForCredit(extra: number) {
    if (!credit) return ''
    const p = prepayment(credit.principal, credit.annualRate, credit.payment, extra)
    if (!extra) return `Сейчас: ${Math.ceil(p.monthsNow)} платежей, переплата ${money(Math.round(p.overpayNow))}`
    return `Закроется за ${Math.ceil(p.monthsAfter)} мес. вместо ${Math.ceil(p.monthsNow)}. Переплата меньше на ${money(Math.round(p.saved))}`
  }

  function effectForLife(extra: number) {
    return extra
      ? `${money(extra)} в месяц на себя. Цели при этом не двигаются вперёд.`
      : 'Не ускорит цели — и это нормальный выбор, если он осознанный.'
  }

  const cushion = goals.find((g) => g.name.toLowerCase().includes('подушка'))

  const pots = [
    ...goals.map((g) => ({
      id: g.id,
      name: g.name,
      effect: (x: number) =>
        cushion && g.id === cushion.id
          ? `Через год покроет ${emergencyCoverage(g.have + (g.monthly + x) * 12, mandatory)
              .toFixed(1)
              .replace('.', ',')} мес. расходов`
          : effectForGoal(g.id, x),
    })),
    ...(credit ? [{ id: 'credit', name: 'Досрочно по кредиту', effect: effectForCredit }] : []),
    { id: 'life', name: 'Качество жизни', effect: effectForLife },
  ]

  function confirm() {
    for (const g of goals) {
      const extra = alloc[g.id] ?? 0
      if (extra > 0) setGoalMonthly(g.id, g.monthly + extra)
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="font-display text-[22px] font-semibold tracking-[-0.02em]">
          Решение записано
        </div>
        <p className="max-w-[38ch] text-[14px] leading-relaxed text-ink-2">
          Взносы по целям увеличены с {monthFrom(freed.change.from)}. Когда появятся
          два аккаунта, это же решение уйдёт {people[1].name} на подтверждение — с окном 72 часа на
          «вернуть на обсуждение», а не с блокировкой.
        </p>
        <Button onClick={() => navigate('/')}>На главную</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          aria-label="Закрыть"
          className="grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface-3"
        >
          <X size={19} />
        </button>
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">
          Куда направить {money(total)}
        </h2>
      </div>

      <div className="flex items-baseline justify-between rounded-[14px] bg-brand-soft px-4 py-3.5">
        <span className="text-[13px] text-ink-2">Осталось распределить</span>
        <span className="font-display text-[22px] font-semibold tracking-[-0.02em] text-brand num">
          {money(left)}
        </span>
      </div>

      {pots.map((p) => {
        const v = alloc[p.id] ?? 0
        return (
          <div
            key={p.id}
            className={cn('rounded-2xl border bg-surface p-3.5', v > 0 ? 'border-brand' : 'border-line')}
          >
            <div className="flex items-center gap-3">
              <b className="flex-1 text-[14.5px] font-semibold">{p.name}</b>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => set(p.id, -STEP)}
                  disabled={v <= 0}
                  aria-label="Убавить"
                  className="grid size-[30px] place-items-center rounded-[9px] border border-line bg-surface-2 text-ink-2 disabled:opacity-40"
                >
                  <Minus size={14} weight="bold" />
                </button>
                <span className="min-w-[62px] text-center text-[14px] font-semibold num">{plain(v)}</span>
                <button
                  onClick={() => set(p.id, STEP)}
                  disabled={left < STEP}
                  aria-label="Прибавить"
                  className="grid size-[30px] place-items-center rounded-[9px] border border-line bg-surface-2 text-ink-2 disabled:opacity-40"
                >
                  <Plus size={14} weight="bold" />
                </button>
              </div>
            </div>
            <div className="mt-2.5 border-t border-line pt-2.5 text-[12.5px] leading-snug text-ink-2">
              {p.effect(v)}
            </div>
          </div>
        )
      })}

      <p className="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
        Пока решения нет, эти деньги не попадают в «свободно потратить». Аренда снизится с{' '}
        {plain(amountAt(freed.o, key))} до {plain(freed.change.amount)} ₸ с{' '}
        {monthFrom(freed.change.from)}.
      </p>

      <Button className="mb-2 w-full" disabled={left !== 0} onClick={confirm}>
        {left === 0 ? 'Подтвердить распределение' : `Осталось ${money(left)}`}
      </Button>
    </div>
  )
}
