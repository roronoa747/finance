import { Link, useNavigate } from 'react-router-dom'
import { Clock } from '@phosphor-icons/react'
import { Card, Callout, Hero, Row, Section, Tag } from '@/components/kit'
import { Bar, Legend, Ring } from '@/components/charts'
import { money, plain, pct } from '@/lib/money'
import { monthKey, monthIn, monthFrom, dayLabel } from '@/lib/dates'
import {
  amountAt, liveCredits, liveGoals, liveObligations, nextChange, totalIncome, useStore,
} from '@/store/useStore'

export function Overview() {
  const navigate = useNavigate()
  const store = useStore()
  const { people, categories } = store
  // Удалённые записи продолжают ездить между устройствами как надгробия, но на экране их нет.
  const goals = liveGoals(store.goals)
  const obligations = liveObligations(store.obligations)
  const credits = liveCredits(store.credits)

  const income = totalIncome(people)
  const spent = categories.filter((c) => c.key !== 'd5').reduce((a, c) => a + c.amount, 0)
  const free = income - spent
  const key = monthKey()

  const segments = categories
    .filter((c) => c.key !== 'd5')
    .map((c) => ({ key: c.key, value: c.amount, color: `var(--${c.key})`, label: c.name }))
  segments.push({ key: 'd5', value: Math.max(0, free), color: 'var(--d5)', label: 'Свободно' })

  // Событие «освободится N ₸» рождается из версий обязательства, а не заводится руками.
  const freed = obligations
    .map((o) => ({ o, change: nextChange(o, key) }))
    .find((x) => x.change && x.change.delta < 0)

  const upcoming = [
    ...obligations.map((o) => ({
      id: o.id, name: o.name, day: o.day, value: amountAt(o, key),
      note: o.estimate ? 'оценка по сезону' : o.note, color: `var(--${o.category})`,
      estimate: o.estimate,
    })),
    ...credits.map((c) => ({
      id: c.id, name: c.name, day: c.day, value: c.payment,
      note: c.note, color: 'var(--d2)', estimate: false,
    })),
  ].sort((a, b) => a.day - b.day)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Card>
        <Hero label={`Свободно в ${monthIn(key, false)}`} value={money(free)} />
        <div className="flex flex-col gap-[7px]">
          <Bar
            segments={people.map((p) => ({
              key: p.id, value: p.salary, color: `var(--p${p.id})`, label: p.name,
            }))}
          />
          <div className="flex justify-between text-[12px] text-ink-3">
            <span>Доход {money(income)}</span>
            <span>распределено {pct(spent, income)}%</span>
          </div>
          <Bar thick segments={segments} />
        </div>
        <Legend
          items={segments.map((s) => ({
            key: s.key, color: s.color, name: s.label ?? '', value: money(s.value),
          }))}
        />
      </Card>

      {freed && freed.change && (
        <div className="rounded-[18px] border border-brand bg-surface p-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand">
            С {monthFrom(freed.change.from, false)}
          </div>
          <h3 className="mb-1 font-display text-[19px] font-semibold tracking-[-0.01em]">
            Освободится {money(Math.abs(freed.change.delta))} в месяц
          </h3>
          <p className="mb-3.5 text-[13px] text-ink-2">
            {freed.o.name} снизится с {plain(amountAt(freed.o, key))} до {plain(freed.change.amount)} ₸.
            За год это {money(Math.abs(freed.change.delta) * 12)} — решите заранее, куда они пойдут.
          </p>
          <button
            onClick={() => navigate('/ritual')}
            className="w-full rounded-xl bg-brand px-4 py-2.5 text-[14px] font-semibold text-brand-ink active:translate-y-px"
          >
            Распределить
          </button>
        </div>
      )}

      {freed && freed.change && (
        <Callout title="Перед экономией будет пик">
          В месяц переезда платятся депозит, комиссия и перевозка — сверх обычных расходов.
          Экономия начнётся только со следующего месяца, и приложение не будет делать вид,
          что это не так.
        </Callout>
      )}

      <Section
        title="Впереди"
        action={<Link to="/budget" className="text-[13px] text-brand">Календарь</Link>}
      />
      <Card flush>
        {upcoming.map((u) => (
          <Row
            key={u.id}
            accent={u.color}
            icon={<Clock size={17} />}
            title={u.name}
            note={`${dayLabel(u.day, key)} · ${u.note}`}
            value={money(u.value)}
            sub={u.estimate ? 'оценка' : undefined}
          />
        ))}
      </Card>

      <Section title="Цели" action={<Link to="/goals" className="text-[13px] text-brand">Все</Link>} />
      <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {goals.map((g) => {
          const p = g.need ? g.have / g.need : 0
          return (
            <Link
              key={g.id}
              to={`/goals/${g.id}`}
              className="w-[138px] shrink-0 rounded-2xl border border-line bg-surface p-3.5"
            >
              <Ring progress={p} plan={g.planPct} hue={g.hue} size={44} />
              <div className="mt-2 text-[13px] font-medium leading-tight">{g.name}</div>
              <div className="mt-0.5 text-[12px] text-ink-3 num">
                {Math.round(p * 100)}% · {plain(g.have)}
              </div>
            </Link>
          )
        })}
      </div>

      <div className="flex justify-center pt-1">
        <Tag>данные хранятся на этом устройстве</Tag>
      </div>
    </div>
  )
}
