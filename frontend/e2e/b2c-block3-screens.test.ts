import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { apiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import Money from '../src/views/Money.vue'
import Statements from '../src/views/Statements.vue'
import { money } from '../src/lib/money'
import { budgetAmounts, duesTotal, monthDues } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import type { SyncDoc } from '../src/types/finance'
import type { SpendTotal } from '../src/lib/statements/types'
import type { OperationWire } from '../src/types/api'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Wishes from '../src/views/Wishes.vue'
import { templateById } from '../src/lib/goalTemplates'
import { attachTemplate } from '../src/lib/photos/goalPhoto'
import { photoUrl, releasePhotos, uploadPhoto } from '../src/lib/photos/store'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 B2C — экраны и лёгкий флоу. Часть 1 (B2C-14): главный «Мечты» у семьи с
 * планом и итогами выписок — процент героя, «Свободно» по факту (посчитано руками), карточка
 * решения ведёт на «Неделю». Части 2–5 — B2C-15, B2C-18, B2C-19, B2C-21.
 */
type Phone = { pinia: Pinia; client: ApiClient; user: string; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member', pv?: FakePrivate): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${slot}`, user: { id: user, email: `${slot}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot), ...(pv ? privateFor(pv, user) : {}) } as unknown as ApiClient
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, user, store: finance }
}

const total = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: T0,
})

describe('e2e / B2C Блок 3 — часть 1: главный «Мечты» (B2C-14)', () => {
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
    at('2026-09-17T07:00:00Z') // четверг, ISO-неделя 2026-W38 (14–20 сентября)
    // Семья с планом месяца: Ильяс a / Дана b; главная мечта — «Машина» (200 000 из 3 000 000).
    const doc: SyncDoc = planFamilyDoc({
      goals: planFamilyDoc().goals.map((g) => (g.id === 'car' ? { ...g, main: true } : g)),
      spendTotals: [
        total('a', 'week', '2026-W38', 'sc_food', 62_000),
        total('b', 'week', '2026-W38', 'sc_food', 20_000),
        total('a', 'week', '2026-W38', 'sc_cafe', 28_000),
        total('a', 'week', '2026-W38', '_unknown', 10_000),
        total('a', 'month', '2026-09', 'sc_food', 184_000),
        total('b', 'month', '2026-09', 'sc_food', 40_000),
        total('a', 'month', '2026-09', 'sc_credit', 58_000),
        total('a', 'month', '2026-09', '_unknown', 40_000),
      ],
    })
    doc.people[1].name = 'Дана'
    server = fakeServer(doc)
    st = fakeStatements()
    // Загрузки обоих покрывают неделю и месяц; у Ильяса — незнакомый продавец этой недели.
    for (const [slot, user, id] of [['a', 'u-a', '1'], ['b', 'u-b', '2']] as const) {
      st.uploads.push({ id: `00000000-0000-4000-8000-00000000000${id}`, slot, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-17', ops_count: 10, created_at: T0, user })
    }
    const op: OperationWire = { id: 'op-1', bank: 'kaspi', date: '2026-09-16', amount: -10_000, kind: 'purchase', merchant: 'IP SERIKOV', category_id: null, internal: false, updated_at: T0 }
    st.ops.set('u-a', new Map([[op.id, op]]))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('герой 7 % и «будет вашей в июле 2030»; картина недели по обоим; «Свободно» сходится с ручным расчётом; решение — незнакомый продавец → /week', async () => {
    const A = await phone(server, st, 'a')
    const html = await screen(A.pinia, Dreams, '/')

    // Герой: 200 000 / 3 000 000 = 7 %; по 60 000 в месяц — 47 взносов с сентября 2026 → июль 2030.
    expect(html).toContain('До мечты')
    expect(html).toContain('7 %')
    expect(html).toContain(`Машина · 200 000 из ${money(3_000_000)} · будет вашей в июле 2030`)

    // Неделя: 62 000 + 20 000 продукты, 28 000 кафе, 10 000 не разобрано = 120 000, обе выписки.
    expect(html).toContain('Эта неделя · 14–20 сентября')
    expect(html).toContain(money(120_000))
    expect(html).toContain('по выпискам обоих')
    expect(html).toContain(money(82_000))
    expect(html).toContain(`не разобрано ${money(10_000)}`)

    // «Свободно до конца месяца» руками: доход 1 200 000 − платежи сентября (аренда 220 000 +
    // кредит 58 000 + кредитка 25 000 + рассрочка 20 000 = 323 000) − взносы в цели 130 000 −
    // траты по выпискам (продукты 224 000 + не разобрано 40 000; кредит 58 000 уже в плане) = 483 000.
    setActivePinia(A.pinia)
    const s = useFinanceStore()
    const state = { ...s.householdDoc, credits: s.credits }
    expect(duesTotal(monthDues(state, '2026-09'))).toBe(323_000)
    expect(budgetAmounts(state).d3).toBe(130_000)
    expect(html).toContain(money(483_000))
    expect(html).toContain('по факту выписок обоих · 3 дня до зарплаты · Дана')

    // Ближайшее решение — незнакомый продавец недели (10 000 ₸), ведёт на «Неделю».
    expect(html).toContain('Не разобрано: 1 продавец')
    expect(html).toContain(`${money(10_000)} за неделю`)
    expect(html).toContain('>Разобрать<')
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('onPrimary' in this.$.setupState) vm = this.$.setupState } }
    await screen(A.pinia, Dreams, '/', undefined, [grab])
    expect(vm.shown?.kind).toBe('unknown')
    expect(vm.shown?.to).toBe('/week')

    // У Даны незнакомых нет (операции личные) — её решение: зарплата 20-го через 3 дня → «пришла?».
    const B = await phone(server, st, 'b')
    const htmlB = await screen(B.pinia, Dreams, '/')
    expect(htmlB).toContain(money(483_000))
    expect(htmlB).not.toContain('Не разобрано:')
    expect(htmlB).toContain('Пришла зарплата Дана?')

    // viewer видит герой и цифры, но без решений и «Новой мечты».
    const V = await phone(server, st, 'b', 'viewer')
    const htmlV = await screen(V.pinia, Dreams, '/')
    expect(htmlV).toContain('7 %')
    expect(htmlV).toContain(money(483_000))
    expect(htmlV).not.toContain('Пришла зарплата')
    expect(htmlV).not.toContain('Новая мечта')
  })
})

describe('e2e / B2C Блок 3 — часть 2: сопоставление выписки с отметками (B2C-15, Р-6)', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false,
  })
  const statement = (from: string, to: string, ...list: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from, to, operations: assignIds(list), skipped: 0 })

  async function upload(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(p.client)
    await useFinanceStore().syncHousehold(p.client)
    return ops
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-09-20T07:00:00Z')
    // Кредит семьи — «Автокредит» 58 000 15-го под 33 %, остаток 1 000 000.
    const doc = planFamilyDoc()
    doc.credits = doc.credits.map((c) => (c.id === 'loan' ? { ...c, name: 'Автокредит' } : c))
    server = fakeServer(doc)
    st = fakeStatements()
    vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h-family', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('A: «похоже, платёж по Автокредиту — отметить?» → «да» → у B отметка «из выписки», остаток минус тело; следующий месяц — само; «снять» у B — у A не предлагается снова, трата в картине', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')

    // Сентябрь: выписка Ильяса с платежом по кредиту.
    const opsA = await upload(A, statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'Оплата Kaspi Кредита')))
    const week = await screen(A.pinia, Statements, '/week')
    expect(week).toContain('Похоже, это платёж по Автокредит — отметить?')
    expect(opsA.pendingMatches).toHaveLength(1)
    // На главном — та же карточка первой (незнакомых нет: продавец узнан словарём).
    expect(await screen(A.pinia, Dreams, '/')).toContain('Похоже, это платёж по Автокредит — отметить?')

    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    const paidB = B.store.payments.find((p) => p.kind === 'credit' && !p.deletedAt)!
    expect(paidB).toMatchObject({ targetId: 'loan', period: '2026-09', amount: 58_000, source: 'statement', accountId: null })
    // creditSplit(1 000 000, 33 %, 58 000): банку 27 500, в долг 30 500.
    expect(B.store.credits.find((c) => c.id === 'loan')!.principal).toBe(969_500)
    const moneyB = await screen(B.pinia, Money, '/money')
    expect(moneyB).toContain('оплачено')
    expect(moneyB).toContain('из выписки')
    // Правило — в личном документе A, партнёру не уезжает.
    expect(A.store.merchantRules).toHaveLength(1)
    expect(B.store.merchantRules).toHaveLength(0)

    // Октябрь: тот же продавец — отметилось само.
    at('2026-10-16T07:00:00Z')
    await upload(A, statement('2026-10-01', '2026-10-16', op('2026-10-15', -58_000, 'Оплата Kaspi Кредита')))
    expect(opsA.lastAutoMarked).toBe(1)
    await B.store.pullHousehold(B.client)
    const october = B.store.payments.find((p) => p.period === '2026-10' && !p.deletedAt)!
    expect(october).toMatchObject({ kind: 'credit', targetId: 'loan', source: 'statement' })

    // B снимает отметку → у A после синка платёж не отмечен, снова не предлагается, трата в картине недели.
    setActivePinia(B.pinia)
    B.store.unmarkPaid('credit', 'loan', '2026-10')
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    expect(A.store.payments.find((p) => p.period === '2026-10' && !p.deletedAt)).toBeUndefined()
    setActivePinia(A.pinia)
    expect(opsA.pendingMatches).toEqual([])
    const totals = A.store.householdDoc.spendTotals!.filter((t) => t.by === 'a' && t.period === '2026-10' && t.kind === 'month')
    expect(totals.map((t) => [t.categoryId, t.amount])).toEqual([['sc_credit', 58_000]])
  })
})

describe('e2e / B2C Блок 3 — часть 3: мечта из шаблона с фото у партнёра, сюрприз — только у автора (B2C-18)', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate
  const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:${(b as Blob).size}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    pv = fakePrivate()
    // Личный документ уходит глобальным клиентом (`mutatePrivateDoc`) — здесь сети нет: правка
    // остаётся неотправленной до явного `syncPrivate` клиентом телефона.
    vi.spyOn(apiClient, 'pushPrivateDoc').mockRejectedValue(new TypeError('fetch failed'))
  })

  afterEach(() => {
    releasePhotos()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('A заводит «Японию» из шаблона → у B цель с фото и автором; сюрприз A для Аруны — в документе B нет, фото для B — 404, автору отдаётся', async () => {
    const A = await phone(server, st, 'a', 'member', pv)
    const B = await phone(server, st, 'b', 'member', pv)

    // Мечта из шаблона: картинка «скачана», сжата и загружена клиентом A.
    setActivePinia(A.pinia)
    const japan = templateById('japan')!
    const id = A.store.addGoal({ name: japan.name, need: 1_800_000, monthly: 150_000, hue: japan.hue, template: japan.id })
    const fetched: string[] = []
    const result = await attachTemplate(A.store, id, japan, {
      fetch: async (url) => {
        fetched.push(url)
        return { ok: true, blob: async () => new Blob([bytes(300_000, 1)], { type: 'image/jpeg' }) }
      },
      compress: async () => ({ blob: new Blob([bytes(90_000, 2)], { type: 'image/webp' }) }),
      upload: (blob) => uploadPhoto(blob, {}, A.client),
      online: () => true,
    })
    expect(result).toBe('uploaded')
    expect(fetched[0]).toContain('images.unsplash.com/')
    const goalA = A.store.goals.find((g) => g.id === id)!
    expect(goalA.photoId).toMatch(/^00000000-0000-4000-8000-/)
    expect(goalA.photoCredit).toEqual({ author: 'Matthew Skinner', url: 'https://unsplash.com/photos/t05kfHeygbE' })
    expect(pv.photos.get(goalA.photoId!)).toMatchObject({ user: 'u-a', hidden: false, type: 'image/webp' })
    await A.store.syncHousehold(A.client)

    // B: та же цель; фото семьи открывается его клиентом; на экране цели — автор и взнос.
    await B.store.pullHousehold(B.client)
    const goalB = B.store.goals.find((g) => g.id === id)!
    expect(goalB).toMatchObject({ name: 'Япония', template: 'japan', photoId: goalA.photoId, photoCredit: goalA.photoCredit })
    expect(await photoUrl(goalB.photoId!, B.client)).toBe('blob:90000')
    const screenB = await screen(B.pinia, GoalDetail, `/goals/${id}`)
    expect(screenB).toContain('Япония')
    expect(screenB).toContain('Matthew Skinner')
    expect(screenB).toContain(`по ${money(150_000)} в месяц · осталось 12 взносов`)
    expect(screenB).toContain('Сделать главной')

    // Сюрприз A для Аруны: фото скрытое, запись — в личном документе A.
    setActivePinia(A.pinia)
    const giftPhoto = await uploadPhoto(new Blob([bytes(50_000, 3)], { type: 'image/webp' }), { hidden: true }, A.client)
    A.store.addGift({ forSlot: 'b', name: 'Наушники', price: 90_000, photoId: giftPhoto })
    await A.store.syncPrivate(A.client)
    expect(pv.docs.get('u-a')!.data.gifts).toHaveLength(1)
    const wishesA = await screen(A.pinia, Wishes, '/people/b')
    expect(wishesA).toContain('Сюрпризы для Аруна')
    expect(wishesA).toContain('Наушники')
    // Автору его скрытое фото отдаётся. Кэш картинок — на телефоне: у B он свой.
    expect(await photoUrl(giftPhoto, A.client)).toBe('blob:50000')
    releasePhotos()

    // B: свой личный документ без записи; скрытое фото партнёра — 404 → null.
    await B.store.pullPrivateDoc(B.client)
    expect(B.store.gifts).toEqual([])
    expect(pv.docs.get('u-b')).toBeUndefined()
    expect(await photoUrl(giftPhoto, B.client)).toBeNull()
    expect(await screen(B.pinia, Wishes, '/people/b')).not.toContain('Наушники')
    expect(await screen(B.pinia, Wishes, '/people/a')).not.toContain('Наушники')
  })
})
