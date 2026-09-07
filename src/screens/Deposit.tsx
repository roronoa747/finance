import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { Card, Callout, Field, Segmented } from '@/components/kit'
import { Input } from '@/components/ui/input'
import { money, parseMoney, plain, ratePct } from '@/lib/money'
import { deposit as calcDeposit, realRate } from '@/lib/finance'
import { useStore } from '@/store/useStore'

export function Deposit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const account = useStore((s) => s.accounts.find((a) => a.id === id))
  const setDeposit = useStore((s) => s.setDeposit)
  const setAccountAmount = useStore((s) => s.setAccountAmount)
  const inflation = useStore((s) => s.settings.inflation)

  if (!account?.deposit) {
    return (
      <div className="pt-6 text-center text-[14px] text-ink-3">
        Вклад не найден.{' '}
        <button className="text-brand" onClick={() => navigate('/capital')}>К капиталу</button>
      </div>
    )
  }

  const d = account.deposit
  const result = calcDeposit({
    principal: account.amount,
    annualRate: d.annualRate,
    months: d.months,
    monthlyTopUp: d.monthlyTopUp,
    capitalize: d.capitalize,
  })
  const real = realRate(result.effectiveRate, inflation)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <button onClick={() => navigate('/capital')} className="flex items-center gap-1.5 self-start text-[13px] text-ink-2">
        <ArrowLeft size={15} /> Капитал
      </button>

      <Card>
        <div className="font-display text-[18px] font-semibold">{account.name}</div>
        <div className="mb-4 text-[13px] text-ink-3">{account.note}</div>

        <Field label="Сумма на счёте, ₸">
          <Input
            inputMode="numeric" className="num" defaultValue={plain(account.amount)}
            onBlur={(e) => setAccountAmount(account.id, parseMoney(e.target.value))}
          />
        </Field>
        <Field label="Ставка, % годовых">
          <Input
            inputMode="decimal" className="num" defaultValue={(d.annualRate * 100).toString().replace('.', ',')}
            onBlur={(e) => {
              const v = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))
              if (Number.isFinite(v)) setDeposit(account.id, { annualRate: v / 100 })
            }}
          />
        </Field>
        <Field label="Пополнение в месяц, ₸">
          <Input
            inputMode="numeric" className="num" defaultValue={plain(d.monthlyTopUp)}
            onBlur={(e) => setDeposit(account.id, { monthlyTopUp: parseMoney(e.target.value) })}
          />
        </Field>
        <Field label="Срок, месяцев">
          <Input
            inputMode="numeric" className="num" defaultValue={String(d.months)}
            onBlur={(e) => setDeposit(account.id, { months: Math.max(1, parseMoney(e.target.value)) })}
          />
        </Field>
        <Field label="Капитализация">
          <Segmented<'yes' | 'no'>
            value={d.capitalize ? 'yes' : 'no'}
            onChange={(v) => setDeposit(account.id, { capitalize: v === 'yes' })}
            options={[
              { value: 'yes', label: 'Ежемесячно' },
              { value: 'no', label: 'В конце срока' },
            ]}
          />
        </Field>
      </Card>

      <Card>
        <div className="pb-1.5 pt-1 text-center">
          <div className="text-[12.5px] text-ink-3">Будет на счёте через {d.months} мес.</div>
          <div className="mt-1 font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] num">
            {money(Math.round(result.future))}
          </div>
          <div className="mt-1.5 text-[13px] text-ink-2">
            Начислено процентов: {money(Math.round(result.interest))}
          </div>
        </div>
        <div className="mt-2.5 flex items-center border-t border-line pt-3.5 text-[13.5px]">
          <span className="text-ink-2">Эффективная ставка</span>
          <b className="ml-auto num">{ratePct(result.effectiveRate)}</b>
        </div>
        <div className="flex items-center py-2 text-[13.5px]">
          <span className="text-ink-2">Ваши взносы</span>
          <b className="ml-auto num">{money(result.contributed)}</b>
        </div>
        <div className="flex items-center text-[13.5px]">
          <span className="text-ink-2">Заработал банк</span>
          <b className="ml-auto num">{money(Math.round(result.interest))}</b>
        </div>
      </Card>

      <Callout title="Реальная доходность ниже той, что на витрине">
        При инфляции {(inflation * 100).toFixed(1).replace('.', ',')}% эффективная ставка{' '}
        {ratePct(result.effectiveRate, 1)} оставляет примерно {ratePct(real, 1)} настоящих.
        Это не повод не копить — это повод не путать номинал с доходом.
      </Callout>

      <Callout title="Проценты считает приложение, а не банк">
        Формула аннуитета и капитализации работает офлайн, на ваших цифрах. Когда появится
        ИИ-советник, он получит уже посчитанный результат и будет только объяснять его словами —
        считать деньги модели не доверяем.
      </Callout>
    </div>
  )
}
