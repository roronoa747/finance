import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PencilSimple, Plus } from '@phosphor-icons/react'
import {
  Callout, Card, Field, NumField, NumFieldBlur, SavedMark, Section, Segmented, Tag, useSavedMark,
} from '@/components/kit'
import { Ring } from '@/components/charts'
import { HUES, HUE_KEYS, hueColor } from '@/lib/palette'
import { useIsDark } from '@/lib/useTheme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain } from '@/lib/money'
import { goalMonths, goalMonthly } from '@/lib/finance'
import { addMonths, monthAfter, monthInAfter, monthKey, monthTitle } from '@/lib/dates'
import { contributionStreak, useStore } from '@/store/useStore'
import type { PersonId } from '@/store/types'
import { cn } from '@/lib/utils'

type Mode = 'date' | 'amount'

export function GoalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const goal = useStore((s) => s.goals.find((g) => g.id === id))
  const people = useStore((s) => s.people)
  const setGoalMonthly = useStore((s) => s.setGoalMonthly)
  const contribute = useStore((s) => s.contribute)
  const inflation = useStore((s) => s.settings.inflation)

  const dark = useIsDark()
  const [mode, setMode] = useState<Mode>('date')
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
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

  // Ритм считается по взносам именно в эту цель.
  const streak = contributionStreak(goal.movements)
  const filled = new Set(goal.movements.filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7)))
  const last12 = Array.from({ length: 12 }, (_, i) => {
    const k = addMonths(monthKey(), i - 11)
    return { key: k, label: monthTitle(k), filled: filled.has(k) }
  })

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
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[18px] font-semibold tracking-[-0.01em]">{goal.name}</div>
            <div className="text-[13px] text-ink-3 num">
              {plain(goal.have)} из {plain(goal.need)} ₸
            </div>
          </div>
          <button
            onClick={() => setEditOpen(true)}
            aria-label="Изменить цель"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <PencilSimple size={17} />
          </button>
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

      <Section title="Ритм цели" />
      <Card>
        <div className="mb-3 flex items-center gap-2.5">
          <b className="text-[14.5px] font-semibold">Пополняем без пропусков</b>
          {streak > 0 && <Tag tone="gold">{streak} мес.</Tag>}
        </div>
        <div className="flex gap-1.5">
          {last12.map((m) => (
            <i
              key={m.key}
              title={m.label}
              className="h-[20px] flex-1 rounded"
              style={{ background: m.filled ? hueColor(goal.hue, dark) : 'var(--track)' }}
            />
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {streak > 0
            ? 'Считается по взносам именно в эту цель, а не по плану.'
            : 'Закрасится, как только появится первый взнос. Считается по фактическим пополнениям этой цели.'}
        </p>
      </Card>

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


      <EditGoalDialog
        goalId={goal.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        onDeleted={() => navigate('/goals')}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[92vw] rounded-2xl border-line bg-surface sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display">Пополнить «{goal.name}»</DialogTitle></DialogHeader>
          <Field label="Сумма, ₸">
            <NumField value={amount} onValue={setAmount} placeholder={plain(goal.monthly)} autoFocus />
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

/**
 * Правка цели: название, сумма, накопленное, цвет и удаление.
 *
 * Накопленное правится через seed, а не напрямую: сумма складывается из seed
 * и взносов, и запись поверх стёрла бы историю пополнений.
 */
function EditGoalDialog({
  goalId, open, onOpenChange, onDeleted,
}: { goalId: string; open: boolean; onOpenChange: (v: boolean) => void; onDeleted: () => void }) {
  const goal = useStore((s) => s.goals.find((g) => g.id === goalId))
  const updateGoal = useStore((s) => s.updateGoal)
  const removeGoal = useStore((s) => s.removeGoal)
  const [confirm, setConfirm] = useState(false)

  const saved = useSavedMark(goal?.id, goal?.updatedAt)

  if (!goal) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        /* Правка существующей записи не должна выбрасывать клавиатуру и выделять название. */
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            Изменить цель
            <SavedMark on={saved} />
          </DialogTitle>
        </DialogHeader>

        <Field label="Название">
          <Input
            defaultValue={goal.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== goal.name) updateGoal(goal.id, { name: v })
            }}
          />
        </Field>

        <Field label="Сколько нужно, ₸">
          <NumFieldBlur
            initial={plain(goal.need)}
            onCommit={(text) => {
              const v = parseMoney(text)
              if (v > 0 && v !== goal.need) updateGoal(goal.id, { need: v })
            }}
          />
        </Field>

        <Field label="Уже накоплено, ₸">
          <NumFieldBlur
            initial={plain(goal.have)}
            onCommit={(text) => {
              const v = parseMoney(text)
              if (v !== goal.have) updateGoal(goal.id, { have: v })
            }}
          />
        </Field>
        {goal.movements.length > 0 && (
          <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
            Взносы ({goal.movements.length}) останутся в истории: правится только та часть,
            с которой цель завели.
          </p>
        )}

        <Field label="Цвет">
          <div className="flex flex-wrap gap-2">
            {HUE_KEYS.map((h) => (
              <button
                key={h}
                aria-label={HUES[h].label}
                aria-pressed={goal.hue === h}
                onClick={() => updateGoal(goal.id, { hue: h })}
                className={cn(
                  'size-[26px] rounded-[9px] border-2',
                  goal.hue === h ? 'border-ink' : 'border-transparent',
                )}
                style={{ background: HUES[h].light }}
              />
            ))}
          </div>
        </Field>

        <Button onClick={() => onOpenChange(false)} className="mb-3 w-full">Готово</Button>

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Цель и её история взносов исчезнут у обоих участников. Отменить нельзя.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeGoal(goal.id); onOpenChange(false); onDeleted() }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить цель
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
