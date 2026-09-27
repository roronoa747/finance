import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { PdfRow } from '@/lib/statements/pdf'
import { parseStatement } from '@/lib/statements/parsers'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import { budgetAmounts } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { templateById } from '@/lib/goalTemplates'
import { T0, authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { SyncDoc } from '@/types/finance'
import Start from './Start.vue'

/**
 * Первый запуск из выписки (B2C-19, SSR): каждый шаг, «введу вручную», вопросы на фикстуре
 * Kaspi и что они пишут, партнёр по коду без шагов 4–5. Операции — в своей копии стора
 * (`ff_operations`), как после «Отправить».
 */
const fixtures = import.meta.glob<PdfRow[]>('../lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspiOps = (name = 'kaspi-01') => parseStatement(fixtures[`../lib/statements/fixtures/${name}.rows.json`]).operations

const storage = new Map<string, string>()
function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
}

function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', doc: SyncDoc = defaultSyncDoc()) {
  useAuthStore().setAuthData(authAs(role, slot))
  const store = useFinanceStore()
  store.claimFor('h-family')
  store.setHouseholdDoc(doc, 1)
  return store
}

/** Своя копия операций — как после «Отправить» (стор операций читает её при создании). */
function seedOps(ops: Operation[], user = 'u-a') {
  writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: `h-family:${user}`, ops: Object.fromEntries(ops.map((o) => [o.id, o])) })
}

const act = (name: string, state: Record<string, unknown> = {}) => screenMixin(state, (s) => (s[name] as () => void)())
const answered = () => JSON.parse(storage.get('ff_start_answered') ?? '[]') as string[]

describe('views/Start.vue — первый запуск из выписки (B2C-19, SSR)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    // Сети нет: картинка шаблона и личный документ не уходят.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('шаг 1: «Загрузите первую выписку», «1 из 5», файл остаётся на телефоне, «Выбрать файл» и «Введу вручную»; партнёр — «свою выписку», «1 из 2»', async () => {
    family()
    const html = await renderScreen(Start, '/start')
    expect(html).toContain('Загрузите первую выписку')
    expect(html).toContain('Приложение само найдёт зарплату, кредиты и подписки — вы только подтвердите.')
    expect(html).toContain('1 из 5')
    expect(html).toContain('Файл разбирается на телефоне и никуда не уходит.')
    expect(html).toContain('Выбрать файл')
    expect(html).toContain('Введу вручную')
    expect(html).toContain('accept="application/pdf,.pdf"')

    setActivePinia(createPinia())
    family('member', 'b', { ...planFamilyDoc(), people: [planFamilyDoc().people[0]] })
    const partner = await renderScreen(Start, '/start/upload')
    expect(partner).toContain('Загрузите свою выписку')
    expect(partner).toContain('1 из 2')
  })

  it('«Введу вручную»: оклад и день зарплаты — участнику с именем регистрации; без выписки картины месяца нет', async () => {
    const store = family()
    const html = await renderScreen(Start, '/start', undefined, [screenMixin({ manual: true })])
    expect(html).toContain('>Зарплата в месяц, ₸</span>')
    expect(html).toContain('>День зарплаты (1–28)</span>')
    expect(html).toContain('Лучше загружу выписку')
    await renderScreen(Start, '/start', undefined, [act('manualNext', { manual: true, manualSalary: '450 000', manualPayday: '12' })])
    expect(store.people).toEqual([expect.objectContaining({ id: 'a', name: 'a', salary: 450_000, payday: 12 })])
    expect(store.householdDoc.spendTotals ?? []).toEqual([])
  })

  it('шаг 2 на фикстуре Kaspi: «Нашли 7 повторяющихся», «2 из 5», первый вопрос — доход с суммой и днём в полях, «1 из 7»', async () => {
    family()
    seedOps(kaspiOps())
    const html = await renderScreen(Start, '/start/questions')
    expect(html).toContain('Нашли 7 повторяющихся')
    expect(html).toContain('Подтвердите по одному — дальше отметим сами.')
    expect(html).toContain('2 из 5')
    expect(html).toContain('Это ваш доход?')
    expect(html).toContain(`${money(120_000)} · 24-го · С карты другого банка · 3 раз`)
    expect(html).toContain(`value="${plain(120_000)}"`)
    expect(html).toContain('value="24"')
    expect(html).toContain('1 из 7')
    expect(html).toContain('Да, это зарплата')
  })

  it('ответы пишут документ: доход (с правкой суммы), кредит с остатком, «Kaspi Red» без остатка — обязательство «Кредиты», подписка — быт; «нет» ничего не пишет; правила — в личном документе', async () => {
    const store = family()
    seedOps(kaspiOps())
    // Доход: безымянный отправитель — правила нет.
    await renderScreen(Start, '/start/questions', undefined, [act('answerIncome', { incomeSalary: '125 000' })])
    expect(store.people).toEqual([expect.objectContaining({ id: 'a', salary: 125_000, payday: 24 })])
    expect(store.merchantRules).toEqual([])
    expect(answered()).toEqual(['income'])

    // Кредит с остатком — кредит без ставки, платёж из выписки; правило «платёж по кредиту».
    const q2 = await renderScreen(Start, '/start/questions')
    expect(q2).toContain('Оплата Kaspi Кредита — это что?')
    expect(q2).toContain('2 из 7')
    expect(q2).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(?:\s|<!---->)*Кредит(?:\s|<!---->)*</)
    expect(q2).toContain('Остаток долга, ₸ — если знаете')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring', { creditPrincipal: '1 200 000' })])
    expect(store.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, annualRate: 0, payment: 151_790, day: 24 })])
    expect(store.merchantRules[0].to).toEqual({ payment: { kind: 'credit', targetId: store.credits[0].id, categoryId: 'sc_credit' } })
    // Июль 2025 — не этот месяц: отметки нет.
    expect(store.payments).toEqual([])

    // Без остатка — обязательство раздела «Кредиты»: кредит с остатком 0 платежа не ждёт.
    expect(await renderScreen(Start, '/start/questions')).toContain('Оплата Kaspi Red — это что?')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring')])
    const red = store.obligations.find((o) => o.name === 'Оплата Kaspi Red')!
    expect(red).toMatchObject({ category: 'd2', day: 9, note: expect.stringContaining('Капитале') })
    expect(red.versions[0].amount).toBe(45_000)
    expect(store.merchantRules[1].to).toEqual({ payment: { kind: 'obligation', targetId: red.id, categoryId: 'sc_credit' } })

    // Подписка — быт, раздел трат из словаря.
    expect(await renderScreen(Start, '/start/questions')).toContain('Яндекс Плюс — это что?')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring')])
    const plus = store.obligations.find((o) => o.name === 'Яндекс Плюс')!
    expect(plus).toMatchObject({ category: 'd4', day: 5 })
    expect(store.merchantRules[2].to).toEqual({ payment: { kind: 'obligation', targetId: plus.id, categoryId: 'sc_subscriptions' } })

    // «Нет, разовое» — вопрос закрыт, записи нет.
    const before = { obligations: store.obligations.length, rules: store.merchantRules.length }
    await renderScreen(Start, '/start/questions', undefined, [screenMixin({}, (s) => (s.answerRecurring as (save: boolean) => void)(false))])
    expect(store.obligations).toHaveLength(before.obligations)
    expect(store.merchantRules).toHaveLength(before.rules)
    expect(answered()).toHaveLength(5)

    // «Потом» — остальные позже в «Неделе»; всё отвечено — «Дальше».
    await renderScreen(Start, '/start/questions', undefined, [act('skipRest')])
    expect(answered()).toHaveLength(7)
    const done = await renderScreen(Start, '/start/questions')
    expect(done).not.toContain('это что?')
    expect(done).toMatch(/<button[^>]*>(?:\s|<!---->)*Дальше/)
    // Бюджет: платёж кредита и «Kaspi Red» — в «Кредитах», подписка — в быту.
    const amounts = budgetAmounts({ ...store.householdDoc, credits: store.credits })
    expect(amounts.d2).toBe(151_790 + 45_000)
    expect(amounts.d4).toBe(3_990)
  })

  it('зарплата в выписке не нашлась: после вопросов — короткая форма дохода', async () => {
    const store = family()
    seedOps(kaspiOps().filter((o) => o.amount < 0))
    const first = await renderScreen(Start, '/start/questions')
    expect(first).toContain('Нашли 6 повторяющихся')
    expect(first).not.toContain('Это ваш доход?')
    await renderScreen(Start, '/start/questions', undefined, [act('skipRest')])
    const form = await renderScreen(Start, '/start/questions')
    expect(form).toContain('В выписке зарплата не нашлась')
    expect(form).toContain('>Зарплата в месяц, ₸</span>')
    await renderScreen(Start, '/start/questions', undefined, [act('manualAfterQuestions', { manualSalary: '400 000', manualPayday: '3' })])
    expect(store.people[0]).toMatchObject({ salary: 400_000, payday: 3 })
  })

  it('шаг 3: «Ваш июль» — месяц выписки, картина по разделам с «не разобрано», «Свободно в месяц» по плану', async () => {
    const total = (categoryId: string, amount: number): SpendTotal => ({ id: `a:month:2025-07:${categoryId}`, by: 'a', kind: 'month', period: '2025-07', categoryId, amount, ops: 3, updatedAt: T0 })
    const store = family('member', 'a', {
      ...defaultSyncDoc(),
      people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }],
      obligations: [{ id: 'red', name: 'Оплата Kaspi Red', note: '', day: 9, category: 'd2', versions: [{ from: '2000-01', amount: 45_000 }], updatedAt: T0 }],
      spendTotals: [total('sc_food', 40_000), total('sc_credit', 151_790), total('_unknown', 5_000)],
    })
    const html = await renderScreen(Start, '/start/month')
    expect(html).toContain('Ваш июль')
    expect(html).toContain('3 из 5')
    expect(html).toContain(money(196_790))
    expect(html).toContain('Кредиты и рассрочки')
    expect(html).toContain('Продукты')
    expect(html).toContain(`не разобрано ${money(5_000)}`)
    expect(html).toContain('Свободно в месяц')
    expect(html).toContain(money(budgetAmounts({ ...store.householdDoc, credits: store.credits }).d5))
    expect(html).toContain(money(555_000))
    expect(html).toContain('Из свободного и складывается мечта — дальше выберем её.')
  })

  it('шаг 4 — «На что копим?» внутри первого запуска («4 из 5»); шаг 5 — код партнёра; «Позже» ставит setupDoneAt и onboardedAt', async () => {
    const store = family('member', 'a', { ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }] })
    const dream = await renderScreen(Start, '/start/dream')
    expect(dream).toContain('На что копим?')
    expect(dream).toContain('4 из 5')
    expect(dream).toContain('Пока без мечты')
    await renderScreen(Start, '/start/dream', undefined, [
      screenMixin({ step: 'form', template: templateById('car'), name: 'Машина', needText: '3 000 000', term: '18' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    expect(store.goals[0]).toMatchObject({ name: 'Машина', main: true, template: 'car', monthly: 166_667 })

    const invite = await renderScreen(Start, '/start/invite')
    expect(invite).toContain('Пригласите партнёра')
    expect(invite).toContain('5 из 5')
    expect(invite).toContain('Создать код')
    expect(invite).toContain('Позже')
    expect(invite).toContain('Один человек — тоже семья.')
    expect(await renderScreen(Start, '/start/invite', undefined, [screenMixin({ inviteCode: 'K7Q2M9' })])).toContain('Готово')
    expect(store.setupDone).toBe(false)
    await renderScreen(Start, '/start/invite', undefined, [act('finish')])
    expect(store.setupDone).toBe(true)
    expect(store.people[0].onboardedAt).toBe('2026-09-24T07:00:00.000Z')
  })

  it('партнёр по коду: выписка и вопросы про себя, «Готово» — people[b] с доходом и onboardedAt, семья не трогается', async () => {
    const base = planFamilyDoc()
    const store = family('member', 'b', { ...base, people: [base.people[0]] })
    seedOps(kaspiOps('kaspi-02'), 'u-b')
    const html = await renderScreen(Start, '/start/questions')
    expect(html).toContain('2 из 2')
    expect(html).toContain('Это ваш доход?')
    expect(html).toContain(`${money(160_000)} · 12-го`)
    await renderScreen(Start, '/start/questions', undefined, [act('answerIncome')])
    expect(store.people.find((p) => p.id === 'b')).toMatchObject({ name: 'b', salary: 160_000, payday: 12 })
    await renderScreen(Start, '/start/questions', undefined, [act('finish')])
    expect(store.people.find((p) => p.id === 'b')?.onboardedAt).toBe('2026-09-24T07:00:00.000Z')
    expect(store.householdDoc.setupDoneAt).toBe(base.setupDoneAt)
    expect(store.goals).toHaveLength(3)
  })
})
