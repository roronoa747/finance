import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import PaidRow from './PaidRow.vue'
import Capital from '@/views/Capital.vue'
import Overview from '@/views/Overview.vue'
import Budget from '@/views/Budget.vue'

describe('RP-07: «Оплатил» в интерфейсе (SSR)', () => {
  const storage = new Map<string, string>()
  const T0 = '2026-09-01T00:00:00.000Z'

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
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z')) // 24 сентября, Алматы
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function family(role: 'member' | 'viewer' = 'member') {
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
    })
    const store = useFinanceStore()
    store.setHouseholdDoc(
      {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 28, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
        ],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        ],
      },
      1,
    )
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
    return store
  }

  const row = (props: Record<string, unknown>) => renderToString(createSSRApp(PaidRow, props))

  async function page(view: Component, path: string, props?: Record<string, unknown>) {
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(view, props)
    app.use(router)
    return renderToString(app)
  }

  const rent = { kind: 'obligation', targetId: 'rent', period: '2026-09', title: 'Аренда', note: '28 сентября' }
  const loan = { kind: 'credit', targetId: 'loan', period: '2026-09', title: 'Кредит', note: '15 сентября' }

  it('неотмеченный платёж — кнопка «Оплатил» и сумма по графику, без упрёка даже после срока', async () => {
    family()
    const html = await row(loan)
    expect(html).toContain('Оплатил')
    expect(html).toContain(money(58_000))
    expect(html).toContain('15 сентября')
    expect(html).not.toMatch(/просроч|долж/i)
  })

  it('отмеченный — «оплачено», следующий платёж; у кредита — новый остаток', async () => {
    const store = family()
    store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    store.markPaid('credit', 'loan', 'a', { accountId: 'card' })

    const r = await row(rent)
    expect(r).toContain(`оплачено · дальше 28 октября · ${plain(220_000)} ₸`)
    expect(r).not.toContain('Оплатил')

    const l = await row(loan)
    expect(l).toContain(`дальше 15 октября · ${plain(58_000)} ₸`)
    expect(l).toContain(`остаток ${plain(969_500)} ₸`)
    expect(l).toContain('Оплачено — подробнее')
  })

  it('viewer видит отметки, но кнопок нет', async () => {
    const store = family('viewer')
    expect(await row(rent)).not.toContain('Оплатил')
    expect(await row({ ...rent, more: true })).not.toContain('Другая сумма или счёт')

    // Отметку поставил участник (пришла синком) — viewer её видит.
    store.markPaid('obligation', 'rent', 'b', { accountId: 'card' })
    const html = await row(rent)
    expect(html).toContain('оплачено')
    expect(html).not.toContain('подробнее')
  })

  it('модалка кредита в Капитале: отметка уменьшает остаток, снятие возвращает', async () => {
    const store = family()
    const before = await page(Capital, '/capital?credit=loan')
    expect(before).toContain('Остаток долга')
    expect(before).toContain(money(1_000_000))
    expect(before).toContain('Платёж 15 сентября')
    expect(before).toContain('Другая сумма или счёт')

    store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
    const after = await page(Capital, '/capital?credit=loan')
    expect(after).toContain(money(969_500))
    // Открытая заново модалка предлагает уже следующий платёж.
    expect(after).toContain('Платёж 15 октября')

    store.unmarkPaid('credit', 'loan', '2026-09')
    const back = await page(Capital, '/capital?credit=loan')
    expect(back).toContain(money(1_000_000))
    expect(back).toContain('Платёж 15 сентября')
  })

  it('модалка обязательства: «Оплатил» рядом с суммой', async () => {
    family()
    const html = await page(Capital, '/capital?obligation=rent')
    expect(html).toContain('Платёж 28 сентября')
    expect(html).toContain('Оплатил')
  })

  it('Обзор: «Впереди» — оплаченное уходит вниз с отметкой; «До зарплаты» — без оплаченного в сумме', async () => {
    const store = family()
    const ahead = (html: string) => html.slice(html.indexOf('Впереди'))

    const before = await page(Overview, '/')
    // Кредит 15-го раньше аренды 28-го.
    expect(ahead(before).indexOf('Кредит')).toBeLessThan(ahead(before).indexOf('Аренда'))
    expect(before).toContain(`Списаний до неё`)
    expect(before).toContain(money(220_000))

    store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
    store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    const after = await page(Overview, '/')
    expect(ahead(after)).toContain('оплачено · дальше')
    // Всё оплачено: до зарплаты списывать нечего, на счетах — остаток из отметок.
    expect(after).toContain(`На счетах ${plain(722_000)} ₸`)
    expect(after).toContain(money(0))
  })

  it('Бюджет, список: «Оплатил» у платежей по графику, у зарплат — нет', async () => {
    family()
    const html = await page(Budget, '/budget', { initialView: 'list' })
    expect(html.match(/Оплатил/g)).toHaveLength(2)
    expect(html).toContain('Зарплата · Ильяс')
  })
})
