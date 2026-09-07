import { useState } from 'react'
import { ArrowLeft, Copy, UserPlus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Segmented } from '@/components/kit'
import { money, parseMoney } from '@/lib/money'
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import { goalMonthly } from '@/lib/finance'
import { useStore } from '@/store/useStore'
import { createInvite } from '@/store/sync'
import { cn } from '@/lib/utils'

/**
 * Первичная настройка.
 *
 * Задаёт ровно те четыре вопроса, без ответов на которые главный экран
 * показывать нечего: сколько приходит, сколько уходит на жильё, есть ли кредит
 * и на что копим. Всё остальное человек добавит сам, когда захочет.
 *
 * Второй участник проходит только шаг про свой доход: жильё и кредиты
 * уже заведены, спрашивать их снова — значит показать, что приложение
 * не понимает, что бюджет общий.
 */

type Step = 'income' | 'housing' | 'credit' | 'goal' | 'invite'

const FIRST_STEPS: Step[] = ['income', 'housing', 'credit', 'goal', 'invite']

function Frame({
  step, total, title, note, onBack, children, footer,
}: {
  step: number; total: number; title: string; note?: string
  onBack?: () => void; children?: React.ReactNode; footer: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-6 pt-5">
      <div className="mb-6 flex items-center gap-3">
        {onBack ? (
          <button onClick={onBack} aria-label="Назад" className="text-ink-2 hover:text-ink">
            <ArrowLeft size={18} />
          </button>
        ) : (
          <span className="grid size-7 place-items-center rounded-lg bg-brand font-display text-[11px] font-bold text-brand-ink">
            FF
          </span>
        )}
        <div className="flex flex-1 gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <i
              key={i}
              className="h-[3px] flex-1 rounded-full"
              style={{ background: i <= step ? 'var(--brand)' : 'var(--track)' }}
            />
          ))}
        </div>
      </div>

      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.03em]">
        {title}
      </h1>
      {note && <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{note}</p>}

      <div className="mt-6 flex-1">{children}</div>
      <div className="mt-6 flex flex-col gap-2.5">{footer}</div>
    </div>
  )
}

export function Setup() {
  const {
    people, membership, householdId, setPerson, addObligation, addCredit, addGoal,
    setCategoryAmount, finishSetup, adoptMembers,
  } = useStore()

  const me = membership.find((m) => people.some((p) => p.id === m.slot))
  const mySlot = me?.slot ?? membership[0]?.slot ?? 'a'
  const myName = membership.find((m) => m.slot === mySlot)?.displayName ?? 'Вы'
  const setupDone = useStore((s) => s.setupDoneAt)

  // Второму участнику незачем заново заводить жильё и кредиты.
  const joining = Boolean(setupDone)
  const steps: Step[] = joining ? ['income'] : FIRST_STEPS
  const [idx, setIdx] = useState(0)
  const step = steps[idx]

  const [salary, setSalary] = useState('')
  const [payday, setPayday] = useState('10')

  const [tenure, setTenure] = useState<'rent' | 'mortgage' | 'own'>('rent')
  const [housing, setHousing] = useState('')
  const [housingDay, setHousingDay] = useState('5')
  const [utilities, setUtilities] = useState('')

  const [hasCredit, setHasCredit] = useState<'no' | 'yes'>('no')
  const [principal, setPrincipal] = useState('')
  const [payment, setPayment] = useState('')
  const [rate, setRate] = useState('')
  const [creditDay, setCreditDay] = useState('12')

  const [goalName, setGoalName] = useState('')
  const [goalNeed, setGoalNeed] = useState('')
  const [goalHave, setGoalHave] = useState('0')
  const [goalMonths, setGoalMonths] = useState('24')
  const [goalHue, setGoalHue] = useState<HueKey>('green')

  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const next = () => setIdx((i) => Math.min(i + 1, steps.length - 1))
  const back = () => setIdx((i) => Math.max(i - 1, 0))

  function saveIncome() {
    // Состав семьи мог ещё не догрузиться, и тогда записывать доход было бы
    // некуда: setPerson правит существующего участника, а не создаёт его.
    if (membership.length) adoptMembers(membership)
    setPerson(mySlot, {
      salary: parseMoney(salary),
      payday: Math.min(28, Math.max(1, parseMoney(payday) || 1)),
    })
    if (joining) finishSetup()
    else next()
  }

  function saveHousing() {
    const amount = parseMoney(housing)
    if (amount > 0) {
      addObligation({
        name: tenure === 'rent' ? 'Аренда' : tenure === 'mortgage' ? 'Ипотека' : 'Жильё',
        note: tenure === 'own' ? 'содержание' : 'ежемесячный платёж',
        day: Math.min(28, Math.max(1, parseMoney(housingDay) || 1)),
        category: 'd1',
        amount,
      })
    }
    const util = parseMoney(utilities)
    if (util > 0) {
      addObligation({
        name: 'Коммуналка',
        note: 'плавает по сезону',
        day: 15,
        category: 'd1',
        estimate: true,
        amount: util,
      })
    }
    setCategoryAmount('d1', amount + util)
    next()
  }

  function saveCredit() {
    if (hasCredit === 'yes') {
      const p = parseMoney(payment)
      addCredit({
        name: 'Кредит',
        note: 'ежемесячный платёж',
        principal: parseMoney(principal),
        annualRate: (parseFloat(rate.replace(',', '.')) || 0) / 100,
        payment: p,
        day: Math.min(28, Math.max(1, parseMoney(creditDay) || 1)),
      })
      setCategoryAmount('d2', p)
    }
    next()
  }

  function saveGoal() {
    const need = parseMoney(goalNeed)
    if (need > 0) {
      const have = parseMoney(goalHave)
      const months = Math.max(1, parseMoney(goalMonths) || 24)
      const monthly = goalMonthly(Math.max(0, need - have), months)
      addGoal({ name: goalName.trim() || 'Первая цель', need, have, monthly, hue: goalHue })
      setCategoryAmount('d3', monthly)
    }
    next()
  }

  async function makeInvite() {
    if (!householdId) return
    setBusy(true)
    try {
      setCode(await createInvite(householdId))
    } catch (e) {
      setCode(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер может быть недоступен — код и так на экране.
    }
  }

  const total = steps.length

  if (step === 'income') {
    return (
      <Frame
        step={idx} total={total}
        title={joining ? `${myName}, добавьте свой доход` : `${myName}, начнём с дохода`}
        note={joining
          ? 'Жильё и цели партнёр уже завёл. От вас нужна только зарплата — без неё бюджет посчитает долю неверно.'
          : 'Оклад без бонусов. Нерегулярные премии добавим отдельно — они не должны попадать в план месяца.'}
        footer={
          <Button onClick={saveIncome} disabled={!parseMoney(salary)}>
            {joining ? 'Готово' : 'Дальше'}
          </Button>
        }
      >
        <Field label="Зарплата в месяц, ₸">
          <Input
            value={salary} onChange={(e) => setSalary(e.target.value)}
            inputMode="numeric" placeholder="450 000" className="num text-[17px]" autoFocus
          />
        </Field>
        <Field label="День зарплаты">
          <Input
            value={payday} onChange={(e) => setPayday(e.target.value)}
            inputMode="numeric" className="num" placeholder="10"
          />
        </Field>
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          День нужен, чтобы календарь показал провал между вашей зарплатой и зарплатой партнёра —
          когда платежи уже прошли, а деньги ещё не пришли.
        </p>
      </Frame>
    )
  }

  if (step === 'housing') {
    return (
      <Frame
        step={idx} total={total} onBack={back}
        title="Жильё"
        note="Самая большая статья у большинства пар. С неё считается и доля жилья в доходе, и подушка."
        footer={
          <>
            <Button onClick={saveHousing}>Дальше</Button>
            <Button variant="ghost" onClick={next}>Пропустить</Button>
          </>
        }
      >
        <Field label="Как живёте">
          <Segmented<'rent' | 'mortgage' | 'own'>
            value={tenure} onChange={setTenure}
            options={[
              { value: 'rent', label: 'Аренда' },
              { value: 'mortgage', label: 'Ипотека' },
              { value: 'own', label: 'Своё' },
            ]}
          />
        </Field>
        <Field label={tenure === 'own' ? 'Содержание в месяц, ₸' : 'Платёж в месяц, ₸'}>
          <Input
            value={housing} onChange={(e) => setHousing(e.target.value)}
            inputMode="numeric" placeholder="280 000" className="num text-[17px]"
          />
        </Field>
        <Field label="День платежа">
          <Input value={housingDay} onChange={(e) => setHousingDay(e.target.value)} inputMode="numeric" className="num" />
        </Field>
        <Field label="Коммуналка в месяц, ₸ — примерно">
          <Input
            value={utilities} onChange={(e) => setUtilities(e.target.value)}
            inputMode="numeric" placeholder="22 000" className="num"
          />
        </Field>
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          Коммуналку приложение будет помечать как оценку: она плавает по сезонам, и выдавать её
          за точную цифру нечестно.
        </p>
      </Frame>
    )
  }

  if (step === 'credit') {
    return (
      <Frame
        step={idx} total={total} onBack={back}
        title="Кредиты"
        note="Если есть — приложение посчитает переплату и покажет, что даст досрочное погашение."
        footer={
          <>
            <Button onClick={saveCredit}>{hasCredit === 'yes' ? 'Дальше' : 'Кредитов нет'}</Button>
            {hasCredit === 'yes' && <Button variant="ghost" onClick={next}>Пропустить</Button>}
          </>
        }
      >
        <Field label="Есть кредит?">
          <Segmented<'no' | 'yes'>
            value={hasCredit} onChange={setHasCredit}
            options={[{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Есть' }]}
          />
        </Field>
        {hasCredit === 'yes' && (
          <>
            <Field label="Остаток долга, ₸">
              <Input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="numeric" placeholder="1 600 000" className="num" />
            </Field>
            <Field label="Платёж в месяц, ₸">
              <Input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="numeric" placeholder="117 000" className="num" />
            </Field>
            <Field label="Ставка (ГЭСВ из договора), % годовых">
              <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="23,4" className="num" />
            </Field>
            <Field label="День платежа">
              <Input value={creditDay} onChange={(e) => setCreditDay(e.target.value)} inputMode="numeric" className="num" />
            </Field>
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              Берите ГЭСВ, а не ставку с витрины: в договоре это «годовая эффективная ставка
              вознаграждения». Она учитывает комиссии, и по ней считается настоящая переплата.
            </p>
          </>
        )}
      </Frame>
    )
  }

  if (step === 'goal') {
    const need = parseMoney(goalNeed)
    const have = parseMoney(goalHave)
    const months = Math.max(1, parseMoney(goalMonths) || 24)
    const monthly = need > 0 ? goalMonthly(Math.max(0, need - have), months) : 0
    return (
      <Frame
        step={idx} total={total} onBack={back}
        title="На что копим"
        note="Одной цели достаточно, остальные добавите позже. Приложение посчитает, сколько откладывать в месяц."
        footer={
          <>
            <Button onClick={saveGoal}>Дальше</Button>
            <Button variant="ghost" onClick={next}>Пока без цели</Button>
          </>
        }
      >
        <Field label="Название">
          <Input value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="Первая квартира" />
        </Field>
        <Field label="Сколько нужно, ₸">
          <Input value={goalNeed} onChange={(e) => setGoalNeed(e.target.value)} inputMode="numeric" placeholder="6 000 000" className="num text-[17px]" />
        </Field>
        <Field label="Уже накоплено, ₸">
          <Input value={goalHave} onChange={(e) => setGoalHave(e.target.value)} inputMode="numeric" className="num" />
        </Field>
        <Field label="За сколько месяцев хотите успеть">
          <Input value={goalMonths} onChange={(e) => setGoalMonths(e.target.value)} inputMode="numeric" className="num" />
        </Field>
        <Field label="Цвет">
          <div className="flex flex-wrap gap-2">
            {HUE_KEYS.map((h) => (
              <button
                key={h} aria-label={HUES[h].label} aria-pressed={goalHue === h}
                onClick={() => setGoalHue(h)}
                className={cn('size-[26px] rounded-[9px] border-2', goalHue === h ? 'border-ink' : 'border-transparent')}
                style={{ background: HUES[h].light }}
              />
            ))}
          </div>
        </Field>
        {monthly > 0 && (
          <div className="rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
            <span className="text-[13px] text-ink-2">Откладывать в месяц</span>
            <div className="font-display text-[22px] font-semibold tracking-[-0.02em] num">
              {money(monthly)}
            </div>
          </div>
        )}
      </Frame>
    )
  }

  // invite
  return (
    <Frame
      step={idx} total={total} onBack={back}
      title="Пригласите партнёра"
      note="Бюджет общий: у второго будет свой вход, свои цвета и свой доход, а цели и покупки — одни на двоих."
      footer={
        <>
          <Button onClick={finishSetup}>{code ? 'Готово' : 'Перейти к бюджету'}</Button>
          {!code && (
            <p className="text-center text-[12.5px] text-ink-3">
              Можно пригласить позже — кнопка есть на главном экране.
            </p>
          )}
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-7 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <UserPlus size={24} />
        </span>
        {code ? (
          <>
            <div>
              <div className="text-[13px] text-ink-2">Код приглашения</div>
              <button
                onClick={copy}
                className="mt-1 flex items-center gap-2 font-display text-[30px] font-semibold tracking-[0.14em] num"
              >
                {code}
                <Copy size={17} className="text-ink-3" />
              </button>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Продиктуйте его партнёру. Он открывает тот же адрес, регистрируется и выбирает
              «Войти по коду». Код действует две недели и срабатывает один раз.
            </p>
            {copied && <span className="text-[12px] text-brand">Скопировано</span>}
          </>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Создадим короткий код — его удобно продиктовать вслух, не пересылая ничего в
              переписке.
            </p>
            <Button onClick={makeInvite} disabled={busy} className="w-full">
              {busy ? 'Минуту…' : 'Создать код'}
            </Button>
          </>
        )}
      </div>
    </Frame>
  )
}

/** Плашка на главном, пока в бюджете один человек. */
export function InviteBanner() {
  const membership = useStore((s) => s.membership)
  const householdId = useStore((s) => s.householdId)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!householdId || membership.length >= 2) return null

  async function make() {
    if (!householdId) return
    setBusy(true)
    try {
      setCode(await createInvite(householdId))
    } catch (e) {
      setCode(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ничего страшного, код виден на экране
    }
  }

  return (
    <div className="rounded-[18px] border border-brand bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <UserPlus size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block font-display text-[15.5px] font-semibold">Пригласите партнёра</b>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            Пока бюджет видите только вы. У второго будет свой вход, а цели и покупки — общие.
          </p>
        </div>
      </div>
      {code ? (
        <button
          onClick={copy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-brand-soft py-3 font-display text-[22px] font-semibold tracking-[0.14em] num"
        >
          {code}
          <Copy size={16} className="text-ink-3" />
        </button>
      ) : (
        <Button className="mt-3 w-full" onClick={make} disabled={busy}>
          {busy ? 'Минуту…' : 'Создать код приглашения'}
        </Button>
      )}
      {copied && <p className="mt-1.5 text-center text-[12px] text-brand">Скопировано</p>}
    </div>
  )
}

