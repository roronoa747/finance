import { Link, useNavigate } from 'react-router-dom'
import { Clock, Plus } from '@phosphor-icons/react'
import { Card, Callout, Hero, Row, Section } from '@/components/kit'
import { cn } from '@/lib/utils'
import { InviteBanner } from '@/screens/Setup'
import { Bar, Legend, Ring } from '@/components/charts'
import { money, plain, pct } from '@/lib/money'
import { monthKey, monthIn, monthFrom, dayLabel } from '@/lib/dates'
import {
  amountAt, budgetAmounts, dueIn, liveCredits, liveGoals, liveObligations, nextChange, salaryAt,
  untilPayday, useStore,
} from '@/store/useStore'

export function Overview() {
  const navigate = useNavigate()
  const store = useStore()
  const { people, categories } = store
  // Удалённые записи продолжают ездить между устройствами как надгробия, но на экране их нет.
  const goals = liveGoals(store.goals)
  const obligations = liveObligations(store.obligations)
  const credits = liveCredits(store.credits)

  // Суммы по разделам считаются из обязательств, кредитов и целей, а не хранятся
  // отдельно: иначе бюджет остаётся в нулях, пока их не перепишут руками.
  const amounts = budgetAmounts(store)
  const income = amounts.income
  const free = amounts.d5
  const spent = income - free
  const key = monthKey()

  const segments = categories
    .filter((c) => c.key !== 'd5')
    .map((c) => ({
      key: c.key,
      value: amounts[c.key as 'd1' | 'd2' | 'd3' | 'd4'],
      color: `var(--${c.key})`,
      label: c.name,
    }))
  segments.push({ key: 'd5', value: Math.max(0, free), color: 'var(--d5)', label: 'Свободно' })

  // Событие «освободится N ₸» рождается из версий обязательства, а не заводится руками.
  const freed = obligations
    .map((o) => ({ o, change: nextChange(o, key) }))
    .find((x) => x.change && x.change.delta < 0)

  // Строка ведёт туда, где эту запись правят, а не в общий список капитала.
  const upcoming = [
    // Годовые платежи показываются только в свой месяц: висеть двенадцать
    // раз в году страховке незачем, а пропасть она не должна.
    ...obligations.filter((o) => dueIn(o, key)).map((o) => ({
      id: o.id, name: o.name, day: o.day, value: amountAt(o, key),
      note: o.every === 'year' ? 'раз в год' : o.estimate ? 'оценка по сезону' : o.note,
      color: `var(--${o.category})`,
      estimate: o.estimate, to: `/capital?obligation=${o.id}`,
    })),
    ...credits.map((c) => ({
      id: c.id, name: c.name, day: c.day, value: c.payment,
      note: c.note, color: 'var(--d2)', estimate: false, to: `/capital?credit=${c.id}`,
    })),
  ].sort((a, b) => a.day - b.day)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <InviteBanner />

      <Card>
        <Hero label={`Свободно в ${monthIn(key, false)}`} value={money(free)} />
        <div className="flex flex-col gap-[7px]">
          <Bar
            segments={people.map((p) => ({
              key: p.id, value: salaryAt(p, key), color: `var(--p${p.id})`, label: p.name,
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

      {free < 0 && (
        <Callout title="План пока не сходится">
          Расписано на {money(-free)} больше, чем приходит.
          {people.length < 2
            ? ' Скорее всего, доход второго участника ещё не внесён — пригласите его, и цифра сойдётся.'
            : ' Уменьшите любую строку в «Бюджете» — свободный остаток пересчитается сам.'}
        </Callout>
      )}

      {freed && freed.change && (
        <Callout title="Перед экономией будет пик">
          В месяц переезда платятся депозит, комиссия и перевозка — сверх обычных расходов.
          Экономия начнётся только со следующего месяца, и приложение не будет делать вид,
          что это не так.
        </Callout>
      )}

      <UntilPayday />

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
            onClick={() => navigate(u.to)}
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
        {!goals.length && (
          <Link
            to="/goals"
            className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-4"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2">
              <Plus size={17} weight="bold" />
            </span>
            <span className="text-[13.5px] leading-snug text-ink-2">
              Целей пока нет. Добавьте первую — приложение посчитает, сколько откладывать в месяц.
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * Что успеет списаться до ближайшей зарплаты.
 *
 * Календарный месяц и жизнь идут не в такт: первого числа приложение уже
 * расписало весь доход, хотя денег ещё не приходило. Заказчик назвал это
 * странным и объяснил почему — ориентир обычно зарплата, а не первое число.
 *
 * Карточка отвечает ровно на то, что можно узнать из введённого: когда придут
 * деньги и что нужно заплатить раньше. Вывод «хватит или нет» появляется
 * только когда заведены счета: без остатка на карте это было бы гаданием,
 * а гадание про деньги хуже молчания.
 */
function UntilPayday() {
  const store = useStore()
  const info = untilPayday(store)
  if (!info || !info.due.length) return null

  const { who, income, inDays, day, key, due, dueTotal, knowsCash, onAccounts, shortfall } = info

  return (
    <>
      <Section title="До зарплаты" />
      <Card>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">
            {inDays === 0 ? 'Сегодня' : `Через ${inDays} ${dayWord(inDays)}`}
          </span>
          <span className="ml-auto text-[13px] text-ink-3">
            {dayLabel(day, key)}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">
          {who.name} получит {money(income)}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline">
            <span className="text-[13px] text-ink-2">Списаний до неё</span>
            <b className="ml-auto num text-[14.5px]">{money(dueTotal)}</b>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {due.map((d) => (
              <div key={d.id} className="flex items-baseline gap-2 text-[12.5px]">
                <span className="text-ink-3">{dayLabel(d.day, d.when)}</span>
                <span className="truncate text-ink-2">{d.name}</span>
                <span className="ml-auto shrink-0 num">{plain(d.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {knowsCash ? (
          <div
            className={cn(
              'mt-3 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed',
              shortfall >= 0 ? 'border-brand bg-brand-soft text-ink-2' : 'border-warn-line bg-warn-soft text-ink-2',
            )}
          >
            {shortfall >= 0
              ? `На счетах ${plain(onAccounts)} ₸ — хватает, остаётся ${plain(shortfall)} ₸.`
              : `На счетах ${plain(onAccounts)} ₸ — не хватает ${plain(-shortfall)} ₸. Перенесите платёж или возьмите из накоплений, но решите это сейчас, а не в день списания.`}
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            Хватит ли этого, приложение не знает: остаток на картах не заведён. Добавьте
            счёт в «Капитале» — и здесь появится ответ вместо списка.
          </p>
        )}
      </Card>
    </>
  )
}

const dayWord = (n: number) => {
  const t = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return 'дней'
  if (t === 1) return 'день'
  if (t >= 2 && t <= 4) return 'дня'
  return 'дней'
}
