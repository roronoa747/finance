import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { startDemo } from '../src/lib/demo'
import { monthsLabel } from '../src/lib/finance'
import { monthKey } from '../src/lib/dates'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import GoalDetail from '../src/views/GoalDetail.vue'
import GoalNew from '../src/views/GoalNew.vue'
import Dreams from '../src/views/Dreams.vue'
import Start from '../src/views/Start.vue'
import { templateById } from '../src/lib/goalTemplates'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

// Фото шаблона — без сети: подушка записана с шаблоном, картинка догрузится потом (как в DOM-тесте «Новой мечты»).
vi.mock('../src/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
}))

/**
 * Блок 6 «понятность» (PN-19…PN-21, Р-12) на двух телефонах с фейковым сервером, 12 октября 2026: (а) семья без подушки —
 * «Новая мечта → Подушка» → фонд, `need` = 3 × (платежи + траты) плана, «Хватит на 0 месяцев» → взнос → «на 1,2 месяца»;
 * (б) второй раз — тот же id, тост; (в) «Месяцев трат» 2 → «нужно на 2 месяца», `need` плана пересчитан; (г) демо — «хватит на N»
 * по демо-цифрам; (д) второй телефон после синка видит те же числа; возврат приёмки — первый запуск без «Подушки», мечта —
 * герой. Экраны — SSR (`screen`), нажатия — методами экрана.
 */
type Phone = Awaited<ReturnType<typeof phone>>
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ')

describe('e2e / понятность Блок 6 — подушка', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    // Семья без подушки: обычная цель «Подушка» семьи плана не фонд — убираем её, копилки нет.
    const base = planFamilyDoc()
    server = fakeServer(planFamilyDoc({ goals: base.goals.filter((g) => g.id !== 'cushion'), goalOrder: null }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs(role, slot))
    return p
  }
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  const sync = async (from: Phone, to: Phone) => {
    await on(from).store.syncHousehold(from.client)
    await on(to).store.syncHousehold(to.client)
  }
  const planOf = (p: Phone) => on(p).store.monthPlanOf(monthKey())
  const spendOf = (p: Phone) => planOf(p).duesTotal + planOf(p).spendTotal
  const fundId = (p: Phone) => on(p).store.goals.filter((g) => g.fund === 'cushion' && !g.deletedAt).map((g) => g.id)
  /** «Новая мечта»: плитка «Подушка» → «Дальше» (формы нет). */
  const pickCushion = (p: Phone) =>
    screen(on(p).pinia, GoalNew, '/goals/new', undefined, [
      screenMixin({}, (s) => {
        ;(s.pickType as (t: string) => void)('cushion')
        ;(s.next as () => void)()
      }),
    ])
  const cushionScreen = async (p: Phone, path: string) => text(await screen(on(p).pinia, GoalDetail, path))

  it('(а)(б)(в)(д) «Новая мечта → Подушка» → фонд; взнос → «хватит на 1,2»; второй раз — тот же; порог 2; второй телефон — то же', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    await sync(A, B)
    expect(fundId(A)).toEqual([])

    // (а) Фонд без формы: `need` — 3 × (платежи + траты) плана месяца.
    const before = on(A).store.goals.length
    await pickCushion(A)
    const [id] = fundId(A)
    expect(id).toBeTruthy()
    expect(on(A).store.goals).toHaveLength(before + 1)
    const spend = spendOf(A)
    expect(spend).toBeGreaterThan(0)
    const item = planOf(A).queue.find((q) => q.goalId === id)!
    expect(item.kind).toBe('fund')
    expect(item.need).toBe(3 * spend)
    let page = await cushionScreen(A, `/goals/${id}`)
    expect(page).toContain('Хватит на 0 месяцев')
    expect(page).toContain('нужно на 3 месяца')
    expect(page).toContain(text(`из ${money(3 * spend)}`))

    // Взнос 1,2 месяца трат (целое) → «Хватит на 1,2 месяца».
    on(A).store.contribute(id, Math.round(spend * 1.2), 'a')
    page = await cushionScreen(A, `/goals/${id}`)
    expect(page).toContain('Хватит на 1,2 месяца')

    // (б) Второй раз — та же подушка, новой цели нет; экран с `?fund=exists` — тост.
    await pickCushion(A)
    expect(fundId(A)).toEqual([id])
    expect(on(A).store.goals).toHaveLength(before + 1)
    expect(await cushionScreen(A, `/goals/${id}?fund=exists`)).toContain('Подушка уже есть')

    // (в) «Месяцев трат» 2 → «нужно на 2 месяца», `need` плана — 2 × траты; 1,2 месяца по-прежнему.
    on(A).store.setFundMonths(id, 2)
    expect(planOf(A).queue.find((q) => q.goalId === id)!.need).toBe(2 * spend)
    page = await cushionScreen(A, `/goals/${id}`)
    expect(page).toContain('нужно на 2 месяца')
    expect(page).toContain(text(`из ${money(2 * spend)}`))
    expect(page).toContain('Хватит на 1,2 месяца')

    // (д) Второй телефон после синка — та же подушка и те же числа; «Новая мечта → Подушка» ведёт к ней же.
    await sync(A, B)
    expect(fundId(B)).toEqual([id])
    const pageB = await cushionScreen(B, `/goals/${id}`)
    expect(pageB).toContain('Хватит на 1,2 месяца')
    expect(pageB).toContain('нужно на 2 месяца')
    expect(pageB).toContain(text(`из ${money(2 * spend)}`))
    await pickCushion(B)
    expect(fundId(B)).toEqual([id])
  })

  it('(г) демо: «Подушка» `g-pot` — «хватит на N» по демо-цифрам', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    startDemo()
    await nextTick()
    setActivePinia(pinia)
    const finance = useFinanceStore()
    const plan = finance.monthPlanOf(monthKey())
    const item = plan.queue.find((q) => q.goalId === 'g-pot')!
    expect(item.kind).toBe('fund')
    const spend = plan.duesTotal + plan.spendTotal
    expect(item.need).toBe(3 * spend)
    const have = finance.goals.find((g) => g.id === 'g-pot')!.have
    // Хватит на have / месяц трат — одна десятая.
    const months = Math.round((have / spend) * 10) / 10
    const page = text(await screen(pinia, GoalDetail, '/goals/g-pot'))
    expect(page).toContain(`Хватит на ${monthsLabel(months)}`)
    expect(page).toContain('нужно на 3 месяца')
    expect(page).toContain(text(`из ${money(item.need)}`))
  })

  it('возврат приёмки (решение владельца А): первый запуск новой семьи — «Что копим?» без «Подушки», мечта → герой на «Мечтах»', async () => {
    server = fakeServer(defaultSyncDoc())
    const A = await as('member', 'a')
    expect(on(A).store.goals).toEqual([])

    // «Что копим?» первого запуска (`GoalNew next="/start/salary"`, FR-01) — только мечты; в «Новой мечте» плитка есть.
    const dream = text(await screen(on(A).pinia, Start, '/start/dream'))
    expect(dream).toContain('На что копим?')
    expect(dream).toContain('Машина')
    expect(dream).not.toContain('Подушка')
    expect(text(await screen(on(A).pinia, GoalNew, '/goals/new'))).toContain('Подушка')

    // Мечта → зарплата → «Пригласить» → «Позже»: на «Мечтах» — герой с этой мечтой, а не пустое «Выбрать мечту».
    await screen(on(A).pinia, Start, '/start/dream', undefined, [
      screenMixin({ step: 'form', template: templateById('car'), name: 'Машина', needText: '3 000 000', term: '18' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    expect(fundId(A)).toEqual([])
    expect(on(A).store.heroGoal?.name).toBe('Машина')
    await screen(on(A).pinia, Start, '/start/salary', undefined, [screenMixin({ manualSalary: '500 000' }, (s) => (s.saveSalary as () => void)())])
    await screen(on(A).pinia, Start, '/start/invite', undefined, [screenMixin({}, (s) => (s.finish as () => void)())])
    expect(on(A).store.setupDone).toBe(true)
    const dreams = await screen(on(A).pinia, Dreams, '/')
    expect(text(dreams)).toContain('Машина')
    expect(dreams).not.toContain('Выбрать мечту')
  })
})
