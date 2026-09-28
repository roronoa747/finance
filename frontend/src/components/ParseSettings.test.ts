import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import { assignIds, ruleMatchOf, seedSpendCategories } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { spendColor } from '@/lib/palette'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import ParseSettings from './ParseSettings.vue'

/**
 * «Разбор выписок» (B2C-21 п. 3): имена и цвета разделов трат, правила разбора с «Убрать» —
 * свои операции пересчитываются, «между своими» снимается.
 */
describe('components/ParseSettings.vue', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const op = (date: string, amount: number, merchant: string, extra: Partial<Omit<Operation, 'id'>> = {}): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
  })

  function family() {
    useAuthStore().setAuthData(authAs('member'))
    const store = useFinanceStore()
    store.claimFor('h-family')
    const doc = planFamilyDoc()
    seedSpendCategories(doc)
    store.setHouseholdDoc(doc, 1)
    return store
  }

  it('разделы: имя правится, цвет — слот палитры (токен --sN), у обоих через документ', async () => {
    const store = family()
    const html = await renderScreen(ParseSettings, '/settings')
    expect(html).toContain('value="Продукты"')
    // Палитры свёрнуты (правило 12): у раздела — одна точка-кнопка, кнопок «Цвет N» нет.
    expect(html).toMatch(/aria-label="Цвет раздела Продукты" aria-expanded="false"/)
    expect(html).not.toMatch(/aria-label="Цвет \d+"/)
    expect(html).not.toMatch(/#[0-9a-f]{6}/i)

    store.updateSpendCategory('sc_food', { name: 'Еда', slot: 7 })
    const food = store.householdDoc.spendCategories!.find((c) => c.id === 'sc_food')!
    expect(food).toMatchObject({ name: 'Еда', slot: 7 })
    expect(spendColor(food)).toBe('var(--s7)')
    const after = await renderScreen(ParseSettings, '/settings')
    expect(after).toContain('value="Еда"')
    // Точка раздела — тот же токен, что даёт spendColor.
    const dot = after.slice(after.indexOf('aria-label="Цвет раздела Еда"')).split('</button>')[0]
    expect(dot).toContain('background:var(--s7)')
  })

  it('палитра раздела раскрывается нажатием на точку — одна; выбор цвета пишет слот и сворачивает', async () => {
    const store = family()
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('pickSlot' in this.$.setupState) vm = this.$.setupState } }
    const open = await renderScreen(ParseSettings, '/settings', undefined, [screenMixin({ openColor: 'sc_food' }), grab])
    expect((open.match(/aria-label="Цвет \d+"/g) ?? []).length).toBe(12)
    expect(open).toContain('aria-label="Палитра раздела Продукты"')
    expect(open).toMatch(/aria-label="Цвет раздела Продукты" aria-expanded="true"/)
    expect(open).toMatch(/aria-label="Цвет \d+" aria-pressed="true"/)

    vm.pickSlot('sc_food', 7)
    expect(store.householdDoc.spendCategories!.find((c) => c.id === 'sc_food')).toMatchObject({ slot: 7 })
    expect(vm.openColor).toBeNull()
    const reopened = await renderScreen(ParseSettings, '/settings', undefined, [screenMixin({ openColor: 'sc_food' })])
    expect(reopened).toMatch(/aria-label="Цвет 7" aria-pressed="true"/)
  })

  it('правила: строка «продавец → раздел», «кому → что», «между своими», «платёж по …»; «Убрать» снимает правило и пересчитывает свои операции', async () => {
    const store = family()
    const ops = assignIds([
      op('2026-09-10', -5_000, 'Coffee Boom'),
      op('2026-09-11', -25_000, 'Дана К.', { kind: 'transfer-out', counterparty: 'Дана К.' }),
      op('2026-09-12', -58_000, 'Оплата Kaspi Кредита', { kind: 'transfer-out' }),
    ])
    writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: 'h-family:u-a', ops: Object.fromEntries(ops.map((o) => [o.id, o])) })
    const opsStore = useOperationsStore()
    // Совпадения — как их строит разбор (нормализованные продавец и получатель).
    const [coffee, dana, loan] = ops.map((o) => ruleMatchOf(o))
    opsStore.answer(coffee, { categoryId: 'sc_food' })
    opsStore.answer(dana, { internal: true })
    opsStore.answer(loan, { payment: { kind: 'credit', targetId: 'loan', categoryId: 'sc_credit' } })
    // «Куда отнести?» о том же продавце — раздел остальных строк внутри правила платежа, не замена (критик возврата 2).
    opsStore.answer(loan, { categoryId: 'sc_food' })
    expect(store.merchantRules).toHaveLength(3)

    const html = await renderScreen(ParseSettings, '/settings')
    expect(html).toContain(`«${coffee.merchant}»`)
    expect(html).toContain('Продукты')
    expect(html).toContain('между своими')
    expect(html).toContain('платёж по «Кредит» · остальное — Продукты')
    expect(html).toContain(`aria-label="Убрать правило «${coffee.merchant}»"`)

    // Операция под правилом «между своими»: после снятия — снова трата, раздел по словарю (перевод человеку).
    await opsStore.recategorize(dana, { internal: true })
    expect(opsStore.all.find((o) => o.counterparty === 'Дана К.')!.internal).toBe(true)
    const rule = store.merchantRules.find((r) => r.match.counterparty === dana.counterparty)!
    // «Убрать» — тот же стор операций, что у кнопки.
    await opsStore.forgetRule(rule)
    expect(store.merchantRules.filter((r) => !r.deletedAt)).toHaveLength(2)
    const danaOp = opsStore.all.find((o) => o.counterparty === 'Дана К.')!
    expect(danaOp.internal).toBe(false)
    expect(danaOp.categoryId).toBe('sc_people')
    expect(await renderScreen(ParseSettings, '/settings')).not.toContain('между своими')
  })
})
