// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type ComponentInternalInstance, type VNode } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { closerDays, goalPace, lastAccountFor, monthPlan, monthPlanPast, pendingPuts, planByFact, planPuts, spendCompare, untilPayday, type HabitImage, type MonthPlanCtx, type ReviewCard, type ReviewCardTarget } from '@/lib/finance'
import { plural } from '@/lib/utils'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import { periodsOf, spendTotals } from '@/lib/statements/model'
import { monthKey } from '@/lib/dates'
import { money, plain } from '@/lib/money'
import type { AiAdvice, AiReview, Obligation, Payment, SyncDoc } from '@/types/finance'
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

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc(), path = '/month', slot: 'a' | 'b' = 'a') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
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
    expect(q('[data-salary="a"][data-came]')).not.toBeNull()
    expect(q('[data-salary="b"][data-came]')).toBeNull()
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

  it('FB-19 (Р-30): малое кольцо 112 без дуг зарплат, «Остаётся» справа, чипы в карточке, разделы в ней же с одной точкой; зарплаты ниже, пришла — подсветка без ✓', async () => {
    const finance = await open()
    const plan = planOf(finance)
    const top = q('[data-month-top]')!
    // Кольцо: одна дорожка + дуги частей (платежи · траты · цели), внешних дуг зарплат нет; размер 112.
    const ring = top.querySelector<HTMLElement>('[data-month-ring]')!
    expect(ring.style.width).toBe('112px')
    expect(ring.querySelectorAll('circle[data-part]').length).toBe(3)
    expect(ring.querySelectorAll('circle').length).toBe(4)
    expect(ring.querySelector('circle')!.getAttribute('r')).toBe('88')
    // «Остаётся» и число — в карточке рядом с кольцом (не в его центре), число ≤ 34 px.
    expect(ring.textContent!.trim()).toBe('')
    expect(txt(top.querySelector('[data-rest]'))).toBe(norm(money(plan.rest)))
    expect(top.querySelector('[data-rest]')!.className).toContain('text-[29px]')
    expect(top.querySelector('[data-rest-hint]')).not.toBeNull()
    expect(top.querySelector('[data-afford-open]')).not.toBeNull()
    // Разделы — в той же карточке: одна точка (цвет раздела), второй точки-призыва нет.
    expect(top.querySelector('[data-sections]')).not.toBeNull()
    expect(q('[data-section-dot]')).toBeNull()
    for (const s of all('[data-section]')) expect(s.querySelectorAll('.rounded-full').length).toBe(1)
    // Призыв у «Целей» (взносы ждут «Отложил») — подписью брендом.
    expect(q('[data-section="queue"] [data-section-call]')!.className).toContain('text-brand')
    expect(q('[data-section="dues"] [data-section-call]')).toBeNull()
    // Карточка зарплат — после карточки с разделами; пришла — строка с `data-came` и `bg-ok-soft`, без ✓ и «N из M пришли»; ждущая — тихая сумма.
    expect(top.compareDocumentPosition(q('[data-salary="a"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(q('[data-salary="a"]')!.className).toContain('bg-ok-soft')
    expect(q('[data-salary="b"]')!.className).not.toContain('bg-ok-soft')
    expect(txt(q('[data-salary="a"]'))).not.toContain('✓')
    expect(q('[data-came-count]')).toBeNull()
    expect(q('[data-salary="b"] b')!.className).toContain('text-ink-2')
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
    // AU-02: раскрытая «Траты» — разделы семьи (выписок нет — план), а не блоки участников.
    expect(q('[data-spend]')).toBeNull()
    expect(txt(q('[data-spend-row="sc_taxi"] [data-spend-amount]'))).toBe(norm(`план ${plain(80_000)}`))
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

  it('PN-27: «Подписки» по «чья» — «Общие · 2» (с пакетом), «Аруна · 1»; «N из M» — у всей группы; viewer видит', async () => {
    const doc = familyDoc()
    doc.obligations = doc.obligations.map((o) => (o.id === 'icloud' ? { ...o, who: 'b' as const } : o))
    for (const role of ['member', 'viewer'] as const) {
      app?.unmount()
      document.body.innerHTML = ''
      await open(role, doc)
      await press(section('dues'))
      expect(txt(q('[data-subs-status]'))).toBe('1 из 3 списались')
      await press(q('[data-subs]')!.querySelector('button'))
      expect(all('[data-subs-who]').map((el) => [el.dataset.subsWho, txt(el)])).toEqual([['all', 'Общие · 2'], ['b', 'Аруна · 1']])
      // Пакет «Кино и музыка» — внутри «Общих», iCloud — после подзаголовка Аруны.
      const order = all('[data-subs-who], [data-subs] p, [data-subs] [data-due]').map((el) => el.dataset.subsWho ?? el.dataset.dueId ?? txt(el))
      expect(order).toEqual(['all', 'Кино и музыка', 'obligation:netflix', 'obligation:spotify', 'b', 'obligation:icloud'])
    }
  })

  it('PN-27: один «чья» у всех подписок — подзаголовков нет', async () => {
    await open()
    await press(section('dues'))
    await press(q('[data-subs]')!.querySelector('button'))
    expect(all('[data-subs-who]')).toHaveLength(0)
    expect(all('[data-subs] [data-due]')).toHaveLength(3)
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
    expect(q('[data-section="queue"] [data-section-call]')).not.toBeNull()
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
    expect(q('[data-section="queue"] [data-section-call]')).toBeNull()
    expect(finance.planCall()).toBeNull()
    // План считает от начала месяца — суммы строк прежние.
    expect(planOf(finance).queue.map((x) => x.given)).toEqual(plan.queue.map((x) => x.given))
  })

  it('PN-09: «Отложил всё» — один тост «{первая цель} ближе на N дней · и ещё M целей» (фонд не считается); «Отложил» у одной — без «и ещё»', async () => {
    // «Подушка» — фонд (Р-82), машина просит 60 000 — остатка хватает всем троим: ждут две цели и фонд.
    const doc = familyDoc()
    doc.goals = doc.goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : g.id === 'car' ? { ...g, monthly: 60_000 } : g))
    const finance = await open('member', doc)
    const goalsOf = () => pendingPuts(putsOf(finance)).filter((p) => p.kind === 'goal' && p.left > 0)
    const daysOf = (p: { goalId: string | null; left: number }) => closerDays(p.left, goalPace(finance.goals.find((g) => g.id === p.goalId)!, KEY))!
    const all0 = goalsOf()
    expect(all0.map((p) => p.name)).toEqual(['Отпуск', 'Машина'])
    expect(pendingPuts(putsOf(finance)).map((p) => p.kind)).toEqual(['goal', 'goal', 'fund'])
    const d = daysOf(all0[0])
    await press(section('queue'))
    await press(q('[data-put-all]'))
    expect(txt(q('[data-closer]'))).toBe(`Отпуск ближе на ${d} ${plural(d, 'день', 'дня', 'дней')} · и ещё 1 цель`)

    // Одна цель: лист «Отложил» → тост без «и ещё».
    app?.unmount()
    document.body.innerHTML = ''
    const finance2 = await open()
    const trip = pendingPuts(putsOf(finance2)).find((p) => p.id === 'trip')!
    const d2 = closerDays(trip.left, goalPace(finance2.goals.find((g) => g.id === 'trip')!, KEY))!
    await press(section('queue'))
    await press(q('[data-queue="trip"]'))
    await press(dialogButton('Отложил'))
    expect(txt(q('[data-closer]'))).toBe(`Отпуск ближе на ${d2} ${plural(d2, 'день', 'дня', 'дней')}`)
  })

  it('PN-09: ни одной цели с темпом (только фонд ждёт «Отложил») — тоста нет', async () => {
    const doc = familyDoc()
    // Отпуск и машина выключены — ждёт только «Подушка» (фонд): у подушки «дней» нет.
    doc.goals = doc.goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : { ...g, pausedAt: T0 }))
    const finance = await open('member', doc)
    const pending = pendingPuts(putsOf(finance))
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((p) => p.kind !== 'goal')).toBe(true)
    await press(section('queue'))
    await press(q('[data-put-all]'))
    expect(q('[data-closer]')).toBeNull()
    expect(all('[data-put-done]')).toHaveLength(pending.length)
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
    expect(q('[data-section="queue"] [data-section-call]')).toBeNull()
    await press(q('[data-queue="trip"]'))
    expect(dialogButton('Отложил')).toBeTruthy()
  })

  it('«Освободится» — подсказкой у своего платежа с точкой на «Платежах»; кнопка тихая, пока зарплата не отложена', async () => {
    const doc = familyDoc()
    const obligations = doc.obligations.map((o) => (o.id === 'rent' ? { ...o, versions: [{ from: '2000-01', amount: 220_000 }, { from: '2026-11', amount: 150_000 }] } : o))
    const finance = await open('member', { ...doc, obligations })
    expect(q('[data-section="dues"] [data-section-call]')).not.toBeNull()
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
    expect(q('[data-section="dues"] [data-section-call]')).toBeNull()
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

  it('RZ-13: прошлый месяц планом — лист раздела по `?month=&cat=` с названием месяца, без «Изменить»; текущий — с ним (критик Блока 3)', async () => {
    const august = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: null, at: '2026-08-10T05:00:00.000Z' })
    // У Ильяса — свой план «Продуктов» (FB-12: лист раздела — только свой план).
    const doc = familyDoc({ spendPlans: [...familyDoc().spendPlans!, { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 40_000, updatedAt: T0 }] })
    await open('member', { ...doc, payments: [...(doc.payments ?? []), august] }, '/month?month=2026-08&cat=sc_food')
    await flush()
    expect(q('[data-month-past]')).toBeNull()
    expect(txt(q('[role="dialog"] h3'))).toBe('Продукты')
    expect(txt(q('[role="dialog"] [data-cat-month]'))).toBe('август')
    expect(q('[role="dialog"] [data-cat-person="a"]')).not.toBeNull()
    expect(q('[role="dialog"] [data-cat-person="b"]')).toBeNull()
    // План раздела общий на будущее — из прошлого месяца не правится.
    expect(q('[role="dialog"] [data-cat-edit]')).toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', doc, '/month?cat=sc_food')
    await flush()
    // Текущий месяц не называется — он и так на экране (`/ux` Блока 3).
    expect(txt(q('[role="dialog"] h3'))).toBe('Продукты')
    expect(q('[role="dialog"] [data-cat-month]')).toBeNull()
    expect(q('[role="dialog"] [data-cat-edit]')).not.toBeNull()
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
    expect(q('[data-section-call]')).toBeNull()
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
 * PN-02 (хвост 1022, правило 12 «действие у предмета»): «Пришла» — тихой кнопкой у своей открытой строки зарплаты;
 * та же одна отметка, что «Пришла зарплата» в листе (`useSalaryTap`), лист строки не открывает. 12 сентября: зарплата
 * Ильяса (10-го) открыта, Аруны (20-го) — нет.
 */
describe('PN-02: «Пришла» у своей строки зарплаты в «Месяце»', () => {
  /** В августе зарплата Ильяса пришла на карту — счёт для одного нажатия (Р-5). */
  const augustSalary = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: 'card', at: '2026-08-10T05:00:00.000Z' })
  /** Сентябрь не отмечен (строка открыта); прошлые отметки — `history`. */
  const waiting = (history: Payment[] = [augustSalary]) => {
    const doc = familyDoc()
    return { ...doc, payments: [...(doc.payments ?? []).filter((p) => p.kind !== 'salary'), ...history] }
  }
  const salaries = (finance: ReturnType<typeof useFinanceStore>) => finance.payments.filter((p) => !p.deletedAt && p.kind === 'salary' && p.period === KEY)

  it('кнопка только у своей открытой (canMark): у Ильяса есть, у Аруны нет; партнёр (слот b) и viewer — без кнопки; кнопка тихая', async () => {
    await open('member', waiting())
    const btn = q('[data-salary="a"][data-can-mark] [data-salary-came-btn]')
    expect(btn).not.toBeNull()
    expect(txt(btn)).toBe('Пришла')
    expect(q('[data-salary="b"] [data-salary-came-btn]')).toBeNull()
    // Не брендовая: главная кнопка экрана одна (правило 12); не внутри кнопки-строки (ревью Н-7).
    expect(btn!.className).not.toContain('bg-brand ')
    expect(btn!.closest('[data-row-open]')).toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', waiting(), '/month', 'b')
    expect(q('[data-salary="a"] [data-salary-came-btn]')).toBeNull()
    expect(q('[data-salary="b"] [data-salary-came-btn]')).toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('viewer', waiting())
    expect(q('[data-salary-came-btn]')).toBeNull()
  })

  it('нажатие — одна отметка на счёт прошлого раза, лист не открывается; после — ✓ у суммы, кнопки нет; в листе — «Другая сумма или снять»', async () => {
    const finance = await open('member', waiting())
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(salaries(finance)).toHaveLength(1)
    expect(salaries(finance)[0]).toMatchObject({ targetId: 'a', period: KEY, amount: 700_000, accountId: 'card', by: 'a' })
    expect(q('[data-salary="a"][data-came]')).not.toBeNull()
    expect(q('[data-salary="a"] [data-salary-came-btn]')).toBeNull()
    // Та же отметка, что в листе: лист — «пришла», без «Пришла зарплата», с «Другая сумма или снять».
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(txt(q('[role="dialog"] [data-salary-status]'))).toContain('пришла')
    expect(dialogButton('Пришла зарплата')).toBeUndefined()
    expect(dialogButton('Другая сумма или снять')).toBeTruthy()
  })

  it('прошлого счёта нет — лист отметки «спрашиваем один раз» (не лист зарплаты), записи пока нет; строка по-прежнему открывает лист зарплаты', async () => {
    const finance = await open('member', waiting([]))
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(txt(q('[role="dialog"]'))).toContain('Спрашиваем один раз')
    expect(q('[role="dialog"] [data-salary-status]')).toBeNull()
    expect(salaries(finance)).toHaveLength(0)
    await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
    expect(q('[role="dialog"]')).toBeNull()
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(q('[role="dialog"] [data-salary-status]')).not.toBeNull()
    expect(dialogButton('Пришла зарплата')).toBeTruthy()
  })
})

/**
 * AP-11 (бэклог «Apple Pay», Р-22): приход из пуша банка, похожий на свою неотмеченную зарплату (`matchCandidates`,
 * допуски выписки), — точка у «Пришла» строки; сумма, банк и день — в листе зарплаты; «Пришла» отмечает приход его
 * суммой и операцией (как «Да» в вопросе «Недели»), точка уходит. 12 сентября: зарплата Ильяса (10-го, 700 000) открыта.
 */
describe('AP-11: точка «Пришла?» у зарплаты — приход из пуша', () => {
  const augustSalary = paid('salary', 'a', '2026-08', 700_000, { id: 'sal-a-08', accountId: 'card', at: '2026-08-10T05:00:00.000Z' })
  const waiting = () => {
    const doc = familyDoc()
    return { ...doc, payments: [...(doc.payments ?? []).filter((p) => p.kind !== 'salary'), augustSalary] }
  }
  const income = (over: Partial<Operation> = {}): Operation => ({
    id: 'aa00aa00aa00aa01', bank: 'freedom', date: '2026-09-11', amount: 690_000, kind: 'income', merchant: 'Зарплата',
    categoryId: null, internal: false, source: 'push', at: '2026-09-11T04:00:00Z', ...over,
  })
  async function withIncome(op: Operation | null, role: 'member' | 'viewer' = 'member') {
    const finance = await open(role, waiting())
    if (op) useOperationsStore().ops[op.id] = op
    await flush()
    return finance
  }
  const salaries = (finance: ReturnType<typeof useFinanceStore>) => finance.payments.filter((p) => !p.deletedAt && p.kind === 'salary' && p.period === KEY)

  it('точка у «Пришла» своей строки; в листе — «Пришло?» с суммой, банком и днём; «Пришла зарплата» — суммой прихода, точка уходит', async () => {
    const finance = await withIncome(income())
    expect(q('[data-salary="a"] [data-arrival-dot]')).not.toBeNull()
    expect(q('[data-salary="b"] [data-arrival-dot]')).toBeNull()
    // На строке — только точка: суммы прихода там нет (правило 12, шумные цифры).
    expect(txt(q('[data-salary="a"]'))).not.toContain('690')

    await press(q('[data-salary="a"] [data-row-open]'))
    expect(txt(q('[role="dialog"] [data-salary-arrival] span'))).toBe('Пришло?')
    expect(txt(q('[role="dialog"] [data-salary-arrival] b'))).toBe(norm(`${money(690_000)} в Freedom · 11 сентября`))
    await press(dialogButton('Пришла зарплата'))
    expect(salaries(finance)).toHaveLength(1)
    expect(salaries(finance)[0]).toMatchObject({ targetId: 'a', amount: 690_000, opId: 'aa00aa00aa00aa01', source: 'statement', accountId: 'card' })
    expect(q('[data-arrival-dot]')).toBeNull()
  })

  it('«Пришла» в строке — та же отметка приходом (не окладом) на счёт прошлой зарплаты, лист не открывается', async () => {
    const finance = await withIncome(income())
    // Остаток счёта в сторе — уже с отметками (`accountBalance`).
    const before = finance.accounts[0].amount
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(q('[role="dialog"]')).toBeNull()
    // Критик Б2: приход зачислен, как обычной «Пришла», — остаток счёта вырос, следующая «Пришла» помнит счёт.
    expect(salaries(finance)[0]).toMatchObject({ amount: 690_000, opId: 'aa00aa00aa00aa01', accountId: 'card' })
    expect(finance.accounts[0].amount - before).toBe(690_000)
    expect(lastAccountFor(finance.payments, 'a', finance.accounts)).toBe('card')
  })

  it('первая зарплата (счёта ещё не было) — лист отметки с суммой прихода, счёт спросить один раз', async () => {
    const doc = waiting()
    const finance = await open('member', { ...doc, payments: (doc.payments ?? []).filter((p) => p.kind !== 'salary') })
    useOperationsStore().ops[income().id] = income()
    await flush()
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(salaries(finance)).toHaveLength(0)
    expect(document.body.innerHTML).toContain(plain(690_000))
  })

  it('точки нет: приход из выписки (там — вопрос «Недели»), сумма вне допуска, уже отмечено, viewer', async () => {
    await withIncome(income({ source: undefined }))
    expect(q('[data-arrival-dot]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''

    await withIncome(income({ amount: 500_000 }))
    expect(q('[data-arrival-dot]')).toBeNull()
    expect(q('[data-salary="a"] [data-salary-came-btn]')).not.toBeNull()
    app?.unmount()
    document.body.innerHTML = ''

    const finance = await withIncome(income())
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(salaries(finance)).toHaveLength(1)
    expect(q('[data-arrival-dot]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''

    await withIncome(income(), 'viewer')
    expect(q('[data-arrival-dot]')).toBeNull()
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
    // AU-02: вместо «+ Траты · <имя>» у каждого — одна тихая «+ Раздел»; чей план — выбор в листе (своё по умолчанию).
    expect(all('[data-spends] button').map((b) => txt(b))).toEqual(['+ Раздел'])
    await press(q('[data-spend-add]'))
    expect(txt(q('[role="dialog"] h3'))).toContain('Траты на месяц')
    expect(q('[role="dialog"] [data-spend-by]')).not.toBeNull()
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

describe('PN-20: строка «Подушки» в «Цели и фонды» — «хватит на N мес.»', () => {
  const asFund = (have: number, extra: Partial<SyncDoc> = {}) => {
    const doc = familyDoc(extra)
    return { ...doc, goals: doc.goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const, have, seed: have, movements: [] } : g)) }
  }

  it('подушка-фонд: подпись — месяцы одной десятой (та же `cushionCover`), у мечты подписи нет', async () => {
    const finance = await open('member', asFund(0))
    const spend = planOf(finance).duesTotal + planOf(finance).spendTotal
    app?.unmount()
    document.body.innerHTML = ''
    // 1,5 месяца трат: 1,5 × месяц трат плана.
    // Подушка первой в очереди — взнос даётся целиком, нехватки (она важнее подписи) нет.
    await open('member', asFund(Math.round(spend * 1.5), { goalOrder: { ids: ['cushion', 'trip', 'car'], updatedAt: T0 } }))
    await press(section('queue'))
    expect(txt(q('[data-queue="cushion"] [data-status]'))).toBe('хватит на 1,5 мес.')
    expect(q('[data-queue="cushion"] [data-status]')!.className).toContain('text-ink-2')
    expect(q('[data-queue="trip"] [data-status]')?.textContent ?? '').not.toContain('хватит')
  })

  it('на паузе — «на паузе», как у всех', async () => {
    const finance = await open('member', asFund(100_000))
    finance.pauseGoal('cushion', true)
    await flush()
    await press(section('queue'))
    expect(txt(q('[data-queue="cushion"] [data-status]'))).toBe('на паузе')
  })
})

/**
 * AU-02 (Р-5): раскрытая «Траты» — разделы всей семьи из `spendCompare`, точка у раздела выше обычного и у заголовка,
 * лист раздела. «Сейчас» — 17 сентября 2026; выписки Ильяса с 1 июня по 17 сентября — июнь…август полные.
 * Кафе: июнь–август по 30 000 → обычно 30 000; сентябрь 50 000 → точка; план 20 000 → «до плана: +10 000».
 * Продукты: по 100 000 → обычно 100 000; сентябрь 90 000 — без точки. План Аруны — продукты 150 000.
 */
describe('AU-02: траты на «Месяце» — свои разделы (FB-12), точка, лист раздела', () => {
  const total = (period: string, categoryId: string, amount: number): SpendTotal => ({
    id: `a:month:${period}:${categoryId}`, by: 'a', kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
  })
  const totals = [
    ...['2026-06', '2026-07', '2026-08'].flatMap((m) => [total(m, 'sc_cafe', 30_000), total(m, 'sc_food', 100_000)]),
    total(KEY, 'sc_cafe', 50_000), total(KEY, 'sc_food', 90_000),
  ]
  const spendPlans = [
    { id: 'a:sc_cafe', by: 'a' as const, categoryId: 'sc_cafe', amount: 20_000, updatedAt: T0 },
    { id: 'b:sc_food', by: 'b' as const, categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
  ]
  const fullUploads = [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-17', ops_count: 40, created_at: T0 }]
  async function openSpend(role: 'member' | 'viewer' = 'member', uploads = fullUploads, path = '/month', slot: 'a' | 'b' = 'a') {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads } as never)
    // Копии: стор правит массивы документа на месте («+ Раздел» дописал бы план в общий `spendPlans` следующим тестам).
    const finance = await open(role, planFamilyDoc({ spendTotals: [...totals], spendPlans: [...spendPlans] }), path, slot)
    await useOperationsStore().loadUploads()
    await flush()
    return finance
  }
  const compareOf = (finance: ReturnType<typeof useFinanceStore>) => {
    const { state, ctx } = finance.planInput(KEY)
    return spendCompare(state, ctx, 'a')
  }

  it('строки — свои разделы из spendCompare(…, by); точка у кафе и у заголовка «Траты»', async () => {
    const finance = await openSpend()
    const rows = compareOf(finance).rows
    expect(rows.map((r) => [r.categoryId, r.amount, r.over])).toEqual([['sc_food', 90_000, false], ['sc_cafe', 50_000, true]])
    expect(q('[data-section="spend"] [data-section-call]')).not.toBeNull()
    await press(section('spend'))
    expect(all('[data-spend-row]').map((el) => el.dataset.spendRow)).toEqual(['sc_food', 'sc_cafe'])
    expect(all('[data-spend-dot]').map((el) => el.closest<HTMLElement>('[data-spend-row]')!.dataset.spendRow)).toEqual(['sc_cafe'])
    expect(txt(q('[data-spend-row="sc_cafe"] [data-spend-amount]'))).toBe(norm(plain(50_000)))
    // «Не разобрано» в сентябре нет — тихой строки нет.
    expect(q('[data-spend-unknown]')).toBeNull()
  })

  it('Х-1, Х-3: «Не разобрано · N» внизу без точки (тихой строкой-кнопкой листа, FB-17); переводы людям — после трат, без точки', async () => {
    // «Не разобрано» 12 000; переводы: обычно 0, сентябрь 300 000 — крупнейшие, но последними и без точки.
    totals.push(total(KEY, '_unknown', 12_000), total(KEY, 'sc_people', 300_000))
    try {
      await openSpend()
      await press(section('spend'))
      expect(all('[data-spend-row]').map((el) => el.dataset.spendRow)).toEqual(['sc_food', 'sc_cafe', 'sc_people'])
      expect(q('[data-spend-row="sc_people"] [data-spend-dot]')).toBeNull()
      const unknown = q('[data-spend-unknown]')!
      expect([...unknown.children].map((el) => txt(el))).toEqual(['Не разобрано', norm(plain(12_000))])
      // FB-17: строка нажимается — лист «Не разобрано» (тест ниже); точки у неё нет.
      expect(unknown.tagName).toBe('BUTTON')
      expect(unknown.querySelector('[data-spend-dot]')).toBeNull()
      expect(unknown.nextElementSibling?.hasAttribute('data-spend-add')).toBe(true)
    } finally {
      totals.splice(-2)
    }
  })

  it('RZ-08: `?cat=sc_cafe` открывает лист раздела («Открыть» совета); закрытие снимает параметр; неизвестный раздел — ничего', async () => {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: fullUploads } as never)
    await open('member', planFamilyDoc({ spendTotals: totals, spendPlans }), '/month?cat=sc_cafe')
    await useOperationsStore().loadUploads()
    await flush()
    expect(q('[data-cat-amount]')).not.toBeNull()
    expect([...document.querySelectorAll('[role="dialog"] h3')].map(txt)).toContain('Кафе и рестораны')
    await press(all('[role="dialog"] button').find((b) => b.getAttribute('aria-label') === 'Закрыть'))
    const router = app!.config.globalProperties.$router
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month'))
    expect(q('[data-cat-amount]')).toBeNull()
    // Строка раздела по-прежнему открывает лист нажатием, адрес не меняется.
    await press(section('spend'))
    await press(q('[data-spend-row="sc_cafe"]'))
    expect(q('[data-cat-amount]')).not.toBeNull()
    expect(router.currentRoute.value.fullPath).toBe('/month')
    app!.unmount()
    app = null
    document.body.innerHTML = ''

    await open('member', planFamilyDoc({ spendTotals: totals, spendPlans }), '/month?cat=sc_nope')
    await useOperationsStore().loadUploads()
    await flush()
    expect(q('[data-cat-amount]')).toBeNull()
  })

  it('лист раздела: факт, обычно, план, «до плана» в мечту; «Изменить» — «Сколько в месяц» с суммой участника', async () => {
    const finance = await openSpend()
    const cafe = compareOf(finance).rows.find((r) => r.categoryId === 'sc_cafe')!
    expect(cafe.advice!.amount).toBe(10_000)
    await press(section('spend'))
    await press(q('[data-spend-row="sc_cafe"]'))
    expect(txt(q('[role="dialog"] h3'))).toBe('Кафе и рестораны')
    expect(txt(q('[role="dialog"] [data-cat-amount]'))).toBe(norm(money(50_000)))
    expect(txt(q('[role="dialog"] [data-cat-usual]'))).toBe(norm(`обычно у вас ${plain(30_000)}`))
    expect(txt(q('[role="dialog"] [data-cat-plan]'))).toBe(norm(`план ${plain(20_000)}`))
    expect(txt(q('[role="dialog"] [data-cat-advice]'))).toContain(norm(`до плана: +${plain(10_000)} в мечту «${cafe.advice!.goalName}»`))
    expect(q('[role="dialog"] [data-cat-rk]')).not.toBeNull()
    await press(q('[role="dialog"] [data-cat-person="a"] [data-cat-edit]'))
    expect(txt(q('[role="dialog"] h3'))).toBe('Сколько в месяц')
    expect(q<HTMLInputElement>('[role="dialog"] input[inputmode]')!.value).toBe(plain(20_000))
  })

  it('без выписок — план строкой, точек нет; план партнёра — не мой раздел', async () => {
    await openSpend('member', [])
    expect(q('[data-section="spend"] [data-section-call]')).toBeNull()
    await press(section('spend'))
    expect(q('[data-spend-dot]')).toBeNull()
    expect(txt(q('[data-spend-row="sc_cafe"] [data-spend-amount]'))).toBe(norm(`план ${plain(20_000)}`))
    // «Продукты» — только план Аруны: у Ильяса без выписок раздела нет.
    expect(q('[data-spend-row="sc_food"]')).toBeNull()
  })

  it('viewer — только строки участников: разделов, листа и «+ Раздел» нет', async () => {
    await openSpend('viewer')
    await press(section('spend'))
    expect(all('[data-spend-person]').map((el) => el.dataset.spendPerson)).toEqual(['a', 'b'])
    expect(all('[data-spend-row]')).toHaveLength(0)
    expect(q('[data-spend-mine]')).toBeNull()
    expect(q('[data-spend-add]')).toBeNull()
    expect(q('[data-section="spend"] [data-section-call]')).toBeNull()
  })

  it('«+ Раздел» — лист «Траты на месяц»; сохранённый план — строкой раздела', async () => {
    const finance = await openSpend()
    await press(section('spend'))
    await press(q('[data-spend-add]'))
    expect(txt(q('[role="dialog"] h3'))).toBe('Траты на месяц')
    const sel = q<HTMLSelectElement>('[role="dialog"] select')!
    sel.value = 'sc_transport'
    sel.dispatchEvent(new Event('change'))
    const input = q<HTMLInputElement>('[role="dialog"] input[inputmode]')!
    input.value = '25000'
    input.dispatchEvent(new Event('input'))
    await press(dialogButton('Готово'))
    expect(finance.householdDoc.spendPlans?.find((x) => x.id === 'a:sc_transport')?.amount).toBe(25_000)
    expect(q('[data-spend-row="sc_transport"]')).not.toBeNull()
  })

  /*
   * FB-12 (Р-7, Р-18): Ильяс (a) — выписка с июня, сентябрь: продукты 90 000 + кафе 50 000 = 140 000, план кафе 20 000;
   * Аруна (b) — выписок нет, план продуктов 150 000. Строки участников — «140 000 / 20 000» и «план 150 000».
   */
  it('FB-12: строки участников «факт / план», свой первым; ниже — «Мои разделы»', async () => {
    await openSpend()
    await press(section('spend'))
    expect(all('[data-spend-person]').map((el) => el.dataset.spendPerson)).toEqual(['a', 'b'])
    expect(txt(q('[data-spend-person="a"] [data-person-amount]'))).toBe(norm(`${plain(140_000)} / ${plain(20_000)}`))
    expect(txt(q('[data-spend-person="b"] [data-person-amount]'))).toBe(norm(`план ${plain(150_000)}`))
    // Строки участников — без кнопок (правило 12).
    expect(q('[data-spend-person] button')).toBeNull()
    expect(q('[data-spend-person]')!.tagName).toBe('DIV')
    expect(txt(q('[data-spend-mine]'))).toBe('Мои разделы')
    // Заголовок — общее «потрачено» семьи, как было.
    // Заголовок — призыв подписью (FB-19, Р-32): кафе выше обычного → «больше обычного» вместо «потрачено»; само «потрачено» — у строки участника.
    expect(txt(q('[data-section="spend"] [data-section-call]'))).toBe('больше обычного')
    expect(txt(q('[data-section="spend"] [data-section-meta]'))).toBe('больше обычного')
  })

  it('FB-12: партнёр — своя строка первой, свои разделы; разделов Ильяса нет; лист — «План» только свой', async () => {
    await openSpend('member', fullUploads, '/month', 'b')
    await press(section('spend'))
    expect(all('[data-spend-person]').map((el) => el.dataset.spendPerson)).toEqual(['b', 'a'])
    expect(all('[data-spend-row]').map((el) => el.dataset.spendRow)).toEqual(['sc_food'])
    expect(txt(q('[data-spend-row="sc_food"] [data-spend-amount]'))).toBe(norm(`план ${plain(150_000)}`))
    expect(q('[data-spend-row="sc_cafe"]')).toBeNull()
    await press(q('[data-spend-row="sc_food"]'))
    expect(txt(q('[role="dialog"] [data-cat-plans-title]'))).toBe('План')
    expect(all('[role="dialog"] [data-cat-person]').map((el) => el.dataset.catPerson)).toEqual(['b'])
    expect(q('[role="dialog"] [data-cat-edit]')).not.toBeNull()
  })

  it('FB-12: `?cat=` чужого раздела — лист «—» и «нет трат», без цифр Ильяса; неизвестный раздел — ничего', async () => {
    await openSpend('member', fullUploads, '/month?cat=sc_cafe', 'b')
    expect(txt(q('[role="dialog"] h3'))).toBe('Кафе и рестораны')
    expect(txt(q('[role="dialog"] [data-cat-amount]'))).toBe('—')
    expect(txt(q('[role="dialog"] [data-cat-none]'))).toBe('У вас трат в этом разделе нет')
    expect(q('[role="dialog"] [data-cat-person]')).toBeNull()
    expect(q('[role="dialog"] [data-cat-usual]')).toBeNull()
    expect(txt(q('[role="dialog"]'))).not.toContain(plain(50_000))
    app?.unmount()
    document.body.innerHTML = ''
    await openSpend('member', fullUploads, '/month?cat=sc_nope', 'b')
    expect(q('[data-cat-amount]')).toBeNull()
  })
})

/** RZ-07 (бэклог «Разбор», Р-17): отчёт разбора — оверлей по адресу `?review=1`. */
describe('RZ-07: отчёт разбора по адресу', () => {
  const review = { id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b' as const, good: 'Хорошо.', risk: 'Риск.', steps: [], sent: null, updatedAt: T0 }
  const routerOf = () => app!.config.globalProperties.$router
  async function openAt(path: string, role: 'member' | 'viewer' = 'member', doc = familyDoc({ aiReviews: [review] })) {
    await open(role, doc, path)
    useAuthStore().ai = true
    await flush()
  }

  it('`?review=1` открывает отчёт и гасит точку «новый»; ✕ снимает параметр', async () => {
    await openAt('/month')
    expect(q('[data-review-dot]')).not.toBeNull()
    expect(q('[data-report]')).toBeNull()
    await routerOf().push('/month?review=1')
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull())
    await flush()
    expect(q('[data-review-dot]')).toBeNull()
    await press(q('[data-report-close]'))
    await vi.waitFor(() => expect(routerOf().currentRoute.value.fullPath).toBe('/month'))
    expect(q('[data-report]')).toBeNull()
  })

  it('прошлый месяц по адресу (`?month=`) — отчёта нет: разбор только текущего', async () => {
    await openAt('/month?month=2026-08&review=1')
    expect(q('[data-report]')).toBeNull()
  })

  it('viewer без разбора — кнопки нет, `?review=1` ничего не открывает', async () => {
    await openAt('/month?review=1', 'viewer', familyDoc())
    expect(q('[data-review-open]')).toBeNull()
    expect(q('[data-report]')).toBeNull()
  })
})

/**
 * RZ-16 (владелец 2026-10-19, Х-12 — «А»): у заголовка раздела одна метка — точка «есть что сделать», если она есть;
 * ✦ совета ИИ — только когда точки нет. В раскрытом разделе ✦ остаётся у строки.
 */
describe('RZ-16: одна метка у заголовка раздела', () => {
  const open1 = (target: { kind: 'goal' | 'cat'; id: string; name: string }): AiAdvice => ({
    title: `Совет ${target.name}`, text: 'Текст.', figure: null, action: { kind: 'open', target },
  })
  /** Разбор v3 сентября: 1 — мечта «Отпуск» (в «Цели и фонды»), 2 — свой раздел Ильяса «Такси» (в «Тратах», FB-12). */
  const review: AiReview = {
    id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
    v: 3, reason: 'month', where: '', work: { ops: 10, found: 2, yearly: 0 },
    advices: [open1({ kind: 'goal', id: 'trip', name: 'Отпуск' }), open1({ kind: 'cat', id: 'sc_taxi', name: 'Такси' })],
  }

  it('точка и совет — у заголовка только точка, ✦ у строки; точки нет — ✦ у заголовка', async () => {
    await open('member', familyDoc({ aiReviews: [review] }))
    useAuthStore().ai = true // ✦ — только с ИИ семьи
    await flush()
    // «Цели и фонды»: зарплата Ильяса пришла, взносы не отложены — точка; совет про «Отпуск» — ✦ у заголовка нет.
    expect(q('[data-section="queue"] [data-section-call]')).not.toBeNull()
    expect(q('[data-section="queue"] [data-section-mark]')).toBeNull()
    expect(txt(q('[data-section="queue"] [data-section-call]'))).toContain('отложено')
    expect(txt(section('queue'))).not.toContain('есть совет ИИ')
    // «Траты»: выше обычного нет — точки нет, совет про «Такси» — ✦ у заголовка.
    expect(q('[data-section="spend"] [data-section-call]')).toBeNull()
    expect(q('[data-section="spend"] [data-section-mark]')).not.toBeNull()
    expect(txt(section('spend'))).toContain('есть совет ИИ')
    // Раскрыл — ✦ у строки «Отпуск», как раньше.
    await press(section('queue'))
    expect(q('[data-queue="trip"] [data-advice-mark]')).not.toBeNull()
    // «Отложил всё» — точка ушла, у заголовка — ✦.
    await press(q('[data-put-all]'))
    expect(q('[data-section="queue"] [data-section-call]')).toBeNull()
    expect(q('[data-section="queue"] [data-section-mark]')).not.toBeNull()
  })
})

describe('FB-05: свои операции в листе раздела «Месяца»', () => {
  const totals: SpendTotal[] = [{ id: 'a:month:2026-09:sc_cafe', by: 'a', kind: 'month', period: '2026-09', categoryId: 'sc_cafe', amount: 7_000, ops: 2, updatedAt: T0 }]
  const OPS: Operation[] = [
    { id: 'c0000001', bank: 'kaspi', date: '2026-09-12', amount: -4_500, kind: 'purchase', merchant: 'COFFEE BOOM ALMATY KZ', categoryId: 'sc_cafe', internal: false },
    { id: 'h0000001', bank: 'hand', date: '2026-09-14', amount: -2_500, kind: 'purchase', merchant: 'Обед', note: 'Обед', categoryId: 'sc_cafe', internal: false },
  ]
  async function openCat(role: 'member' | 'viewer') {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-17', ops_count: 40, created_at: T0 }] } as never)
    const spendPlans = [{ id: 'a:sc_cafe', by: 'a' as const, categoryId: 'sc_cafe', amount: 20_000, updatedAt: T0 }]
    await open(role, planFamilyDoc({ spendTotals: totals, spendPlans }), '/month?cat=sc_cafe')
    if (role === 'member') for (const o of OPS) useOperationsStore().ops[o.id] = o
    await useOperationsStore().loadUploads()
    await flush()
  }

  it('?cat= — лист раздела с «Мои операции · 2»; строка выписки → лист операции поверх (два диалога); ручная → «Трата»', async () => {
    await openCat('member')
    expect(txt(q('[data-cat-ops-title]'))).toBe('Мои операции · 2')
    await press(q('[data-cat-op="c0000001"]'))
    const dialogs = all('[role="dialog"]')
    expect(dialogs).toHaveLength(2)
    expect(txt(dialogs[1])).toContain('COFFEE BOOM')
    expect(txt(dialogs[1])).toContain('Мне вернули')
    await press(dialogs[1].querySelector<HTMLElement>('button[aria-label="Закрыть"]'))
    await press(q('[data-cat-op="h0000001"]'))
    expect(q('[data-hand-sheet]')).not.toBeNull()
  })

  it('viewer — листа раздела нет (FB-12: разделов у viewer нет), операций тоже', async () => {
    await openCat('viewer')
    expect(q('[data-cat-amount]')).toBeNull()
    expect(q('[data-cat-ops]')).toBeNull()
  })
})

describe('FB-07: «Разовые» на «Месяце» — тихая строка и лист своих разовых', () => {
  const totals: SpendTotal[] = [{ id: 'a:month:2026-09:sc_cafe', by: 'a', kind: 'month', period: '2026-09', categoryId: 'sc_cafe', amount: 7_000, ops: 2, updatedAt: T0 }]
  const OPS: Operation[] = [
    { id: 'c0000001', bank: 'kaspi', date: '2026-09-12', amount: -4_500, kind: 'purchase', merchant: 'COFFEE BOOM ALMATY KZ', categoryId: 'sc_cafe', internal: false },
    { id: 'c0000002', bank: 'kaspi', date: '2026-09-14', amount: -2_500, kind: 'purchase', merchant: 'Starbucks', categoryId: 'sc_cafe', internal: false },
  ]
  async function openMonth(role: 'member' | 'viewer', oneOff: boolean) {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-17', ops_count: 40, created_at: T0 }] } as never)
    const doc = planFamilyDoc({ spendTotals: oneOff ? [{ ...totals[0], oneOff: 4_500 }] : totals })
    const finance = await open(role, doc)
    const ops = useOperationsStore()
    if (role === 'member') {
      for (const o of OPS) ops.ops[o.id] = o
      if (oneOff) ops.editOp('c0000001', { oneOff: true })
    }
    await ops.loadUploads()
    await flush()
    await press(section('spend'))
    return finance
  }

  it('разовая: раздел без неё, «Разовые» — она; нажатие → лист с суммой и строкой → лист операции', async () => {
    const finance = await openMonth('member', true)
    expect(finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2026-09:sc_cafe')).toMatchObject({ amount: 7_000, oneOff: 4_500 })
    expect(txt(q('[data-spend-row="sc_cafe"] [data-spend-amount]'))).toBe(norm(plain(2_500)))
    expect(txt(q('[data-spend-oneoff]'))).toBe(norm(`Разовые${plain(4_500)}`))
    await press(q('[data-spend-oneoff]'))
    expect(txt(q('[data-oneoff-amount]'))).toBe(norm(money(4_500)))
    expect(txt(q('[data-cat-ops-title]'))).toBe('Мои операции · 1')
    await press(q('[data-cat-op="c0000001"]'))
    const dialogs = all('[role="dialog"]')
    expect(dialogs).toHaveLength(2)
    expect(txt(dialogs[1])).toContain('COFFEE BOOM')
  })

  it('без разовых — строки нет; viewer — строки нет (разделов у него нет, FB-12)', async () => {
    await openMonth('member', false)
    expect(q('[data-spend-oneoff]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    await openMonth('viewer', true)
    expect(q('[data-spend-oneoff]')).toBeNull()
    expect(q('[data-oneoff-amount]')).toBeNull()
  })
})

describe('FB-17: «Не разобрано» на «Месяце» — тихая строка и лист своих трат без раздела', () => {
  const OPS: Operation[] = [
    { id: 'c0000011', bank: 'kaspi', date: '2026-09-12', amount: -6_000, kind: 'purchase', merchant: 'SHOP X', categoryId: null, internal: false },
    { id: 'c0000012', bank: 'kaspi', date: '2026-09-14', amount: -2_500, kind: 'purchase', merchant: 'Starbucks', categoryId: 'sc_cafe', internal: false },
  ]
  const totals: SpendTotal[] = [
    { id: 'a:month:2026-09:_unknown', by: 'a', kind: 'month', period: '2026-09', categoryId: '_unknown', amount: 6_000, ops: 1, updatedAt: T0 },
    { id: 'a:month:2026-09:sc_cafe', by: 'a', kind: 'month', period: '2026-09', categoryId: 'sc_cafe', amount: 2_500, ops: 1, updatedAt: T0 },
  ]
  it('строка «Не разобрано» → лист с суммой и операциями → лист операции поверх', async () => {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-17', ops_count: 2, created_at: T0 }] } as never)
    await open('member', planFamilyDoc({ spendTotals: totals }))
    const ops = useOperationsStore()
    for (const o of OPS) ops.ops[o.id] = o
    await ops.loadUploads()
    await flush()
    await press(section('spend'))
    await press(q('[data-spend-unknown]'))
    expect(txt(q('[data-unknown-amount]'))).toBe(norm(money(6_000)))
    expect(txt(q('[data-cat-ops-title]'))).toBe('Мои операции · 1')
    await press(q('[data-cat-op="c0000011"]'))
    const dialogs = all('[role="dialog"]')
    expect(dialogs).toHaveLength(2)
    expect(txt(dialogs[1])).toContain('SHOP X')
  })
})

/**
 * Ревью frontend 4б Н-5: маршрут кнопки карточки отчёта (`reviewAct`) — на каждую цель свой лист поверх отчёта (слой
 * `sheetZ` 60 и выше), закрыли — отчёт открыт. `do` и «Отметить разовой» отчёт делает сам, `obligation` — переход.
 */
describe('FB-17: кнопки карточек отчёта — свой лист поверх отчёта', () => {
  const OPS: Operation[] = [
    { id: 'c0000021', bank: 'kaspi', date: '2026-09-12', amount: -6_000, kind: 'purchase', merchant: 'SHOP X', categoryId: null, internal: false },
    { id: 'c0000022', bank: 'kaspi', date: '2026-09-14', amount: -2_500, kind: 'purchase', merchant: 'Starbucks', categoryId: 'sc_cafe', internal: false },
  ]
  const totals: SpendTotal[] = [
    { id: 'a:month:2026-09:_unknown', by: 'a', kind: 'month', period: '2026-09', categoryId: '_unknown', amount: 6_000, ops: 1, updatedAt: T0 },
    { id: 'a:month:2026-09:sc_cafe', by: 'a', kind: 'month', period: '2026-09', categoryId: 'sc_cafe', amount: 2_500, ops: 1, updatedAt: T0 },
  ]
  const image: HabitImage = {
    habit: 'coffee', categoryId: 'sc_cafe', monthly: 2_500, count: 1, kind: 'dream', price: null, left: null,
    action: { kind: 'move', categoryId: 'sc_cafe', goalId: 'trip', goalName: 'Отпуск', amount: 1_000, days: 3 },
  } as HabitImage
  const card = (target: ReviewCardTarget): ReviewCard => ({ id: 'c1', kind: 'unknown', title: 'Карточка', figure: { value: 1, unit: 'money' }, line: '', button: 'Кнопка', target, monthly: 1 })
  /** Отчёт на «Месяце» — экземпляр `AiReport`: событие `act`, как его шлёт кнопка карточки. */
  function report(): ComponentInternalInstance {
    const walk = (v: VNode | null | undefined): ComponentInternalInstance | null => {
      if (!v) return null
      if (v.component) return (v.component.type as { __name?: string }).__name === 'AiReport' ? v.component : walk(v.component.subTree)
      if (Array.isArray(v.children)) for (const c of v.children) {
        const r = walk(c as VNode)
        if (r) return r
      }
      return null
    }
    return walk(app!._instance!.subTree)!
  }
  const cases: [string, ReviewCardTarget, (d: HTMLElement) => boolean][] = [
    ['op — лист операции', { kind: 'op', opId: 'c0000021' }, (d) => txt(d).includes('SHOP X') && txt(d).includes('Мне вернули')],
    ['cat — лист раздела', { kind: 'cat', categoryId: 'sc_cafe' }, (d) => !!d.querySelector('[data-cat-amount]')],
    ['unknown — «Не разобрано»', { kind: 'unknown' }, (d) => !!d.querySelector('[data-unknown-amount]')],
    ['pay — «В платежи»', { kind: 'pay', opId: 'c0000022' }, (d) => [...d.querySelectorAll('input')].some((i) => i.value === 'Starbucks')],
    ['image — «Перенести в мечту»', { kind: 'image', image }, (d) => txt(d).includes('Перенести в мечту')],
    ['plan — «Сколько в месяц» с суммой', { kind: 'plan', categoryId: 'sc_cafe', amount: 4_000 }, (d) => /Траты на месяц|Сколько в месяц/.test(txt(d)) && !!d.querySelector('input')],
  ]

  it.each(cases)('%s', async (_, target, isIt) => {
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-17', ops_count: 2, created_at: T0 }] } as never)
    await open('member', planFamilyDoc({ spendTotals: totals }), '/month?review=1')
    const ops = useOperationsStore()
    for (const o of OPS) ops.ops[o.id] = o
    ops.recurringFor = (o) => (o.id === 'c0000022' ? { name: 'Starbucks', amount: 2_500, day: 14, kind: 'subscription' } : null)
    await ops.loadUploads()
    await flush()
    expect(q('[data-report]')).not.toBeNull()
    const before = all('[role="dialog"]').length
    report().emit('act', card(target))
    await flush()
    const sheet = all('[role="dialog"]').find((d) => !d.querySelector('[data-report]') && isIt(d))
    expect(sheet, 'лист цели').toBeTruthy()
    expect(all('[role="dialog"]').length).toBeGreaterThan(before)
    expect(Number(sheet!.closest<HTMLElement>('.fixed')!.style.zIndex)).toBeGreaterThanOrEqual(60)
    await press(sheet!.querySelector<HTMLElement>('button[aria-label="Закрыть"]'))
    expect(q('[data-report]')).not.toBeNull()
  })
})

/*
 * FB-21 (Блок 5 «Фидбек», Р-35…Р-37): «нашли N в выписке» в «Платежах», «Поставить план» по неделям в строке «Траты»,
 * «Месяц» без дохода. Сегодня — 12 сентября 2026 (сб); W36 = 31 авг – 6 сен, W35 = 24–30 авг, W34 = 17–23 авг.
 */
describe('FB-21: «нашли в выписке», «Поставить план», месяц без дохода', () => {
  const opOf = (id: string, date: string, amount: number, merchant: string, categoryId: string | null = null): Operation => ({
    id, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false,
  })
  /** Семья без платежей: Apple Music дважды (±3 дня, та же сумма) — повтор; Magnum — нет. */
  function seedFound() {
    const store = useOperationsStore()
    for (const o of [opOf('ap8', '2026-08-14', 4_990, 'APPLE.COM BILL'), opOf('ap9', '2026-09-10', 4_990, 'APPLE.COM BILL'), opOf('m9', '2026-09-08', 8_000, 'MAGNUM', 'sc_food')]) store.ops[o.id] = o
  }

  it('«нашли 1 в выписке» — подпись «Платежей», пока платежей месяца нет; раскрыто — строка с «В платежи» → форма → «Сохранить» — платёж, строка ушла', async () => {
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] } as never)
    const finance = await open('member', familyDoc({ obligations: [], credits: [], payments: [] }))
    seedFound()
    await flush()
    expect(txt(q('[data-section="dues"] [data-section-meta]'))).toBe('нашли 1 в выписке')
    expect(q('[data-section="dues"] [data-section-found]')!.getAttribute('data-section-found')).toBe('1')
    await press(section('dues'))
    expect(txt(q('[data-found-list]'))).toContain('Нашли в выписке')
    const row = q('[data-found-row="ap9"]')!
    expect(txt(row)).toContain('APPLE.COM BILL')
    expect(txt(row)).toContain('≈ 10-го') // медиана дней 14 и 10 — нижняя
    expect(txt(row)).toContain(norm(plain(4_990)))
    expect(q('[data-found-row="m9"]')).toBeNull()
    // Маленькая `xs` «В платежи» → форма регулярного платежа с заполнением (путь FB-09).
    const pay = row.querySelector<HTMLElement>('[data-found-pay]')!
    expect(pay.className).toContain('h-[26px]')
    await press(pay)
    // Имя заполнено из выписки — в поле формы (меняется там же).
    expect(all('[role="dialog"] input').some((i) => (i as HTMLInputElement).value.includes('APPLE.COM'))).toBe(true)
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Добавить'))
    await flush()
    expect(finance.obligations.map((o) => o.name)).toEqual(['APPLE.COM BILL'])
    expect(finance.merchantRules.some((r) => 'payment' in r.to)).toBe(true)
    // Платёж заведён — строки «нашли» нет, подпись — обычная.
    expect(q('[data-found-row="ap9"]')).toBeNull()
    expect(txt(q('[data-section="dues"] [data-section-meta]'))).not.toContain('нашли')
  })

  /**
   * «Поставить план»: выписка Ильяса 17 авг – 10 сен (25 дней ≥ 14), полные недели W34, W35, W36; по неделям — продукты
   * 20 000 / 30 000 / 25 000 (→ 25 000 × 52 / 12 = 108 333 → 109 000), кафе 6 000 / 6 000 / 6 000 (→ 26 000), транспорт
   * 3 000 / 0 / 3 000 (→ 8 667 → 9 000), развлечения 0 / 9 000 / 0 (→ 13 000), дом 0 / 0 / 4 500 (→ 6 500 → 7 000);
   * итог 164 000. Своих строк плана у Ильяса нет (план есть только у Аруны).
   */
  const WEEK_OPS: Operation[] = [
    opOf('f1', '2026-08-18', 20_000, 'Magnum', 'sc_food'), opOf('f2', '2026-08-26', 30_000, 'Magnum', 'sc_food'), opOf('f3', '2026-09-02', 25_000, 'Magnum', 'sc_food'),
    opOf('c1', '2026-08-19', 6_000, 'Кофейня', 'sc_cafe'), opOf('c2', '2026-08-27', 6_000, 'Кофейня', 'sc_cafe'), opOf('c3', '2026-09-03', 6_000, 'Кофейня', 'sc_cafe'),
    opOf('t1', '2026-08-20', 3_000, 'Yandex Go', 'sc_transport'), opOf('t3', '2026-09-04', 3_000, 'Yandex Go', 'sc_transport'),
    opOf('e2', '2026-08-28', 9_000, 'Кино', 'sc_fun'),
    opOf('h3', '2026-09-05', 4_500, 'Хозтовары', 'sc_home'),
  ]
  const planDoc = () =>
    familyDoc({
      spendPlans: [{ id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 }],
      spendTotals: periodsOf(WEEK_OPS).flatMap(({ kind, period }) => spendTotals(WEEK_OPS, 'a', kind, period, T0)),
    })
  const planUploads = [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-08-17', period_to: '2026-09-10', ops_count: 10, created_at: T0 }]

  it('«Поставить план» — маленькая брендовая в строке «Траты», подпись «обычно в месяц», сумма — итог; лист: 3 строки + «ещё 2 раздела», «Поставить» → spendPlans мне, тост, кнопки нет', async () => {
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: planUploads } as never)
    const finance = await open('member', planDoc())
    await useOperationsStore().loadUploads()
    await flush()
    const { state, ctx } = finance.planInput(KEY)
    const p = planByFact(state, ctx, 'a', '2026-09-12')!
    expect(p.rows.map((r) => [r.categoryId, r.amount])).toEqual([['sc_food', 109_000], ['sc_cafe', 26_000], ['sc_fun', 13_000], ['sc_transport', 9_000], ['sc_home', 7_000]])
    expect(p.total).toBe(164_000)
    expect(txt(q('[data-section="spend"] [data-section-meta]'))).toBe('обычно в месяц')
    expect(txt(section('spend'))).toContain(norm(plain(164_000)))
    const btn = q('[data-plan-fact]')!
    expect(btn.className).toContain('bg-brand')
    expect(btn.className).toContain('h-[26px]')
    // Раскрытия строки нажатие кнопки не трогает.
    await press(btn)
    expect(section('spend')!.getAttribute('aria-expanded')).toBe('false')
    const sheet = q('[data-plan-fact-sheet]')!
    expect(all('[data-plan-fact-row]').map((el) => el.dataset.planFactRow)).toEqual(['sc_food', 'sc_cafe', 'sc_fun'])
    expect(txt(q('[data-plan-fact-more]'))).toContain('ещё 2 раздела')
    expect(txt(q('[data-plan-fact-more]'))).toContain(norm(plain(16_000)))
    expect(txt(sheet)).toContain(norm(plain(164_000)))
    await press(q('[data-plan-fact-more]'))
    expect(all('[data-plan-fact-row]')).toHaveLength(5)
    expect(q('[data-plan-fact-more]')).toBeNull()
    await press(q('[data-plan-fact-save]'))
    expect(q('[role="dialog"]')).toBeNull()
    expect((finance.householdDoc.spendPlans ?? []).filter((x) => x.by === 'a' && !x.deletedAt).map((x) => [x.categoryId, x.amount])).toEqual(p.rows.map((r) => [r.categoryId, r.amount]))
    // План Аруны не тронут.
    expect((finance.householdDoc.spendPlans ?? []).find((x) => x.by === 'b')).toMatchObject({ categoryId: 'sc_food', amount: 150_000 })
    expect(txt(q('[data-plan-fact-done]'))).toBe('План поставлен')
    expect(q('[data-plan-fact]')).toBeNull()
    expect(txt(q('[data-section="spend"] [data-section-meta]'))).not.toBe('обычно в месяц')
  })

  it('семья с планом и viewer — ни «Поставить план», ни «нашли»; покрытие 13 дней — кнопки нет', async () => {
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: planUploads } as never)
    await open('member', familyDoc())
    await useOperationsStore().loadUploads()
    await flush()
    expect(q('[data-plan-fact]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ ...planUploads[0], period_from: '2026-08-29' }] } as never)
    await open('member', planDoc())
    await useOperationsStore().loadUploads()
    await flush()
    expect(q('[data-plan-fact]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: planUploads } as never)
    await open('viewer', planDoc())
    seedFound()
    await flush()
    expect(q('[data-plan-fact]')).toBeNull()
    expect(q('[data-section-found]')).toBeNull()
  })

  it('без дохода (оклады 0): «Остаётся» и «—», без «Не хватает» и красного, подсказка «Доход месяца не указан.»; «+ Зарплата» → лист оклада; партнёру чужой оклад не предлагается', async () => {
    const doc = familyDoc()
    const finance = await open('member', { ...doc, people: doc.people.map((p) => ({ ...p, salary: 0 })), payments: [] })
    expect(planOf(finance).income.total).toBe(0)
    expect(txt(q('[data-rest-none]'))).toBe('—')
    expect(q('[data-rest-none]')!.className).toContain('text-ink-2')
    expect(q('[data-rest]')).toBeNull()
    expect(txt(document.body)).not.toContain('Не хватает')
    expect(q('[data-month-top] .text-warn')).toBeNull()
    await press(q('button[aria-label="Остаётся"]'))
    expect(txt(q('[role="note"]'))).toContain('Доход месяца не указан.')
    await press(q('button[aria-label="Остаётся"]'))
    // Кольцо — только дорожка.
    expect(q('[data-month-ring] circle[data-part]')).toBeNull()
    await press(q('[data-add-salary]'))
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(txt(q('[role="dialog"]'))).toContain('Ильяс')
    app?.unmount()
    document.body.innerHTML = ''
    // Свой оклад есть, у партнёра нет — «+ Зарплата» не показывается (его дело).
    await open('member', { ...doc, people: doc.people.map((p) => (p.id === 'b' ? { ...p, salary: 0 } : p)) })
    expect(q('[data-add-salary]')).toBeNull()
    expect(q('[data-rest-none]')).toBeNull()
  })
})
