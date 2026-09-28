import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { apiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import History from '../src/views/History.vue'
import Statements from '../src/views/Statements.vue'
import { money, plain } from '../src/lib/money'
import { budgetAmounts, creditBalance, duesTotal, freeByFact, monthDues } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import type { SyncDoc } from '../src/types/finance'
import type { SpendTotal } from '../src/lib/statements/types'
import type { OperationWire } from '../src/types/api'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Wishes from '../src/views/Wishes.vue'
import { templateById } from '../src/lib/goalTemplates'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import { landingPath } from '../src/router/landing'
import Start from '../src/views/Start.vue'
import WeekSalary from '../src/views/WeekSalary.vue'
import { attachTemplate } from '../src/lib/photos/goalPhoto'
import { photoUrl, releasePhotos, uploadPhoto } from '../src/lib/photos/store'
import { screenMixin } from '../src/test/screenState'
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
    // Отметки платежей месяца — «Впереди» на /money/history (B2C-21).
    const moneyB = await screen(B.pinia, History, '/money/history')
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

    // B снимает отметку → у A после синка платёж не отмечен, снова не предлагается. «Оплата Kaspi Кредита»
    // и без правила — кредит по словарю: раздел тот же (продавец не из словаря — следующий сценарий).
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

  it('возврат приёмки п. 5: аренда переводом ИП (не из словаря) — «да» у A → трата в плановом разделе; «снять» у B → у A после синка итогов снова трата, «Свободно» у B меньше на её сумму', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const opsA = await upload(A, statement('2026-09-01', '2026-09-20', op('2026-09-05', -220_000, 'ИП Жолдасбеков')))
    expect(opsA.all.map((o) => o.categoryId)).toEqual([null])
    expect(opsA.pendingMatches.map((c) => [c.kind, c.targetId, c.period])).toEqual([['obligation', 'rent', '2026-09']])
    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await A.store.syncHousehold(A.client)

    const monthA = (p: Phone) => Object.fromEntries(p.store.householdDoc.spendTotals!.filter((t) => t.id.startsWith('a:month:2026-09:')).map((t) => [t.categoryId, t.amount]))
    const freeB = async () => {
      setActivePinia(B.pinia)
      await B.store.pullHousehold(B.client)
      const ops = useOperationsStore()
      await ops.loadUploads(B.client)
      const doc = B.store.householdDoc
      return freeByFact({ ...doc, credits: B.store.credits }, doc.spendTotals ?? [], doc.spendCategories ?? [], '2026-09', ops.uploads).amount
    }
    const before = await freeB()
    expect(monthA(B)).toEqual({ sc_rent: 220_000, _unknown: 0 })

    // B снимает отметку аренды: платёж снова в плане месяца.
    B.store.unmarkPaid('obligation', 'rent', '2026-09')
    await B.store.syncHousehold(B.client)
    // У A после синка операция снова трата — итоги переписаны и уехали партнёру.
    await A.store.pullHousehold(A.client)
    setActivePinia(A.pinia)
    await nextTick()
    expect(opsA.all.map((o) => o.categoryId)).toEqual([null])
    expect(opsA.pendingMatches).toEqual([])
    await A.store.syncHousehold(A.client)
    const after = await freeB()
    expect(monthA(B)).toEqual({ sc_rent: 0, _unknown: 220_000 })
    expect(after).toBe(before - 220_000)
    expect(await screen(B.pinia, Dreams, '/')).toContain(money(after))
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
    // Имя цели — в шапке оболочки (screen() её не рисует); в герое — «накоплено из нужно» (правило 12, критик Б3).
    expect(screenB).toContain(`${plain(goalB.have)} из ${money(goalB.need)}`)
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

describe('e2e / B2C Блок 3 — часть 4: первый запуск из выписки (B2C-19, Р-7)', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  const fixtures = import.meta.glob<PdfRow[]>('../src/lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
  const kaspi = (name: string) => parseStatement(fixtures[`../src/lib/statements/fixtures/${name}.rows.json`])

  async function upload(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(p.client)
    await useFinanceStore().syncHousehold(p.client)
    return ops
  }
  const act = (name: string, state: Record<string, unknown> = {}) => screenMixin(state, (s) => (s[name] as () => void)())

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    // Выписка за 26.06–26.07.2025 загружена 27 июля: платежи июля — этого месяца, отмечаются сразу.
    at('2025-07-27T07:00:00Z')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' })))
    server = fakeServer(defaultSyncDoc())
    st = fakeStatements()
    vi.spyOn(apiClient, 'pushPrivateDoc').mockRejectedValue(new TypeError('fetch failed'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('новая семья: выписка Kaspi → 7 вопросов → документ (оклад, кредит с остатком и отметкой июля, «Kaspi Red» обязательством, подписка), картина июля, мечта main, setupDoneAt; партнёр по коду — свои шаги → people[b]', async () => {
    const A = await phone(server, st, 'a')
    expect(A.store.setupDone).toBe(false)
    await upload(A, kaspi('kaspi-01'))
    // Один телефон — как после «Отправить»: своя копия операций и итоги в документе.
    expect(useOperationsStore().all).toHaveLength(60)
    expect(server.data.spendTotals!.some((t) => t.by === 'a' && t.kind === 'month' && t.period === '2025-07')).toBe(true)

    const q1 = await screen(A.pinia, Start, '/start/questions')
    expect(q1).toContain('Нашли 7 повторяющихся')
    expect(q1).toContain('Это ваш доход?')
    await screen(A.pinia, Start, '/start/questions', undefined, [act('answerIncome')])
    expect(A.store.people).toEqual([expect.objectContaining({ id: 'a', salary: 120_000, payday: 24 })])

    // Кредит с остатком: платёж июля из выписки отмечен «из выписки» с датой операции — до сверки
    // остатка, поэтому введённый остаток (уже без июльского платежа) второй раз не уменьшается (критик Б3).
    await screen(A.pinia, Start, '/start/questions', undefined, [act('answerRecurring', { creditPrincipal: '1 200 000' })])
    const credit = A.store.credits[0]
    expect(A.store.householdDoc.credits[0]).toMatchObject({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, payment: 151_790, day: 24, annualRate: 0 })
    expect(A.store.payments).toEqual([expect.objectContaining({ kind: 'credit', targetId: credit.id, period: '2025-07', amount: 151_790, source: 'statement' })])
    expect(credit.principal).toBe(1_200_000)
    expect(creditBalance(A.store.householdDoc.credits[0], A.store.payments)).toBe(1_200_000)
    expect(A.store.merchantRules[0].to).toEqual({ payment: { kind: 'credit', targetId: credit.id, categoryId: 'sc_credit' } })

    // «Kaspi Red» без остатка — обязательство «Кредиты», июль отмечен; подписка — быт.
    await screen(A.pinia, Start, '/start/questions', undefined, [act('answerRecurring')])
    await screen(A.pinia, Start, '/start/questions', undefined, [act('answerRecurring')])
    const red = A.store.obligations.find((o) => o.name === 'Оплата Kaspi Red')!
    expect(red.category).toBe('d2')
    expect(A.store.payments.find((p) => p.targetId === red.id)).toMatchObject({ kind: 'obligation', period: '2025-07', amount: 45_000, source: 'statement' })
    expect(A.store.obligations.find((o) => o.name === 'Яндекс Плюс')).toMatchObject({ category: 'd4' })
    await screen(A.pinia, Start, '/start/questions', undefined, [act('skipRest')])

    // Картина июля — итоги своей выписки; «Свободно в месяц» — по плану (доход минус кредит, Red и подписка).
    const month = await screen(A.pinia, Start, '/start/month')
    const mine = A.store.householdDoc.spendTotals!.filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2025-07')
    expect(month).toContain('Ваш июль')
    expect(month).toContain(money(mine.reduce((s, t) => s + t.amount, 0)))
    expect(month).toContain(money(budgetAmounts({ ...A.store.householdDoc, credits: A.store.credits }).d5))

    // Мечта — main; «Позже» — семья настроена, участник отмечен; всё на сервере.
    await screen(A.pinia, Start, '/start/dream', undefined, [
      screenMixin({ step: 'form', template: templateById('car'), name: 'Машина', needText: '3 000 000', term: '18' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    expect(A.store.goals[0]).toMatchObject({ name: 'Машина', main: true, template: 'car' })
    await screen(A.pinia, Start, '/start/invite', undefined, [act('finish')])
    expect(A.store.setupDone).toBe(true)
    expect(A.store.people[0].onboardedAt).toBe('2025-07-27T07:00:00.000Z')
    await A.store.syncHousehold(A.client)
    expect(server.data.setupDoneAt).toBeTruthy()
    expect(server.data.goals[0].main).toBe(true)

    // Партнёр по коду: семья настроена, записи b нет → /start; своя выписка, свой доход, «Готово».
    // Свой телефон: без ответов и операций A в хранилище (A дальше живёт в памяти стора).
    storage.clear()
    const B = await phone(server, st, 'b')
    expect(landingPath(useAuthStore(), B.store)).toBe('/start')
    await upload(B, kaspi('kaspi-02'))
    const qb = await screen(B.pinia, Start, '/start/questions')
    expect(qb).toContain('2 из 2')
    expect(qb).toContain(`${money(160_000)} · 12-го`)
    await screen(B.pinia, Start, '/start/questions', undefined, [act('answerIncome')])
    await screen(B.pinia, Start, '/start/questions', undefined, [act('finish')])
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    expect(A.store.people.find((p) => p.id === 'b')).toMatchObject({ salary: 160_000, payday: 12, onboardedAt: expect.any(String) })
    expect(A.store.setupDone).toBe(true)
    expect(landingPath({ slot: 'b', isViewer: false }, B.store)).toBe('/')
  })

  it('«Введу вручную»: оклад и день без выписки — участник записан, итогов нет, дальше — к мечте', async () => {
    const A = await phone(server, st, 'a')
    await screen(A.pinia, Start, '/start', undefined, [act('manualNext', { manual: true, manualSalary: '500 000', manualPayday: '5' })])
    expect(A.store.people).toEqual([expect.objectContaining({ id: 'a', salary: 500_000, payday: 5 })])
    expect(A.store.householdDoc.spendTotals ?? []).toEqual([])
    expect(await screen(A.pinia, Start, '/start/dream')).toContain('На что копим?')
  })
})

describe('e2e / B2C Блок 3 — часть 5: раскладка записана — второй заход и партнёр не раскладывают повторно (B2C-21)', () => {
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
    at('2026-09-10T07:00:00Z') // день зарплаты Ильяса
    server = fakeServer(planFamilyDoc({ wishlist: [{ id: 'w1', name: 'Робот-пылесос', price: 90_000, by: 'a', addedOn: T0, bought: false, updatedAt: T0 }] }))
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('A отмечает зарплату и раскладывает: цель, досрочка со счёта, «на себя» → allocations в документе; A снова и B видят «Уже разложено» с теми же частями; досрочка — записью prepay', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const path = '/week/salary?from=salary&person=a&period=2026-09'

    // «Пришла зарплата» — на «Неделе» (карточка) и в «Деньгах»; отметка — со счёта.
    setActivePinia(A.pinia)
    expect(await screen(A.pinia, Statements, '/week')).toContain('Пришла зарплата Ильяс — разложить?')
    A.store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: 'card' })
    const before = await screen(A.pinia, WeekSalary, path)
    expect(before).toContain('Осталось распределить')
    expect(before).toContain('Это приближает: «Робот-пылесос»')
    expect(before).not.toContain('Уже разложено')

    await screen(A.pinia, WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        const total = s.total as number
        s.alloc = { trip: 60_000, credit: 30_000, life: total - 90_000 }
        s.picked = 'card'
        ;(s.confirm as () => void)()
      }),
    ])
    const rec = A.store.allocations[0]
    expect(rec).toMatchObject({ source: 'salary', sourceId: 'a', period: '2026-09', by: 'a' })
    expect(rec.parts).toEqual(expect.arrayContaining([{ target: 'trip', amount: 60_000 }, { target: 'prepay:cc', amount: 30_000 }]))
    expect(A.store.goals.find((g) => g.id === 'trip')!.have).toBe(110_000)
    // Досрочка — запись со счёта раскладки (Кредитка — самый дорогой долг), деньги ушли со счёта.
    expect(A.store.payments.find((p) => p.kind === 'prepay')).toMatchObject({ targetId: 'cc', amount: 30_000, accountId: 'card' })
    expect(A.store.accounts.find((a) => a.id === 'card')!.amount).toBe(2_000_000 + 700_000 - 60_000 - 30_000)

    // Второй заход A — записанное решение, а не раскладка.
    const again = await screen(A.pinia, WeekSalary, path)
    expect(again).toContain('Уже разложено')
    expect(again).toContain('Отпуск')
    expect(again).toContain('Досрочно в «Кредитка»')
    expect(again).toContain('Качество жизни')
    expect(again).not.toContain('Подтвердить распределение')

    // B после синка — то же решение; цель и остаток счёта совпадают.
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(B.store.allocations).toHaveLength(1)
    const partner = await screen(B.pinia, WeekSalary, path)
    expect(partner).toContain('Уже разложено')
    expect(partner).toContain('Ильяс · ')
    expect(partner).not.toContain('Осталось распределить')
    expect(B.store.goals.find((g) => g.id === 'trip')!.have).toBe(110_000)
    expect(B.store.payments.filter((p) => p.kind === 'prepay')).toHaveLength(1)
    // Остаток месяца — другой источник: раскладывать можно.
    expect(await screen(B.pinia, WeekSalary, '/week/salary?from=rest&amount=40000&period=2026-09')).toContain('Осталось распределить')
  })
})

describe('e2e / B2C Блок 3 — часть 6 (приёмка): повтор выписки ничего не удваивает; остаток месяца разложен — вопрос закрыт у обоих', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false,
  })
  const statement = (...list: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-09-01', to: '2026-09-28', operations: assignIds(list), skipped: 0 })

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
    at('2026-09-29T07:00:00Z') // последние дни сентября — «Остались деньги?»
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

  it('A: выписка → «да» платежу по кредиту; та же выписка ещё раз — операций, отметок и итогов не прибавилось; «Остались деньги?» 100 000 → «Отпуск» со счёта → запись rest; вопрос больше не задаётся ни A, ни B (главный и «Неделя»), у B — «Уже разложено»', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const parsed = statement(op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'), op('2026-09-20', -12_500, 'Magnum'))
    const alive = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt)
    const monthTotals = () => alive(A.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-09').map((t) => [t.categoryId, t.amount])

    const opsA = await upload(A, parsed)
    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await A.store.syncHousehold(A.client)
    const once = { ops: opsA.all.length, server: st.ops.get('u-a')!.size, payments: alive(A.store.payments).length, totals: monthTotals() }
    expect(once).toMatchObject({ ops: 2, server: 2, payments: 1 })

    // Повтор того же файла (человек загрузил выписку дважды): ничего не удвоилось, вопрос не вернулся.
    await upload(A, parsed)
    expect(opsA.all.length).toBe(once.ops)
    expect(st.ops.get('u-a')!.size).toBe(once.server)
    expect(alive(A.store.payments)).toHaveLength(once.payments)
    expect(monthTotals()).toEqual(once.totals)
    expect(opsA.pendingMatches).toEqual([])

    // «Остались деньги?» — карточкой первой по «Разложить» с главного.
    expect(await screen(A.pinia, Statements, '/week?rest=1')).toContain('Остались деньги?')
    const path = '/week/salary?from=rest&amount=100000&period=2026-09'
    await screen(A.pinia, WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        s.alloc = { trip: 100_000 }
        s.picked = 'card'
        ;(s.confirm as () => void)()
      }),
    ])
    expect(A.store.allocations).toHaveLength(1)
    expect(A.store.allocations[0]).toMatchObject({ source: 'rest', sourceId: '2026-09', period: '2026-09', by: 'a', parts: [{ target: 'trip', amount: 100_000 }] })
    expect(A.store.goals.find((g) => g.id === 'trip')!.have).toBe(150_000)
    expect(await screen(A.pinia, Statements, '/week?rest=1')).not.toContain('Остались деньги?')

    // B: вопрос закрыт записью семьи, а не ответом на телефоне A.
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(await screen(B.pinia, Statements, '/week?rest=1')).not.toContain('Остались деньги?')
    expect(await screen(B.pinia, Dreams, '/')).not.toContain('Остались деньги?')
    const partner = await screen(B.pinia, WeekSalary, path)
    expect(partner).toContain('Уже разложено')
    expect(partner).not.toContain('Осталось распределить')

    // Повтор выписки после раскладки её не трогает.
    await upload(A, parsed)
    expect(A.store.allocations).toHaveLength(1)
    expect(A.store.goals.find((g) => g.id === 'trip')!.have).toBe(150_000)
  })
})
