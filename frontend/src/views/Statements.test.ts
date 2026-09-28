import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { parseStatement } from '@/lib/statements/parsers'
import { DEFAULT_SPEND_CATEGORIES } from '@/lib/statements/dictionary'
import type { Operation } from '@/lib/statements/types'
import { money } from '@/lib/money'
import { MONTH_END_KEY } from '@/lib/storage'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { StatementUploadResponse } from '@/types/api'
import type { Allocation, Goal, Obligation } from '@/types/finance'
import kaspi01 from '@/lib/statements/fixtures/kaspi-01.rows.json'
import Statements from './Statements.vue'

const storage = new Map<string, string>()
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ')

const m = (v: number) => text(money(v))
/** Брендовые кнопки экрана (вариант default) — правило 12: главная кнопка одна. */
const brand = (html: string) =>
  [...html.matchAll(/<button[^>]*class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => text(x[1]).trim())

const T = '2026-09-01T00:00:00.000Z'
const op = (id: string, date: string, amount: number, merchant: string, p: Partial<Operation> = {}): Operation => ({
  id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...p,
})
const netflix: Obligation = { id: 'nf', name: 'Netflix', note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: T }
// Годовая, продление 5 октября; с октября — 12 000 вместо 10 000 (фикстура PaidRow.test «Иви»).
const ivi: Obligation = {
  id: 'ivi', name: 'Иви', note: '', day: 5, category: 'd4', every: 'year', month: 10,
  versions: [{ from: '2000-01', amount: 10_000 }, { from: '2026-10', amount: 12_000 }], updatedAt: T,
}
// До мечты 684 000: Netflix за год 59 880 — 9 % пути.
const japan: Goal = { id: 'g', name: 'Япония', need: 1_800_000, seed: 1_116_000, have: 1_116_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], main: true, updatedAt: T }
const restOf = (period: string): Allocation => ({
  id: `rest-${period}`, source: 'rest', sourceId: period, period, by: 'b', at: T, total: 50_000, parts: [], updatedAt: T,
})

function signIn(role: 'member' | 'viewer' = 'member') {
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [
    { id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' },
    { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: '' },
  ]
}

function uploadsClient(uploads: Partial<StatementUploadResponse>[]) {
  return { listStatementUploads: vi.fn(async () => ({ uploads })) } as unknown as ApiClient
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('views/Statements.vue', () => {
  it('пусто: кнопка загрузки и приглашение, без таблицы', async () => {
    signIn()
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).toContain('Загрузить выписку')
    expect(html).toContain('Ваша выписка ещё не загружена')
    expect(html).toContain('файл никуда не уходит')
    expect(html).toContain('Картины недели пока нет')
    expect(html).not.toContain('Загрузки')
  })

  it('картина недели и месяца по разделам обоих, загрузки семьи и «без выписки <имя>»', async () => {
    signIn()
    const finance = useFinanceStore()
    const t = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number) => ({
      id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: '',
    })
    finance.householdDoc.spendTotals = [
      t('a', 'week', '2026-W39', 'sc_food', 12_000), t('b', 'week', '2026-W39', 'sc_food', 8_000),
      t('a', 'month', '2026-09', 'sc_food', 50_000), t('b', 'month', '2026-09', 'sc_food', 30_000),
      t('a', 'month', '2026-09', '_unknown', 4_000),
    ]
    await useOperationsStore().loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-08-26', period_to: '2026-09-26', ops_count: 120, created_at: '' },
    ]))
    const raw = await renderScreen(Statements, '/statements')
    const html = text(raw)
    // Шапка и тег недели — как на главном (weekRangeLabel, weekTag).
    expect(html).toContain('Эта неделя · 21–27 сентября без выписки Дана')
    expect(html).toContain('Алихан · Kaspi')
    expect(html).toContain('26.08–26.09 · 120')
    expect(html).toContain('За эту неделю без выписки Дана.')
    // Таблица по разделам — за «Подробнее» (правило 12): внутри свёрнутого <details>.
    const fold = raw.slice(raw.indexOf('<details>'), raw.indexOf('</details>'))
    expect(raw).not.toContain('<details open')
    expect(text(fold)).toContain('Подробнее: по разделам')
    expect(text(fold)).toContain('Продукты 20 000 ₸ 80 000 ₸')
    expect(text(fold)).toContain('Не разобрано — 4 000 ₸')
    expect(text(fold)).toContain('Всего 20 000 ₸ 84 000 ₸')
    expect(html.match(/Всего 20 000 ₸/g)).toHaveLength(1)
  })

  it('предпросмотр: сводка, незнакомые с выбором раздела, подсказка о переводе партнёру', async () => {
    signIn()
    const parsed = parseStatement(kaspi01)
    useOperationsStore().setDraft([{ name: 'выписка.pdf', parsed }], [{ name: 'чек.pdf', message: 'Пока понимаю выписки Kaspi и Freedom' }])
    const raw = await renderScreen(Statements, '/statements')
    const html = text(raw)
    expect(html).toContain('Kaspi · 26.06–26.07 · 60 операций')
    expect(html).toContain('чек.pdf: Пока понимаю выписки Kaspi и Freedom')
    expect(html).toContain('Операций 60')
    expect(html).toContain('Незнакомое — куда отнести')
    expect(html).toContain('IP ASANOVA')
    expect(html).toContain('Можно пропустить — останется «не разобрано».')
    expect(html).not.toContain('Ответ запомним')
    // Подсказка о партнёре по DESIGN.md §6: вопрос коротко, подробности — строкой деталей.
    expect(html).toContain('Это перевод партнёру?')
    expect(html).toContain('«Дана К.» — похоже, это Дана. Тогда переводы между вами — не траты.')
    expect(html).toContain('Да, это Дана')
    // Главная в разборе одна — «Отправить»; «Да, это Дана» — тихая.
    expect(brand(raw)).toEqual(['Отправить'])
    expect(html).not.toContain('Загрузить выписку')
  })

  it('B2C-15: карточка сопоставления по одному — «Похоже, это платёж по … — отметить?», три действия; viewer её не видит', async () => {
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.credits = [{ id: 'loan', name: 'Автокредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: '' }]
    const store = useOperationsStore()
    store.ops['op-1'] = { id: 'op-1', bank: 'kaspi', date: '2026-09-14', amount: -58_000, kind: 'purchase', merchant: 'Оплата Kaspi Кредита', categoryId: 'sc_credit', internal: false }
    const html = await renderScreen(Statements, '/week')
    expect(html).toContain('Похоже, это платёж по Автокредит — отметить?')
    expect(html).toContain('14 сентября · «Оплата Kaspi Кредита»')
    for (const t of ['Да, отметить', 'Нет, это другое', 'Потом']) expect(html).toContain(t)
    // Без абзаца механики (правило 12); главная кнопка одна — «Загрузить выписку» тихая.
    expect(html).not.toContain('запомним')
    expect(brand(html)).toEqual(['Да, отметить'])

    setActivePinia(createPinia())
    signIn('viewer')
    useFinanceStore().householdDoc.credits = finance.householdDoc.credits
    useOperationsStore().ops['op-1'] = store.ops['op-1']
    expect(await renderScreen(Statements, '/week')).not.toContain('отметить?')
  })

  it('повтор того же файла — «все N уже были»', async () => {
    signIn()
    const store = useOperationsStore()
    const parsed = parseStatement(kaspi01)
    for (const op of parsed.operations) store.ops[op.id] = op
    store.setDraft([{ name: 'выписка.pdf', parsed }])
    expect(text(await renderScreen(Statements, '/statements'))).toContain('Все 60 уже были — ничего не удвоится')
  })

  it('viewer видит картину и загрузки, но не кнопку загрузки', async () => {
    signIn('viewer')
    await useOperationsStore().loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'freedom', period_from: '2026-09-01', period_to: '2026-09-26', ops_count: 40, created_at: '' },
    ]))
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).not.toContain('Загрузить выписку')
    expect(html).toContain('Алихан · Freedom')
  })

  it('демо: отправка без запросов, загрузка — локально', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const store = useOperationsStore()
    store.setDraft([{ name: 'выписка.pdf', parsed: parseStatement(kaspi01) }])
    await store.send()
    const html = text(await renderScreen(Statements, '/statements'))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(html).toContain('демо: только на этом телефоне')
    expect(html).toContain('26.06–26.07 · 60')
  })
})

// B2C-21 «Тесты»: SSR /week — очередь решений по одному после сопоставлений и итог недели.
describe('views/Statements.vue — решения по одному и итог недели', () => {
  it('незнакомые продавцы месяца — по одному: «куда отнести?», «1 из 2», чипы, «Ещё N ▾», «Пропустить все»', async () => {
    signIn()
    const store = useOperationsStore()
    store.ops.o1 = op('o1', '2026-09-05', -12_000, 'IP ASANOVA')
    store.ops.o2 = op('o2', '2026-09-10', -2_000, 'TOO ROMASHKA')
    store.ops.o3 = op('o3', '2026-09-20', -3_000, 'TOO ROMASHKA')
    const html = text(await renderScreen(Statements, '/week'))
    expect(html).toContain('IP ASANOVA — куда отнести?')
    expect(html).toContain(`1 раз · ${m(12_000)} · последний — 5 сентября`)
    expect(html).toContain('1 из 2')
    for (const t of ['Продукты', 'Между своими', `Ещё ${DEFAULT_SPEND_CATEGORIES.length - 6} ▾`, 'Пропустить все', 'Потом']) expect(html).toContain(t)
    expect(html).not.toContain('TOO ROMASHKA — куда отнести?')
  })

  it('«Оставить подписку?» — тексты главного (keepCard): сумма месяца, за год ×12 и доля пути до мечты', async () => {
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.obligations = [netflix]
    finance.householdDoc.goals = [japan]
    const raw = await renderScreen(Statements, '/week')
    const html = text(raw)
    expect(html).toContain('Оставить подписку Netflix?')
    expect(html).toContain(`${m(4_990)} · каждый месяц`)
    expect(html).toContain(`За год — ${m(59_880)} · это 9 % пути до Япония`)
    for (const t of ['Оставить', 'Отписаться', 'Подумать']) expect(html).toContain(t)
    // Своей выписки нет — «Загрузить выписку» тихая, главная — «Оставить».
    expect(html).toContain('Загрузить выписку')
    expect(brand(raw)).toEqual(['Оставить'])
  })

  it('«Оставить?» у годовой: цена продления из новой версии, а не текущая — как на главном', async () => {
    vi.setSystemTime(new Date('2026-09-25T07:00:00Z')) // до продления 5 октября — 10 дней
    signIn()
    useFinanceStore().householdDoc.obligations = [ivi]
    const html = text(await renderScreen(Statements, '/week'))
    expect(html).toContain('Оставить подписку Иви?')
    expect(html).toContain(`${m(12_000)} · в год · продлится 5 октября`)
    expect(html).toContain(`За год — ${m(12_000)}`)
    expect(html).not.toContain(m(10_000))
  })

  it('«Остались деньги?» в последние дни месяца: «Конец сентября», одна главная кнопка; ответ — сырым ключом месяца', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const raw = await renderScreen(Statements, '/week')
    const html = text(raw)
    expect(html).toContain('Остались деньги?')
    expect(html).toContain('Конец сентября — остаток разложим в мечты')
    expect(html).not.toContain('Конец сентябрь')
    expect(brand(raw)).toEqual(['Разложить'])

    // «Нет» — ответ до конца месяца в формате главного («2026-09», не JSON): карточка уходит.
    const answered = await renderScreen(Statements, '/week', undefined, [screenMixin({}, (s) => (s.answerRest as (go: boolean) => void)(false))])
    expect(storage.get(MONTH_END_KEY)).toBe('2026-09')
    expect(answered).not.toContain('Остались деньги?')
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги?')
    // Запись «Недели» до критика (JSON) тоже читается как ответ; прошлый месяц — не ответ.
    storage.set(MONTH_END_KEY, '"2026-09"')
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги?')
    storage.set(MONTH_END_KEY, '2026-08')
    expect(await renderScreen(Statements, '/week')).toContain('Остались деньги?')
  })

  it('«Остались деньги?»: остаток месяца уже разложил партнёр (раскладка rest в общем документе) — не спрашиваем', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.allocations = [restOf('2026-08')]
    expect(await renderScreen(Statements, '/week')).toContain('Остались деньги?')
    finance.householdDoc.allocations = [restOf('2026-08'), restOf('2026-09')]
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги?')
    expect(await renderScreen(Statements, '/week?rest=1')).not.toContain('Остались деньги?')
  })

  it('/week?rest=1 («Разложить» с главного) — «Остались деньги?» первой, очередь — после ответа', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    // Незнакомая трата 10 сентября (не этой недели) и подписка — обе стоят в очереди раньше остатка.
    useOperationsStore().ops.o1 = op('o1', '2026-09-10', -7_000, 'IP ASANOVA')
    useFinanceStore().householdDoc.obligations = [netflix]
    const queue = text(await renderScreen(Statements, '/week'))
    expect(queue).toContain('IP ASANOVA — куда отнести?')
    expect(queue).not.toContain('Остались деньги?')

    const rest = text(await renderScreen(Statements, '/week?rest=1'))
    expect(rest).toContain('Остались деньги?')
    expect(rest).not.toContain('куда отнести?')
    expect(rest).not.toContain('Оставить подписку')

    // Ответили — адрес тот же, а первой снова очередь.
    storage.set(MONTH_END_KEY, '2026-09')
    const after = text(await renderScreen(Statements, '/week?rest=1'))
    expect(after).toContain('IP ASANOVA — куда отнести?')
    expect(after).not.toContain('Остались деньги?')
  })

  it('итог недели: «на N % меньше прошлой», прошлые недели; «Отмечено по выписке: N»', async () => {
    signIn()
    const finance = useFinanceStore()
    const t = (period: string, amount: number) => ({ id: `a:week:${period}:sc_food`, by: 'a' as const, kind: 'week' as const, period, categoryId: 'sc_food', amount, ops: 1, updatedAt: '' })
    finance.householdDoc.spendTotals = [t('2026-W39', 60_000), t('2026-W38', 80_000)]
    const store = useOperationsStore()
    await store.loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-24', ops_count: 30, created_at: '' },
    ]))
    store.lastAutoMarked = 1
    const html = text(await renderScreen(Statements, '/week'))
    expect(html).toContain('на 25 % меньше прошлой')
    expect(html).toContain('Прошлые недели')
    expect(html).toContain(`14–20 сентября ${m(80_000)}`)
    expect(html).toContain('Отмечено по выписке: 1')
  })
})
