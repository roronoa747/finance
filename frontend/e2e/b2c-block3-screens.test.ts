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
import { templateById, templateCredit } from '../src/lib/goalTemplates'
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
    expect(goalA.photoCredit).toEqual(templateCredit(templateById('japan')!))
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
    expect(screenB).toContain(templateById('japan')!.photo.author)
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
    expect(A.store.householdDoc.credits[0]).toMatchObject({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, payment: 151_790, day: 24, annualRate: 0, rateUnknown: true })
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

  it('возврат приёмки 2 п. 2: партнёр B — первый запуск на фикстуре Freedom; «Записать» на «Перевод с карты на карту» (переводы разных сумм) — «Свободно» у A и B не прыгает на сумму переводов', async () => {
    server = fakeServer({ ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }], setupDoneAt: T0 })
    const A = await phone(server, st, 'a')
    storage.clear()
    const B = await phone(server, st, 'b')
    // Обезличенная выписка Freedom (июль 2025: переводы 2 000, 11 000, 50 000 одним названием) и ещё два
    // перевода по 15 000 около 20-го — повтор, о котором спросит первый запуск.
    const base = kaspi('freedom-01')
    const transfer = (date: string, amount: number): Omit<Operation, 'id'> => ({
      bank: 'freedom', date, amount, kind: 'transfer-out', merchant: 'Перевод с карты на карту', categoryId: null, internal: false,
    })
    const julyTransfers = base.operations.filter((o) => o.merchant === 'Перевод с карты на карту' && o.amount < 0 && o.date.startsWith('2025-07'))
    expect(julyTransfers.map((o) => o.amount).sort((x, y) => x - y)).toEqual([-50_000, -11_000, -2_000])
    const parsed: ParsedStatement = {
      ...base,
      operations: assignIds([...base.operations.map(({ id: _id, ...o }) => o), transfer('2025-06-20', -15_000), transfer('2025-07-20', -15_000)]),
    }
    await upload(B, parsed)
    const free = async (p: Phone) => {
      setActivePinia(p.pinia)
      const f = useFinanceStore()
      await f.pullHousehold(p.client)
      await useOperationsStore().loadUploads(p.client)
      const doc = f.householdDoc
      return freeByFact({ ...doc, credits: f.credits }, doc.spendTotals ?? [], doc.spendCategories ?? [], '2025-07', useOperationsStore().uploads).amount
    }

    // До вопроса о переводах — ответы по умолчанию (доход, крупные повторы); «Свободно» — до и после «Записать».
    setActivePinia(B.pinia)
    for (let i = 0; i < 7; i++) {
      const html = await screen(B.pinia, Start, '/start/questions')
      if (html.includes('Перевод с карты на карту — это что?')) break
      await screen(B.pinia, Start, '/start/questions', undefined, [act(html.includes('Это ваш доход?') ? 'answerIncome' : 'answerRecurring', {})])
    }
    const q = await screen(B.pinia, Start, '/start/questions')
    expect(q).toContain('Перевод с карты на карту — это что?')
    expect(q).toContain(`${money(15_000)} · примерно`)
    await B.store.syncHousehold(B.client)
    const before = { a: await free(A), b: await free(B) }
    setActivePinia(B.pinia)
    // «Записать» с «Другое регулярное» — главная кнопка карточки.
    await screen(B.pinia, Start, '/start/questions', undefined, [act('answerRecurring')])
    const ob = B.store.obligations.find((o) => o.name === 'Перевод с карты на карту')!
    expect(ob).toMatchObject({ category: 'd4' })
    // Июль отмечен переводом 15 000, а не первой строкой месяца.
    expect(B.store.payments.filter((p) => p.targetId === ob.id && !p.deletedAt)).toEqual([expect.objectContaining({ period: '2025-07', amount: 15_000, source: 'statement' })])
    await B.store.syncHousehold(B.client)

    // «Свободно» июля у обоих: 15 000 было тратой — стало платежом месяца; 2 000, 11 000 и 50 000 — траты.
    expect({ a: await free(A), b: await free(B) }).toEqual(before)
    setActivePinia(B.pinia)
    const transfers = useOperationsStore().all.filter((o) => o.merchant === 'Перевод с карты на карту' && o.amount < 0 && o.date.startsWith('2025-07'))
    expect(transfers.map((o) => [o.amount, o.categoryId]).sort((x, y) => Number(x[0]) - Number(y[0]))).toEqual([
      [-50_000, null], [-15_000, 'sc_subscriptions'], [-11_000, null], [-2_000, null],
    ])
  })

  it('третья приёмка (критик возврата 2): после «Записать» переводов у B — «куда отнести?» → раздел ложится «остальным» в правило платежа; «Свободно» у A и B то же; повтор выписки отмечает июнь 15 000 сам, остальные переводы — в разделе', async () => {
    server = fakeServer({ ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }], setupDoneAt: T0 })
    const A = await phone(server, st, 'a')
    storage.clear()
    const B = await phone(server, st, 'b')
    const base = kaspi('freedom-01')
    const transfer = (date: string, amount: number): Omit<Operation, 'id'> => ({
      bank: 'freedom', date, amount, kind: 'transfer-out', merchant: 'Перевод с карты на карту', categoryId: null, internal: false,
    })
    const parsed: ParsedStatement = {
      ...base,
      operations: assignIds([...base.operations.map(({ id: _id, ...o }) => o), transfer('2025-06-20', -15_000), transfer('2025-07-20', -15_000)]),
    }
    await upload(B, parsed)
    const free = async (p: Phone) => {
      setActivePinia(p.pinia)
      const f = useFinanceStore()
      await f.pullHousehold(p.client)
      await useOperationsStore().loadUploads(p.client)
      const doc = f.householdDoc
      return freeByFact({ ...doc, credits: f.credits }, doc.spendTotals ?? [], doc.spendCategories ?? [], '2025-07', useOperationsStore().uploads).amount
    }

    // Первый запуск B: ответы по умолчанию до вопроса о переводах, «Записать» — обязательство 15 000.
    setActivePinia(B.pinia)
    for (let i = 0; i < 7; i++) {
      const html = await screen(B.pinia, Start, '/start/questions')
      if (html.includes('Перевод с карты на карту — это что?')) break
      await screen(B.pinia, Start, '/start/questions', undefined, [act(html.includes('Это ваш доход?') ? 'answerIncome' : 'answerRecurring', {})])
    }
    await screen(B.pinia, Start, '/start/questions', undefined, [act('answerRecurring')])
    const ob = B.store.obligations.find((o) => o.name === 'Перевод с карты на карту')!
    await B.store.syncHousehold(B.client)
    const before = { a: await free(A), b: await free(B) }

    // «Неделя» B: переводы не той суммы — незнакомые; ответ разделом не заменяет правило платежа.
    setActivePinia(B.pinia)
    const ops = useOperationsStore()
    // Сопоставления — первыми (порядок Р-8): «Нет» на каждое, дальше — незнакомое.
    for (const c of [...ops.pendingMatches]) ops.declineMatch(c)
    // Переводы не той суммы — в очереди «куда отнести?»; ответ — чип раздела (как нажатие на карточке).
    type Group = { label: string }
    let queued: string[] = []
    await screen(B.pinia, Statements, '/week', undefined, [
      screenMixin({}, (s) => {
        const queue = s.unknownQueue as Group[]
        queued = queue.map((g) => g.label)
        ;(s.choose as (g: Group, v: string, r: boolean) => void)(queue.find((g) => g.label === 'Перевод с карты на карту')!, 'sc_people', true)
      }),
    ])
    expect(queued).toContain('Перевод с карты на карту')
    await vi.runOnlyPendingTimersAsync()
    await ops.flush(B.client)
    const rule = () => B.store.merchantRules.filter((r) => !r.deletedAt && r.match.merchant === 'перевод с карты на карту')
    expect(rule().map((r) => r.to)).toEqual([{ payment: { kind: 'obligation', targetId: ob.id, categoryId: 'sc_subscriptions', restCategoryId: 'sc_people' } }])
    await screen(B.pinia, Statements, '/week', undefined, [screenMixin({}, (s) => void (queued = (s.unknownQueue as Group[]).map((g) => g.label)))])
    expect(queued).not.toContain('Перевод с карты на карту')
    const julyTransfers = () => ops.all
      .filter((o) => o.merchant === 'Перевод с карты на карту' && o.amount < 0 && o.date.startsWith('2025-07'))
      .map((o) => [o.amount, o.categoryId]).sort((x, y) => Number(x[0]) - Number(y[0]))
    expect(julyTransfers()).toEqual([[-50_000, 'sc_people'], [-15_000, 'sc_subscriptions'], [-11_000, 'sc_people'], [-2_000, 'sc_people']])
    await B.store.syncHousehold(B.client)
    // Переводы людям — такая же трата, как незнакомое: «Свободно» не меняется ни у кого.
    expect({ a: await free(A), b: await free(B) }).toEqual(before)

    // Повтор той же выписки: июнь 15 000 отмечен правилом сам, июль — не второй раз; операций не прибавилось.
    setActivePinia(B.pinia)
    const count = ops.all.length
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(B.client)
    await B.store.syncHousehold(B.client)
    expect(ops.lastAutoMarked).toBe(1)
    expect(ops.all).toHaveLength(count)
    const marks = B.store.payments.filter((p) => p.targetId === ob.id && !p.deletedAt).map((p) => [p.period, p.amount, p.source]).sort()
    expect(marks).toEqual([['2025-06', 15_000, 'statement'], ['2025-07', 15_000, 'statement']])
    expect(julyTransfers()).toEqual([[-50_000, 'sc_people'], [-15_000, 'sc_subscriptions'], [-11_000, 'sc_people'], [-2_000, 'sc_people']])
    expect(rule()).toHaveLength(1)
    expect({ a: await free(A), b: await free(B) }).toEqual(before)
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

    // «Пришла зарплата» — на «Неделе» (карточка-вопрос о приходе, возврат приёмки 2 п. 4) и в «Деньгах»; отметка — со счёта.
    setActivePinia(A.pinia)
    const week = await screen(A.pinia, Statements, '/week')
    expect(week).toContain('Пришла зарплата Ильяс?')
    expect(week).not.toContain('разложить?')
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

describe('e2e / B2C Блок 3 — часть 7 (возврат приёмки п. 2): зарплата, отмеченная по выписке, раскладывается — от карточки сопоставления и от автоотметки', () => {
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
    return ops
  }

  /** Раскладка на экране: всё свободное — в «Отпуск» (без счёта: зарплата из выписки не зачислена), «Подтвердить». */
  async function allocateAll(p: Phone, path: string) {
    const html = await screen(p.pinia, WeekSalary, path)
    expect(html).toContain('Осталось распределить')
    await screen(p.pinia, WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        s.alloc = { trip: s.total as number }
        ;(s.confirm as () => void)()
      }),
    ])
  }

  /** Решение главного экрана (как в части 1): kind и адрес. */
  async function decision(p: Phone) {
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('onPrimary' in this.$.setupState) vm = this.$.setupState } }
    await screen(p.pinia, Dreams, '/', undefined, [grab])
    return vm.shown as { kind: string; to: string | null; question: string } | null
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
    at('2026-09-10T07:00:00Z') // день зарплаты Ильяса (700 000, 10-го)
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h-family', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('сентябрь: «Да, зарплата» → сразу раскладка → запись; октябрь: правило отмечает само → на главном и в «Неделе» «разложить?» → раскладка → вопрос закрыт; партнёру чужая зарплата не предлагается', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const september = '/week/salary?from=salary&person=a&period=2026-09'

    // Сентябрь: выписка с зарплатой — вопрос «Это зарплата Ильяс?»; «Да, зарплата» ведёт на раскладку.
    const opsA = await upload(A, statement('2026-09-01', '2026-09-10', op('2026-09-10', 700_000, 'ТОО Работодатель')))
    expect(await screen(A.pinia, Statements, '/week')).toContain('Это зарплата Ильяс?')
    let router: any = null
    await screen(A.pinia, Statements, '/week', undefined, [
      {
        created(this: any) {
          const s = this.$.setupState
          if (!('acceptMatch' in s) || router) return
          router = this.$router
          s.acceptMatch(s.match)
        },
      },
    ])
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(september))
    expect(A.store.payments.find((p) => p.kind === 'salary')).toMatchObject({ targetId: 'a', period: '2026-09', source: 'statement', accountId: null })
    expect(opsA.pendingMatches).toEqual([])
    await allocateAll(A, september)
    expect(A.store.allocations).toEqual([expect.objectContaining({ source: 'salary', sourceId: 'a', period: '2026-09' })])
    expect((await decision(A))?.kind).not.toBe('allocate')

    // Октябрь: та же строка — правило отмечает зарплату само, раскладки ещё нет.
    at('2026-10-10T07:00:00Z')
    await upload(A, statement('2026-10-01', '2026-10-10', op('2026-10-10', 700_000, 'ТОО Работодатель')))
    expect(opsA.lastAutoMarked).toBe(1)
    const october = '/week/salary?from=salary&person=a&period=2026-10'
    const d = await decision(A)
    expect(d).toMatchObject({ kind: 'allocate', question: 'Пришла зарплата Ильяс — разложить?', to: october })
    expect(await screen(A.pinia, Statements, '/week')).toContain('Пришла зарплата Ильяс — разложить?')

    // Партнёр — пока октябрьская Ильяса не разложена: её не раскладывает и о ней не спрашивается
    // (после раскладки A проверка не отличила бы фильтр «своя» от «разложено» — критик возврата).
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect((await decision(B))?.kind).not.toBe('allocate')
    expect(await screen(B.pinia, Statements, '/week')).not.toContain('Пришла зарплата Ильяс — разложить?')

    setActivePinia(A.pinia)
    await allocateAll(A, october)
    expect(A.store.allocations.map((a) => a.period).sort()).toEqual(['2026-09', '2026-10'])
    expect((await decision(A))?.kind).not.toBe('allocate')
    expect(await screen(A.pinia, Statements, '/week')).not.toContain('разложить?')
  })

  it('возврат приёмки 2 п. 3: выписка после дня зарплаты — «Да, зарплата» за август 13 сентября → ушёл с раскладки → «разложить?» на главном и в «Неделе» и 13-го, и 27-го', async () => {
    // Сентябрьской зарплаты в выписке нет (день 10-й прошёл), вопрос «Это зарплата?» — об августовской.
    at('2026-09-13T07:00:00Z')
    const A = await phone(server, st, 'a')
    await upload(A, statement('2026-08-01', '2026-09-13', op('2026-08-10', 700_000, 'ТОО Работодатель'), op('2026-09-05', -3_500, 'Magnum')))
    expect(await screen(A.pinia, Statements, '/week')).toContain('Это зарплата Ильяс?')
    let router: any = null
    await screen(A.pinia, Statements, '/week', undefined, [
      {
        created(this: any) {
          const s = this.$.setupState
          if (!('acceptMatch' in s) || router) return
          router = this.$router
          s.acceptMatch(s.match)
        },
      },
    ])
    const august = '/week/salary?from=salary&person=a&period=2026-08'
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(august))
    expect(A.store.payments.find((p) => p.kind === 'salary')).toMatchObject({ period: '2026-08', source: 'statement' })

    // Не разложил — ушёл («Закрыть»): августовская ждёт на главном и в «Неделе», пока «Пришла?» сентября не спрашивается.
    for (const day of ['2026-09-13', '2026-09-27']) {
      at(`${day}T07:00:00Z`)
      expect(await decision(A)).toMatchObject({ kind: 'allocate', question: 'Пришла зарплата Ильяс — разложить?', to: august })
      const week = await screen(A.pinia, Statements, '/week')
      expect(week).toContain('Пришла зарплата Ильяс — разложить?')
      expect(week).not.toContain('Пришла зарплата Ильяс?')
    }
    await allocateAll(A, august)
    expect((await decision(A))?.kind).not.toBe('allocate')
  })
})

describe('e2e / B2C Блок 3 — часть 8 (повторная приёмка): у каждого телефона — только своя зарплата; «снял ошибочное — принял верное» видно партнёру', () => {
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

  const salaries = (p: Phone) => p.store.payments.filter((x) => x.kind === 'salary' && !x.deletedAt).map((x) => [x.targetId, x.period, x.source]).sort()
  const paymentRules = (p: Phone) =>
    p.store.merchantRules.flatMap((r) => ('payment' in r.to && !r.deletedAt ? [[r.to.payment.kind, r.to.payment.targetId]] : []))

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-09-20T07:00:00Z') // день зарплаты Аруны (500 000, 20-го); у Ильяса — 700 000, 10-го
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h-family', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
    // Наблюдатель снятых отметок досылает копию глобальным клиентом — у стенда его нет: «нет сети»,
    // очередь остаётся и уходит клиентом телефона при следующей отправке.
    vi.spyOn(apiClient, 'upsertOperations').mockRejectedValue(new TypeError('Failed to fetch'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('п. 1: в выписке каждого есть приход ≈ оклад партнёра — телефон спрашивает только о своей; «да» у обоих — две свои отметки и свои правила', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    // Оба загрузили до ответов: иначе отметка A закрыла бы месяц и ошибка «чужой кандидат» не была бы видна.
    const opsA = await upload(A, statement('2026-09-01', '2026-09-20', op('2026-09-10', 700_000, 'ТОО Работодатель'), op('2026-09-20', 500_000, 'Аруна Б.')))
    const opsB = await upload(B, statement('2026-09-01', '2026-09-20', op('2026-09-10', 700_000, 'Ильяс А.'), op('2026-09-19', 500_000, 'ТОО Школа')))

    setActivePinia(A.pinia)
    expect(opsA.pendingMatches.map((c) => [c.kind, c.targetId, c.period])).toEqual([['salary', 'a', '2026-09']])
    const weekA = await screen(A.pinia, Statements, '/week')
    expect(weekA).toContain('Это зарплата Ильяс?')
    expect(weekA).not.toContain('Это зарплата Аруна?')
    setActivePinia(B.pinia)
    expect(opsB.pendingMatches.map((c) => [c.kind, c.targetId, c.period])).toEqual([['salary', 'b', '2026-09']])
    const weekB = await screen(B.pinia, Statements, '/week')
    expect(weekB).toContain('Это зарплата Аруна?')
    expect(weekB).not.toContain('Это зарплата Ильяс?')

    // A отвечает «да» первым — месяц Аруны остаётся открытым, ей есть что отметить.
    setActivePinia(A.pinia)
    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await A.store.syncHousehold(A.client)
    expect(paymentRules(A)).toEqual([['salary', 'a']])
    await B.store.pullHousehold(B.client)
    expect(salaries(B)).toEqual([['a', '2026-09', 'statement']])
    setActivePinia(B.pinia)
    expect(opsB.pendingMatches.map((c) => [c.kind, c.targetId])).toEqual([['salary', 'b']])

    await opsB.acceptMatch(opsB.pendingMatches[0], B.client)
    await B.store.syncHousehold(B.client)
    expect(paymentRules(B)).toEqual([['salary', 'b']])
    await A.store.pullHousehold(A.client)
    expect(salaries(A)).toEqual([['a', '2026-09', 'statement'], ['b', '2026-09', 'statement']])
    // Приход партнёра в выписке A так и остался приходом: ни отметки, ни правила на него.
    expect(A.store.payments.filter((x) => x.kind === 'salary' && x.targetId === 'b').map((x) => x.opId)).toEqual([opsB.all.find((o) => o.merchant === 'ТОО Школа')!.id])
  })

  it('критик возврата (1): аренда — «да» на ошибочную строку → «Снять отметку» → «да» на верную того же месяца; ошибочная остаётся тратой у A, на сервере и в «Свободно» партнёра', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const freeB = async () => {
      setActivePinia(B.pinia)
      await B.store.pullHousehold(B.client)
      const ops = useOperationsStore()
      await ops.loadUploads(B.client)
      const doc = B.store.householdDoc
      return freeByFact({ ...doc, credits: B.store.credits }, doc.spendTotals ?? [], doc.spendCategories ?? [], '2026-09', ops.uploads).amount
    }
    const monthA = () => Object.fromEntries(B.store.householdDoc.spendTotals!.filter((t) => t.id.startsWith('a:month:2026-09:')).map((t) => [t.categoryId, t.amount]))

    // Аренда 220 000 5-го. Первая строка — долг другу той же суммой (ошибочная), вторая — аренда.
    const parsed = statement('2026-09-01', '2026-09-20', op('2026-09-04', -220_000, 'ИП Ахметов'), op('2026-09-05', -221_000, 'ИП Жолдасбеков'))
    const opsA = await upload(A, parsed)
    const wrong = opsA.all.find((o) => o.merchant === 'ИП Ахметов')!
    const right = opsA.all.find((o) => o.merchant === 'ИП Жолдасбеков')!
    expect([wrong.categoryId, right.categoryId]).toEqual([null, null])
    expect(opsA.pendingMatches.map((c) => [c.opId, c.kind, c.targetId, c.period])).toEqual([[wrong.id, 'obligation', 'rent', '2026-09']])
    const free0 = await freeB()

    // «Да» на ошибочную: месяц аренды оплачен её суммой, она — в плановом разделе.
    setActivePinia(A.pinia)
    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await A.store.syncHousehold(A.client)
    const free1 = await freeB()
    expect(free1).toBe(free0 + 220_000)
    expect(monthA()).toEqual({ sc_rent: 220_000, _unknown: 221_000 })

    // «Снять отметку» → ошибочная снова трата, вопрос — о следующей строке того же месяца.
    setActivePinia(A.pinia)
    A.store.unmarkPaid('obligation', 'rent', '2026-09')
    await nextTick()
    expect(opsA.all.find((o) => o.id === wrong.id)!.categoryId).toBeNull()
    expect(opsA.pendingMatches.map((c) => [c.opId, c.targetId, c.period])).toEqual([[right.id, 'rent', '2026-09']])

    // «Да» на верную: платёж — она; ошибочная остаётся тратой (правило её продавца не снято — ТЗ).
    await opsA.acceptMatch(opsA.pendingMatches[0], A.client)
    await opsA.flush(A.client)
    await A.store.syncHousehold(A.client)
    expect(A.store.payments.filter((x) => x.kind === 'obligation' && !x.deletedAt).map((x) => [x.targetId, x.amount, x.opId])).toEqual([['rent', 221_000, right.id]])
    expect(Object.fromEntries(opsA.all.map((o) => [o.merchant, o.categoryId]))).toEqual({ 'ИП Ахметов': null, 'ИП Жолдасбеков': 'sc_rent' })
    expect(st.ops.get('u-a')!.get(wrong.id)!.category_id).toBeNull()
    expect(st.ops.get('u-a')!.get(right.id)!.category_id).toBe('sc_rent')
    // Партнёр: аренда оплачена верной строкой, ошибочная вычтена тратой — «Свободно» как при первой
    // отметке (со старым releasedOps ошибочная ушла бы в аренду и «Свободно» выросло бы на 220 000).
    const free3 = await freeB()
    expect(monthA()).toEqual({ sc_rent: 221_000, _unknown: 220_000 })
    expect(free3).toBe(free1)
    expect(await screen(B.pinia, Dreams, '/')).toContain(money(free3))

    // Повтор той же выписки ничего не возвращает в аренду.
    await upload(A, parsed)
    expect(Object.fromEntries(opsA.all.map((o) => [o.merchant, o.categoryId]))).toEqual({ 'ИП Ахметов': null, 'ИП Жолдасбеков': 'sc_rent' })
    expect(await freeB()).toBe(free1)
  })
})
