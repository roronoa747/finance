import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { calendarEvents } from '../src/lib/calendar'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Obligation, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import Money from '../src/views/Money.vue'
import { at, backend, fakeServer, screen, type FakeServer } from './support/family'

/**
 * Блок 8 «понятность» — подписки (PN-26…PN-29; Р-7, хвост 1024) на фейковом сервере, два телефона и viewer. Октябрь 2026.
 * Семья: Ильяс — 150 000 за неделю по пятницам, Аруна — аванс 15-го и остаток 30-го (ритмы Блока 7); аренда 5-го,
 * общие подписки Netflix (10-го) и iCloud (15-го), три кредита. (а) форма подписки без разделов → d4, «Чья» Аруна →
 * «Общие · 2», «Аруна · 1» в «Капитале» и «Месяце»; (б) «Аренда и коммуналка» → d1 с оценкой, в «Подписки» не попадает;
 * (в) пакет из двух подписок Аруны — целиком в её части, с разными «чья» — в «Общих»; (г) .ics: платежи, кредиты и
 * приходы по ритму, `RRULE`, пары BEGIN/END; (д) viewer — части и «В календарь», формы нет; (е) второй телефон видит части.
 * Нажатия — обработчиками экранов (`screenMixin`), экраны — SSR; файл — через мок `shareFile`.
 */
const shareFile = vi.hoisted(() => vi.fn(async (_blob: Blob, _opts: { title: string; fileName: string }) => 'downloaded' as const))
vi.mock('../src/lib/share', () => ({ shareFile }))

type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const sub = (id: string, name: string, day: number, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
})

function subsDoc(): SyncDoc {
  const doc = planFamilyDoc()
  doc.people = [
    { ...doc.people[0], salary: 150_000, payRhythm: 'week', weekday: 5 },
    { ...doc.people[1], salary: 500_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 200_000 },
  ]
  doc.obligations = [...doc.obligations, sub('netflix', 'Netflix', 10, 4_990), sub('icloud', 'iCloud', 15, 1_490)]
  return doc
}

async function phone(server: FakeServer, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}
const on = (p: Phone) => (setActivePinia(p.pinia), p)

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
/** Подзаголовки «Подписок» по «чья»: `[who, текст]`. */
const whoParts = (html: string) => [...html.matchAll(/data-subs-who="(\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()])
const capital = (p: Phone) => screen(on(p).pinia, Money, '/money', undefined, [screenMixin({ subsOpen: true })])
const month = (p: Phone) => screen(on(p).pinia, Month, '/month', undefined, [screenMixin({ opened: 'dues', subsOpen: true })])
/** Заполнить форму «Капитала» по адресу и нажать «Добавить». */
const submit = (p: Phone, path: string, state: Record<string, unknown>) =>
  screen(on(p).pinia, Money, path, undefined, [screenMixin(state, (s) => (s.createObligation as () => void)())])

describe('e2e / понятность Блок 8 — подписки', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T05:00:00Z')
    server = fakeServer(subsDoc())
    shareFile.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('(а) + (е): подписка без разделов → d4, «Чья» Аруна; «Общие · 2», «Аруна · 1» в «Капитале» и «Месяце»; второй телефон видит то же', async () => {
    const A = await phone(server, 'a')
    // Одна «чья» — подзаголовков нет.
    expect(whoParts(await capital(A))).toEqual([])
    const form = await screen(on(A).pinia, Money, '/money?add=payment')
    expect(form).not.toContain('В какой раздел бюджета')
    expect(form).toContain('>Чья</span>')

    at('2026-10-12T05:01:00Z')
    await submit(A, '/money?add=payment', { obName: 'Spotify', obAmount: '2 990', obDay: '22', obWho: 'b' })
    const spotify = A.store.obligations.find((o) => o.name === 'Spotify')!
    expect(spotify).toMatchObject({ category: 'd4', who: 'b', estimate: false })
    const parts = [['all', 'Общие · 2'], ['b', 'Аруна · 1']]
    expect(whoParts(await capital(A))).toEqual(parts)
    const m = await month(A)
    expect(whoParts(m)).toEqual(parts)
    expect(text(m)).toContain('Подписки · 3')
    expect(m.indexOf('data-due-id="obligation:' + spotify.id + '"')).toBeGreaterThan(m.indexOf('data-subs-who="b"'))
    await A.store.syncHousehold(A.client)

    const B = await phone(server, 'b')
    expect(B.store.obligations.find((o) => o.id === spotify.id)).toMatchObject({ who: 'b', category: 'd4' })
    expect(whoParts(await capital(B))).toEqual(parts)
    expect(whoParts(await month(B))).toEqual(parts)
  })

  it('(б) «Аренда и коммуналка» → d1 с оценкой; в «Подписки» не попадает', async () => {
    const A = await phone(server, 'a')
    const list = await screen(on(A).pinia, Money, '/money', undefined, [screenMixin({ addOpen: true })])
    expect(text(list).indexOf('Аренда и коммуналка')).toBeLessThan(text(list).indexOf('Подписка или услуга'))
    await submit(A, '/money?add=housing', { obName: 'Свет', obAmount: '12 000', obDay: '20' })
    expect(A.store.obligations.find((o) => o.name === 'Свет')).toMatchObject({ category: 'd1', estimate: true, who: null })
    const html = await capital(A)
    const subs = html.slice(html.indexOf('data-subs'), html.indexOf('</div></div>', html.indexOf('data-subs')))
    expect(subs).not.toContain('Свет')
    expect(text(html)).toContain('Подписки · 2')
  })

  it('(в) пакет из двух подписок Аруны — целиком в её части; «чья» разные — пакет в «Общих», не рвётся', async () => {
    const A = await phone(server, 'a')
    at('2026-10-12T05:01:00Z')
    const fun = A.store.addGroup('Кино и музыка')
    for (const [name, day] of [['Ivi', 3], ['Яндекс Музыка', 8]] as const) {
      const id = A.store.addObligation({ name, day, category: 'd4', who: 'b', amount: 2_000 })
      A.store.moveToGroup(id, fun)
    }
    const html = await capital(A)
    expect(whoParts(html)).toEqual([['all', 'Общие · 2'], ['b', 'Аруна · 2']])
    const b = html.slice(html.indexOf('data-subs-who="b"'))
    expect(b).toContain('Группа «Кино и музыка»')
    expect(b.indexOf('Ivi')).toBeGreaterThan(-1)
    expect(b.indexOf('Яндекс Музыка')).toBeGreaterThan(-1)

    // Одну из пакета — общей: пакет целиком уходит в «Общие», части Аруны больше нет.
    A.store.updateObligation(A.store.obligations.find((o) => o.name === 'Ivi')!.id, { who: null })
    const after = await month(A)
    expect(whoParts(after)).toEqual([])
    expect(text(after)).toContain('Кино и музыка')
  })

  it('(г) «В календарь»: файл .ics — платежи, кредиты, зарплаты по ритму; RRULE; BEGIN/END сходятся; сумм зарплаты нет', async () => {
    const A = await phone(server, 'a')
    await screen(on(A).pinia, Money, '/money', undefined, [screenMixin({}, (s) => void (s.toCalendar as () => Promise<void>)())])
    expect(shareFile).toHaveBeenCalledTimes(1)
    const [blob, opts] = shareFile.mock.calls[0]
    expect(opts.fileName).toBe('family-finance.ics')
    expect(blob.type).toBe('text/calendar')
    const ics = await blob.text()
    const lines = ics.split('\r\n')
    const stack: string[] = []
    for (const l of lines) {
      if (l.startsWith('BEGIN:')) stack.push(l.slice(6))
      if (l.startsWith('END:')) expect(stack.pop()).toBe(l.slice(4))
    }
    expect(stack).toEqual([])
    const events = calendarEvents({ obligations: A.store.obligations, credits: A.store.credits, people: A.store.people })
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(events.length)
    const rule = (uid: string) => {
      const block = ics.slice(ics.indexOf(`UID:ff-${uid}@family-finance`))
      return block.slice(block.indexOf('RRULE:') + 6, block.indexOf('\r\n', block.indexOf('RRULE:')))
    }
    expect(rule('rent')).toBe('FREQ=MONTHLY;BYMONTHDAY=5')
    expect(rule('netflix')).toBe('FREQ=MONTHLY;BYMONTHDAY=10')
    expect(rule('loan')).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(rule('salary-a')).toBe('FREQ=WEEKLY;BYDAY=FR')
    expect(rule('advance-b')).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(rule('salary-b')).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1')
    expect(ics).toContain('SUMMARY:Зарплата · Ильяс\r\n')
    expect(ics).toContain('SUMMARY:Аванс · Аруна\r\n')
    expect(ics).not.toMatch(/(150|200|300|500) 000/)
    expect(ics).toContain('SUMMARY:Аренда · 220 000 ₸\r\n')
  })

  it('(д) viewer: части «Подписок» и «В календарь» видны, формы нет и по адресу', async () => {
    const A = await phone(server, 'a')
    at('2026-10-12T05:01:00Z')
    A.store.updateObligation('icloud', { who: 'b' })
    await A.store.syncHousehold(A.client)

    const V = await phone(server, 'b', 'viewer')
    const html = await capital(V)
    expect(whoParts(html)).toEqual([['all', 'Общие · 1'], ['b', 'Аруна · 1']])
    expect(whoParts(await month(V))).toEqual([['all', 'Общие · 1'], ['b', 'Аруна · 1']])
    expect(html).toContain('data-calendar')
    expect(html).not.toMatch(/>\s*<!---->\s*Добавить\s*</)
    for (const path of ['/money?add=payment', '/money?add=housing']) {
      const form = await screen(on(V).pinia, Money, path)
      expect(form, path).not.toContain('Регулярный платёж')
      expect(form, path).not.toContain('Например, аренда или свет')
    }
    await screen(on(V).pinia, Money, '/money', undefined, [screenMixin({}, (s) => void (s.toCalendar as () => Promise<void>)())])
    expect(shareFile).toHaveBeenCalledTimes(1)
  })

  it('(ж) приёмка: подписка и «Свет» из форм — в файле календаря своими правилами; второй телефон и viewer выгружают те же события', async () => {
    const A = await phone(server, 'a')
    at('2026-10-12T05:01:00Z')
    // День платежа формы — до 28-го (как до блока); 29–31 в файле бывают у зарплат — проверено в (г).
    await submit(A, '/money?add=payment', { obName: 'Spotify', obAmount: '2 990', obDay: '22', obWho: 'b' })
    await submit(A, '/money?add=housing', { obName: 'Свет', obAmount: '12 000', obDay: '31' })
    await A.store.syncHousehold(A.client)

    const icsOf = async (p: Phone) => {
      shareFile.mockClear()
      await screen(on(p).pinia, Money, '/money', undefined, [screenMixin({}, (s) => void (s.toCalendar as () => Promise<void>)())])
      return (await shareFile.mock.calls[0][0].text()).replace(/DTSTAMP:\S+/g, '')
    }
    const mine = await icsOf(A)
    expect(mine).toMatch(/DTSTART;VALUE=DATE:20261022\r\n.*\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=22\r\nSUMMARY:Spotify · 2 990 ₸\r\n/)
    expect(mine).toMatch(/RRULE:FREQ=MONTHLY;BYMONTHDAY=28\r\nSUMMARY:Свет · ≈ 12 000 ₸\r\n/)
    expect(mine.match(/TRIGGER:PT9H/g)).toHaveLength(mine.match(/BEGIN:VEVENT/g)!.length)

    expect(await icsOf(await phone(server, 'b'))).toBe(mine)
    expect(await icsOf(await phone(server, 'b', 'viewer'))).toBe(mine)
  })
})
