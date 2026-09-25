import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { Payment } from '@/types/finance'
import { money } from '@/lib/money'
import { authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen } from '@/test/screenState'
import DebtPlan from './DebtPlan.vue'

describe('views/DebtPlan.vue — экран плана «Сначала долги»', () => {
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

  const family = (extra = {}) => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc({ plans: [planOf()], ...extra }), 1)
    return store
  }
  const cancelButton = />\s*Отменить план\s*</

  describe('PV-15', () => {
    it('без плана — «Плана нет» и ссылка на калькулятор', async () => {
      family({ plans: [] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Плана нет')
      expect(html).toContain('href="/capital?advice=strategy"')
      expect(html).not.toMatch(cancelButton)
    })

    it('с планом — дата выбора, цели на паузе с их взносами, подушка; участник может отменить', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('План «Сначала долги»')
      expect(html).toContain('Выбран 10 сентября')
      for (const [name, monthly] of [['Отпуск', 40_000], ['Машина', 60_000]] as const) {
        const row = html.slice(html.indexOf(`>${name}<`))
        expect(row.slice(0, row.indexOf('</button>'))).toContain(money(monthly))
      }
      expect(html.slice(html.indexOf('Цели на паузе'))).not.toContain('>Подушка<')
      expect(html).toContain('Подушка плана — «Подушка»: взносы продолжаются.')
      expect(html).toMatch(cancelButton)
    })

    it('viewer — всё видно, «Отменить план» нет (Р-12)', async () => {
      useAuthStore().setAuthData(authAs('viewer', 'b'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('>Отпуск<')
      expect(html).not.toMatch(cancelButton)
    })
  })

  describe('PV-16 — шаг этого месяца и пропущенный месяц', () => {
    const prepay = (p: Partial<Payment>): Payment => ({
      id: 'p1', kind: 'prepay', targetId: 'cc', period: '2026-09', amount: 100_000, principal: 100_000, accountId: 'card',
      by: 'a', at: '2026-09-20T05:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', saved: 9_000, mode: 'term', planId: 'plan', ...p,
    })

    it('шаг — досрочка: сумма, долг, «Внести по плану» (участник)', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Шаг этого месяца')
      expect(html).toContain(money(100_000))
      expect(html).toContain('досрочно в «Кредитка»')
      expect(html).toMatch(/>\s*Внести по плану\s*</)
    })

    it('шаг внесён — «Внесено по плану», без кнопки', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family({ payments: [prepay({})] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Внесено по плану')
      expect(html).not.toMatch(/>\s*Внести по плану\s*</)
    })

    it('шаг — подушка: «Сначала подушка» и «Пополнить подушку»', async () => {
      const goals = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 100_000, seed: 100_000 } : g))
      family({ goals })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Сначала подушка')
      expect(html).toContain(`До месяца обязательных списаний не хватает ${money(223_000)}.`)
      expect(html).toMatch(/>\s*Пополнить подушку\s*</)
    })

    it('пропущенный месяц — одна строка без упрёка; досрочка в прошлом месяце или месяц старта — строки нет', async () => {
      vi.setSystemTime(new Date('2026-10-15T07:00:00Z'))
      family()
      const missed = await renderScreen(DebtPlan, '/plan')
      expect(missed).toContain('В сентябре досрочки не было — план пересчитан от факта.')
      expect(missed).not.toMatch(/пропустил|просроч|не внесли|забыли/i)

      setActivePinia(createPinia())
      family({ payments: [prepay({})] })
      expect(await renderScreen(DebtPlan, '/plan')).not.toContain('досрочки не было')

      setActivePinia(createPinia())
      vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
      family()
      expect(await renderScreen(DebtPlan, '/plan')).not.toContain('досрочки не было')
    })
  })
})
