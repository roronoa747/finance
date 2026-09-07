import { Link } from 'react-router-dom'
import { Bank, Coins, CreditCard, House, Wallet } from '@phosphor-icons/react'
import { Card, Row, Section, Tag } from '@/components/kit'
import { money, plain, ratePct } from '@/lib/money'
import { annuityMonths, annuityTotal } from '@/lib/finance'
import {
  amountAt, liveAccounts, liveCredits, liveObligations, netWorth, useStore,
} from '@/store/useStore'
import { monthKey } from '@/lib/dates'

const ICONS = {
  deposit: <Bank size={17} />,
  card: <CreditCard size={17} />,
  cash: <Coins size={17} />,
  envelope: <Wallet size={17} />,
}

export function Capital() {
  const store = useStore()
  const accounts = liveAccounts(store.accounts)
  const credits = liveCredits(store.credits)
  const obligations = liveObligations(store.obligations)
  const key = monthKey()
  const total = netWorth(store.accounts, store.credits)

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Card>
        <div className="text-[13px] text-ink-2">Чистый капитал</div>
        <div className="font-display text-[30px] font-semibold tracking-[-0.025em] num">{money(total)}</div>
        <p className="mt-2 text-[12.5px] text-ink-3">
          Всё, что есть, минус всё, что должны. Возвратный депозит за квартиру — это не расход,
          а замороженные деньги, поэтому он остаётся в капитале.
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
              note={o.note}
              value={money(amountAt(o, key))}
              sub="в месяц"
            />
          ))}
      </Card>

      <Card>
        <div className="mb-2.5 flex items-center gap-2.5">
          <b className="text-[14.5px] font-semibold">Депозит «Первая квартира»</b>
          <Tag tone="gold">+8% к плану</Tag>
        </div>
        <div className="flex h-4 overflow-hidden rounded-lg bg-track">
          <span className="block h-full" style={{ width: '64%', background: 'var(--brand)' }} />
          <span className="block h-full" style={{ width: '6%', background: 'var(--gold)' }} />
        </div>
        <p className="mt-2.5 text-[12.5px] text-ink-2">
          Золотая часть — то, что вы положили сверх плана. Это и есть вся геймификация вкладов:
          обгоняем собственный график, а не абстрактный уровень.
        </p>
      </Card>
    </div>
  )
}
