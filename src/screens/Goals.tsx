import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Link as LinkIcon, Plus, Trash } from '@phosphor-icons/react'
import { Card, Callout, Field, Section, Segmented, Tag } from '@/components/kit'
import { Ring } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain } from '@/lib/money'
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import { liveGoals, liveWishlist, useStore } from '@/store/useStore'
import type { PersonId } from '@/store/types'
import { cn } from '@/lib/utils'

type Tab = 'goals' | 'wish'

export function Goals() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') === 'wish' ? 'wish' : 'goals') as Tab
  const setTab = (t: Tab) => setParams(t === 'wish' ? { tab: 'wish' } : {}, { replace: true })

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'goals', label: 'Цели' },
          { value: 'wish', label: 'Покупки' },
        ]}
      />
      {tab === 'goals' ? <GoalList /> : <Wishlist />}
    </div>
  )
}

/* ------------------------------- цели ------------------------------- */

function GoalList() {
  const goals = liveGoals(useStore((s) => s.goals))
  const addGoal = useStore((s) => s.addGoal)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [need, setNeed] = useState('')
  const [have, setHave] = useState('0')
  const [monthly, setMonthly] = useState('')
  const [hue, setHue] = useState<HueKey>('blue')

  function create() {
    const n = parseMoney(need)
    if (!name.trim() || !n) return
    addGoal({
      name: name.trim(),
      need: n,
      have: parseMoney(have),
      monthly: parseMoney(monthly) || Math.ceil(n / 24),
      hue,
    })
    setName(''); setNeed(''); setHave('0'); setMonthly('')
    setOpen(false)
  }

  return (
    <>
      <Card flush>
        {goals.map((g) => {
          const p = g.need ? g.have / g.need : 0
          return (
            <Link
              key={g.id}
              to={`/goals/${g.id}`}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-2"
            >
              <Ring progress={p} plan={g.planPct} hue={g.hue} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{g.name}</span>
                <span className="block text-[12.5px] text-ink-3 num">
                  {plain(g.have)} из {plain(g.need)} ₸
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[14.5px] font-semibold num">{Math.round(p * 100)}%</span>
                <span className="block text-[12px] text-ink-3 num">{plain(g.monthly)}/мес</span>
              </span>
            </Link>
          )
        })}
        {!goals.length && <div className="px-4 py-6 text-center text-[13px] text-ink-3">Целей пока нет</div>}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" /> Новая цель
      </Button>

      <Section title="Ритм" />
      <Card>
        <div className="mb-3 flex items-center gap-2.5">
          <b className="text-[14.5px] font-semibold">Откладываем без пропусков</b>
          <Tag tone="gold">7 месяцев</Tag>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <i
              key={i}
              className="h-[22px] flex-1 rounded-md"
              style={{ background: i < 7 ? 'var(--brand)' : 'var(--track)' }}
            />
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">
          Месяц засчитывается, если план по целям выполнен и нет просрочек по кредиту. Иначе
          геймификация поощряла бы закидывать деньги в цель вместо обязательного платежа.
        </p>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92vw] rounded-2xl border-line bg-surface sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display">Новая цель</DialogTitle></DialogHeader>
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, машина" />
          </Field>
          <Field label="Сколько нужно, ₸">
            <Input value={need} onChange={(e) => setNeed(e.target.value)} inputMode="numeric" placeholder="3 000 000" className="num" />
          </Field>
          <Field label="Уже есть, ₸">
            <Input value={have} onChange={(e) => setHave(e.target.value)} inputMode="numeric" className="num" />
          </Field>
          <Field label="Откладывать в месяц, ₸">
            <Input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="numeric" placeholder="по умолчанию — за 24 месяца" className="num" />
          </Field>
          <Field label="Цвет">
            <div className="flex flex-wrap gap-2">
              {HUE_KEYS.map((h) => (
                <button
                  key={h}
                  aria-label={HUES[h].label}
                  aria-pressed={hue === h}
                  onClick={() => setHue(h)}
                  className={cn('size-[26px] rounded-[9px] border-2', hue === h ? 'border-ink' : 'border-transparent')}
                  style={{ background: HUES[h].light }}
                />
              ))}
            </div>
          </Field>
          <Button onClick={create} className="w-full">Создать цель</Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ----------------------------- покупки ----------------------------- */

function Wishlist() {
  const store = useStore()
  const { people, addWish, toggleBought, removeWish } = store
  const wishlist = liveWishlist(store.wishlist)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [url, setUrl] = useState('')
  const [by, setBy] = useState<PersonId>('a')
  const [justBought, setJustBought] = useState<string | null>(null)

  const active = wishlist.filter((w) => !w.bought)
  const bought = wishlist.filter((w) => w.bought)
  const boughtSum = bought.reduce((a, w) => a + w.price, 0)
  const nameOf = (id: PersonId) => people.find((p) => p.id === id)?.name ?? ''

  function create() {
    if (!name.trim()) return
    addWish({ name: name.trim(), price: parseMoney(price), by, url: url.trim() || undefined })
    setName(''); setPrice(''); setUrl('')
    setOpen(false)
  }

  function markBought(id: string, itemName: string) {
    toggleBought(id)
    setJustBought(itemName)
  }

  return (
    <>
      {justBought && (
        <Callout tone="good" title={`Куплено — ${justBought}`}>
          Это {bought.length + 1}-я покупка в дом. Вещь переехала в историю с датой и автором —
          через год будет видно, куда уходили деньги на быт.
        </Callout>
      )}

      <Card flush>
        {active.map((w) => (
          <div key={w.id} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
            <button
              onClick={() => markBought(w.id, w.name)}
              aria-label="Отметить купленным"
              className="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-line-strong text-transparent hover:border-brand hover:text-brand"
            >
              <Check size={14} weight="bold" />
            </button>
            <div className="min-w-0 flex-1">
              <b className="block text-[14.5px] font-medium">{w.name}</b>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                <i className="size-[7px] shrink-0 rounded-full" style={{ background: `var(--p${w.by})` }} />
                {nameOf(w.by)} · {w.addedOn}
                {w.url && (
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-1.5 text-[11.5px] text-brand"
                  >
                    <LinkIcon size={10} /> ссылка
                  </a>
                )}
              </div>
            </div>
            <span className="shrink-0 text-[14px] font-semibold num">{plain(w.price)}</span>
            <button onClick={() => removeWish(w.id)} aria-label="Удалить" className="shrink-0 text-ink-3 hover:text-ink">
              <Trash size={15} />
            </button>
          </div>
        ))}
        {!active.length && <div className="px-4 py-6 text-center text-[13px] text-ink-3">Список пуст</div>}
      </Card>

      <Button variant="outline" className="w-full bg-surface-2" onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" /> Добавить покупку
      </Button>

      <Section
        title="Уже купили"
        action={bought.length ? <span className="text-[13px] text-ink-3 num">{money(boughtSum)}</span> : undefined}
      />
      <Card flush>
        {bought.map((w) => (
          <div key={w.id} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
            <button
              onClick={() => toggleBought(w.id)}
              aria-label="Вернуть в список"
              className="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-brand bg-brand text-brand-ink"
            >
              <Check size={14} weight="bold" />
            </button>
            <div className="min-w-0 flex-1">
              <b className="block text-[14.5px] font-medium text-ink-3 line-through">{w.name}</b>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                <i className="size-[7px] shrink-0 rounded-full" style={{ background: `var(--p${w.by})` }} />
                {nameOf(w.by)} · куплено {w.boughtOn}
              </div>
            </div>
            <span className="shrink-0 text-[14px] font-semibold text-ink-3 num">{plain(w.price)}</span>
          </div>
        ))}
        {!bought.length && <div className="px-4 py-6 text-center text-[13px] text-ink-3">Пока ничего</div>}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92vw] rounded-2xl border-line bg-surface sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display">Покупка в дом</DialogTitle></DialogHeader>
          <Field label="Что покупаем">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, сковорода" />
          </Field>
          <Field label="Цена, ₸">
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="18 000" className="num" />
          </Field>
          <Field label="Ссылка на товар">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="можно оставить пустым" />
          </Field>
          <Field label="Кто добавил">
            <Segmented<PersonId>
              value={by}
              onChange={setBy}
              options={people.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Button onClick={create} className="w-full">Добавить в список</Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
