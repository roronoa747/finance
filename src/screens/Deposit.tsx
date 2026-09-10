import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { Callout, Card, Field, NumFieldBlur, Segmented } from '@/components/kit'
import { Button } from '@/components/ui/button'
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
  const updateAccount = useStore((s) => s.updateAccount)
  const removeAccount = useStore((s) => s.removeAccount)
  const inflation = useStore((s) => s.settings.inflation)
  const [confirm, setConfirm] = useState(false)

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
        <div className="mb-4 font-display text-[18px] font-semibold">{account.name}</div>

        <Field label="Название">
          <Input
            defaultValue={account.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== account.name) updateAccount(account.id, { name: v })
            }}
          />
        </Field>
        <Field label="Примечание">
          <Input
            defaultValue={account.note}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== account.note) updateAccount(account.id, { note: v })
            }}
          />
        </Field>

        <Field label="Сумма на счёте, ₸">
          <NumFieldBlur
            initial={plain(account.amount)}
            onCommit={(text) => setAccountAmount(account.id, parseMoney(text))}
          />
        </Field>
        <Field label="Ставка, % годовых">
          <NumFieldBlur
            initial={(d.annualRate * 100).toString().replace('.', ',')}
            onCommit={(text) => {
              const v = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''))
              if (Number.isFinite(v)) setDeposit(account.id, { annualRate: v / 100 })
            }}
            kind="rate"
          />
        </Field>
        <Field label="Пополнение в месяц, ₸">
          <NumFieldBlur
            initial={plain(d.monthlyTopUp)}
            onCommit={(text) => setDeposit(account.id, { monthlyTopUp: parseMoney(text) })}
          />
        </Field>
        <Field label="Срок, месяцев">
          <NumFieldBlur
            initial={String(d.months)}
            onCommit={(text) => setDeposit(account.id, { months: Math.max(1, parseMoney(text)) })}
            kind="int"
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

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Вклад исчезнет у обоих участников вместе с условиями. Отменить нельзя.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeAccount(account.id); navigate('/capital') }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить вклад
            </button>
          )}
        </div>
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
