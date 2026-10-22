// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import type { HabitImage, SectionMonth, SpendCompareRow } from '@/lib/finance'
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

const events: [string, string][] = []
async function mount(
  row: Partial<SpendCompareRow> = {},
  extra: { rk?: number | null; canEdit?: boolean; image?: HabitImage; month?: string; ops?: SectionMonth | null; plans?: typeof PLANS; none?: string } = {},
) {
  const edits: [PersonId, number][] = []
  events.length = 0
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () => h(SpendCategorySheet, {
      row: extra.none ? null : { ...ROW, ...row }, rk: extra.rk === undefined ? 45 : extra.rk, plans: extra.plans ?? PLANS, canEdit: extra.canEdit ?? true, image: extra.image ?? null, month: extra.month,
      ops: extra.ops ?? null, none: extra.none ?? null,
      onEdit: (by: PersonId, amount: number) => edits.push([by, amount]),
      onOpen: (id: string) => events.push(['open', id]),
      onHand: (id: string) => events.push(['hand', id]),
      onMore: () => events.push(['more', '']),
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
    // Х-2: «в мечту «<мечта>»» без склонения имени; справка называет группу (у кафе и транспорта одна доля).
    expect(txt(q('[data-cat-advice]'))).toBe(norm(`до плана: +${plain(10_000)} в мечту «Отпуск» · на 3 недели раньше`))
    expect(txt(q('[data-cat-rk]'))).toContain('услуги: у вас 45 % · в Алматы 24 %')
    // Hint — сначала открыть.
    q('[data-cat-rk] button')!.click()
    await nextTick()
    expect(txt(q('[role="note"]'))).toBe('Доля услуг в тратах семей Алматы, stat.gov.kz, II кв. 2025')
  })

  it('Х-10: образ «N % мечты» той же мечты — внутри плашки «до плана», одной плашкой; другая мечта — строкой под ней', async () => {
    const IMG: HabitImage = {
      habit: 'delivery', categoryId: 'sc_cafe', monthly: 40_000, count: 4, kind: 'dream', price: { from: 'goal', goalId: 'trip', name: 'Отпуск', price: 2_000_000 },
      left: null, months: null, cost: null, saving: null, yearly: 480_000, share: 24, moved: null,
      action: { kind: 'move', categoryId: 'sc_cafe', goalId: 'trip', goalName: 'Отпуск', amount: 20_000, days: 30 },
    }
    await mount({}, { image: IMG })
    expect(document.querySelectorAll('[data-image]').length).toBe(1)
    expect(txt(q('[data-cat-advice-box] [data-image-line]'))).toBe('Доставка за год — 24 % мечты')
    expect(txt(q('[data-cat-advice-box] [data-image-act]'))).toBe('Перенести в мечту')
    app!.unmount()
    document.body.innerHTML = ''
    await mount({}, { image: { ...IMG, price: { from: 'goal', goalId: 'car', name: 'Машина', price: 4_750_000 } } })
    expect(q('[data-cat-advice-box] [data-image]')).toBeNull()
    expect(q('[data-image]')).not.toBeNull()
    app!.unmount()
    document.body.innerHTML = ''
    // Х-14: перенос сделан — «до плана» нет (выросла бы на перенесённое), в плашке образ с именем мечты и ✓.
    await mount({}, { image: { ...IMG, action: null, moved: 20_000 } })
    expect(q('[data-cat-advice]')).toBeNull()
    expect(txt(q('[data-cat-advice-box] [data-image-line]'))).toBe('Доставка за год — 24 % мечты «Отпуск»')
    expect(txt(q('[data-cat-advice-box] [data-image-moved]'))).toBe(norm(`✓ ${plain(20_000)} в мечту`))
    expect(q('[data-image-act]')).toBeNull()
    app!.unmount()
    document.body.innerHTML = ''
    // Перенос жив, а «до плана» нет (план потом подняли выше «обычно») — плашки нет, образ строкой с ✓.
    await mount({ advice: null }, { image: { ...IMG, action: null, moved: 20_000 }, canEdit: false })
    expect(q('[data-cat-advice-box]')).toBeNull()
    expect(txt(q('[data-image-line]'))).toBe('Доставка за год — 24 % мечты «Отпуск»')
    expect(q('[data-image-moved]')).not.toBeNull()
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
    // План уже крупно — второй раз строкой его нет (`/ux` Блока 3: шумная цифра); «обычно» — на месте.
    expect(q('[data-cat-plan]')).toBeNull()
    expect(q('[data-cat-usual]')).not.toBeNull()
    expect(q('[data-cat-share]')).toBeNull()
  })

  it('доля дохода округлилась до 0 — строки «0 % дохода» нет (ux: шумная цифра)', async () => {
    await mount({ amount: 5_400, share: 0 })
    expect(q('[data-cat-share]')).toBeNull()
    expect(txt(q('[data-cat-amount]'))).toBe(norm(money(5_400)))
  })

  it('свой раздел — без справки РК', async () => {
    await mount({ categoryId: 'my_dog', name: 'Собака', group: null }, { rk: null })
    expect(q('[data-cat-rk]')).toBeNull()
  })

  it('план по участникам; «Изменить» отдаёт участника и сумму; viewer — без «Изменить»', async () => {
    const edits = await mount()
    expect(txt(q('[data-cat-plans-title]'))).toBe('План каждого')
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

  it('FB-12: свой план одной строкой — «План», без «каждого»; «Изменить» — свой', async () => {
    const edits = await mount({}, { plans: [PLANS[0]] })
    expect(txt(q('[data-cat-plans-title]'))).toBe('План')
    expect([...document.querySelectorAll<HTMLElement>('[data-cat-person]')].map((el) => el.dataset.catPerson)).toEqual(['a'])
    q('[data-cat-person="a"] [data-cat-edit]')!.click()
    expect(edits).toEqual([['a', 20_000]])
  })

  it('FB-12: раздел без моих трат (`none`) — «—» и одна строка, без цифр, плана и операций', async () => {
    await mount({}, { none: 'Кафе и рестораны' })
    expect(txt(q('[role="dialog"] h3'))).toBe('Кафе и рестораны')
    expect(txt(q('[data-cat-amount]'))).toBe('—')
    expect(txt(q('[data-cat-none]'))).toBe('У вас трат в этом разделе нет')
    for (const sel of ['[data-cat-usual]', '[data-cat-plan]', '[data-cat-rk]', '[data-cat-person]', '[data-cat-ops]']) expect(q(sel), sel).toBeNull()
  })

  it('RZ-13: месяц листа — над цифрой: этого года — «январь», другого — с годом; текущий и без месяца — строки нет (критик, `/ux` Блока 3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-05T07:00:00Z'))
    await mount({}, { month: '2026-01' })
    expect(txt(q('[data-cat-month]'))).toBe('январь')
    app!.unmount()
    document.body.innerHTML = ''
    await mount({}, { month: '2025-12' })
    expect(txt(q('[data-cat-month]'))).toBe('декабрь 2025')
    app!.unmount()
    document.body.innerHTML = ''
    // Текущий месяц не называется — он и так на экране.
    await mount({}, { month: '2026-03' })
    expect(q('[data-cat-amount]')).not.toBeNull()
    expect(q('[data-cat-month]')).toBeNull()
    app!.unmount()
    document.body.innerHTML = ''
    await mount()
    expect(q('[data-cat-month]')).toBeNull()
    vi.useRealTimers()
  })
})

describe('FB-05: свои операции в листе раздела «Месяца»', () => {
  const OPS: SectionMonth = {
    total: 21_000, count: 7,
    days: [
      { date: '2026-09-24', ops: [{ id: 'o1', name: 'Coffee Boom', amount: 3_000, hand: false, refund: 1_000 }, { id: 'h1', name: 'Обед с другом', amount: 4_000, hand: true }] },
      { date: '2026-09-20', ops: [{ id: 'o2', name: 'Navat', amount: 5_000, hand: false }, { id: 'o3', name: 'Del Papa', amount: 2_000, hand: false }, { id: 'o4', name: 'Kofe', amount: 1_000, hand: false }] },
    ],
    more: { count: 2, amount: 6_000 },
  }

  it('«Мои операции · 7» — дни и строки, «вернули» в строке; «Ещё 2 · 6 000 ₸» — тихая строка → more; строка → open, ручная → hand', async () => {
    await mount({}, { ops: OPS })
    expect(txt(q('[data-cat-ops-title]'))).toBe('Мои операции · 7')
    expect(document.querySelectorAll('[data-cat-op]')).toHaveLength(5)
    expect(txt(q('[data-cat-op="o1"]'))).toContain(norm(`вернули ${plain(1_000)}`))
    expect(txt(q('[data-cat-ops-more]'))).toBe(norm(`Ещё 2 · ${money(6_000)}`))
    q('[data-cat-ops-more]')!.click()
    q('[data-cat-op="o2"]')!.click()
    q('[data-cat-op="h1"]')!.click()
    expect(events).toEqual([['more', ''], ['open', 'o2'], ['hand', 'h1']])
    // Брендовой кнопки не прибавилось.
    expect([...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.className.includes('bg-brand '))).toHaveLength(0)
  })

  it('своих операций нет (партнёр, viewer) — блока нет', async () => {
    await mount({}, { ops: { total: 0, count: 0, days: [], more: null } })
    expect(q('[data-cat-ops-title]')).toBeNull()
    app!.unmount()
    document.body.innerHTML = ''
    await mount({}, { ops: null, canEdit: false })
    expect(q('[data-cat-ops]')).toBeNull()
  })
})
