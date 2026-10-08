import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { parseStatement } from '@/lib/statements/parsers'
import type { Operation } from '@/lib/statements/types'
import { money } from '@/lib/money'
import { decisionQueue } from '@/lib/finance'
import { MONTH_END_KEY } from '@/lib/storage'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { Allocation, Goal, Obligation } from '@/types/finance'
import kaspi01 from '@/lib/statements/fixtures/kaspi-01.rows.json'
import Week from './Week.vue'

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

/** «Неделя» с открытым листом вопросов «! N» (Р-97). */
const asked = (state: Record<string, unknown> = {}, act?: (s: Record<string, unknown>) => void) =>
  renderScreen(Week, '/week', undefined, [screenMixin({ questionsOpen: true, ...state }, act)])

describe('views/Week.vue', () => {
  it('пусто (Р-96): одна брендовая «Загрузить» в строке загрузки, сумма — тихий «0 ₸»; ни карточки «Выписки», ни кнопки внизу, ни механики', async () => {
    signIn()
    const raw = await renderScreen(Week, '/statements')
    const html = text(raw)
    expect(brand(raw)).toEqual(['Загрузить'])
    expect(raw).toContain('data-upload="lead"')
    expect(html).toContain(`21–27 сентября ${m(0)}`)
    // Правило 12: текста механики на экране нет.
    for (const t of ['PDF из Kaspi', 'Загрузить выписку', 'Выписки', 'Картины недели пока нет', 'Разделы за', 'Прошлые недели', 'Вопросы']) expect(html).not.toContain(t)
    expect(raw).not.toContain('data-bang')
    expect(raw).not.toContain('data-week-trend')
  })

  it('B2C-15: карточка сопоставления по одному — «Похоже, это платёж по … — отметить?», три действия; viewer её не видит', async () => {
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.credits = [{ id: 'loan', name: 'Автокредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: '' }]
    const store = useOperationsStore()
    store.ops['op-1'] = { id: 'op-1', bank: 'kaspi', date: '2026-09-14', amount: -58_000, kind: 'purchase', merchant: 'Оплата Kaspi Кредита', categoryId: 'sc_credit', internal: false }
    const html = await asked()
    expect(html).toContain('Похоже, это платёж по Автокредит — отметить?')
    expect(html).toContain('14 сентября · «Оплата Kaspi Кредита»')
    for (const t of ['Да, отметить', 'Нет, это другое', 'Потом']) expect(html).toContain(t)
    // Без абзаца механики (правило 12); в листе — одна брендовая, на экране — «Загрузить» (своей выписки нет).
    expect(html).not.toContain('запомним')
    expect(brand(html)).toEqual(['Загрузить', 'Да, отметить'])
    // Лист закрыт — на экране строка «Вопросы · 1 вопрос» с «Разобрать» (Б17: действие у предмета, не «! 1» сверху).
    const closed = await renderScreen(Week, '/week')
    expect(closed).not.toContain('отметить?')
    expect(text(closed)).toContain('Вопросы 1 вопрос Разобрать')
    expect(closed).toContain('data-questions-row')

    setActivePinia(createPinia())
    signIn('viewer')
    useFinanceStore().householdDoc.credits = finance.householdDoc.credits
    useOperationsStore().ops['op-1'] = store.ops['op-1']
    expect(await asked()).not.toContain('отметить?')
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
    const html = text(await renderScreen(Week, '/statements'))
    expect(fetchSpy).not.toHaveBeenCalled()
    // Строки «демо: только на этом телефоне» на «Неделе» нет (Б17, макет) — демо говорит о себе в «Настройках».
    expect(html).not.toContain('демо: только на этом телефоне')
    // Загрузка записана локально; выписка июня-июля эту неделю не закрывает — экран зовёт загрузить свою.
    expect(store.uploads).toHaveLength(1)
    expect(store.uploads[0]).toMatchObject({ ops_count: 60 })
    expect(html).toContain('Загрузить')
  })
})

// B2C-21 «Тесты»: SSR /week — очередь решений по одному после сопоставлений и итог недели.
describe('views/Week.vue — решения по одному и итог недели', () => {
  it('B2C-61: незнакомые месяца — пачкой: «Без раздела · N», 6 строк по сумме + «Ещё K · сумма ›»; без отмеченных — чипов нет; брендовых кнопок нет', async () => {
    signIn()
    const store = useOperationsStore()
    // 8 продавцов: 8 000, 7 000 … 1 000; у TOO ROMASHKA — две операции.
    const names = ['IP ASANOVA', 'TOO ROMASHKA', 'IP KIM', 'IP OSPANOV', 'IP NURLANOVA', 'IP SEITKALI', 'IP ZHUMABAEV', 'IP AKHMETOVA']
    names.forEach((n, i) => (store.ops[`o${i}`] = op(`o${i}`, '2026-09-05', -(8 - i) * 1_000 + (i === 1 ? 3_000 : 0), n)))
    store.ops.r2 = op('r2', '2026-09-20', -3_000, 'TOO ROMASHKA')
    const raw = await asked()
    const html = text(raw)
    expect(html).toContain('Без раздела · 8')
    expect(html).toContain('Выбрать все')
    expect(html).toContain(`TOO ROMASHKA 2 раза ${m(7_000)}`)
    expect(html).toContain(`IP ASANOVA 1 раз ${m(8_000)}`)
    // Первые шесть — по сумме; два последних — в хвосте одной строкой.
    expect(html.indexOf('IP ASANOVA')).toBeLessThan(html.indexOf('TOO ROMASHKA'))
    expect(html).toContain('IP SEITKALI')
    for (const n of ['IP ZHUMABAEV', 'IP AKHMETOVA']) expect(html).not.toContain(n)
    expect(html).toContain(`Ещё 2 · ${m(3_000)} ›`)
    // Без отмеченных — «куда?» нет; «Пропустить все» больше нет, «Потом» — есть.
    for (const t of ['Выбрано', 'Продукты', 'Не помню', 'Пропустить все', 'куда отнести']) expect(html).not.toContain(t)
    expect(html).toContain('Потом')
    // Правило 12: в листе брендовой кнопки нет (ответ — чипы), рамок нет; на экране — «Загрузить».
    expect(brand(raw)).toEqual(['Загрузить'])
    expect(raw).not.toContain('border-brand')
  })

  it('«Оставить подписку?» — тексты главного (keepCard): сумма месяца, за год ×12 и доля пути до мечты', async () => {
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.obligations = [netflix]
    finance.householdDoc.goals = [japan]
    const raw = await asked()
    const html = text(raw)
    expect(html).toContain('Оставить подписку Netflix?')
    expect(html).toContain(`${m(4_990)} · каждый месяц`)
    expect(html).toContain(`За год — ${m(59_880)} · это 9 % пути до Япония`)
    for (const t of ['Оставить', 'Отписаться', 'Подумать']) expect(html).toContain(t)
    // В листе — одна брендовая «Оставить».
    expect(brand(raw)).toEqual(['Загрузить', 'Оставить'])

    // «Отписаться» — предупреждение главного: отключить в самом сервисе нужно отдельно (Н-4).
    const cancel = text(await asked({ cancelling: true }))
    expect(cancel).toContain('Подписка уйдёт из бюджета и планов у вас обоих. Отключить её в самом сервисе нужно отдельно.')
    expect(cancel).toContain('Отменить подписку')
    expect(cancel).not.toContain('За год —')
  })

  it('«Оставить?» у годовой: цена продления из новой версии, а не текущая — как на главном', async () => {
    vi.setSystemTime(new Date('2026-09-25T07:00:00Z')) // до продления 5 октября — 10 дней
    signIn()
    useFinanceStore().householdDoc.obligations = [ivi]
    const html = text(await asked())
    expect(html).toContain('Оставить подписку Иви?')
    expect(html).toContain(`${m(12_000)} · в год · продлится 5 октября`)
    expect(html).toContain(`За год — ${m(12_000)}`)
    expect(html).not.toContain(m(10_000))
  })

  it('«Остались деньги с сентября?» в последние дни месяца — тексты главного (Н-4), одна главная кнопка; ответ — сырым ключом месяца', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const raw = await asked()
    const html = text(raw)
    expect(html).toContain('Остались деньги с')
    expect(html).toContain('Остались деньги с сентября?')
    expect(html).toContain('Месяц заканчивается — отложим остаток по очереди целей')
    expect(html).toContain('Не сейчас')
    expect(brand(raw)).toEqual(['Загрузить', 'Отложить'])

    // «Не сейчас» — ответ до конца месяца в формате главного («2026-09», не JSON): карточка уходит.
    const answered = await asked({}, (s) => (s.answerRest as (go: boolean) => void)(false))
    expect(storage.get(MONTH_END_KEY)).toBe('2026-09')
    expect(answered).not.toContain('Остались деньги с')
    expect(await asked()).not.toContain('Остались деньги с')
    // Запись «Недели» до критика (JSON) тоже читается как ответ; прошлый месяц — не ответ.
    storage.set(MONTH_END_KEY, '"2026-09"')
    expect(await asked()).not.toContain('Остались деньги с')
    storage.set(MONTH_END_KEY, '2026-08')
    expect(await asked()).toContain('Остались деньги с')
  })

  it('Р-97: вопросы «Недели» — подписка → «Остались деньги?»; зарплаты и «освободится» в листе нет — это дела «Месяца»', async () => {
    // День зарплаты 1-го: 29 сентября раньше спрашивалось и «Пришла?» октября — теперь это строка зарплаты «Месяца».
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000, payday: 1 }
    // Аренда уменьшится с ноября — «освободится 40 000 ₸» живёт у своего платежа в «Месяце».
    const flat: Obligation = { id: 'flat', name: 'Квартира', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }, { from: '2026-11', amount: 180_000 }], updatedAt: T }
    finance.householdDoc.obligations = [{ ...netflix }, flat] // копия: «оставить» ниже пишет keptAt в объект
    const queue = () => decisionQueue({ ...finance.householdDoc, credits: finance.credits }, {})
    expect(queue().map((d) => d.kind)).toEqual(['keep', 'monthEnd'])

    let raw = await asked()
    expect(text(raw)).toContain('Оставить подписку Netflix?')
    expect(text(raw)).toContain('1 из 2')
    for (const t of ['Пришла зарплата', 'Освободится', 'К плану месяца', 'Остались деньги с']) expect(text(raw)).not.toContain(t)
    expect(brand(raw)).toEqual(['Загрузить', 'Оставить'])
    expect(raw.match(/<h2 class="type-h2 text-ink">/g)).toHaveLength(1)

    // Ответили «оставить» — «Остались деньги?».
    finance.keepSubscription('nf')
    raw = await asked()
    expect(text(raw)).toContain('Остались деньги с')
    expect(text(raw)).not.toContain('Пришла зарплата')
    expect(brand(raw)).toEqual(['Загрузить', 'Отложить'])
  })

  it('B2C-49: продавец раньше подписки и остатка; незнакомые — по своим операциям этого и прошлого месяца', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const store = useOperationsStore()
    store.ops.o1 = op('o1', '2026-09-10', -7_000, 'IP ASANOVA')
    store.ops.o2 = op('o2', '2026-08-28', -3_000, 'IP KIM')
    store.ops.o3 = op('o3', '2026-07-30', -9_000, 'IP OSPANOV')
    useFinanceStore().householdDoc.obligations = [netflix]
    const html = text(await asked())
    expect(html).toContain('Без раздела · 2')
    expect(html).toContain('IP ASANOVA')
    expect(html).toContain('IP KIM')
    expect(html).not.toContain('IP OSPANOV')
    expect(html).toContain('1 из 3')
    expect(html).not.toContain('Оставить подписку')
    expect(html).not.toContain('Остались деньги с')
  })

  it('«Остались деньги?»: остаток месяца уже разложил партнёр (раскладка rest в общем документе) — не спрашиваем', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    signIn()
    const finance = useFinanceStore()
    finance.householdDoc.allocations = [restOf('2026-08')]
    expect(await asked()).toContain('Остались деньги с')
    finance.householdDoc.allocations = [restOf('2026-08'), restOf('2026-09')]
    expect(await asked()).not.toContain('Остались деньги с')
  })

})

