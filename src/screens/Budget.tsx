import { useState } from 'react'
import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { Card, Callout, Row, Section, Segmented, Stat } from '@/components/kit'
import { Bar, Legend } from '@/components/charts'
import { Input } from '@/components/ui/input'
import { money, parseMoney, pct, plain } from '@/lib/money'
import {
  WEEKDAYS, dayLabel, daysInMonth, leadingBlanks, monthKey, monthTitle, today,
} from '@/lib/dates'
import { amountAt, budgetAmounts, liveCredits, liveObligations, useStore } from '@/store/useStore'
import { cn } from '@/lib/utils'

const DERIVED_NOTE: Record<string, string> = {
  d1: 'сумма обязательств по жилью',
  d2: 'платежи по кредитам',
  d3: 'взносы по всем целям',
}

type View = 'plan' | 'calendar' | 'list'
type Event = {
  id: string; day: number; name: string; note: string
  value: number; color: string; income: boolean; estimate?: boolean
}

export function Budget() {
  const [view, setView] = useState<View>('plan')
  const store = useStore()
  const { people, categories, setCategoryAmount, setPerson } = store
  const obligations = liveObligations(store.obligations)
  const credits = liveCredits(store.credits)
  const key = monthKey()
  const amounts = budgetAmounts(store)
  const income = amounts.income
  const free = amounts.d5

  const events: Event[] = [
    ...people.map((p) => ({
      id: `pay-${p.id}`, day: p.payday, name: `Зарплата · ${p.name}`, note: 'оклад',
      value: p.salary, color: `var(--p${p.id})`, income: true,
    })),
    ...obligations.map((o) => ({
      id: o.id, day: o.day, name: o.name, note: o.estimate ? 'оценка по сезону' : o.note,
      value: amountAt(o, key), color: `var(--${o.category})`, income: false, estimate: o.estimate,
    })),
    ...credits.map((c) => ({
      id: c.id, day: c.day, name: c.name, note: c.note,
      value: c.payment, color: 'var(--d2)', income: false,
    })),
    {
      id: 'goals', day: 1, name: 'Взносы в цели', note: 'по плану месяца',
      value: amounts.d3, color: 'var(--d3)', income: false,
    },
  ].sort((a, b) => a.day - b.day)

  const obligationsTotal = events.filter((e) => !e.income && e.id !== 'goals').reduce((a, e) => a + e.value, 0)
  const savedTotal = amounts.d3

  const [selected, setSelected] = useState(today().day)
  const dayEvents = events.filter((e) => e.day === selected)


  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'plan', label: 'План' },
          { value: 'calendar', label: 'Календарь' },
          { value: 'list', label: 'Список' },
        ]}
      />

      {view === 'plan' && (
        <>
          <Card>
            <div className="text-[13px] text-ink-2">Доход семьи · оклады без бонусов</div>
            <div className="mb-3.5 mt-0.5 font-display text-[30px] font-semibold tracking-[-0.025em] num">
              {money(income)}
            </div>
            <Bar segments={people.map((p) => ({ key: p.id, value: p.salary, color: `var(--p${p.id})`, label: p.name }))} />
            <div className="mt-3.5 flex flex-col gap-3">
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5">
                  <i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--p${p.id})` }} />
                  <span className="text-[14px] text-ink-2">
                    {p.name} · {p.payday} числа
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Input
                      aria-label={`Оклад ${p.name}`}
                      inputMode="numeric"
                      defaultValue={plain(p.salary)}
                      onBlur={(e) => setPerson(p.id, { salary: parseMoney(e.target.value) })}
                      className="h-9 w-[118px] bg-surface-2 text-right num"
                    />
                    <span className="w-8 text-right text-[12px] text-ink-3 num">{pct(p.salary, income)}%</span>
                  </span>
                </div>
              ))}
            </div>
            {people.length > 1 && (
              <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">
                Зарплаты приходят в разные дни, поэтому месяц закрывается 1-го числа, а не в день
                получки. Провал между {people[0].payday} и {people[1].payday} числом виден в календаре.
              </p>
            )}
          </Card>

          <Section title="Куда уходит" />
          <Card>
            <div className="flex flex-col">
              {categories.filter((c) => c.key !== 'd5').map((c) => {
                const value = amounts[c.key as 'd1' | 'd2' | 'd3' | 'd4']
                // Жильё, кредиты и цели уже описаны в другом месте — здесь их
                // только показываем. Вводить их второй раз значило бы завести
                // вторую версию правды, которая тут же разойдётся с первой.
                const derived = c.key !== 'd4'
                return (
                  <div key={c.key} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
                    <i className="min-h-[34px] w-[3px] self-stretch rounded-sm" style={{ background: `var(--${c.key})` }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium">{c.name}</div>
                      <div className="text-[12.5px] text-ink-3">
                        {derived ? DERIVED_NOTE[c.key] : c.note}
                      </div>
                    </div>
                    <div className="text-right">
                      {derived ? (
                        <div className="text-[15px] font-semibold num">{money(value)}</div>
                      ) : (
                        <Input
                          aria-label={c.name}
                          inputMode="numeric"
                          defaultValue={plain(c.amount)}
                          onBlur={(e) => setCategoryAmount(c.key, parseMoney(e.target.value))}
                          className="h-9 w-[118px] bg-surface-2 text-right num"
                        />
                      )}
                      <div className="mt-0.5 text-[12px] font-medium text-brand num">
                        {pct(value, income)}% дохода
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-3 pt-3">
                <i className="min-h-[34px] w-[3px] self-stretch rounded-sm" style={{ background: 'var(--d5)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium">Свободно</div>
                  <div className="text-[12.5px] text-ink-3">считается само — это остаток</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-semibold num">{money(free)}</div>
                  <div className="mt-0.5 text-[12px] font-medium text-brand num">{pct(free, income)}% дохода</div>
                </div>
              </div>
            </div>
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-3">
              Жильё, кредиты и цели считаются из того, что вы уже завели: меняются они
              в «Капитале» и в целях. Руками задаётся только «еда и быт» — единственная
              статья, которую мы намеренно не отслеживаем по операциям.
            </p>
          </Card>

          {free < 0 && (
            <Callout title="План не сходится">
              Расписано больше, чем приходит, на {money(-free)}. Уменьшите любую строку — свободный
              остаток пересчитается сам.
            </Callout>
          )}
        </>
      )}

      {view === 'calendar' && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Отложено" value={money(savedTotal)} color="var(--d3)" />
            <Stat label="На обязательства" value={money(obligationsTotal)} color="var(--d2)" />
          </div>

          <Card>
            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-center text-[11px] tracking-[0.04em] text-ink-3">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: leadingBlanks(key) }).map((_, i) => (
                <span key={`b${i}`} className="aspect-square" />
              ))}
              {Array.from({ length: daysInMonth(key) }).map((_, i) => {
                const day = i + 1
                const evs = events.filter((e) => e.day === day)
                return (
                  <button
                    key={day}
                    onClick={() => setSelected(day)}
                    aria-pressed={selected === day}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[10px] border border-transparent text-[13px]',
                      evs.length ? 'font-medium text-ink' : 'text-ink-2',
                      selected === day && 'border-line-strong bg-surface-3',
                    )}
                  >
                    {day}
                    <span className="flex h-[5px] gap-0.5">
                      {evs.slice(0, 3).map((e) => (
                        <i key={e.id} className="size-[5px] rounded-full" style={{ background: e.color }} />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
            <Legend
              items={[
                ...people.map((p) => ({ key: p.id, color: `var(--p${p.id})`, name: `Зарплата · ${p.name}`, value: '' })),
                { key: 'd1', color: 'var(--d1)', name: 'Жильё', value: '' },
                { key: 'd2', color: 'var(--d2)', name: 'Кредит', value: '' },
                { key: 'd3', color: 'var(--d3)', name: 'Отложено в цели', value: '' },
              ]}
            />
          </Card>

          <div className="mt-1 flex items-baseline gap-2 px-0.5">
            <b className="font-display text-[14px] font-semibold">{dayLabel(selected, key)}</b>
            {!dayEvents.length && <span className="text-[12.5px] text-ink-3">движений нет</span>}
          </div>
          {dayEvents.length > 0 && (
            <Card flush>
              {dayEvents.map((e) => (
                <Row
                  key={e.id}
                  accent={e.color}
                  icon={e.income ? <ArrowUp size={15} weight="bold" /> : <ArrowDown size={15} weight="bold" />}
                  title={e.name}
                  note={e.note}
                  value={
                    <span style={{ color: e.income ? 'var(--brand)' : undefined }}>
                      {e.income ? '+' : '−'}{plain(e.value)}
                    </span>
                  }
                />
              ))}
            </Card>
          )}

          <Card>
            <div className="mb-3 flex items-center gap-2.5">
              <b className="text-[14.5px] font-semibold">Нагрузка на доход</b>
            </div>

            {/*
              Две разные вещи, которые часто путают: платежи по кредитам и все
              обязательные платежи вместе с жильём. Банк смотрит на первое,
              а на жизнь семьи влияет второе — поэтому показываем обе.
            */}
            <div className="mb-3">
              <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">Кредиты</span>
                <b className="num">{pct(amounts.d2, income)}% · {money(amounts.d2)}</b>
              </div>
              <div className="flex h-3 overflow-hidden rounded-md bg-track">
                <span className="block h-full" style={{ width: `${Math.min(100, (amounts.d2 / (income || 1)) * 100)}%`, background: 'var(--d2)' }} />
              </div>
              <div className="mt-1 text-[11.5px] text-ink-3">до 30% считается комфортным</div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">Вместе с жильём</span>
                <b className="num">{pct(amounts.d1 + amounts.d2, income)}% · {money(amounts.d1 + amounts.d2)}</b>
              </div>
              <div className="flex h-3 overflow-hidden rounded-md bg-track">
                <span className="block h-full" style={{ width: `${Math.min(100, (amounts.d1 / (income || 1)) * 100)}%`, background: 'var(--d1)' }} />
                <span className="block h-full" style={{ width: `${Math.min(100, (amounts.d2 / (income || 1)) * 100)}%`, background: 'var(--d2)' }} />
              </div>
              <div className="mt-1 text-[11.5px] text-ink-3">до 50% — обычный ориентир для пары</div>
            </div>

            <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
              Обязательные платежи — {money(obligationsTotal)} из {money(income)} дохода.
              Это то, что уходит независимо от ваших решений в этом месяце.
            </p>
          </Card>
        </>
      )}

      {view === 'list' && (
        <Card flush>
          {events.map((e) => (
            <Row
              key={e.id}
              accent={e.color}
              icon={e.income ? <ArrowUp size={15} weight="bold" /> : <ArrowDown size={15} weight="bold" />}
              title={e.name}
              note={`${dayLabel(e.day, key)} · ${e.note}`}
              value={
                <span style={{ color: e.income ? 'var(--brand)' : undefined }}>
                  {e.income ? '+' : '−'}{plain(e.value)}
                </span>
              }
              sub={e.estimate ? 'оценка' : undefined}
            />
          ))}
        </Card>
      )}

      <div className="pb-2 text-center text-[12px] text-ink-3">{monthTitle(key)}</div>
    </div>
  )
}
