// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import type { SpendCompareRow } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import type { PersonId } from '@/types/finance'
import SpendCategorySheet from './SpendCategorySheet.vue'

/** AU-02: лист раздела трат — только показ строки `spendCompare` и `rkShare`; «Изменить» отдаёт участника и его сумму. */
let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const ROW: SpendCompareRow = {
  categoryId: 'sc_cafe', name: 'Кафе и рестораны', amount: 60_000, plan: 20_000, usual: 30_000, share: 5, over: true,
  advice: { amount: 10_000, goalId: 'trip', goalName: 'Отпуск', days: 20 }, group: 'services',
}
const PLANS = [{ by: 'a' as PersonId, name: 'Ильяс', amount: 20_000 }, { by: 'b' as PersonId, name: 'Аруна', amount: 0 }]

async function mount(row: Partial<SpendCompareRow> = {}, extra: { rk?: number | null; canEdit?: boolean } = {}) {
  const edits: [PersonId, number][] = []
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () => h(SpendCategorySheet, {
      row: { ...ROW, ...row }, rk: extra.rk === undefined ? 45 : extra.rk, plans: PLANS, canEdit: extra.canEdit ?? true,
      onEdit: (by: PersonId, amount: number) => edits.push([by, amount]),
    }),
  })
  app.mount(root)
  await nextTick()
  return edits
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('SpendCategorySheet', () => {
  it('полные данные: факт крупно, % дохода, обычно, план, «до плана» с днями, справка с подсказкой', async () => {
    await mount()
    expect(txt(q('[role="dialog"] h3'))).toBe('Кафе и рестораны')
    expect(txt(q('[data-cat-amount]'))).toBe(norm(money(60_000)))
    expect(txt(q('[data-cat-share]'))).toBe('5 % дохода')
    expect(txt(q('[data-cat-usual]'))).toBe(norm(`обычно у вас ${plain(30_000)}`))
    expect(txt(q('[data-cat-plan]'))).toBe(norm(`план ${plain(20_000)}`))
    expect(txt(q('[data-cat-advice]'))).toBe(norm(`до плана: +${plain(10_000)} в «Отпуск» · на 3 недели раньше`))
    expect(txt(q('[data-cat-rk]'))).toContain('у вас 45 % · в Алматы 24 %')
    // Hint — сначала открыть.
    q('[data-cat-rk] button')!.click()
    await nextTick()
    expect(txt(q('[role="note"]'))).toBe('Доля услуг в тратах семей Алматы, stat.gov.kz, II кв. 2025')
  })

  it('«обычно» нет — подпись; плана нет; рекомендации нет', async () => {
    await mount({ usual: null, plan: null, advice: null })
    expect(txt(q('[data-cat-usual]'))).toBe('обычно — когда будет 2 месяца выписок')
    expect(txt(q('[data-cat-plan]'))).toBe('плана нет')
    expect(q('[data-cat-advice]')).toBeNull()
  })

  it('без мечты — «в мечту» без дней; выписок нет — план крупно с подписью', async () => {
    await mount({ amount: null, share: null, advice: { amount: 10_000, goalId: null, goalName: null, days: null } })
    expect(txt(q('[data-cat-advice]'))).toBe(norm(`до плана: +${plain(10_000)} в мечту`))
    expect(txt(q('[data-cat-amount]'))).toBe(norm(`${money(20_000)}план`))
    expect(q('[data-cat-share]')).toBeNull()
  })

  it('свой раздел — без справки РК', async () => {
    await mount({ categoryId: 'my_dog', name: 'Собака', group: null }, { rk: null })
    expect(q('[data-cat-rk]')).toBeNull()
  })

  it('план по участникам; «Изменить» отдаёт участника и сумму; viewer — без «Изменить»', async () => {
    const edits = await mount()
    expect(txt(q('[data-cat-person="a"]'))).toContain(norm(plain(20_000)))
    expect(txt(q('[data-cat-person="b"]'))).toContain('—')
    q('[data-cat-person="a"] [data-cat-edit]')!.click()
    expect(edits).toEqual([['a', 20_000]])
    app!.unmount()
    document.body.innerHTML = ''
    await mount({}, { canEdit: false })
    expect(q('[data-cat-person="a"]')).not.toBeNull()
    expect(q('[data-cat-edit]')).toBeNull()
  })
})
