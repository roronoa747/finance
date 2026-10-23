import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { untilPayday } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Payment, Person, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import Money from '../src/views/Money.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 7 «понятность» — ритм зарплаты (PN-22…PN-25; Р-5, Р-6) на фейковом сервере, два телефона и выписка. Октябрь 2026:
 * пятницы 2, 9, 16, 23, 30. (а) неделя 150 000 по пятницам: план 750 000, строка «0 из 5» → «Пришла» — отметка
 * 2026-10-02, «✓ 1 из 5», доход = 150 000 факт + 600 000 ожидание; (б) аванс: два прихода, «до зарплаты» — ближайший;
 * (в) плавающая: «Пришла» без суммы нет, после 300/320/340 ждём 320 000; (г) выписка с четырьмя пятничными приходами —
 * четыре вопроса «за неделю», «да» — четыре отметки; (д) старый документ без ритма — прежние числа; (е) второй телефон
 * видит приходы и отметки. Нажатия — обработчиками экранов (`screenMixin`), экраны — SSR.
 */
const KEY = '2026-10'
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const salaryRec = (targetId: 'a' | 'b', period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `sal-${targetId}-${period}`, kind: 'salary', targetId, period, amount, accountId: 'card', by: targetId,
  at: `${period.length > 7 ? period : `${period}-10`}T05:00:00.000Z`, updatedAt: T0, ...extra,
})

/** Семья: Ильяс — 150 000 за неделю по пятницам (25 сентября пришла на карту); Аруна — аванс 15-го 200 000, остаток 30-го. */
function rhythmDoc(a: Partial<Person> = {}, payments: Payment[] = [salaryRec('a', '2026-09-25', 150_000)]): SyncDoc {
  const doc = planFamilyDoc({ payments })
  doc.people = [
    { ...doc.people[0], salary: 150_000, payRhythm: 'week', weekday: 5, ...a },
    { ...doc.people[1], salary: 500_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 200_000 },
  ]
  return doc
}

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}
const on = (p: Phone) => (setActivePinia(p.pinia), p)

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
/** Разметка строки зарплаты участника — от её `data-salary` до следующей строки или конца карточки. */
const rowOf = (html: string, slot: 'a' | 'b') => {
  const start = html.indexOf(`data-salary="${slot}"`)
  expect(start, `строка зарплаты ${slot}`).toBeGreaterThan(-1)
  const ends = ['data-salary="', 'data-extra-income', 'data-sections', '</main', 'data-capital-accounts', 'Счета']
    .map((m) => html.indexOf(m, start + 1))
    .filter((i) => i > start)
  return html.slice(start, ends.length ? Math.min(...ends) : undefined)
}
const tap = () => [screenMixin({}, (s) => (s.tap as () => void)())]
const incomeOf = (p: Phone, person: 'a' | 'b') => on(p).store.monthPlanOf(KEY).income.byPerson.find((x) => x.person === person)!
const salaries = (p: Phone, person: 'a' | 'b' = 'a') => p.store.payments.filter((x) => !x.deletedAt && x.kind === 'salary' && x.targetId === person && x.period.startsWith(KEY))
/** Лист зарплаты участника: «N из M пришли» и приходы живут там (FB-19 — в строке «Месяца» их больше нет). */
const status = async (p: Phone, slot: 'a' | 'b') => {
  const html = await screen(on(p).pinia, Month, '/month', undefined, [screenMixin({ salaryFor: slot })])
  const i = html.indexOf('data-salary-status')
  expect(i, `лист зарплаты ${slot}`).toBeGreaterThan(-1)
  return text(html.slice(i, html.indexOf('</div>', i)))
}

describe('e2e / понятность Блок 7 — ритм зарплаты', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-02T07:00:00Z')
    server = fakeServer(rhythmDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('(а) + (е): неделя — план 750 000, «0 из 5»; «Пришла» — 2026-10-02 на карту, «✓ 1 из 5», 150 000 факт + 600 000 ожидание; партнёр после синка видит то же', async () => {
    const A = await phone(server, st, 'a')
    expect(incomeOf(A, 'a')).toMatchObject({ amount: 750_000, eventCount: 5, cameCount: 0, came: false })
    // FB-19: «N из M пришли» — в листе зарплаты, в строке — «Пришла» и подсветка только когда пришли все.
    for (const [view, path] of [[Month, '/month'], [Money, '/money']] as const) {
      const row = rowOf(await screen(on(A).pinia, view, path), 'a')
      if (view === Month) expect(text(row), path).not.toContain('пришли') // «Деньги» — до FB-20 ещё со старой карточкой зарплат
      expect(row, path).toContain('data-salary-came-btn')
      if (view === Month) expect(row, path).not.toContain('data-came')
    }
    expect(await status(A, 'a')).toContain('0 из 5 пришли')

    at('2026-10-02T07:01:00Z')
    await screen(on(A).pinia, Month, '/month', undefined, tap())
    expect(salaries(A).map((p) => [p.period, p.amount, p.accountId])).toEqual([['2026-10-02', 150_000, 'card']])
    const inc = incomeOf(A, 'a')
    expect(inc).toMatchObject({ amount: 750_000, cameCount: 1, came: false })
    expect(inc.events.map((e) => [e.period, e.came])).toEqual([
      ['2026-10-02', true], ['2026-10-09', false], ['2026-10-16', false], ['2026-10-23', false], ['2026-10-30', false],
    ])
    expect(rowOf(await screen(A.pinia, Month, '/month'), 'a')).not.toContain('data-came')
    expect(await status(A, 'a')).toContain('1 из 5 пришли')
    // Второе нажатие в тот же день — следующая пятница ещё не близко (7 дней): кнопки нет, записей не прибавилось.
    expect(rowOf(await screen(A.pinia, Month, '/month'), 'a')).not.toContain('data-salary-came-btn')

    // (е) второй телефон: приходы и отметка — после синка.
    await on(A).store.syncHousehold(A.client)
    const B = await phone(server, st, 'b')
    expect(salaries(B).map((p) => p.period)).toEqual(['2026-10-02'])
    expect(incomeOf(B, 'a')).toMatchObject({ amount: 750_000, cameCount: 1, eventCount: 5 })
    const rowB = rowOf(await screen(on(B).pinia, Month, '/month'), 'a')
    expect(rowB).not.toContain('data-salary-came-btn')
    expect(await status(B, 'a')).toContain('1 из 5 пришли')
  })

  it('(б): аванс — два прихода; 12 октября «до зарплаты» — аванс Аруны 15-го (3 дня), а не пятница Ильяса 16-го; после аванса — пятница', async () => {
    // Сентябрьский остаток Аруны пришёл на карту — счёт для одного нажатия «Пришла».
    server = fakeServer(rhythmDoc({}, [salaryRec('a', '2026-09-25', 150_000), salaryRec('b', '2026-09-30', 300_000)]))
    at('2026-10-12T07:00:00Z')
    const B = await phone(server, st, 'b')
    expect(incomeOf(B, 'b')).toMatchObject({ amount: 500_000, eventCount: 2 })
    expect(incomeOf(B, 'b').events.map((e) => [e.day, e.amount, e.kind])).toEqual([
      ['2026-10-15', 200_000, 'advance'],
      ['2026-10-30', 300_000, 'salary'],
    ])
    const near = untilPayday({ people: B.store.people, payments: B.store.payments }, { key: KEY, day: 12 })!
    expect(near).toMatchObject({ who: { id: 'b' }, period: '2026-10-15', inDays: 3, income: 200_000, kind: 'advance' })
    expect(await status(B, 'b')).toContain('0 из 2 пришли')

    at('2026-10-15T07:00:00Z')
    await screen(on(B).pinia, Month, '/month', undefined, tap())
    expect(salaries(B, 'b').map((p) => [p.period, p.amount])).toEqual([['2026-10-15', 200_000]])
    const after = untilPayday({ people: B.store.people, payments: B.store.payments }, { key: KEY, day: 15 })!
    expect(after).toMatchObject({ who: { id: 'a' }, period: '2026-10-16', inDays: 1 })
  })

  it('(в): плавающая — «Пришла» открывает лист с пустой суммой, отметки без суммы нет; после 300 / 320 / 340 тысяч ждём 320 000', async () => {
    server = fakeServer(rhythmDoc({ salary: 700_000, payday: 10, payRhythm: undefined, weekday: undefined, floating: true }, [salaryRec('a', '2026-06', 700_000)]))
    at('2026-10-12T07:00:00Z')
    const A = await phone(server, st, 'a')
    const sheet = await screen(on(A).pinia, Month, '/month', undefined, tap())
    expect(text(sheet)).toContain('Отметить зарплату')
    // Поле суммы листа — пустое (SSR пишет пустое значение атрибутом без значения).
    const field = sheet.slice(sheet.indexOf('role="dialog"')).match(/<input[^>]*inputmode="[^"]*"[^>]*>/)?.[0] ?? ''
    expect(field).toMatch(/\svalue[\s>]/)
    expect(field).not.toMatch(/value="\S/)
    expect(salaries(A)).toEqual([])

    for (const [p, amount] of [['2026-07', 300_000], ['2026-08', 320_000], ['2026-09', 340_000]] as const) {
      A.store.markSalary('a', { period: p, amount, accountId: 'card', at: `${p}-10T05:00:00.000Z` })
    }
    expect(incomeOf(A, 'a')).toMatchObject({ amount: 320_000, came: false })
    expect(text(rowOf(await screen(A.pinia, Month, '/month'), 'a'))).toMatch(/≈\s320\s000/)
  })

  it('(г): выписка с четырьмя пятничными приходами — четыре вопроса «за неделю», «да» на первый — четыре отметки по своим пятницам', async () => {
    server = fakeServer(rhythmDoc({}, []))
    at('2026-10-24T07:00:00Z')
    const A = await phone(server, st, 'a')
    const op = (date: string, amount: number): Omit<Operation, 'id'> => ({ bank: 'kaspi', date, amount, kind: 'transfer-in', merchant: 'ТОО Смена', categoryId: null, internal: false })
    const parsed: ParsedStatement = {
      bank: 'kaspi', from: '2026-10-01', to: '2026-10-24', skipped: 0,
      operations: assignIds([op('2026-10-02', 150_000), op('2026-10-09', 151_000), op('2026-10-16', 150_000), op('2026-10-23', 149_000)]),
    }
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(A.client)
    expect(ops.pendingMatches.map((c) => [c.period, c.question])).toEqual([
      ['2026-10-02', 'Это зарплата a за неделю?'],
      ['2026-10-09', 'Это зарплата a за неделю?'],
      ['2026-10-16', 'Это зарплата a за неделю?'],
      ['2026-10-23', 'Это зарплата a за неделю?'],
    ].map(([p, q]) => [p, q.replace(' a ', ` ${A.store.people[0].name} `)]))
    await ops.acceptMatch(ops.pendingMatches[0], A.client)
    expect(salaries(A).map((p) => [p.period, p.amount, p.source]).sort()).toEqual([
      ['2026-10-02', 150_000, 'statement'],
      ['2026-10-09', 151_000, 'statement'],
      ['2026-10-16', 150_000, 'statement'],
      ['2026-10-23', 149_000, 'statement'],
    ])
    expect(ops.pendingMatches).toEqual([])
    expect(incomeOf(A, 'a')).toMatchObject({ cameCount: 4, eventCount: 5, amount: 750_000 })
  })

  it('(д): старый документ без ритма — прежние числа: доход 1 200 000, «до зарплаты» — Аруна 20-го, «Пришла» — за месяц', async () => {
    server = fakeServer(planFamilyDoc({ payments: [salaryRec('a', '2026-09', 700_000)] }))
    at('2026-10-12T07:00:00Z')
    const A = await phone(server, st, 'a')
    const plan = A.store.monthPlanOf(KEY)
    expect(plan.income.total).toBe(1_200_000)
    expect(plan.income.byPerson.map((x) => [x.person, x.amount, x.eventCount])).toEqual([['a', 700_000, 1], ['b', 500_000, 1]])
    const row = rowOf(await screen(A.pinia, Month, '/month'), 'a')
    expect(row).not.toContain('data-came-count')
    expect(untilPayday({ people: A.store.people, payments: A.store.payments }, { key: KEY, day: 12 })).toMatchObject({ who: { id: 'b' }, key: KEY, period: KEY, inDays: 8, income: 500_000 })
    await screen(on(A).pinia, Month, '/month', undefined, tap())
    expect(salaries(A).map((p) => [p.period, p.amount, p.accountId])).toEqual([[KEY, 700_000, 'card']])
    expect(rowOf(await screen(A.pinia, Month, '/month'), 'a')).toContain('data-came')
  })

  /**
   * Приёмка Б7 (стенд, 2026-10-12): неделя не по пятницам и плавающая сумма у недели; первый аванс партнёра — листом со
   * счётом. Лист отметки в SSR открыт сразу: поле суммы вписывает смесь, «Отметить …» — `confirmMark` того листа, что
   * открыт на зарплату (листы платежей пропускаются обращением к несуществующему полю).
   */
  const confirmSalarySheet = (amount: string) =>
    screenMixin({}, (s) => {
      void (s.salary && s.mode === 'mark' ? s.confirmMark : s.notThisSheet)
      s.amountText = amount
      s.chosen = 'card'
      ;(s.confirmMark as () => void)()
    })

  it('(ж) приёмка: среда, сумма меняется — «≈ 480 000», «Пришла» листом 130 000 → ждём 123 333 за последнюю среду; аванс Аруны первым разом — лист «Отметить аванс» со счётом', async () => {
    const before = ['2026-09-30', '2026-10-07', '2026-10-14'].map((d) => salaryRec('a', d, 120_000))
    server = fakeServer(rhythmDoc({ salary: 120_000, weekday: 3, floating: true }, before))
    at('2026-10-21T07:00:00Z')
    const A = await phone(server, st, 'a')
    expect(incomeOf(A, 'a')).toMatchObject({ amount: 480_000, cameCount: 2, eventCount: 4, came: false })
    expect(incomeOf(A, 'a').events.map((e) => e.day)).toEqual(['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])
    const row = text(rowOf(await screen(on(A).pinia, Month, '/month'), 'a'))
    expect(row).toMatch(/≈\s480\s000/)
    expect(await status(A, 'a')).toContain('2 из 4 пришли')

    // «Пришла» у плавающей — только лист: одной отметки без суммы нет.
    expect(text(await screen(A.pinia, Month, '/month', undefined, tap()))).toContain('Отметить зарплату')
    expect(salaries(A).map((p) => p.period)).toEqual(['2026-10-07', '2026-10-14'])
    await screen(A.pinia, Month, '/month', undefined, [...tap(), confirmSalarySheet('130 000')])
    expect(salaries(A).map((p) => [p.period, p.amount, p.accountId])).toEqual([
      ['2026-10-07', 120_000, 'card'], ['2026-10-14', 120_000, 'card'], ['2026-10-21', 130_000, 'card'],
    ])
    // Последняя среда — среднее трёх последних недель (120 / 120 / 130 тысяч), целое.
    expect(incomeOf(A, 'a')).toMatchObject({ amount: 120_000 + 120_000 + 130_000 + 123_333, cameCount: 3, came: false })
    const after = text(rowOf(await screen(A.pinia, Month, '/month'), 'a'))
    expect(after).toMatch(/≈\s493\s333/)
    expect(await status(A, 'a')).toContain('3 из 4 пришли')

    // Аруна: аванс 15-го прошёл и не отмечен — «Пришла» в её строке; прошлого счёта нет — лист со счётом.
    await on(A).store.syncHousehold(A.client)
    const B = await phone(server, st, 'b')
    const rowB = rowOf(await screen(on(B).pinia, Month, '/month'), 'b')
    expect(rowB).toContain('data-salary-came-btn')
    const sheet = text(await screen(B.pinia, Month, '/month', undefined, tap()))
    expect(sheet).toMatch(/Аванс\s—\s200\s000\s₸/)
    expect(sheet).toContain('Отметить аванс')
    expect(salaries(B, 'b')).toEqual([])
    await screen(B.pinia, Month, '/month', undefined, [...tap(), confirmSalarySheet('200 000')])
    expect(salaries(B, 'b').map((p) => [p.period, p.amount, p.accountId])).toEqual([['2026-10-15', 200_000, 'card']])
    expect(await status(B, 'b')).toContain('1 из 2 пришли')
    // «До зарплаты» — последняя среда Ильяса (7 дней), раньше остатка Аруны 30-го; ждём среднее.
    expect(untilPayday({ people: B.store.people, payments: B.store.payments }, { key: KEY, day: 21 })).toMatchObject({
      who: { id: 'a' }, period: '2026-10-28', inDays: 7, income: 123_333, kind: 'week',
    })
  })
})
