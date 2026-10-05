import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useFinanceStore } from '@/stores/finance'
import { budgetAmounts, budgetInterest, nextSalaryChange, salaryAt } from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { money, pct, plain } from '@/lib/money'
import Money from './Money.vue'
import { renderScreen } from '@/test/screenState'
import SalaryDialog from '@/components/SalaryDialog.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Перенос `views/Budget.test.ts` (пивот 3, B2C-45): экрана Бюджета нет (Р-33 — план по разделам не
 * вводится; Р-39 — календарь ушёл). Остаются расчёты, которые он показывал, — «Свободно» и «Кредиты»
 * (`budgetAmounts`: доли в виджете «Доход»), проценты банку (квадрат «План»), оклады и их окно.
 * Сняты: события календаря и строки видов «План/Календарь/Список» Бюджета — этих экранов нет.
 */
describe('«Деньги»: бюджет месяца и оклады (бывший Budget.test)', () => {
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
    expect(html).toContain('Изменить оклад')
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

  /** «Деньги» → Капитал (виджет «Доход» — доли) или квадрат «План». */
  const render = async (path = '/money') => (await renderScreen(Money, path)).replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')


  it('кредит закрыт досрочкой на всю сумму → «Свободно» выросло ровно на его платёж, «Кредиты» без него', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 1_000_000, payday: 10, updatedAt: '' }]
    store.householdDoc.categories = [{ key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' }]
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 2_000_000, updatedAt: '' }]
    store.householdDoc.credits = [
      { id: 'cr-a', name: 'Рассрочка', note: '', principal: 300_000, annualRate: 0.24, payment: 60_000, day: 12, updatedAt: '' },
      { id: 'cr-b', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: '' },
    ]

    // До закрытия: 1 000 000 − 151 680 − 200 000. В «Доходе» — доли: остаток по плану 65 %, нагрузка 15 %.
    const before = budgetAmounts({ ...store.householdDoc, credits: store.credits })
    expect(before).toMatchObject({ d2: 151_680, d5: 648_320 })
    let html = await render()
    expect(html).toContain(`остаток по плану ${pct(648_320, 1_000_000)} %`)
    // Нагрузка 15 % — словом (B2C-59): низкая.
    expect(pct(151_680, 1_000_000)).toBe(15)
    expect(html).toContain('нагрузка низкая')

    store.applyPrepayment('cr-a', 'a', { amount: store.credits[0].principal, mode: 'term', accountId: 'card' })
    expect(store.credits[0].principal).toBe(0)

    const after = budgetAmounts({ ...store.householdDoc, credits: store.credits })
    expect(after.d2).toBe(91_680)
    expect(after.d5 - before.d5).toBe(60_000)
    html = await render()
    expect(html).toContain(`остаток по плану ${pct(708_320, 1_000_000)} %`)
    expect(html).toContain('нагрузка низкая')
    // Сырой документ закрытость не видит — поэтому экраны передают производные кредиты.
    expect(budgetAmounts(store.householdDoc).d2).toBe(151_680)
  })

  it('PV-13: проценты банку в месяц = budgetInterest — в «Подробнее» самой дорогой ставки «Плана»; закрытый кредит выпадает', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 1_000_000, payday: 10, updatedAt: '' }]
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 2_000_000, updatedAt: '' }]
    store.householdDoc.credits = [
      { id: 'cr-a', name: 'Рассрочка', note: '', principal: 300_000, annualRate: 0.24, payment: 60_000, day: 12, updatedAt: '' },
      { id: 'cr-b', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: '' },
    ]
    // 300 000 × 0,24 / 12 = 6 000; 1 000 000 × 0,18 / 12 = 15 000.
    expect(budgetInterest(store.credits)).toBe(21_000)
    expect(await render('/money/debts')).toContain(`Проценты банку по всем долгам ${money(21_000)} в месяц`)

    store.applyPrepayment('cr-a', 'a', { amount: 300_000, mode: 'term', accountId: 'card' })
    const plan = await render('/money/debts')
    expect(plan).toContain(`Проценты банку по всем долгам ${money(15_000)} в месяц`)
    expect(plan).not.toContain(money(21_000))
  })
})
