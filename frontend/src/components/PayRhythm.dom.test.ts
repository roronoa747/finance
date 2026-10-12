// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { FX_BOOK_KEY, writeStorage } from '@/lib/storage'
import { plain } from '@/lib/money'
import type { Payment, Person, SyncDoc } from '@/types/finance'
import SalaryDialog from './SalaryDialog.vue'
import MarkSheet from './MarkSheet.vue'
import Month from '@/views/Month.vue'
import Money from '@/views/Money.vue'
import Start from '@/views/Start.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-23 (понятность Б7, Р-5, Р-6): ритм зарплаты в «Изменить оклад» (`PayRhythmFields` пишет сразу, «Сумма меняется» —
 * `Toggle`), строка «Месяца» «✓ N из M» и «Пришла» у ближайшего прихода (`period` — ISO-день), лист зарплаты — приходы
 * строками, плавающая — лист с пустой суммой, без одной отметки. Сентябрь 2026: пятницы 4, 11, 18, 25; сегодня — 12-е.
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
})

const KEY = '2026-09'
const came = (period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `sal-a-${period}`, kind: 'salary', targetId: 'a', period, amount, accountId: 'card', by: 'a', at: `${period.length > 7 ? period : `${period}-10`}T05:00:00.000Z`, updatedAt: T0, ...extra,
})
/** Ильяс — 150 000 за неделю по пятницам; 4 сентября пришла на карту (счёт для одного нажатия). */
function weeklyDoc(person: Partial<Person> = {}, payments: Payment[] = [came('2026-09-04', 150_000)]): SyncDoc {
  const doc = planFamilyDoc({ payments })
  doc.people[0] = { ...doc.people[0], salary: 150_000, payRhythm: 'week', weekday: 5, ...person }
  return doc
}

async function openMonth(doc: SyncDoc, role: 'member' | 'viewer' = 'member', path = '/month') {
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
  return { finance, router }
}

async function openDialog(doc: SyncDoc = planFamilyDoc()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SalaryDialog, { id: 'a' }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  return finance
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const qi = (sel: string) => document.querySelector<HTMLInputElement>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const byText = (sel: string, label: string) => all(sel).find((b) => txt(b) === label)
async function commit(input: HTMLInputElement | null, value: string) {
  expect(input, 'поле').toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input'))
  await nextTick()
  input!.dispatchEvent(new Event('blur'))
  await flush()
}
const salaries = (finance: ReturnType<typeof useFinanceStore>) => finance.payments.filter((p) => !p.deletedAt && p.kind === 'salary' && p.targetId === 'a')

describe('PN-23: «Изменить оклад» — как приходит зарплата', () => {
  it('аванс: выбор пишет ритм с днём и суммой аванса, правки — сразу; подпись «остальное»', async () => {
    const finance = await openDialog()
    await press(byText('[data-pay-rhythm] button', 'Дважды'))
    // День зарплаты 10-го — аванс по умолчанию 25-го, половина оклада.
    expect(finance.people[0]).toMatchObject({ payRhythm: 'advance', payday2: 25, salary2: 350_000 })
    await commit(qi('input[data-salary2]'), '200 000')
    await commit(qi('input[data-payday2]'), '15')
    expect(finance.people[0]).toMatchObject({ payRhythm: 'advance', payday2: 15, salary2: 200_000 })
    expect(txt(q('[data-rest]'))).toBe('остальное — 500 000 ₸')
    // День аванса = дню зарплаты — не принимается (иначе ритм не аванс); `/ux` Б7: не молча — строка «что не так», поле
    // возвращает записанный день.
    await commit(qi('input[data-payday2]'), '10')
    expect(finance.people[0].payday2).toBe(15)
    expect(document.body.textContent).toContain('Аванс и зарплата — в разные дни')
    expect(qi('input[data-payday2]')!.value).toBe('15')
    expect(qi('input[data-payday2]')!.getAttribute('aria-invalid')).toBe('true')
    // То же с другой стороны: день зарплаты = дню аванса.
    await commit(qi('input[data-payday]'), '15')
    expect(finance.people[0].payday).toBe(10)
    expect(qi('input[data-payday]')!.value).toBe('10')
    expect(qi('input[data-payday]')!.getAttribute('aria-invalid')).toBe('true')
    // Верный день — строка уходит, день пишется.
    await commit(qi('input[data-payday]'), '28')
    expect(finance.people[0].payday).toBe(28)
    expect(document.body.textContent).not.toContain('Аванс и зарплата — в разные дни')
  })

  it('неделя: день недели чипами, подпись «за неделю», подсказка «≈ N за неделю» — запись только нажатием', async () => {
    const finance = await openDialog()
    await press(byText('[data-pay-rhythm] button', 'Раз в неделю'))
    expect(finance.people[0]).toMatchObject({ payRhythm: 'week', weekday: 5, salary: 700_000 })
    expect(document.body.textContent).toContain('Оклад сейчас — за неделю, ₸')
    // 700 000 × 12 / 52 = 161 538.
    expect(txt(q('[data-week-hint]'))).toBe('≈ 161 538 за неделю')
    await press(byText('[data-weekday] button', 'пн'))
    expect(finance.people[0].weekday).toBe(1)
    await press(q('[data-week-hint]'))
    expect(finance.people[0].salary).toBe(161_538)
    expect(q('[data-week-hint]')).toBeNull()
  })

  it('критик Б7: валютный оклад за неделю — «≈ ₸» под полем тоже за неделю (300 € × 510 = 153 000), не сумма месяца', async () => {
    // Книга с устройства — до создания стора; в сентябре 2026 пятницы 4, 11, 18, 25 — курс 510 у всех (последний в книге).
    writeStorage(FX_BOOK_KEY, { book: { EUR: { '2026-09-04': 510 } }, covered: {} })
    const doc = planFamilyDoc()
    doc.people[0] = { ...doc.people[0], payRhythm: 'week', weekday: 5, salaryVersions: [{ from: '2000-01', amount: 700_000 }, { from: '2026-01', amount: 300, currency: 'EUR', rate: 500 }] }
    await openDialog(doc)
    expect(document.body.textContent).toContain('Оклад сейчас — за неделю, €')
    // Раньше — 612 000 ₸ (четыре пятницы месяца) под полем «за неделю».
    expect(txt(all('p').find((p) => txt(p).includes('по курсу Нацбанка')) ?? null)).toBe('≈ 153 000 ₸ по курсу Нацбанка')
  })

  it('критик Б7: лист отметки — остаток после аванса «Зарплата — 300 000 ₸» (не «Оклад месяца»), аванс — «Аванс — 200 000 ₸»', async () => {
    const doc = planFamilyDoc()
    doc.people[0] = { ...doc.people[0], salary: 500_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 200_000 }
    for (const [period, label, button] of [['2026-09-30', 'Зарплата — 300 000 ₸.', 'Отметить зарплату'], ['2026-09-15', 'Аванс — 200 000 ₸.', 'Отметить аванс']]) {
      const pinia = createPinia()
      setActivePinia(pinia)
      useAuthStore().setAuthData(authAs('member', 'a'))
      useFinanceStore().setHouseholdDoc(doc, 1)
      const root = document.createElement('div')
      document.body.appendChild(root)
      app = createApp({ render: () => h(MarkSheet, { open: 'mark', kind: 'salary', targetId: 'a', period, title: 'Зарплата · Ильяс' }) })
      app.use(pinia)
      app.mount(root)
      await flush()
      expect(txt(document.body)).toContain(label)
      expect(txt(document.body)).not.toContain('Оклад месяца')
      // `/ux` Б7: кнопка зовёт приход по имени — у аванса «Отметить аванс».
      expect(byText('button', button)).toBeTruthy()
      app.unmount()
      app = null
      document.body.innerHTML = ''
    }
  })

  it('«Сумма меняется» — Toggle пишет floating; «Раз в месяц» возвращает месяц', async () => {
    const finance = await openDialog()
    await press(q('[data-floating] [role="switch"]'))
    expect(finance.people[0].floating).toBe(true)
    await press(byText('[data-pay-rhythm] button', 'Раз в неделю'))
    await press(byText('[data-pay-rhythm] button', 'Раз в месяц'))
    expect(finance.people[0].payRhythm).toBe('month')
  })
})

describe('PN-23: строка «Месяца» и лист зарплаты по неделям', () => {
  it('строка — «✓ 1 из 4 пришли», сумма месяца 600 000; «Пришла» отмечает ближайшую открытую пятницу (11-е) на счёт прошлого раза', async () => {
    const { finance, router } = await openMonth(weeklyDoc(), 'member', '/month?from=row')
    expect(txt(q('[data-salary="a"] [data-came-count]'))).toBe('✓ 1 из 4 пришли')
    expect(q('[data-salary="a"] [data-came]')).toBeNull()
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(salaries(finance).map((p) => [p.period, p.amount, p.accountId])).toEqual([
      ['2026-09-04', 150_000, 'card'],
      ['2026-09-11', 150_000, 'card'],
    ])
    expect(txt(q('[data-salary="a"] [data-came-count]'))).toBe('✓ 2 из 4 пришли')
    // 18-е ещё не близко (6 дней) — кнопки нет; в план не уводит, пока месяц не пришёл.
    expect(q('[data-salary="a"] [data-salary-came-btn]')).toBeNull()
    await new Promise((r) => setTimeout(r, 20))
    expect(router.currentRoute.value.fullPath).toBe('/month?from=row')
  })

  it('критик Б7: последняя пятница месяца — «Пришла» ведёт в план (Р-78): месяц пришёл целиком', async () => {
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    const doc = weeklyDoc({}, [came('2026-09-04', 150_000), came('2026-09-11', 150_000), came('2026-09-18', 150_000)])
    const { finance, router } = await openMonth(doc, 'member', '/month?from=row')
    expect(txt(q('[data-salary="a"] [data-came-count]'))).toBe('✓ 3 из 4 пришли')
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(salaries(finance).map((p) => p.period)).toEqual(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'])
    await new Promise((r) => setTimeout(r, 20))
    expect(router.currentRoute.value.fullPath).toBe('/month')
  })

  it('лист: приходы строками, «1 из 4 пришли», «Пришла» — у своего открытого; пришедший — лист отметки этого прихода', async () => {
    await openMonth(weeklyDoc())
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(txt(q('[data-salary-status]'))).toContain('1 из 4 пришли')
    expect(all('[data-pay-event]').map((e) => e.dataset.payEvent)).toEqual(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'])
    expect(q('[data-pay-event="2026-09-04"] [data-event-came]')).not.toBeNull()
    expect(q('[data-pay-event="2026-09-11"] [data-salary-came-btn]')).not.toBeNull()
    expect(q('[data-pay-event="2026-09-18"] [data-salary-came-btn]')).toBeNull()
    // Большой «Пришла зарплата» месячного ритма в листе нет — действие у прихода.
    expect(byText('[role="dialog"] button', 'Пришла зарплата')).toBeUndefined()
    await press(q('[data-pay-event="2026-09-04"]'))
    expect(document.body.textContent).toContain('Снять отметку')
  })

  it('viewer: строка «✓ 1 из 4 пришли» без кнопок; лист — приходы без «Пришла» и без «Изменить оклад»', async () => {
    await openMonth(weeklyDoc(), 'viewer')
    expect(txt(q('[data-salary="a"] [data-came-count]'))).toBe('✓ 1 из 4 пришли')
    expect(q('[data-salary-came-btn]')).toBeNull()
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(all('[data-pay-event]')).toHaveLength(4)
    expect(q('[data-salary-came-btn]')).toBeNull()
    expect(q('[data-salary-edit]')).toBeNull()
  })
})

describe('PN-23: плавающая сумма (Р-6)', () => {
  it('«Пришла» открывает лист с пустой суммой; без суммы отметки нет; вписали — отметка этой суммой', async () => {
    const doc = planFamilyDoc({ payments: [came('2026-08', 690_000), came('2026-07', 710_000)] })
    doc.people[0] = { ...doc.people[0], floating: true }
    const { finance } = await openMonth(doc)
    // Ждём среднее двух: (690 000 + 710 000) / 2 = 700 000 — с «≈».
    expect(txt(q('[data-salary="a"] b'))).toBe('≈ 700 000 ₸')
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    const input = qi('[role="dialog"] input[inputmode]') as HTMLInputElement
    expect(input.value).toBe('')
    await press(byText('[role="dialog"] button', 'Отметить зарплату'))
    expect(salaries(finance).filter((p) => p.period === KEY)).toHaveLength(0)
    input.value = '725 000'
    input.dispatchEvent(new Event('input'))
    await flush()
    await press(byText('[role="dialog"] button', 'Отметить зарплату'))
    expect(salaries(finance).filter((p) => p.period === KEY).map((p) => p.amount)).toEqual([725_000])
  })
})

/**
 * `/ux` Б7 (свежий взгляд на стенде): подсказка пересчёта оклада только через границу «неделя», первый запуск — аванс
 * за окладом и подсказка «≈ N за неделю», «в зарплатах» при недельной зарплате — месяцами дохода.
 */
async function openView(view: typeof Money, path: string, doc: SyncDoc) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return finance
}

/** Первый запуск новой семьи — шаг 1, «Введу вручную». */
async function openStartManual() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  finance.setHouseholdDoc(defaultSyncDoc(), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/start/upload')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  await press(byText('button', 'Введу вручную'))
  return finance
}
const salaryInput = () =>
  all('label').find((l) => /^Зарплата (в месяц|за неделю), ₸$/.test(txt(l.querySelector('span'))))!.querySelector('input') as HTMLInputElement
async function typeIn(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}

describe('/ux Б7: подсказка пересчёта оклада, первый запуск, «в зарплатах» при неделе', () => {
  it('«Изменить оклад» недельного: промах «неделя → месяц → неделя» подсказки не даёт; «неделя → месяц» — «≈ N в месяц» (× 52 / 12)', async () => {
    // Лист в приложении живёт закрытым (`id` null) и открывается сменой `id` — ритм оклада берётся в момент открытия.
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member', 'a'))
    const finance = useFinanceStore()
    finance.setHouseholdDoc(weeklyDoc(), 1)
    const id = ref<'a' | null>(null)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(SalaryDialog, { id: id.value }) })
    app.use(pinia)
    app.mount(root)
    await flush()
    id.value = 'a'
    await flush()
    expect(q('[data-week-hint]')).toBeNull()
    await press(byText('[data-pay-rhythm] button', 'Раз в месяц'))
    // 150 000 × 52 / 12 = 650 000 — оклад недели теперь читается как месячный.
    expect(txt(q('[data-week-hint]'))).toBe('≈ 650 000 в месяц')
    await press(byText('[data-pay-rhythm] button', 'Раз в неделю'))
    // Раньше: «≈ 34 615 за неделю» — недельный оклад ещё раз делился на 4,33.
    expect(q('[data-week-hint]')).toBeNull()
    expect(finance.people[0].salary).toBe(150_000)
    await press(byText('[data-pay-rhythm] button', 'Дважды'))
    await press(q('[data-week-hint]'))
    expect(finance.people[0].salary).toBe(650_000)
    expect(q('[data-week-hint]')).toBeNull()
  })

  it('первый запуск: «Дважды» до оклада — аванс идёт за окладом (половина), пока его не вписали руками; «Дальше» — два прихода', async () => {
    const finance = await openStartManual()
    await press(byText('[data-pay-rhythm] button', 'Дважды'))
    // Раньше: «Аванс 0» и «остальное — 0 ₸» — и после оклада аванс оставался 0 (один приход).
    await typeIn(salaryInput(), '450000')
    expect(qi('input[data-salary2]')!.value).toBe(plain(225_000))
    expect(txt(q('[data-rest]'))).toBe('остальное — 225 000 ₸')
    // Вписали аванс руками — оклад его больше не двигает.
    await commit(qi('input[data-salary2]'), '150 000')
    await typeIn(salaryInput(), '500000')
    expect(qi('input[data-salary2]')!.value).toBe(plain(150_000))
    await press(byText('button', 'Дальше'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 500_000, payRhythm: 'advance', payday2: 25, salary2: 150_000 })
  })

  it('первый запуск: оклад набран «в месяц», выбрали «Раз в неделю» — подсказка «≈ N за неделю», нажатие вписывает', async () => {
    const finance = await openStartManual()
    await typeIn(salaryInput(), '650000')
    expect(q('[data-week-hint]')).toBeNull()
    await press(byText('[data-pay-rhythm] button', 'Раз в неделю'))
    // Подпись поля уже «за неделю», а число — месячное: 650 000 × 12 / 52 = 150 000.
    expect(txt(q('[data-week-hint]'))).toBe('≈ 150 000 за неделю')
    await press(q('[data-week-hint]'))
    expect(salaryInput().value).toBe(plain(150_000))
    expect(q('[data-week-hint]')).toBeNull()
    await press(byText('button', 'Дальше'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 150_000, payRhythm: 'week', weekday: 5 })
  })

  it('статистика Капитала: недельная зарплата в семье — «месяца дохода» и «ещё N месяцев», без «зарплат»; месячная — как было', async () => {
    await openView(Money, '/money', weeklyDoc())
    await press(q('[data-capital-stats]'))
    const weekly = txt(q('[data-capital-stats-body]'))
    expect(weekly).toMatch(/Переплата [\d\s]+₸ · [\d,]+ месяца дохода/)
    expect(weekly).toMatch(/· ещё \d+ месяц(а|ев)?$|· ещё \d+ месяц(а|ев)? /)
    expect(weekly).not.toContain('зарплат')
    app?.unmount()
    app = null
    document.body.innerHTML = ''
    await openView(Money, '/money', planFamilyDoc())
    await press(q('[data-capital-stats]'))
    expect(txt(q('[data-capital-stats-body]'))).toContain('зарплат')
  })
})
