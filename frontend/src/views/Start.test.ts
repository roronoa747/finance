import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { PdfRow } from '@/lib/statements/pdf'
import { parseStatement } from '@/lib/statements/parsers'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import { applyRules, periodOf, spendTotals, unknownGroups } from '@/lib/statements/model'
import { beyondLimit } from '@/lib/statements/firstRun'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import { budgetAmounts, freeByFact, paidFor } from '@/lib/finance'
import { useOperationsStore } from '@/stores/operations'
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

/** Строка выписки; раздел — по словарю, как после разбора. */
const op = (id: string, date: string, amount: number, merchant: string, kind: Operation['kind'] = 'purchase'): Operation => ({
  id, bank: 'kaspi', date, amount, kind, merchant, categoryId: null, internal: false,
})
const parsed = (list: Operation[]) => applyRules(list, [])
/** Тексты брендовых кнопок (`variant` default) — правило 12: одна главная на экране. */
const brandButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*class="(?:[^"]*\s)?bg-brand\s[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())

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
    // Одна строка, подробности — в подсказке (правило интерфейса, критик Блока 3).
    expect(html).toContain('Файл остаётся на телефоне')
    expect(html).toContain('aria-label="Пояснение"')
    expect(html).not.toContain('никуда не уходит')
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

  it('повторы за лимитом: обещания «позже, в «Неделе»» нет — спросить о них потом негде (хвост §4)', async () => {
    family()
    const ops = [...kaspiOps(), ...parsed([op('f1', '2025-06-28', -15_000, 'Фитнес Клуб'), op('f2', '2025-07-28', -15_000, 'Фитнес Клуб')])]
    expect(beyondLimit(ops)).toBeGreaterThan(0)
    seedOps(ops)
    const html = await renderScreen(Start, '/start/questions')
    expect(html).toContain('Нашли 7 повторяющихся')
    expect(html).not.toContain('Ещё ')
    expect(html).not.toContain('в «Неделе»')
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
    // Возврат приёмки п. 4: ставку выписка не знает — одна строка в карточке, у кредита признак «неизвестна».
    expect(q2).toContain('Ставку уточните потом в Капитале.')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring', { creditPrincipal: '1 200 000' })])
    expect(store.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, annualRate: 0, rateUnknown: true, payment: 151_790, day: 24 })])
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

    // «Потом» — остальные закрыты без записи; всё отвечено — «Дальше».
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
    // Подпись — одна строка (правило 12).
    expect(form).toContain('В выписке зарплата не нашлась — впишите её.')
    expect(form).not.toContain('план месяца не сложится')
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
    expect(invite).toContain('Мечты и покупки — одни на двоих.')
    expect(invite).not.toContain('Бюджет общий')
    expect(invite).toContain('5 из 5')
    expect(invite).toContain('Создать код')
    expect(invite).toContain('Позже')
    expect(invite).toContain('Один человек — тоже семья.')
    // Одна брендовая кнопка: до кода — «Создать код» («Позже» тихая), с кодом — «Готово».
    expect(brandButtons(invite)).toEqual(['Создать код'])
    const withCode = await renderScreen(Start, '/start/invite', undefined, [screenMixin({ inviteCode: 'K7Q2M9' })])
    expect(withCode).toContain('Готово')
    expect(brandButtons(withCode)).toEqual(['Готово'])
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

  it('отметки месяца — суммой, id и днём операции этого месяца: зарплата с премией (оклад остаётся окладом), кредит с введённым остатком 1 200 000 — остаток не уменьшается второй раз', async () => {
    const store = family()
    seedOps(
      parsed([
        op('s8', '2026-08-10', 450_000, 'Зарплата ТОО Ромашка', 'income'),
        op('s9', '2026-09-10', 490_000, 'Зарплата ТОО Ромашка', 'income'),
        op('c8', '2026-08-05', -151_790, 'Оплата Kaspi Кредита'),
        // Сегодняшняя строка (полдень по Алматы — это «сейчас»): и она встаёт до сверки остатка.
        op('c9', '2026-09-24', -152_000, 'Оплата Kaspi Кредита'),
      ]),
    )
    await renderScreen(Start, '/start/questions', undefined, [act('answerIncome', { incomeSalary: '450 000' })])
    expect(store.people[0]).toMatchObject({ salary: 450_000, payday: 10 })
    // Пришло 490 000 (премия в допуске оклада ±10 %) — запись суммой операции: разница ляжет на свободное.
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')).toMatchObject({ amount: 490_000, opId: 's9', source: 'statement', at: '2026-09-10T07:00:00.000Z' })

    expect(await renderScreen(Start, '/start/questions')).toContain('Оплата Kaspi Кредита — это что?')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring', { creditPrincipal: '1 200 000' })])
    const credit = store.credits[0]
    expect(store.householdDoc.credits[0]).toMatchObject({ principal: 1_200_000, payment: 151_790, day: 5 })
    // Остаток «если знаете» — уже после сентябрьского платежа: отметка днём операции стоит до сверки.
    expect(credit.principal).toBe(1_200_000)
    const paid = paidFor(store.payments, 'credit', credit.id, '2026-09')!
    expect(paid).toMatchObject({ amount: 152_000, opId: 'c9', source: 'statement' })
    expect(paid.at < store.householdDoc.credits[0].principalSetAt!).toBe(true)
  })

  it('возврат приёмки п. 7: зарплату месяца отмечает только приход в допуске оклада — мелкий перевод того же отправителя месяц не отмечает', async () => {
    const store = family()
    // Оклад 30 000 (июль и август), а в сентябре от того же отправителя пришли только 4 700.
    seedOps(
      parsed([
        op('j', '2026-07-12', 30_000, 'Зарплата ТОО Ромашка', 'income'),
        op('a', '2026-08-12', 30_000, 'Зарплата ТОО Ромашка', 'income'),
        op('s', '2026-09-03', 4_700, 'Зарплата ТОО Ромашка', 'income'),
      ]),
    )
    await renderScreen(Start, '/start/questions', undefined, [act('answerIncome', { incomeSalary: '30 000' })])
    expect(store.people[0]).toMatchObject({ salary: 30_000, payday: 12 })
    // Правило зарплаты есть (приход регулярный), а отметки сентября — нет: 4 700 — не зарплата.
    expect(store.merchantRules.map((r) => r.to)).toEqual([{ payment: { kind: 'salary', targetId: 'a' } }])
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')).toBeNull()
  })

  it('«Записать → Аренда»: операции — в «Аренде», а не «не разобрано»; «Свободно по факту» вычитает аренду один раз; «Неделя» не спрашивает; правило платежа на месте', async () => {
    const rent = parsed([op('r8', '2026-08-05', -220_000, 'PEREVOD ARENDA', 'transfer-out'), op('r9', '2026-09-05', -220_000, 'PEREVOD ARENDA', 'transfer-out')])
    // Аренду по названию не узнать — после отправки она «не разобрано».
    expect(rent.map((o) => o.categoryId)).toEqual([null, null])
    const store = family('member', 'a', {
      ...defaultSyncDoc(),
      people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }],
      spendTotals: spendTotals(rent, 'a', 'month', '2026-09', T0),
    })
    seedOps(rent)
    expect(await renderScreen(Start, '/start/questions')).toContain('PEREVOD ARENDA — это что?')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring', { recurringKind: 'rent' })])

    const rentOb = store.obligations[0]
    expect(rentOb).toMatchObject({ name: 'Аренда', category: 'd1', note: 'PEREVOD ARENDA' })
    expect(store.merchantRules).toHaveLength(1)
    expect(store.merchantRules[0].to).toEqual({ payment: { kind: 'obligation', targetId: rentOb.id, categoryId: 'sc_rent' } })
    const all = useOperationsStore().all
    expect(all.map((o) => o.categoryId)).toEqual(['sc_rent', 'sc_rent'])
    expect(unknownGroups(all.filter((o) => periodOf(o.date, 'month') === '2026-09'))).toEqual([])
    expect(paidFor(store.payments, 'obligation', rentOb.id, '2026-09')).toMatchObject({ amount: 220_000, opId: 'r9', at: '2026-09-05T07:00:00.000Z' })

    const uploads = [{ slot: 'a', period_from: '2026-08-01', period_to: '2026-09-23' }]
    const doc = store.householdDoc
    const free = freeByFact({ ...doc, credits: store.credits }, doc.spendTotals ?? [], doc.spendCategories ?? [], '2026-09', uploads)
    expect(free).toMatchObject({ byFact: true, dues: 220_000, spent: 0, amount: 600_000 - 220_000 })
    expect(useOperationsStore().pendingMatches).toEqual([])
  })

  it('возврат приёмки 2 п. 2: «Записать» на «Перевод с карты на карту» (переводы разных сумм) — месяц отмечен строкой в допуске, плановый раздел только ей; «Свободно» не прыгает на сумму переводов', async () => {
    // Freedom печатает все переводы без получателя одним названием; повтор — 15 000 около 19–20-го.
    const transfer = (id: string, date: string, amount: number) => op(id, date, amount, 'Перевод с карты на карту', 'transfer-out')
    const list = parsed([
      transfer('t7', '2026-07-20', -15_000), transfer('a1', '2026-08-19', -40_000), transfer('a2', '2026-08-20', -15_000),
      transfer('s1', '2026-09-03', -2_000), transfer('s2', '2026-09-12', -280_000), transfer('s3', '2026-09-20', -15_200),
    ])
    const store = family('member', 'a', {
      ...defaultSyncDoc(),
      people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }],
      spendTotals: spendTotals(list, 'a', 'month', '2026-09', T0),
    })
    seedOps(list)
    const uploads = [{ slot: 'a', period_from: '2026-07-01', period_to: '2026-09-23' }]
    const free = () => freeByFact({ ...store.householdDoc, credits: store.credits }, store.householdDoc.spendTotals ?? [], store.householdDoc.spendCategories ?? [], '2026-09', uploads)
    const before = free()
    expect(before).toMatchObject({ byFact: true, dues: 0, spent: 297_200, amount: 302_800 })

    const html = await renderScreen(Start, '/start/questions')
    expect(html).toContain('Перевод с карты на карту — это что?')
    expect(html).toContain(`${money(15_000)} · примерно 19-го · 6 раз за период`)
    // «Записать» с выбранным «Другое регулярное» (главная кнопка карточки).
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring')])
    const ob = store.obligations[0]
    expect(ob).toMatchObject({ name: 'Перевод с карты на карту', category: 'd4' })
    // Сентябрь отмечен строкой 15 200 (±2 %), а не первой строкой месяца 2 000.
    expect(paidFor(store.payments, 'obligation', ob.id, '2026-09')).toMatchObject({ amount: 15_200, opId: 's3' })
    // Плановый раздел — только строкам в допуске; 2 000, 280 000 и 40 000 — по-прежнему траты.
    expect(Object.fromEntries(useOperationsStore().all.map((o) => [o.id, o.categoryId]))).toEqual({
      t7: 'sc_subscriptions', a1: null, a2: 'sc_subscriptions', s1: null, s2: null, s3: 'sc_subscriptions',
    })
    // «Свободно»: 15 200 было тратой — стало платежом месяца; траты 2 000 и 280 000 остались. Сумма та же.
    expect(free()).toMatchObject({ dues: 15_200, spent: 282_000, amount: before.amount })
  })

  it('партнёр по коду: повторы, которые сопоставляются с арендой и кредитом семьи, не спрашиваются — «Записать» не заведёт второе такое же', async () => {
    const base = planFamilyDoc()
    const store = family('member', 'b', { ...base, people: [base.people[0]] })
    seedOps(
      parsed([
        op('r8', '2026-08-05', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
        op('r9', '2026-09-05', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
        op('l9', '2026-09-15', -58_000, 'Оплата Kaspi Кредита'),
        op('y9', '2026-09-03', -3_990, 'Яндекс Плюс'),
      ]),
      'u-b',
    )
    const html = await renderScreen(Start, '/start/questions')
    expect(html).toContain('Нашли 1 повторяющийся')
    expect(html).toContain('Яндекс Плюс — это что?')
    expect(html).toContain('1 из 1')
    expect(html).not.toContain('PEREVOD ARENDA')
    expect(html).not.toContain('Оплата Kaspi Кредита')
    await renderScreen(Start, '/start/questions', undefined, [act('answerRecurring')])
    expect(store.obligations.map((o) => o.name)).toEqual(['Аренда', 'Яндекс Плюс'])
    expect(store.householdDoc.credits.map((c) => c.name)).toEqual(['Кредит', 'Кредитка', 'Рассрочка'])
  })
})
