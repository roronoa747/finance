import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Link as LinkIcon, Plus } from '@phosphor-icons/react'
import { Callout, Card, Field, NumField, NumFieldBlur, Section, Segmented, Tag } from '@/components/kit'
import { Ring } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { money, parseMoney, plain } from '@/lib/money'
import { addMonths, monthKey, monthTitle } from '@/lib/dates'
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import { contributionStreak, liveGoals, liveWishlist, useStore } from '@/store/useStore'
import type { PersonId } from '@/store/types'
import { cn } from '@/lib/utils'

type Tab = 'goals' | 'wish'

const monthWord = (n: number) => {
  const t = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return 'месяцев'
  if (t === 1) return 'месяц'
  if (t >= 2 && t <= 4) return 'месяца'
  return 'месяцев'
}

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

  // Ритм считается по фактическим взносам во все цели, а не задан числом в коде.
  const allMovements = goals.flatMap((g) => g.movements)
  const streak = contributionStreak(allMovements)
  const filledMonths = new Set(allMovements.filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7)))
  const last12 = Array.from({ length: 12 }, (_, i) => {
    const key = addMonths(monthKey(), i - 11)
    return { key, label: monthTitle(key), filled: filledMonths.has(key) }
  })

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
          {streak > 0 && <Tag tone="gold">{streak} {monthWord(streak)}</Tag>}
        </div>
        <div className="flex gap-1.5">
          {last12.map((m) => (
            <i
              key={m.key}
              title={m.label}
              className="h-[22px] flex-1 rounded-md"
              style={{ background: m.filled ? 'var(--brand)' : 'var(--track)' }}
            />
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {streak > 0
            ? 'Закрашен месяц, в котором был хотя бы один взнос в любую цель. Серия считается назад от текущего месяца.'
            : 'Пока ни одного взноса. Полоски закрасятся сами, как только начнёте пополнять цели — считается по фактическим взносам, а не по плану.'}
        </p>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92vw] rounded-2xl border-line bg-surface sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display">Новая цель</DialogTitle></DialogHeader>
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, машина" />
          </Field>
          <Field label="Сколько нужно, ₸">
            <NumField value={need} onValue={setNeed} placeholder="3 000 000" />
          </Field>
          <Field label="Уже есть, ₸">
            <NumField value={have} onValue={setHave} />
          </Field>
          <Field label="Откладывать в месяц, ₸">
            <NumField value={monthly} onValue={setMonthly} placeholder="по умолчанию — за 24 месяца" />
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
  const { people, addWish, toggleBought } = store
  const wishlist = liveWishlist(store.wishlist)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
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
            {/*
              Ссылка вынесена из нажимаемой области: ссылка внутри кнопки —
              и невалидная разметка, и промах пальцем вместо перехода.
            */}
            <button onClick={() => setEditId(w.id)} className="min-w-0 flex-1 text-left">
              <b className="block truncate text-[14.5px] font-medium">{w.name}</b>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                <i className="size-[7px] shrink-0 rounded-full" style={{ background: `var(--p${w.by})` }} />
                {nameOf(w.by)} · {w.addedOn}
              </span>
            </button>
            {w.url && (
              <a
                href={w.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-brand"
              >
                <LinkIcon size={10} /> ссылка
              </a>
            )}
            <span className="shrink-0 text-[14px] font-semibold num">{plain(w.price)}</span>
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
            <NumField value={price} onValue={setPrice} placeholder="18 000" />
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

      <WishDialog id={editId} onClose={() => setEditId(null)} />
    </>
  )
}

/**
 * Правка покупки. Раньше строку можно было только вычеркнуть или удалить, а
 * корзина стояла вплотную к цене: промахнуться пальцем и стереть чужое желание
 * было проще, чем открыть ссылку. Теперь удаление внутри и спрашивает.
 */
function WishDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const wish = useStore((s) => s.wishlist.find((w) => w.id === id))
  const people = useStore((s) => s.people)
  const updateWish = useStore((s) => s.updateWish)
  const removeWish = useStore((s) => s.removeWish)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => { setConfirm(false) }, [id])

  if (!wish) return null

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[88dvh] max-w-[92vw] overflow-y-auto rounded-2xl border-line bg-surface sm:max-w-[400px]"
        /* Правка существующей записи не должна выбрасывать клавиатуру и выделять название. */
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader><DialogTitle className="font-display">{wish.name}</DialogTitle></DialogHeader>

        <Field label="Что покупаем">
          <Input
            defaultValue={wish.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== wish.name) updateWish(wish.id, { name: v })
            }}
          />
        </Field>
        <Field label="Цена, ₸">
          <NumFieldBlur
            initial={plain(wish.price)}
            onCommit={(text) => {
              const v = parseMoney(text)
              if (v !== wish.price) updateWish(wish.id, { price: v })
            }}
          />
        </Field>
        <Field label="Ссылка на товар">
          <Input
            defaultValue={wish.url ?? ''}
            inputMode="url"
            placeholder="можно оставить пустым"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== (wish.url ?? '')) updateWish(wish.id, { url: v || undefined })
            }}
          />
        </Field>
        <Field label="Кто добавил">
          <Segmented<PersonId>
            value={wish.by}
            onChange={(v) => updateWish(wish.id, { by: v })}
            options={people.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>

        <div className="border-t border-line pt-3">
          {confirm ? (
            <>
              <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                Покупка исчезнет из списка у обоих. Отменить нельзя.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>Отмена</Button>
                <Button
                  className="flex-1 bg-destructive text-destructive-foreground"
                  onClick={() => { removeWish(wish.id); onClose() }}
                >
                  Удалить
                </Button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-[13px] text-ink-3 hover:text-destructive">
              Удалить из списка
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
