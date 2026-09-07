import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from '@phosphor-icons/react'
import { Card, Callout, Field, Section, Segmented } from '@/components/kit'
import { Ring } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain } from '@/lib/money'
import { goalMonths, goalMonthly } from '@/lib/finance'
import { monthAfter, monthInAfter } from '@/lib/dates'
import { useStore } from '@/store/useStore'
import type { PersonId } from '@/store/types'

type Mode = 'date' | 'amount'

export function GoalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const goal = useStore((s) => s.goals.find((g) => g.id === id))
  const people = useStore((s) => s.people)
  const setGoalMonthly = useStore((s) => s.setGoalMonthly)
  const contribute = useStore((s) => s.contribute)
  const removeGoal = useStore((s) => s.removeGoal)
  const inflation = useStore((s) => s.settings.inflation)

  const [mode, setMode] = useState<Mode>('date')
  const [addOpen, setAddOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [by, setBy] = useState<PersonId>('a')

  if (!goal) {
    return (
      <div className="pt-6 text-center text-[14px] text-ink-3">
        Цель не найдена.{' '}
        <button className="text-brand" onClick={() => navigate('/goals')}>К списку</button>
      </div>
    )
  }

  const remaining = Math.max(0, goal.need - goal.have)
  const months = goalMonths(remaining, goal.monthly)
  const progress = goal.need ? goal.have / goal.need : 0
  const min = Math.max(5_000, Math.round((goal.monthly * 0.4) / 5_000) * 5_000)
  const max = Math.max(min + 5_000, Math.round((goal.monthly * 2.6) / 5_000) * 5_000)

  // Во сколько обойдётся та же цель через N месяцев, если она дорожает вместе с рынком.
  const indexed = Math.round(goal.need * Math.pow(1 + inflation, months / 12))

  function addContribution() {
    const v = parseMoney(amount)
    if (!v) return
    contribute(goal!.id, v, by)
    setAmount('')
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <button onClick={() => navigate('/goals')} className="flex items-center gap-1.5 self-start text-[13px] text-ink-2">
        <ArrowLeft size={15} /> Все цели
      </button>

      <Card>
        <div className="mb-4 flex items-center gap-3.5">
          <Ring progress={progress} plan={goal.planPct} hue={goal.hue} size={58} />
          <div>
            <div className="font-display text-[18px] font-semibold tracking-[-0.01em]">{goal.name}</div>
            <div className="text-[13px] text-ink-3 num">
              {plain(goal.have)} из {plain(goal.need)} ₸
            </div>
          </div>
        </div>

        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'date', label: 'Считаем от даты' },
            { value: 'amount', label: 'Считаем от суммы' },
          ]}
        />

        <div className="pb-1.5 pt-5 text-center">
          <div className="text-[12.5px] tracking-[0.03em] text-ink-3">
            {mode === 'date' ? 'Откладывать в месяц' : 'Цель будет достигнута'}
          </div>
          <div className="mt-1 font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] num">
            {mode === 'date' ? money(goal.monthly) : monthAfter(months - 1)}
          </div>
          <div className="mt-1.5 text-[13px] text-ink-2">
            {mode === 'date'
              ? `Цель закроется в ${monthInAfter(months - 1)}`
              : `При взносе ${money(goal.monthly)} в месяц · ${months} мес.`}
          </div>
        </div>

        <div className="mt-4">
          <Slider
            min={min}
            max={max}
            step={5_000}
            value={[Math.min(max, Math.max(min, goal.monthly))]}
            onValueChange={([v]) => setGoalMonthly(goal.id, v)}
            aria-label="Ежемесячный взнос"
          />
          <div className="mt-1 flex justify-between text-[12px] text-ink-3 num">
            <span>{money(min)}</span>
            <span>{money(max)}</span>
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-2">
          Чтобы успеть за год, нужно {money(goalMonthly(remaining, 12))} в месяц.
        </div>
      </Card>

      <Button className="w-full" onClick={() => setAddOpen(true)}>
        <Plus size={16} weight="bold" /> Пополнить цель
      </Button>

      <Callout title="Цель дорожает вместе с рынком">
        При инфляции {(inflation * 100).toFixed(1).replace('.', ',')}% в год к моменту достижения
        такая же покупка будет стоить около {money(indexed)}. Расчёт выше — в сегодняшних деньгах.
      </Callout>

      <Section title="История цели" />
      <Card flush>
        {goal.movements.length ? (
          goal.movements.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <i className="size-2 shrink-0 rounded-full" style={{ background: `var(--p${m.by})` }} />
              <div className="min-w-0 flex-1">
                <b className="block text-[14.5px] font-medium">
                  {m.amount > 0 ? 'Пополнение' : 'Изъятие'}
                </b>
                <span className="block text-[12.5px] text-ink-3">
                  {new Date(m.date).toLocaleDateString('ru-RU')} ·{' '}
                  {people.find((p) => p.id === m.by)?.name}
                </span>
              </div>
              <span className="shrink-0 text-[14.5px] font-semibold num">
                {m.amount > 0 ? '+' : '−'}{plain(Math.abs(m.amount))}
              </span>
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-center text-[13px] text-ink-3">
            Взносов пока нет — история появится после первого пополнения
          </div>
        )}
      </Card>

      <button
        onClick={() => { removeGoal(goal.id); navigate('/goals') }}
        className="mb-2 self-center text-[13px] text-ink-3 hover:text-destructive"
      >
        Удалить цель
      </button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[92vw] rounded-2xl border-line bg-surface sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display">Пополнить «{goal.name}»</DialogTitle></DialogHeader>
          <Field label="Сумма, ₸">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder={plain(goal.monthly)} className="num" autoFocus />
          </Field>
          <Field label="Кто вносит">
            <Segmented<PersonId> value={by} onChange={setBy} options={people.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Button onClick={addContribution} className="w-full">Внести</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
