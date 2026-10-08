// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { monthPlan, monthPlanPast, planPuts, untilPayday, type MonthPlanCtx } from '@/lib/finance'
import type { SpendTotal } from '@/lib/statements/types'
import { monthKey } from '@/lib/dates'
import { money, plain } from '@/lib/money'
import type { Obligation, Payment, SyncDoc } from '@/types/finance'
import Month from '@/views/Month.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * B2C-94 (Р-90, Р-92…Р-94, Р-97; ворота B2C-91): «План · Месяц» — круг-оглавление: числа из `monthPlan` (экран не
 * считает), разделы свёрнуты и раскрываются по одному; цели — строки без фото и «Желаний»; подписки — одной
 * строкой, ✓ группы — когда оплачены все; платёж — «Оплатил» нажатием строки, один раз; цели — «Отложил всё» и
 * «Отложил» / «Не отложено» по одной; точка — пока есть что отложить; viewer — без листов, переключателей и кнопок.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KEY = '2026-09'
const sub = (id: string, name: string, day: number, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
})
const paid = (kind: Payment['kind'], targetId: string, period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `${kind}-${targetId}-${period}`, kind, targetId, period, amount, accountId: 'card', by: 'a', at: `${period}-05T05:00:00.000Z`, updatedAt: T0, ...extra,
})

/**
 * Семья плана: Ильяс 700 000 пришла 10-го, Аруна 500 000 ждём 20-го; траты обоих; очередь Отпуск → Машина →
 * Подушка (плательщик — Ильяс). Машина просит 600 000 — остатка на всех не хватает: «Подушка» получает часть.
 * Подписки: Netflix 5 000 (оплачен), Spotify 3 000 и iCloud 1 500 — в ручной группе «Кино и музыка» только первые две.
 * Аренда августа оплачена с карты — «Оплатил» сентября одним нажатием с того же счёта.
 */
function familyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'car' ? { ...g, monthly: 600_000 } : g)),
    obligations: [
      ...doc.obligations,
      { id: 'grp', name: 'Кино и музыка', note: '', day: 1, category: 'd4', group: true, versions: [], updatedAt: T0 },
      sub('netflix', 'Netflix', 5, 5_000, { parentId: 'grp' }),
      sub('spotify', 'Spotify', 7, 3_000, { parentId: 'grp' }),
      sub('icloud', 'iCloud', 15, 1_500),
    ],
    payments: [
      paid('salary', 'a', KEY, 700_000, { id: 'sal-a', accountId: null, at: '2026-09-10T05:00:00.000Z' }),
      paid('obligation', 'rent', '2026-08', 220_000),
      paid('obligation', 'netflix', KEY, 5_000),
      paid('obligation', 'spotify', '2026-08', 3_000),
      paid('obligation', 'icloud', '2026-08', 1_500),
    ],
    spendPlans: [
      { id: 'a:sc_taxi', by: 'a', categoryId: 'sc_taxi', amount: 80_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 },
    ...extra,
  })
}

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc(), path = '/month') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Month)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

/** Тот же план, что у экрана, — из `finance.ts`. */
function planOf(finance: ReturnType<typeof useFinanceStore>) {
  const ctx: MonthPlanCtx = { key: KEY, totals: finance.householdDoc.spendTotals ?? [], spendCategories: finance.householdDoc.spendCategories ?? [], uploads: [] }
  return monthPlan({ ...finance.householdDoc, credits: finance.credits, book: useFxStore().book }, ctx)
}
const putsOf = (finance: ReturnType<typeof useFinanceStore>) =>
  planPuts({ ...finance.householdDoc, credits: finance.credits, book: useFxStore().book }, planOf(finance))

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
/** Нажатие: часы стоят (`toFake: Date`), а Vue пропускает событие не позже подключения обработчика — шаг времени. */
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const norm = (s: string) => s.replace(/\s+/g, ' ')
const section = (k: 'dues' | 'spend' | 'queue') => q<HTMLButtonElement>(`[data-section="${k}"]`)
const dialogButton = (label: string) => all('[role="dialog"] button').find((b) => txt(b).startsWith(label))
const plans = (finance: ReturnType<typeof useFinanceStore>) => (finance.householdDoc.allocations ?? []).filter((a) => a.kind === 'plan' && !a.deletedAt)

describe('B2C-94: «План · Месяц» — круг-оглавление', () => {
  it('числа — из monthPlan; разделы свёрнуты, в строках — сумма и «N из M»; зарплата — ✓ у суммы или «ждём»', async () => {
    const finance = await open()
    const plan = planOf(finance)
    expect(plan.income.total).toBe(1_200_000)
    expect(txt(q('[data-rest]'))).toBe(norm(money(plan.rest)))
    // «из <доход>» — не строкой под кругом, а в подсказке у «Остаётся» (Р-116).
    expect(txt(document.body)).not.toContain(norm(`из ${plain(plan.income.total)}`))
    await press(q('button[aria-label="Остаётся"]'))
    expect(txt(q('[role="note"]'))).toContain(norm(`Из ${money(plan.income.total)} дохода месяца.`))
    await press(q('button[aria-label="Остаётся"]'))
    expect(q('[role="note"]')).toBeNull()
    // Итоговой карточки «Отложим · Потратим» нет (Р-116): Отложим — строка «Цели и фонды», Потратим — «Платежи» + «Траты».
    expect(q('[data-plan-sum]')).toBeNull()
    expect(txt(section('queue'))).toContain(norm(plain(plan.queueTotal)))
    expect(txt(section('spend'))).toContain(norm(plain(plan.spendTotal)))
    expect(plan.duesTotal + plan.spendTotal).toBe(plan.outTotal)
    // Зарплата: в строке — ✓ у суммы; дата и «хватает ли» — в листе зарплаты (Р-116). Слов «✓ пришла» нет.
    expect(q('[data-salary="a"] [data-came]')).not.toBeNull()
    expect(q('[data-salary="b"] [data-came]')).toBeNull()
    expect(q('[data-salary] [data-salary-status]')).toBeNull()
    expect(q('[data-salary] [data-left]')).toBeNull()
    expect(txt(document.body)).not.toContain('✓ пришла')
    const when = { a: 'пришла 10 сентября', b: 'ждём 20 сентября' } as Record<string, string>
    for (const p of plan.byPerson) {
      await press(q(`[data-salary="${p.person}"] [data-row-open]`))
      expect(txt(q('[role="dialog"] [data-left]'))).toBe(norm(p.left > 0 ? `+${money(p.left)}` : money(p.left)))
      expect(txt(q('[role="dialog"] [data-salary-status]'))).toContain(when[p.person])
      await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
      expect(q('[role="dialog"]')).toBeNull()
    }
    // Оглавление: три строки, всё свёрнуто.
    expect(all('[data-section]').map((el) => el.dataset.section)).toEqual(['dues', 'spend', 'queue'])
    expect(all('[data-section]').every((el) => el.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(q('[data-due]')).toBeNull()
    expect(q('[data-queue]')).toBeNull()
    expect(txt(section('dues'))).toContain(norm(plain(plan.duesTotal)))
    expect(txt(q('[data-section="dues"] [data-section-meta]'))).toBe(`${plan.dues.filter((d) => d.paid).length} из ${plan.dues.length} оплачено`)
    expect(txt(q('[data-section="spend"] [data-section-meta]'))).toBe('по плану')
    expect(txt(q('[data-section="queue"] [data-section-meta]'))).toBe(`0 из ${putsOf(finance).length} отложено`)
    // «Месяц» — переключатель есть, брендовой крупной кнопки нет.
    expect(q('[data-plan-view="month"]')!.getAttribute('aria-current')).toBe('page')
    expect(txt(document.body)).not.toContain('Отложить по плану')
  })

  it('раздел раскрывается строкой и цветом круга, один за раз; цели — строки без фото и «Желаний»', async () => {
    const finance = await open()
    const plan = planOf(finance)
    await press(section('queue'))
    expect(section('queue')!.getAttribute('aria-expanded')).toBe('true')
    expect(all('[data-queue]').map((el) => el.dataset.queue)).toEqual(plan.queue.map((x) => x.id))
    expect(q('[data-queue-list] img')).toBeNull()
    expect(txt(document.body)).not.toContain('Желания')
    expect(txt(document.body)).not.toContain('главная')
    for (const x of plan.queue) expect(txt(q(`[data-queue="${x.id}"] [data-given]`))).toBe(norm(plain(x.given)))
    // Цвет круга «Платежи» — открывает платежи, цели сворачиваются; остальные цвета бледнеют.
    q<SVGElement>('[data-part="dues"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(section('dues')!.getAttribute('aria-expanded')).toBe('true')
    expect(section('queue')!.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-queue]')).toBeNull()
    expect(q('[data-part="queue"]')!.getAttribute('opacity')).toBe('0.3')
    expect(q('[data-part="dues"]')!.getAttribute('opacity')).toBe('1')
    // Повторное нажатие — свернуть.
    await press(section('dues'))
    expect(all('[data-section]').every((el) => el.getAttribute('aria-expanded') === 'false')).toBe(true)
    await press(section('spend'))
    expect(txt(q('[data-spend="a"]'))).toContain(norm(plain(80_000)))
  })

  it('выключил цель — остаток сменился сразу, она «на паузе», деньги ушли ниже', async () => {
    const finance = await open()
    const before = planOf(finance)
    await press(section('queue'))
    expect(txt(q('[data-queue="cushion"] [data-status]'))).toContain('не хватает')
    await press(q<HTMLButtonElement>('[data-queue="trip"] [role="switch"]'))
    const after = planOf(finance)
    expect(finance.goals.find((g) => g.id === 'trip')?.pausedAt).toBeTruthy()
    expect(after.rest).not.toBe(before.rest)
    expect(txt(q('[data-rest]'))).toBe(norm(money(after.rest)))
    expect(txt(q('[data-queue="trip"] [data-status]'))).toBe('на паузе')
    expect(txt(q('[data-queue="trip"] [data-given]'))).toBe('0')
    expect(txt(q('[data-queue="cushion"] [data-given]'))).toBe(norm(plain(after.queue.find((x) => x.id === 'cushion')!.given)))
    // Лист «Отложил» выключатель не открывает.
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('смена плательщика — «хватает» обоих пересчитано; лист платежа кружок не открывает', async () => {
    const finance = await open()
    // «Хватает» — в листе зарплаты (Р-116): открыть строку, прочитать, закрыть.
    const leftOf = async (id: string) => {
      await press(q(`[data-salary="${id}"] [data-row-open]`))
      const left = txt(q('[role="dialog"] [data-left]'))
      await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
      expect(left).not.toBe('')
      return left
    }
    const a0 = await leftOf('a')
    const b0 = await leftOf('b')
    await press(section('dues'))
    await press(q<HTMLButtonElement>('[data-due-id="obligation:rent"] button[aria-label^="Платит"]'))
    expect(txt(q('[role="dialog"]'))).toContain('Кто платит: аренда?')
    expect(dialogButton('Оплатил')).toBeUndefined()
    const other = all('[role="dialog"] button').filter((b) => /Ильяс|Аруна/.test(b.textContent ?? '')).find((b) => !b.textContent?.includes('✓'))
    await press(other)
    expect(finance.obligations.find((o) => o.id === 'rent')?.payer).toBe('b')
    expect(await leftOf('a')).not.toBe(a0)
    expect(await leftOf('b')).not.toBe(b0)
  })

  it('подписки — одной строкой «Подписки · 3»; раскрытие — список с ручной группой; ✓ группы — только когда оплачены все', async () => {
    const finance = await open()
    await press(section('dues'))
    // В общем списке — аренда и кредиты; подписок по отдельности нет.
    expect(all('[data-due]').map((el) => el.dataset.dueId)).not.toContain('obligation:netflix')
    const subs = q('[data-subs]')!
    expect(txt(subs)).toContain('Подписки · 3')
    expect(txt(subs)).toContain(norm(plain(9_500)))
    expect(txt(q('[data-subs-status]'))).toBe('1 из 3 списались')
    expect(q('[data-subs-done]')).toBeNull()
    await press(subs.querySelector('button'))
    expect(txt(subs)).toContain('Кино и музыка')
    expect(all('[data-subs] [data-due]').map((el) => el.dataset.dueId)).toEqual(['obligation:icloud', 'obligation:netflix', 'obligation:spotify'])
    // Оплатили вторую — группа ещё без ✓; третью — ✓.
    await press(q('[data-due-id="obligation:spotify"]'))
    await press(dialogButton('Оплатил'))
    expect(txt(q('[data-subs-status]'))).toBe('2 из 3 списались')
    expect(q('[data-subs-done]')).toBeNull()
    await press(q('[data-due-id="obligation:icloud"]'))
    await press(dialogButton('Оплатил'))
    expect(txt(q('[data-subs-status]'))).toBe('все списались')
    expect(q('[data-subs-done]')).not.toBeNull()
    expect(finance.payments.filter((p) => !p.deletedAt && p.period === KEY && ['netflix', 'spotify', 'icloud'].includes(p.targetId))).toHaveLength(3)
  })

  it('нажатие платежа → лист «Оплатил»: отметка пишется один раз; «Не оплачено» снимает; первая оплата спрашивает счёт', async () => {
    const finance = await open()
    await press(section('dues'))
    const rent = () => finance.payments.filter((p) => !p.deletedAt && p.kind === 'obligation' && p.targetId === 'rent' && p.period === KEY)
    await press(q('[data-due-id="obligation:rent"]'))
    const sheet = txt(q('[role="dialog"]'))
    expect(sheet).toContain('Аренда')
    expect(sheet).toContain('5 сентября · платит Ильяс')
    expect(sheet).toContain(norm(money(220_000)))
    expect(sheet).toContain('Изменить платёж')
    await press(dialogButton('Оплатил'))
    expect(rent()).toHaveLength(1)
    expect(rent()[0]).toMatchObject({ amount: 220_000, accountId: 'card', by: 'a' })
    expect(q('[role="dialog"]')).toBeNull()
    expect(txt(q('[data-due-id="obligation:rent"]'))).toContain('✓')
    // Повторный вызов (второй телефон, двойное нажатие) — той же записью.
    finance.markPaid('obligation', 'rent', 'a', { period: KEY, accountId: 'card' })
    expect(rent()).toHaveLength(1)
    // У оплаченного — «✓ Оплачено» и тихое «Не оплачено».
    await press(q('[data-due-id="obligation:rent"]'))
    expect(q('[role="dialog"] [data-paid]')).not.toBeNull()
    expect(dialogButton('Оплатил')).toBeUndefined()
    await press(dialogButton('Не оплачено'))
    expect(rent()).toHaveLength(0)
    // Кредит ещё не платили — счёт спросить не у кого: лист отметки со счётом, записи пока нет.
    await press(q('[data-due-id="credit:loan"]'))
    await press(dialogButton('Оплатил'))
    expect(txt(q('[role="dialog"]'))).toContain('Спрашиваем один раз')
    expect(finance.payments.some((p) => p.kind === 'credit' && p.targetId === 'loan')).toBe(false)
  })

  it('/ux мелочи 2: долг человеку в плане — «Отдал», отданный — «✓ Отдал», как его строка в «Долгах»', async () => {
    const base = familyDoc()
    const bro = { id: 'bro', name: 'Брату', note: '', principal: 300_000, principalSetAt: T0, annualRate: 0, payment: 50_000, day: 25, person: true, updatedAt: T0 }
    const finance = await open('member', familyDoc({
      credits: [...base.credits!, bro],
      payments: [...base.payments!, paid('credit', 'bro', '2026-08', 50_000, { principal: 50_000 })],
    }))
    await press(section('dues'))
    await press(q('[data-due-id="credit:bro"]'))
    expect(dialogButton('Оплатил')).toBeUndefined()
    await press(dialogButton('Отдал'))
    expect(finance.payments.find((p) => p.targetId === 'bro' && p.period === KEY)).toMatchObject({ amount: 50_000, accountId: 'card' })
    await press(q('[data-due-id="credit:bro"]'))
    expect(txt(q('[role="dialog"] [data-paid]'))).toBe('✓ Отдал')
  })

  it('«Отложил всё» — взносы тех, чья зарплата пришла, остатком до плана; запись kind plan; ✓ у строк, точки нет; план не меняется', async () => {
    const finance = await open()
    const plan = planOf(finance)
    const mine = plan.queue.filter((x) => x.payer === 'a' && x.given > 0 && x.goalId)
    expect(mine.length).toBeGreaterThan(1)
    expect(finance.planCall()).toBe(KEY)
    expect(q('[data-section="queue"] [data-section-dot]')).not.toBeNull()
    await press(section('queue'))
    const haves = new Map(finance.goals.map((g) => [g.id, g.have]))
    expect(txt(q('[data-put-all]'))).toBe(norm(`Отложил всё · ${money(mine.reduce((s, x) => s + x.given, 0))}`))
    await press(q('[data-put-all]'))
    for (const x of mine) expect(finance.goals.find((g) => g.id === x.goalId)!.have).toBe(haves.get(x.goalId!)! + x.given)
    expect(plans(finance)).toHaveLength(1)
    expect(plans(finance)[0]).toMatchObject({ source: 'salary', sourceId: 'a', period: KEY, by: 'a', total: 700_000 })
    expect(plans(finance)[0]!.parts).toEqual(mine.map((x) => ({ target: x.goalId, amount: x.given })))
    expect(q('[data-put-all]')).toBeNull()
    expect(all('[data-put-done]')).toHaveLength(mine.length)
    expect(txt(q('[data-section="queue"] [data-section-meta]'))).toBe(`${mine.length} из ${mine.length} отложено`)
    expect(q('[data-section="queue"] [data-section-dot]')).toBeNull()
    expect(finance.planCall()).toBeNull()
    // План считает от начала месяца — суммы строк прежние.
    expect(planOf(finance).queue.map((x) => x.given)).toEqual(plan.queue.map((x) => x.given))
  })

  it('«Отложил» у одной цели и «Не отложено»: взнос остатком до плана, запись — надгробие после снятия; второй раз не кладётся', async () => {
    const finance = await open()
    const given = planOf(finance).queue.find((x) => x.id === 'trip')!.given
    const have0 = finance.goals.find((g) => g.id === 'trip')!.have
    await press(section('queue'))
    await press(q('[data-queue="trip"]'))
    const sheet = txt(q('[role="dialog"]'))
    expect(sheet).toContain('Отпуск')
    expect(sheet).toContain('сентябрь · откладывает Ильяс')
    expect(sheet).toContain(norm(money(given)))
    await press(dialogButton('Отложил'))
    expect(finance.goals.find((g) => g.id === 'trip')!.have).toBe(have0 + given)
    expect(plans(finance)).toHaveLength(1)
    expect(plans(finance)[0]!.parts).toEqual([{ target: 'trip', amount: given }])
    expect(q('[data-queue="trip"] [data-put-done]')).not.toBeNull()
    expect(q('[data-queue="car"] [data-put-done]')).toBeNull()
    // Остальные ещё ждут — «Отложил всё» без отпуска, точка на месте.
    expect(txt(q('[data-put-all]'))).not.toContain(norm(money(putsOf(finance).reduce((s, p) => s + p.amount, 0))))
    expect(finance.planCall()).toBe(KEY)
    // Отложенная: «✓ Отложено» и «Не отложено»; кнопки «Отложил» нет — дважды не положить.
    await press(q('[data-queue="trip"]'))
    expect(q('[role="dialog"] [data-put]')).not.toBeNull()
    expect(q('[role="dialog"] [data-put-one]')).toBeNull()
    await press(dialogButton('Не отложено'))
    expect(finance.goals.find((g) => g.id === 'trip')!.have).toBe(have0)
    expect(plans(finance)).toHaveLength(0)
    expect(q('[data-queue="trip"] [data-put-done]')).toBeNull()
    // И снова в делах — той же суммой плана.
    expect(putsOf(finance).find((p) => p.id === 'trip')).toMatchObject({ put: 0, left: given, done: false, undo: 0 })
  })

  it('взнос руками на экране цели — строка с ✓, «Не отложено» не предлагается (снимать нечего)', async () => {
    const finance = await open()
    const given = planOf(finance).queue.find((x) => x.id === 'trip')!.given
    finance.contribute('trip', given, 'a', 'взнос')
    await flush()
    await press(section('queue'))
    expect(q('[data-queue="trip"] [data-put-done]')).not.toBeNull()
    await press(q('[data-queue="trip"]'))
    expect(q('[role="dialog"] [data-put]')).not.toBeNull()
    expect(dialogButton('Не отложено')).toBeUndefined()
  })

  it('зарплата не пришла — «Отложил всё» и точки нет; цель всё равно отмечается нажатием', async () => {
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: (doc.payments ?? []).filter((p) => p.kind !== 'salary') })
    expect(finance.planCall()).toBeNull()
    await press(section('queue'))
    expect(q('[data-put-all]')).toBeNull()
    expect(q('[data-section="queue"] [data-section-dot]')).toBeNull()
    await press(q('[data-queue="trip"]'))
    expect(dialogButton('Отложил')).toBeTruthy()
  })

  it('«Освободится» — подсказкой у своего платежа с точкой на «Платежах»; кнопка тихая, пока зарплата не отложена', async () => {
    const doc = familyDoc()
    const obligations = doc.obligations.map((o) => (o.id === 'rent' ? { ...o, versions: [{ from: '2000-01', amount: 220_000 }, { from: '2026-11', amount: 150_000 }] } : o))
    const finance = await open('member', { ...doc, obligations })
    expect(q('[data-section="dues"] [data-section-dot]')).not.toBeNull()
    await press(section('dues'))
    const tip = q('[data-freed]')!
    expect(txt(tip)).toContain(norm(`С ноября свободно +${plain(70_000)} в месяц`))
    expect(q('[data-due-id="obligation:rent"]')!.nextElementSibling).toBe(tip)
    const button = tip.querySelector('button')!
    expect(txt(button)).toBe('К «Отпуск»')
    expect(button.className).toContain('bg-surface-3')
    const monthly = finance.goals.find((g) => g.id === 'trip')!.monthly
    await press(button)
    expect(finance.goals.find((g) => g.id === 'trip')!.monthly).toBe(monthly + 70_000)
    expect(q('[data-freed]')).toBeNull()
    expect(q('[data-section="dues"] [data-section-dot]')).toBeNull()
  })

  it('строка зарплаты — лист: своя и ждём — «Пришла зарплата»; чужая — без «Пришла»; пришедшая — отметка; у всех — «Изменить оклад»', async () => {
    const doc = familyDoc()
    await open('member', { ...doc, payments: (doc.payments ?? []).filter((p) => p.kind !== 'salary') })
    await press(q('[data-salary="a"]'))
    expect(txt(q('[role="dialog"]'))).toContain('Зарплата · Ильяс')
    expect(txt(q('[role="dialog"]'))).toContain('ждём 10 сентября')
    expect(dialogButton('Пришла зарплата')).toBeTruthy()
    expect(dialogButton('Другая сумма или счёт')).toBeTruthy()
    expect(dialogButton('Изменить оклад')).toBeTruthy()
    // Чужую зарплату не отмечают (Р-13) — в листе только оклад.
    await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
    await press(q('[data-salary="b"]'))
    expect(txt(q('[role="dialog"]'))).toContain('Зарплата · Аруна')
    expect(dialogButton('Пришла зарплата')).toBeUndefined()
    // «Изменить оклад» — лист оклада (сумма, день, валюта): из «Денег» он ушёл вместе с виджетом «Доход».
    await press(dialogButton('Изменить оклад'))
    expect(txt(q('[role="dialog"]'))).toContain('Аруна')
    expect(q('[role="dialog"] input')).not.toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open()
    await press(q('[data-salary="a"]'))
    expect(txt(q('[role="dialog"]'))).toContain('пришла 10 сентября')
    expect(dialogButton('Пришла зарплата')).toBeUndefined()
    await press(dialogButton('Другая сумма или снять'))
    expect(txt(q('[role="dialog"]'))).toContain('Снять отметку')
  })

  it('«Внеплановый доход» — тихо в карточке зарплат и по адресу из «+» (`?income=1`)', async () => {
    await open()
    expect(q('[role="dialog"]')).toBeNull()
    await press(q('[data-extra-income]'))
    expect(q('[role="dialog"]')).not.toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', familyDoc(), '/month?income=1')
    await flush()
    expect(q('[role="dialog"]')).not.toBeNull()
  })

  it('ссылка «Истории» `/month?month=` — сводка того месяца; вкладка «План» без ?month= — снова текущий', async () => {
    await open()
    expect(q('[data-rest]')).not.toBeNull()
    const router = app!.config.globalProperties.$router
    await router.push('/month?month=2026-08')
    await flush()
    expect(q('[data-month-past]')).not.toBeNull()
    expect(q('[data-month-past] img')).toBeNull()
    expect(txt(q('[data-month-nav]'))).toContain('Август')
    await router.push('/month')
    await flush()
    expect(q('[data-rest]')).not.toBeNull()
    expect(txt(q('[data-month-nav]'))).toContain('Сентябрь')
  })

  it('прошлый месяц с пришедшей неотложенной зарплатой — планом с «Отложил всё»; без своих целей — сводкой', async () => {
    const august = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: null, at: '2026-08-10T05:00:00.000Z' })
    const doc = familyDoc()
    await open('member', { ...doc, payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08')
    await flush()
    expect(q('[data-month-past]')).toBeNull()
    await press(section('queue'))
    expect(q('[data-put-all]')).not.toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', { ...doc, goals: [], payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08')
    await flush()
    expect(q('[data-month-past]')).not.toBeNull()
  })

  it('прошлый месяц планом: цель по одной не отмечается (запись закрыла бы месяц сводкой) — только «Отложил всё» (критик)', async () => {
    const august = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: null, at: '2026-08-10T05:00:00.000Z' })
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08')
    await flush()
    await press(section('queue'))
    await press(q('[data-queue="trip"]'))
    expect(q('[role="dialog"] [data-put-one]')).toBeNull()
    expect(plans(finance)).toHaveLength(0)
    expect(q('[data-put-all]')).not.toBeNull()
  })

  it('«Отложил всё» прошлого месяца — взносы в том месяце: у сентября ✓ без нажатия нет (ревью frontend Н-2)', async () => {
    const august = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: null, at: '2026-08-10T05:00:00.000Z' })
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08')
    await flush()
    const doneBefore = putsOf(finance).filter((p) => p.done).map((p) => p.id)
    const moved = () => finance.householdDoc.goals!.flatMap((g) => g.movements ?? [])
    const movesBefore = moved().length
    await press(section('queue'))
    await press(q('[data-put-all]'))

    const [record] = plans(finance)
    expect(plans(finance)).toHaveLength(1)
    expect(record!.period).toBe('2026-08')
    const fresh = moved().slice(movesBefore)
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.every((m) => monthKey(new Date(m.date)) === '2026-08')).toBe(true)
    // Август: «Отложили» = сумма записи; сентябрь: ни одной новой ✓ — его взносы ждут «Отложил».
    const past = monthPlanPast({ ...finance.householdDoc, credits: finance.credits, book: useFxStore().book }, '2026-08')
    expect(past.put).toBe(record!.parts.reduce((s, x) => s + x.amount, 0))
    expect(putsOf(finance).filter((p) => p.done).map((p) => p.id)).toEqual(doneBefore)

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', JSON.parse(JSON.stringify(finance.householdDoc)), '/month')
    await flush()
    await press(section('queue'))
    expect(q('[data-put-done]')).toBeNull()
    expect(q('[data-put-all]')).not.toBeNull()
  })

  it('прошлый месяц: всё отложили, затем «Не отложено» — открывается планом с «Отложил всё», не сводкой (ревью frontend Н-3)', async () => {
    const august = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: null, at: '2026-08-10T05:00:00.000Z' })
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08')
    await flush()
    // Ильяс в августе положил в каждую свою строку её сумму и снял обратно.
    const mine = finance.monthPlanOf('2026-08').queue.filter((x) => x.payer === 'a' && x.goalId && x.given > 0)
    expect(mine.length).toBeGreaterThan(0)
    for (const x of mine) {
      finance.contribute(x.goalId!, x.given, 'a', 'по плану', '2026-08-20T07:00:00.000Z')
      finance.withdraw(x.goalId!, x.given, 'a', 'не отложено', '2026-08-21T07:00:00.000Z')
    }
    app?.unmount()
    document.body.innerHTML = ''
    await open('member', JSON.parse(JSON.stringify(finance.householdDoc)), '/month?month=2026-08')
    await flush()
    expect(q('[data-month-past]')).toBeNull()
    await press(section('queue'))
    expect(q('[data-put-all]')).not.toBeNull()
  })

  it('строки платежа, зарплаты и цели — без «кнопки в кнопке»: одна кнопка-строка, плательщик и выключатель — отдельно (ревью frontend Н-7)', async () => {
    const reopen = async () => {
      app?.unmount()
      document.body.innerHTML = ''
      await open()
    }
    await open()
    const rows: [string, 'dues' | 'queue' | null][] = [['[data-due-id="obligation:rent"]', 'dues'], ['[data-salary="a"]', null], ['[data-queue="trip"]', 'queue']]
    for (const [sel, k] of rows) {
      if (k) await press(section(k))
      expect(q('[role="button"]'), sel).toBeNull()
      const row = q(sel)!
      expect(row, sel).toBeTruthy()
      const main = row.querySelector<HTMLElement>('[data-row-open]')!
      expect(main.tagName, sel).toBe('BUTTON')
      expect(main.querySelector('button, [role="switch"]'), sel).toBeNull()
      expect(row.querySelectorAll('[data-row-open]'), sel).toHaveLength(1)
    }
    expect(q('[data-queue="trip"] button[aria-label^="Платит"]')).not.toBeNull()
    expect(q('[data-queue="trip"] [role="switch"]')).not.toBeNull()

    // Кнопка строки открывает лист своего предмета; кружок — лист плательщика, не лист строки.
    await reopen()
    await press(section('dues'))
    await press(q('[data-due-id="obligation:rent"] [data-row-open]'))
    expect(dialogButton('Оплатил')).toBeDefined()
    await reopen()
    await press(section('dues'))
    expect(txt(q('[data-due-id="obligation:rent"] [data-row-open]'))).toContain('Аренда')
    await press(q('[data-due-id="obligation:rent"] button[aria-label^="Платит"]'))
    expect(txt(q('[role="dialog"]'))).toContain('Кто платит')
    expect(dialogButton('Оплатил')).toBeUndefined()
    await reopen()
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(q('[role="dialog"]')).not.toBeNull()
  })

  it('viewer — тот же план без переключателя вида, выключателей, ⋮⋮, плательщиков, листов и кнопок', async () => {
    const finance = await open('viewer')
    expect(txt(q('[data-rest]'))).toBe(norm(money(planOf(finance).rest)))
    expect(q('[data-plan-view]')).toBeNull()
    expect(txt(document.body)).toContain('просмотр')
    expect(q('[data-extra-income]')).toBeNull()
    expect(finance.planCall()).toBeNull()
    expect(q('[data-section-dot]')).toBeNull()
    await press(section('dues'))
    expect(all('button').some((b) => b.getAttribute('aria-label')?.startsWith('Платит'))).toBe(false)
    await press(q('[data-due-id="obligation:rent"]'))
    expect(q('[role="dialog"]')).toBeNull()
    await press(section('queue'))
    expect(q('[data-queue] [role="switch"]')).toBeNull()
    expect(q('[data-grip]')).toBeNull()
    expect(q('[data-put-all]')).toBeNull()
    // Критик Б17: дата и «хватает» — только в листе зарплаты (Р-116), viewer открывает его для чтения — без кнопок.
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(q('[role="dialog"] [data-salary-status]')).not.toBeNull()
    expect(q('[role="dialog"] [data-salary-edit], [role="dialog"] [data-salary-paid]')).toBeNull()
    expect([...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent?.trim())).not.toContain('Пришла зарплата')
  })

  it('‹ — прошлый месяц сводкой (только чтение), › — обратно к плану', async () => {
    await open()
    await press(all('button').find((b) => b.getAttribute('aria-label') === 'Прошлый месяц'))
    expect(q('[data-month-past]')).not.toBeNull()
    expect(q('[data-rest]')).toBeNull()
    expect(txt(q('[data-month-nav]'))).toContain('Август')
    await press(all('button').find((b) => b.getAttribute('aria-label') === 'Следующий месяц'))
    expect(q('[data-rest]')).not.toBeNull()
  })
})

/**
 * Р-116 (B2C-108): «Свободно по выпискам» и «До зарплаты N дней» переехали с «Мечт» в подсказку у «Остаётся».
 * Семья — `planFamilyDoc` (доход 1 200 000), «сейчас» — четверг 17 сентября 2026, ближняя зарплата — Аруна, 20-е.
 */
describe('ML-01: хвост 960 устарел — траты на жизнь заводятся у семьи без обязательств', () => {
  it('«Введу вручную» без обязательств и трат: «+ Траты · <имя>» у каждого; ввод суммы — она в плане месяца', async () => {
    const base = planFamilyDoc()
    const doc = planFamilyDoc({
      obligations: [],
      credits: [],
      goals: [],
      categories: base.categories.map((c) => ({ ...c, amount: 0 })),
      spendPlans: [],
    })
    const finance = await open('member', doc)
    expect(planOf(finance).spendTotal).toBe(0)
    await press(section('spend'))
    expect(all('[data-spends] button').map((b) => txt(b).slice(txt(b).indexOf('+')))).toEqual(['+ Траты · Ильяс', '+ Траты · Аруна'])
    await press(all('[data-spends] button')[0])
    expect(txt(q('[role="dialog"] h3'))).toContain('Траты на месяц')
    const input = q<HTMLInputElement>('[role="dialog"] input[inputmode]')!
    input.value = '120000'
    input.dispatchEvent(new Event('input'))
    await press(dialogButton('Готово'))
    expect(planOf(finance).spendTotal).toBe(120_000)
    expect(txt(section('spend'))).toContain(norm(plain(120_000)))
  })
})

describe('B2C-108: подсказка у «Остаётся» — «Свободно» по выпискам и дни до зарплаты (бывшая строка «Мечт»)', () => {
  const total = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number): SpendTotal => ({
    id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: T0,
  })
  const upload = (slot: 'a' | 'b', id: string, from = '2026-09-01', to = '2026-09-17') =>
    ({ id, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 10, created_at: T0 })
  async function openWith(uploads: ReturnType<typeof upload>[], extra: Partial<SyncDoc> = {}, role: 'member' | 'viewer' = 'member') {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads } as never)
    const finance = await open(role, planFamilyDoc(extra))
    await useOperationsStore().loadUploads()
    await flush()
    await press(q('button[aria-label="Остаётся"]'))
    return finance
  }

  it('«Свободно» = freeByFact().amount (посчитано руками) · «До зарплаты N дней» = untilPayday().inDays', async () => {
    const totals = [
      total('a', 'week', '2026-W38', 'sc_food', 62_000),
      total('a', 'month', '2026-09', 'sc_food', 184_000),
      total('a', 'month', '2026-09', 'sc_credit', 58_000),
      total('a', 'month', '2026-09', '_unknown', 40_000),
    ]
    const store = await openWith([upload('a', 'u1')], { spendTotals: totals })
    // Свободно = доход 1 200 000 − обязательства и кредиты сентября 323 000 (аренда 220 000, кредит
    // 58 000, кредитка 25 000, рассрочка 20 000) − взносы в цели 130 000 − траты по выписке 224 000
    // (продукты 184 000 + не разобрано 40 000; кредит 58 000 уже в плане — не вычитается) = 523 000.
    const days = untilPayday({ people: store.people, obligations: store.obligations, credits: store.credits, accounts: store.householdAccounts, payments: store.payments })!.inDays
    expect(days).toBe(3) // Аруна, 20-е
    expect(txt(q('[role="note"] [data-free]'))).toBe(norm(`Свободно по выпискам — ${money(523_000)}.`))
    expect(txt(q('[role="note"] [data-payday]'))).toBe('До зарплаты 3 дня.')
    // На кольце — одно крупное число; «Свободно» строкой не показано.
    expect(txt(document.body).replace(txt(q('[role="note"]')), '')).not.toContain('Свободно')
  })

  it('до первой выписки — без «Свободно», только «До зарплаты N дней»; у viewer — то же', async () => {
    await openWith([])
    expect(q('[role="note"] [data-free]')).toBeNull()
    expect(txt(q('[role="note"] [data-payday]'))).toBe('До зарплаты 3 дня.')
    app?.unmount()
    app = null
    document.body.innerHTML = ''
    await openWith([], {}, 'viewer')
    expect(txt(q('[role="note"] [data-payday]'))).toBe('До зарплаты 3 дня.')
  })

  it('выписки только за прошлый месяц — «Свободно» нет: freeByFact без факта отдаёт «остаток по плану» (Р-47, критик Б10)', async () => {
    await openWith([upload('a', 'u0', '2026-08-01', '2026-08-31')])
    expect(q('[role="note"] [data-free]')).toBeNull()
    expect(txt(q('[role="note"] [data-payday]'))).toBe('До зарплаты 3 дня.')
  })
})
