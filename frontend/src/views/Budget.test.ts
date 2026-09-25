import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import {
  amountAt,
  budgetAmounts,
  budgetInterest,
  dueIn,
  liveCredits,
  liveObligations,
  nextSalaryChange,
  salaryAt,
} from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { money, plain } from '@/lib/money'
import Budget from './Budget.vue'
import { planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import SalaryDialog from '@/components/SalaryDialog.vue'
import Input from '@/components/ui/Input.vue'

describe('views/Budget.vue — План, Календарь, Список и оклады', () => {
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    setActivePinia(createPinia())
  })

  it('корректно формирует и сортирует события календаря по дням', () => {
    const store = useFinanceStore()
    const key = monthKey()

    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Динара', salary: 400_000, payday: 20, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: 'ежемесячно',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 200_000 }],
        updatedAt: '',
      },
      {
        id: 'ob-yearly',
        name: 'Страховка',
        note: 'раз в год',
        day: 15,
        category: 'd1',
        every: 'year',
        month: 1, // если сейчас не январь, dueIn вернет false
        versions: [{ from: '2026-01', amount: 120_000 }],
        updatedAt: '',
      },
    ]
    store.householdDoc.credits = [
      {
        id: 'cr-car',
        name: 'Автокредит',
        note: '',
        principal: 3_000_000,
        annualRate: 0.18,
        payment: 75_000,
        day: 12,
        updatedAt: '',
      },
    ]

    const amounts = budgetAmounts(store.householdDoc)

    // Формируем события как в Budget.vue
    const obligations = liveObligations(store.obligations)
    const credits = liveCredits(store.credits)
    const people = store.people

    const events = [
      ...people.map((p) => ({
        id: `pay-${p.id}`,
        day: p.payday,
        name: `Зарплата · ${p.name}`,
        value: salaryAt(p, key),
        income: true,
      })),
      ...obligations.filter((o) => dueIn(o, key)).map((o) => ({
        id: o.id,
        day: o.day,
        name: o.name,
        value: amountAt(o, key),
        income: false,
      })),
      ...credits.map((c) => ({
        id: c.id,
        day: c.day,
        name: c.name,
        value: c.payment,
        income: false,
      })),
      {
        id: 'goals',
        day: 1,
        name: 'Взносы в цели',
        value: amounts.d3,
        income: false,
      },
    ].sort((a, b) => a.day - b.day)

    // Первым должно идти событие целей (день 1)
    expect(events[0].id).toBe('goals')
    expect(events[0].day).toBe(1)

    // Вторым — аренда (день 5)
    expect(events[1].id).toBe('ob-rent')
    expect(events[1].day).toBe(5)
    expect(events[1].value).toBe(200_000)

    // Третьим — зарплата Ильяса (день 10)
    expect(events[2].id).toBe('pay-a')
    expect(events[2].day).toBe(10)
    expect(events[2].income).toBe(true)

    // Четвертым — автокредит (день 12)
    expect(events[3].id).toBe('cr-car')
    expect(events[3].day).toBe(12)

    // Пятым — зарплата Динары (день 20)
    expect(events[4].id).toBe('pay-b')
    expect(events[4].day).toBe(20)

    // Фильтрация по выбранному дню
    const day5Events = events.filter((e) => e.day === 5)
    expect(day5Events).toHaveLength(1)
    expect(day5Events[0].name).toBe('Аренда квартиры')
  })

  it('изменение лимита категории d4 реактивно пересчитывает свободный остаток d5', () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 500_000, payday: 10, updatedAt: '' },
    ]
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 150_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 150_000, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-1',
        name: 'Квартира',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 150_000 }],
        updatedAt: '',
      },
    ]

    const before = budgetAmounts(store.householdDoc)
    expect(before.d4).toBe(100_000)
    expect(before.d5).toBe(250_000) // 500k - 150k (housing) - 100k (d4) = 250k

    // Изменяем d4 через метод хранилища
    store.setCategoryAmount('d4', 180_000)

    const after = budgetAmounts(store.householdDoc)
    expect(after.d4).toBe(180_000)
    expect(after.d5).toBe(170_000) // 500k - 150k (housing) - 180k (d4) = 170k
  })

  it('методы управления окладом correctSalary и amendSalary обновляют данные и вычисляют nextSalaryChange', () => {
    const store = useFinanceStore()
    const key = monthKey()

    store.householdDoc.people = [
      {
        id: 'a',
        name: 'Ильяс',
        salary: 500_000,
        salaryVersions: [{ from: '2026-01', amount: 500_000 }],
        payday: 10,
        updatedAt: '',
      },
    ]

    const person = store.people[0]
    expect(salaryAt(person, key)).toBe(500_000)
    expect(nextSalaryChange(person, key)).toBeNull()

    // Исправление оклада сейчас
    store.correctSalary('a', 550_000)
    expect(salaryAt(store.people[0], key)).toBe(550_000)

    // Запланированное повышение в будущем (2028-01)
    store.amendSalary('a', '2028-01', 700_000, 'Повышение в должности')
    const updated = store.people[0]
    const change = nextSalaryChange(updated, key)

    expect(change).not.toBeNull()
    expect(change?.from).toBe('2028-01')
    expect(change?.amount).toBe(700_000)
    expect(change?.delta).toBe(150_000)
    expect(change?.reason).toBe('Повышение в должности')
  })

  it('компонентный рендер Budget.vue отображает основные секции и элементы', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Динара', salary: 400_000, payday: 20, updatedAt: '' },
    ]
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 250_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 400_000, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда жилья',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 200_000 }],
        updatedAt: '',
      },
    ]

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Budget)
    app.use(router)

    const html = await renderToString(app)

    // Проверяем элементы Segmented
    expect(html).toContain('План')
    expect(html).toContain('Календарь')
    expect(html).toContain('Список')

    // Проверяем дефолтный режим 'План'
    expect(html).toContain('Доход семьи · оклады без бонусов')
    expect(html).toContain(money(1_000_000)) // 600k + 400k
    expect(html).toContain('Ильяс')
    expect(html).toContain('Динара')
    expect(html).toContain('Куда уходит')
    expect(html).toContain('Жильё')
    expect(html).toContain('Еда и быт')
    expect(html).toContain('Свободно')
    expect(html).toContain('Откуда эти суммы')

    // Проверяем рендер в режиме 'Календарь'
    const appCalendar = createSSRApp(Budget, { initialView: 'calendar' })
    appCalendar.use(router)
    const htmlCalendar = await renderToString(appCalendar)
    expect(htmlCalendar).toContain('Отложено')
    expect(htmlCalendar).toContain('На обязательства')
    expect(htmlCalendar).toContain('Пн')
    expect(htmlCalendar).toContain('Вс')
    expect(htmlCalendar).toContain('Нагрузка на доход')
    expect(htmlCalendar).toContain('Кредиты')
    expect(htmlCalendar).toContain('Вместе с жильём')

    // Проверяем рендер в режиме 'Список'
    const appList = createSSRApp(Budget, { initialView: 'list' })
    appList.use(router)
    const htmlList = await renderToString(appList)
    expect(htmlList).toContain('Аренда жилья')
    expect(htmlList).toContain('Зарплата · Ильяс')
    expect(htmlList).toContain('Зарплата · Динара')
    expect(htmlList).toContain('Взносы в цели')
  })

  it('компонентный рендер SalaryDialog.vue отображает имя, текущий оклад и элементы управления', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      {
        id: 'a',
        name: 'Ильяс',
        salary: 650_000,
        payday: 10,
        salaryVersions: [{ from: '2026-01', amount: 650_000 }],
        updatedAt: '',
      },
    ]

    const app = createSSRApp(SalaryDialog, { id: 'a' })
    const html = await renderToString(app)

    expect(html).toContain('Ильяс')
    expect(html).toContain(plain(650_000))
    expect(html).toContain('10')
    expect(html).toContain('Запланировать изменение')
    expect(html).toContain('Оклад сейчас, ₸')
    expect(html).toContain('День зарплаты')
  })

  it('Input.vue корректно отображает defaultValue при отсутствии modelValue', async () => {
    const appDefault = createSSRApp(Input, { defaultValue: 'Ильяс' })
    const htmlDefault = await renderToString(appDefault)
    expect(htmlDefault).toContain('value="Ильяс"')

    const appModel = createSSRApp(Input, { modelValue: 'Динара', defaultValue: 'Ильяс' })
    const htmlModel = await renderToString(appModel)
    expect(htmlModel).toContain('value="Динара"')
  })
})

describe('PV-01 — закрытый кредит вне бюджета', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    // Таймеры подделаны: запланированный синк не уходит в сеть.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function render(view: 'plan' | 'calendar') {
    const app = createSSRApp(Budget, { initialView: view })
    app.use(createAppRouter(createMemoryHistory()))
    return renderToString(app)
  }

  it('кредит закрыт досрочкой на всю сумму → «Свободно» выросло ровно на его платёж, «Кредиты» без него', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 1_000_000, payday: 10, updatedAt: '' }]
    store.householdDoc.categories = [{ key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' }]
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 2_000_000, updatedAt: '' }]
    store.householdDoc.credits = [
      { id: 'cr-a', name: 'Рассрочка', note: '', principal: 300_000, annualRate: 0.24, payment: 60_000, day: 12, updatedAt: '' },
      { id: 'cr-b', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: '' },
    ]

    // До закрытия: 1 000 000 − 151 680 − 200 000.
    const before = budgetAmounts({ ...store.householdDoc, credits: store.credits })
    expect(before).toMatchObject({ d2: 151_680, d5: 648_320 })
    expect(await render('plan')).toContain(money(648_320))
    expect(await render('calendar')).toContain(money(151_680))

    store.applyPrepayment('cr-a', 'a', { amount: store.credits[0].principal, mode: 'term', accountId: 'card' })
    expect(store.credits[0].principal).toBe(0)

    const after = budgetAmounts({ ...store.householdDoc, credits: store.credits })
    expect(after.d2).toBe(91_680)
    expect(after.d5 - before.d5).toBe(60_000)
    const plan = await render('plan')
    expect(plan).toContain(money(708_320))
    expect(plan).not.toContain(money(648_320))
    const calendar = await render('calendar')
    expect(calendar).toContain(money(91_680))
    expect(calendar).not.toContain(money(151_680))
    // Сырой документ закрытость не видит — поэтому экраны передают производные кредиты.
    expect(budgetAmounts(store.householdDoc).d2).toBe(151_680)
  })

  it('PV-13: под «Кредитами» — «из них проценты банку N ₸ в месяц» = budgetInterest; закрытый кредит выпадает', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 1_000_000, payday: 10, updatedAt: '' }]
    store.householdDoc.categories = (['d1', 'd2', 'd3', 'd4', 'd5'] as const).map((key) => ({
      key, name: key === 'd2' ? 'Кредиты' : key, note: '', amount: 0, updatedAt: '',
    }))
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 2_000_000, updatedAt: '' }]
    store.householdDoc.credits = [
      { id: 'cr-a', name: 'Рассрочка', note: '', principal: 300_000, annualRate: 0.24, payment: 60_000, day: 12, updatedAt: '' },
      { id: 'cr-b', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: '' },
    ]
    // 300 000 × 0,24 / 12 = 6 000; 1 000 000 × 0,18 / 12 = 15 000.
    expect(budgetInterest(store.credits)).toBe(21_000)
    expect(await render('plan')).toContain(`из них проценты банку ${money(21_000)} в месяц`)

    store.applyPrepayment('cr-a', 'a', { amount: 300_000, mode: 'term', accountId: 'card' })
    const plan = await render('plan')
    expect(plan).toContain(`из них проценты банку ${money(15_000)} в месяц`)
    expect(plan).not.toContain(money(21_000))
  })
})

describe('PV-15: «Досрочно по плану» и разделы по ключам (SSR)', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  /** Строка «Куда уходит»: сумма в ячейке значения (подпись «из них проценты» — не она). */
  const lineAmount = (html: string, name: string) => {
    const at = html.indexOf(`>${name}</div>`)
    if (at < 0) return null
    const m = html.slice(at).match(/font-semibold num text-ink\">(\d[\d\s\u00a0\u202f]*?)[\s\u00a0\u202f]*₸/)
    return m ? Number(m[1].replace(/\D/g, '')) : null
  }

  it('с планом — «Досрочно по плану» = Σ взносов пауз, «Цели» без них, «Свободно» как без плана', async () => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const before = await renderScreen(Budget, '/budget')
    const free = budgetAmounts({ ...store.householdDoc, credits: store.credits }).d5
    expect(lineAmount(before, 'Цели')).toBe(130_000)
    expect(before).not.toContain('Досрочно по плану')

    store.setHouseholdDoc(planFamilyDoc({ plans: [planOf()] }), 2)
    const html = await renderScreen(Budget, '/budget')
    expect(lineAmount(html, 'Досрочно по плану')).toBe(40_000 + 60_000)
    expect(lineAmount(html, 'Цели')).toBe(30_000)
    expect(html).toContain('взносы целей на паузе и платежи закрытых долгов — по шагу плана')
    expect(lineAmount(html, 'Свободно')).toBe(free)
    // Строка плана — сразу после целей, цвет раздела кредитов.
    expect(html.indexOf('>Досрочно по плану<')).toBeGreaterThan(html.indexOf('>Цели<'))
    expect(html.slice(html.indexOf('>Цели<'), html.indexOf('>Досрочно по плану<'))).toContain('background:var(--d2)')
  })

  it('Н-1: «Список» и «Календарь» — событие плана той же суммой, Σ расходов как без плана', async () => {
    // Расходы списка: «−N» у каждого события (платежи месяца, цели, план).
    const spent = (html: string) =>
      [...html.matchAll(/−([\d\s\u00a0\u202f]+)</g)].reduce((a, m) => a + Number(m[1].replace(/\D/g, '')), 0)
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const without = await renderScreen(Budget, '/budget', { initialView: 'list' })
    store.setHouseholdDoc(planFamilyDoc({ plans: [planOf()] }), 2)
    const list = await renderScreen(Budget, '/budget', { initialView: 'list' })
    const row = (html: string, name: string) => html.slice(html.indexOf(`>${name}<`), html.indexOf(`>${name}<`) + 400)
    expect(row(list, 'Досрочно по плану')).toContain(`−${plain(100_000)}`)
    expect(row(list, 'Взносы в цели')).toContain(`−${plain(30_000)}`)
    expect(spent(list)).toBe(spent(without))
    expect(spent(list)).toBe(130_000 + 220_000 + 58_000 + 25_000 + 20_000)
    // Календарь берёт точки и строки дня из тех же событий: 1-е число — цели и план.
    const cal = await renderScreen(Budget, '/budget', { initialView: 'calendar' }, [screenMixin({ selected: 1 })])
    expect(row(cal, 'Досрочно по плану')).toContain(`−${plain(100_000)}`)
  })

  it('Н-4: пока план набирает подушку — строка «По плану — в подушку», сумма и «Свободно» те же', async () => {
    const store = useFinanceStore()
    const thin = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 150_000, seed: 150_000 } : g))
    store.setHouseholdDoc(planFamilyDoc({ goals: thin, plans: [planOf()] }), 1)
    const html = await renderScreen(Budget, '/budget')
    expect(lineAmount(html, 'По плану — в подушку')).toBe(100_000)
    expect(html).not.toContain('Досрочно по плану')
    expect(html).toContain('взносы целей на паузе — в подушку, пока в ней меньше месяца списаний')
    expect(lineAmount(html, 'Свободно')).toBe(budgetAmounts({ ...store.householdDoc, credits: store.credits }).d5)
  })

  it('п. 7: раздела d1 нет, аренда в d1 — строка «Жильё» с её суммой, Σ строк + «Свободно» = доход; без аренды строки нет', async () => {
    const store = useFinanceStore()
    const categories = planFamilyDoc().categories.filter((c) => c.key === 'd4')
    store.setHouseholdDoc(planFamilyDoc({ categories }), 1)
    const html = await renderScreen(Budget, '/budget')
    expect(lineAmount(html, 'Жильё')).toBe(220_000)
    const names = ['Жильё', 'Кредиты', 'Цели', 'Еда и быт']
    const shown = names.map((n) => lineAmount(html, n))
    expect(shown.every((v) => v !== null)).toBe(true)
    const income = budgetAmounts({ ...store.householdDoc, credits: store.credits }).income
    // «Еда и быт» — поле ввода базы раздела; платежи в d4 сверх базы в строке не видны (так и в
    // React, хвост §4 критика Блока 3), поэтому здесь — сумма раздела из budgetAmounts.
    const d4 = budgetAmounts({ ...store.householdDoc, credits: store.credits }).d4
    expect(shown[0]! + shown[1]! + shown[2]! + d4 + lineAmount(html, 'Свободно')!).toBe(income)
    expect(store.householdDoc.categories.map((c) => c.key)).toEqual(['d4'])

    store.setHouseholdDoc(planFamilyDoc({ categories, obligations: [] }), 2)
    expect(await renderScreen(Budget, '/budget')).not.toContain('>Жильё</div>')
  })
})
