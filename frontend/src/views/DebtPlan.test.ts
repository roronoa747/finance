import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
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
})
