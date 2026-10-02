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
import { decisionQueue } from '@/lib/finance'
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
    // Возврат смоука (g2 «Неделя — до загрузки»): у участника — одна карточка загрузки, без второго пустого состояния и «0 ₸».
    expect(html).not.toContain('Картины недели пока нет')
    expect(html).not.toContain(m(0))
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
    // Даты недели и «без выписки Дана» — в подписи шапки оболочки (AppShell.test); на экране — итог недели.
    expect(html).not.toContain('Эта неделя')
    expect(html).not.toContain('За эту неделю без выписки')
    expect(html).toContain(m(20_000))
    // Своя выписка за неделю есть — ни загрузки, ни списка загрузок (g2 «Неделя — итог»).
    expect(html).not.toContain('Загрузить выписку')
    expect(html).not.toContain('Алихан · Kaspi')
    // Таблица по разделам — внутри карточки итога, свёрнутым <details> (смоук владельца, п. 3; правило 12).
    const fold = raw.slice(raw.indexOf('<details'), raw.indexOf('</details>'))
    expect(raw).not.toContain('<details open')
    expect(raw.lastIndexOf('rounded-card', raw.indexOf('<details'))).toBeGreaterThan(-1)
    expect(text(fold)).toContain('Разделы за сентябрь')
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
    // Банк и период — в подписи шапки «Разбор» (AppShell); здесь — сводка g2 «Разбор — предпросмотр».
    expect(html).toContain('чек.pdf: Пока понимаю выписки Kaspi и Freedom')
    expect(html).toContain('60 операций')
    expect(html).toContain('Списания')
    expect(html).toContain('Между своими')
    // Незнакомые — одной карточкой за раз с чипами (g2 «Решение — незнакомый продавец»), не стеной выпадающих списков.
    expect(html).toMatch(/— куда отнести\?/)
    expect(html).toMatch(/1 из \d+/)
    expect(html).toContain('Пропустить все')
    expect(raw).not.toContain('<select')
    expect(html.match(/куда отнести\?/g)).toHaveLength(1)
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
    expect(text(await renderScreen(Statements, '/statements'))).toContain('60 операций все уже были')
  })

  it('viewer видит, кто загрузил за неделю (g2: имя · банк · период · N операций · готово), но не кнопку загрузки', async () => {
    signIn('viewer')
    await useOperationsStore().loadUploads(uploadsClient([
      { id: 'u1', slot: 'b', bank: 'freedom', period_from: '2026-09-01', period_to: '2026-09-26', ops_count: 40, created_at: '' },
    ]))
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).not.toContain('Загрузить выписку')
    expect(html).toContain('Дана Freedom · 1–26 сентября · 40 операций готово')
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
    // Загрузка записана локально; выписка июня-июля эту неделю не закрывает — экран зовёт загрузить свою.
    expect(store.uploads).toHaveLength(1)
    expect(store.uploads[0]).toMatchObject({ ops_count: 60 })
    expect(html).toContain('Ваша выписка ещё не загружена')
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

    // «Отписаться» — предупреждение главного: отключить в самом сервисе нужно отдельно (Н-4).
    const cancel = text(await renderScreen(Statements, '/week', undefined, [screenMixin({ cancelling: true })]))
    expect(cancel).toContain('Подписка уйдёт из бюджета и планов у вас обоих. Отключить её в самом сервисе нужно отдельно.')
    expect(cancel).toContain('Отменить подписку')
    expect(cancel).not.toContain('За год —')
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

  it('«Остались деньги с сентября?» в последние дни месяца — тексты главного (Н-4), одна главная кнопка; ответ — сырым ключом месяца', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const raw = await renderScreen(Statements, '/week')
    const html = text(raw)
    expect(html).toContain('Остались деньги с')
    expect(html).toContain('Остались деньги с сентября?')
    expect(html).toContain('Месяц заканчивается — разложим остаток в мечту или на досрочку')
    expect(html).toContain('Не сейчас')
    expect(brand(raw)).toEqual(['Разложить'])

    // «Не сейчас» — ответ до конца месяца в формате главного («2026-09», не JSON): карточка уходит.
    const answered = await renderScreen(Statements, '/week', undefined, [screenMixin({}, (s) => (s.answerRest as (go: boolean) => void)(false))])
    expect(storage.get(MONTH_END_KEY)).toBe('2026-09')
    expect(answered).not.toContain('Остались деньги с')
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги с')
    // Запись «Недели» до критика (JSON) тоже читается как ответ; прошлый месяц — не ответ.
    storage.set(MONTH_END_KEY, '"2026-09"')
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги с')
    storage.set(MONTH_END_KEY, '2026-08')
    expect(await renderScreen(Statements, '/week')).toContain('Остались деньги с')
  })

  it('B2C-49: одна очередь Р-43 — подписка → «Пришла зарплата?» → «Остались деньги?»; на экране одно решение и одна брендовая кнопка', async () => {
    // День зарплаты 1-го: 29 сентября спрашиваются подписка, «Пришла?» октября и «Остались деньги?» сентября.
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000, payday: 1 }
    finance.householdDoc.obligations = [{ ...netflix }] // копия: «оставить» ниже пишет keptAt в объект
    const queue = () => decisionQueue({ ...finance.householdDoc, credits: finance.credits }, { me: 'a' })
    expect(queue().map((d) => d.kind)).toEqual(['keep', 'salary', 'monthEnd'])

    let raw = await renderScreen(Statements, '/week')
    expect(text(raw)).toContain('Оставить подписку Netflix?')
    expect(text(raw)).not.toContain('Пришла зарплата Алихан?')
    expect(text(raw)).not.toContain('Остались деньги с')
    expect(text(raw)).toContain('1 из 3')
    // Своей выписки нет — «Загрузить выписку» тихая; главная — «Оставить».
    expect(text(raw)).toContain('Загрузить выписку')
    expect(brand(raw)).toEqual(['Оставить'])
    expect(raw.match(/<h2 class="type-h2 text-ink">/g)).toHaveLength(1)

    // Ответили «оставить» — «Пришла?»: тексты `salaryCard` (DecisionCard, вопрос type-h2).
    finance.keepSubscription('nf')
    raw = await renderScreen(Statements, '/week')
    const d = queue()[0]
    expect(d.kind).toBe('salary')
    expect(raw).toMatch(new RegExp(`<h2 class="type-h2 text-ink">${d.question.replace('?', '\\?')}</h2>`))
    expect(raw).toContain(d.meta)
    expect(brand(raw)).toEqual(['Пришла зарплата'])

    // Отмечена — «Остались деньги?».
    finance.markSalary('a', { period: '2026-10', amount: 500_000, accountId: null })
    raw = await renderScreen(Statements, '/week')
    expect(text(raw)).not.toContain('Пришла зарплата Алихан?')
    expect(text(raw)).toContain('Остались деньги с')
    expect(brand(raw)).toEqual(['Разложить'])
  })

  it('B2C-49: продавец месяца раньше подписки и остатка; «Освободится N ₸» — в очереди с «Распределить», сумма — как в «Деньгах»', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    useOperationsStore().ops.o1 = op('o1', '2026-09-10', -7_000, 'IP ASANOVA')
    const finance = useFinanceStore()
    finance.householdDoc.obligations = [netflix]
    let html = text(await renderScreen(Statements, '/week'))
    expect(html).toContain('IP ASANOVA — куда отнести?')
    expect(html).toContain('1 из 3')
    expect(html).not.toContain('Оставить подписку')
    expect(html).not.toContain('Остались деньги с')

    // Освободится: аренда 220 000 → 180 000 с ноября — 40 000 ₸ в месяц, «Распределить».
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    finance.householdDoc.obligations = [{ id: 'flat', name: 'Квартира', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }, { from: '2026-11', amount: 180_000 }], updatedAt: T }]
    useOperationsStore().ops = {}
    const raw = await renderScreen(Statements, '/week')
    html = text(raw)
    expect(html).toContain(`Освободится ${m(40_000)} в месяц`)
    expect(html).toContain('Квартира · с ноября')
    expect(brand(raw)).toEqual(['Распределить'])
  })

  it('«Остались деньги?»: остаток месяца уже разложил партнёр (раскладка rest в общем документе) — не спрашиваем', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.allocations = [restOf('2026-08')]
    expect(await renderScreen(Statements, '/week')).toContain('Остались деньги с')
    finance.householdDoc.allocations = [restOf('2026-08'), restOf('2026-09')]
    expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги с')
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
    // Прошлая неделя — даты, чьи выписки (g2 «обе выписки»; здесь — только Алихана), сумма.
    expect(html).toContain(`14–20 сентября без выписки Дана ${m(80_000)}`)
    expect(html).toContain('Отмечено по выписке: 1')
  })

  it('итог недели по макету g2: все разделы и «Не разобрано» — сумма недели обоих без «N продавцов» (разбор — в очереди); загрузки нет без «+»', async () => {
    signIn()
    const finance = useFinanceStore()
    const t = (categoryId: string, amount: number) => ({ id: `a:week:2026-W39:${categoryId}`, by: 'a' as const, kind: 'week' as const, period: '2026-W39', categoryId, amount, ops: 1, updatedAt: '' })
    finance.householdDoc.spendTotals = [t('sc_food', 30_000), t('sc_cafe', 9_000), t('sc_transport', 8_000), t('sc_health', 7_000), t('sc_home', 6_000), t('sc_shopping', 5_000), t('_unknown', 4_000)]
    const store = useOperationsStore()
    store.ops['u-1'] = op('u-1', '2026-09-22', -2_500, 'IP SERIKOV')
    store.ops['u-2'] = op('u-2', '2026-09-23', -1_500, 'IP ASANOVA')
    await store.loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-24', ops_count: 30, created_at: '' },
    ]))
    const raw = await renderScreen(Statements, '/week')
    const html = text(raw)
    // Шесть разделов — все строками (на главном — первые четыре).
    for (const name of ['Продукты', 'Кафе и рестораны', 'Транспорт', 'Здоровье и аптеки', 'Дом и быт', 'Одежда и покупки']) expect(html).toContain(name)
    expect(html).toContain(`Не разобрано ${m(4_000)}`)
    expect(html).not.toContain('продавца')
    expect(html).not.toContain('ещё ')
    expect(html).not.toContain('Подробнее: по разделам')
    expect(html).not.toContain('Загрузить выписку')
    expect(html).not.toContain('PDF из приложения')
    // Из «+» (`?upload=1`) — карточка загрузки есть и при своей выписке.
    expect(text(await renderScreen(Statements, '/week?upload=1'))).toContain('Загрузить выписку')
  })
})
