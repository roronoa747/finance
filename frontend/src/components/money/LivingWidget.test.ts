import { describe, it, expect, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { money, plain } from '@/lib/money'
import type { SpendTotal } from '@/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import IncomeWidget from './IncomeWidget.vue'
import LivingWidget from './LivingWidget.vue'
import CapitalLists from './CapitalLists.vue'

/**
 * B2C-59 (SSR): у «Дохода», «Трат», «Платежей» — по одной строке-статусу; нажатие на «Траты» — лист
 * «Траты за сентябрь» с долями разделов и чертами ориентира; viewer видит теги и лист без правки сумм.
 * Семья — `planFamilyDoc` (Жизнь + Траты = база d4 150 000), 12 сентября.
 */
describe('B2C-59: виджеты «Денег» — статусы и лист «Траты»', () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
  const total = (categoryId: string, amount: number): SpendTotal => ({
    id: `a:month:2026-09:${categoryId}`, by: 'a', kind: 'month', period: '2026-09', categoryId, amount, ops: 1, updatedAt: T0,
  })
  const upload = { id: 'u1', slot: 'a' as const, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-11', ops_count: 10, created_at: T0 }
  // Продукты 60 000 (60 %, ориентир 61 %), кафе 25 000 (25 %, ориентир 4 %), транспорт 15 000 (15 %, ориентир 7 %).
  const totals = [total('sc_food', 60_000), total('sc_cafe', 25_000), total('sc_transport', 15_000), total('sc_rent', 220_000)]

  async function family(role: 'member' | 'viewer' = 'member', withUploads = true) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs(role, 'a'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc({ spendTotals: totals }), 1)
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: withUploads ? [upload] : [] })
    await useOperationsStore().loadUploads()
  }
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('теги: «Доход» — нагрузка словом, «Траты» — раздел выше ориентира, «Платежи» — «N из M оплачено»', async () => {
    await family()
    // (220 000 + 103 000) / 1 200 000 = 27 % — низкая.
    expect(text(await renderScreen(IncomeWidget, '/money'))).toContain('Доход ? нагрузка низкая')
    const living = text(await renderScreen(LivingWidget, '/money'))
    // Кафе +21 п. п. — больше, чем транспорт +8; продукты −1.
    expect(living).toContain('Траты кафе и рестораны выше нормы')
    expect(living).toContain(`${money(100_000)} из ${plain(150_000)}`)
    // Аренда и три кредита в сентябре, ничего не оплачено.
    expect(text(await renderScreen(CapitalLists, '/money'))).toContain('Платежи 0 из 4 оплачено')
  })

  it('без выписок за месяц — у «Трат» нет тега, факт «—»', async () => {
    await family('member', false)
    const living = text(await renderScreen(LivingWidget, '/money'))
    expect(living).toContain(`— из ${plain(150_000)}`)
    expect(living).not.toMatch(/выше нормы|в норме/)
  })

  it('лист «Траты за сентябрь»: строки по убыванию доли, полоса и черта ориентира, подпись с подсказкой; правка — «Жизнь» и «Траты»', async () => {
    await family()
    const html = await renderScreen(LivingWidget, '/money', undefined, [screenMixin({ open: true })])
    const t = text(html)
    expect(t).toContain('Траты за сентябрь')
    expect(t.indexOf('Продукты')).toBeLessThan(t.indexOf('Кафе и рестораны'))
    expect(t.indexOf('Кафе и рестораны')).toBeLessThan(t.indexOf('Транспорт'))
    expect(t).toContain(`Продукты ${money(60_000)} · 60 %`)
    expect(t).toContain(`Кафе и рестораны ${money(25_000)} · 25 %`)
    // Аренда — в плане, строки нет; черта — у каждого раздела с ориентиром.
    expect(t).not.toContain('Аренда')
    expect(html.match(/data-mark/g)).toHaveLength(3)
    expect(t).toContain('Черта — обычная доля')
    expect(html).toContain('aria-label="Жизнь — в месяц"')
    expect(html).toContain('aria-label="Траты — в месяц"')
  })

  it('правка в листе меняет статьи «Жизнь» и «Траты», не d4', async () => {
    await family()
    const store = useFinanceStore()
    store.setArticle('spend', { amount: 70_000 })
    expect(store.householdDoc.categories.find((c) => c.key === 'd4')!.amount).toBe(150_000)
    expect(text(await renderScreen(LivingWidget, '/money'))).toContain(`из ${plain(store.moneyArticles.find((a) => a.id === 'life')!.amount! + 70_000)}`)
  })

  it('viewer: теги и лист видны, правки сумм нет', async () => {
    await family('viewer')
    expect(text(await renderScreen(IncomeWidget, '/money'))).toContain('нагрузка низкая')
    const html = await renderScreen(LivingWidget, '/money', undefined, [screenMixin({ open: true })])
    expect(text(html)).toContain('Траты кафе и рестораны выше нормы')
    expect(text(html)).toContain('Траты за сентябрь')
    expect(html.match(/data-mark/g)).toHaveLength(3)
    expect(html).not.toContain('— в месяц')
  })
})
