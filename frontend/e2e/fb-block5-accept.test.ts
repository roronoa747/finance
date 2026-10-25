// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView, type Router } from 'vue-router'
import { createAppRouter } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { money, plain } from '../src/lib/money'
import { todayIso } from '../src/lib/dates'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { monthPlan, planByFact } from '../src/lib/finance'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 5 «Фидбек» (FB-19…FB-21, FB-24; возврат Х-23): то, что e2e исполнителя (`fb-block5-look`, (а)–(д)) делает
 * вызовом функций экрана (`savePlanFact`, `addObligation`, наличие `data-add-salary`), — здесь нажатиями во всём приложении:
 * роутер с гардами, оболочка с вкладками и «+», экраны по адресу. Пятница 23 октября 2026 (W43 = 19–25 окт).
 *
 *   Новая семья (Ильяс, a): первый запуск пройден («Позже», «Пропустить»), мечта «Машина», оклада нет. Выписка 7 сен – 22 окт
 *     (46 дней ≥ 14): шесть полных недель W37…W42 — Magnum 20 000 … 30 000 по 2 000 в неделю (среднее 25 000), Coffee Boom
 *     6 000, Yandex Go 3 000 каждую неделю. «План по факту»: 25 000 × 52 / 12 = 108 333,3 → 109 000; 6 000 × 52 / 12 = 26 000;
 *     3 000 × 52 / 12 = 13 000 → Σ 148 000. План недели октября: 148 000 × 7 / 31 = 33 419,4 → 33 419. Неделя W43 трат нет —
 *     «осталось 33 419 / 33 419».
 *   «+ Зарплата» 300 000 → «Остаётся» = monthPlan().rest (считает finance.ts), «—» уходит.
 *   Семья из двух (planFamilyDoc): заметка Ильяса — только у него; viewer — ни «+», ни правок на «Месяце».
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const K = '2026-10'
let app: App | null = null
let router: Router

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
// `\s` в JS ловит и неразрывные пробелы сумм (U+00A0, U+202F).
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const sp = (s: string) => s.replace(/\s/g, ' ')
const plus = () => q('[aria-label="Добавить"]')
const flush = async () => {
  for (let i = 0; i < 6; i++) await vi.dynamicImportSettled()
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const press = async (el: Element | null | undefined, what: string) => {
  expect(el, what).toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  ;(el as HTMLElement).click()
  await flush()
}
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>('button, a')].find((b) => txt(b) === label || txt(b).startsWith(label))
const type = async (input: HTMLInputElement | null, value: string, what: string) => {
  expect(input, what).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input'))
  await nextTick()
  input!.dispatchEvent(new Event('blur'))
  await flush()
}

const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
/** Шесть полных недель W37…W42 (пн 7 сен … вс 18 окт) и W43 до четверга — без трат. */
function newFamilyStatement(): ParsedStatement {
  const ops: Omit<Operation, 'id'>[] = []
  for (let i = 0; i < 6; i++) {
    const mon = new Date(Date.UTC(2026, 8, 7 + i * 7))
    const d = (k: number) => new Date(mon.getTime() + k * 864e5).toISOString().slice(0, 10)
    ops.push(op(d(1), -(20_000 + i * 2_000), 'Magnum', 'sc_food'), op(d(2), -6_000, 'Coffee Boom', 'sc_cafe'), op(d(3), -3_000, 'Yandex Go', 'sc_transport'))
  }
  return { bank: 'kaspi', from: '2026-09-07', to: '2026-10-22', skipped: 0, operations: assignIds(ops) }
}

describe('e2e / приёмка Фидбек Блок 5 — нажатиями во всём приложении', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size
      },
    })
    storage.clear()
    // Подсказки вкладок уже видены — пузыри не перекрывают нажатия.
    storage.set('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
    vi.useFakeTimers()
    at('2026-10-23T07:00:00Z')
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    app?.unmount()
    app = null
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member', user = `u-${slot}`): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData({
      token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: user, slot, display_name: slot === 'a' ? 'Ильяс' : 'Аруна', role, joined_at: '' },
    })
    const client = { ...backend(server), ...statementsFor(st, user, slot), ...privateFor(pv, user) } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await store.pullPrivateDoc(client)
    await useOperationsStore().loadUploads(client)
    await useOperationsStore().pull(client)
    return { pinia, client, store }
  }
  /** Фоновые синки экранов и стора идут в `apiClient` — направляем их в Go-мок этого телефона. */
  function wire(p: Phone) {
    vi.restoreAllMocks()
    type Methods = Record<string, (...a: unknown[]) => unknown>
    const c = p.client as unknown as Methods
    const api = apiClient as unknown as Methods
    for (const m of ['getHouseholdDoc', 'pushHouseholdDoc', 'getPrivateDoc', 'pushPrivateDoc', 'listOperations', 'listStatementUploads', 'upsertOperations', 'createStatementUpload']) {
      if (c[m]) vi.spyOn(api, m).mockImplementation(c[m])
    }
  }
  /** Приложение телефона целиком: роутер с гардами, `Root` → оболочка с вкладками и «+». */
  async function open(p: Phone, path: string) {
    app?.unmount()
    document.body.innerHTML = ''
    setActivePinia(p.pinia)
    wire(p)
    router = createAppRouter(createMemoryHistory())
    await router.push(path)
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(RouterView) })
    app.use(p.pinia)
    app.use(router)
    app.mount(root)
    await flush()
  }
  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    await useOperationsStore().upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }
  /** Новая семья после первого запуска: мечта, «Позже», «Пропустить» — оклада и плана нет, выписка загружена. */
  async function newFamily(): Promise<Phone> {
    server = fakeServer({ ...defaultSyncDoc() })
    const A = await phone('a')
    A.store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    A.store.setPerson('a', { name: 'Ильяс', onboardedAt: '2026-10-23T07:00:00.000Z' })
    A.store.finishSetup()
    await A.store.syncHousehold(A.client)
    await uploaded(A, newFamilyStatement())
    return A
  }

  it('(а) новая семья: «Месяц» без дохода — «—» и кольцо одной дугой «Трат» (Х-23); «Поставить план» → лист → «Поставить» → spendPlans = planByFact, тост; сегментом на «Неделю» — полоса «осталось 33 419 / 33 419», точки нет; «+ Зарплата» → оклад → «Остаётся» = monthPlan().rest', async () => {
    const A = await newFamily()
    await open(A, '/')
    expect(router.currentRoute.value.path).toBe('/')
    // Вкладка «План» → сегмент «Месяц».
    await press(all('nav a, nav button').find((t) => txt(t) === 'План'), 'вкладка «План»')
    if (router.currentRoute.value.path !== '/month') await press(button('Месяц'), 'сегмент «Месяц»')
    expect(router.currentRoute.value.path).toBe('/month')

    // Без дохода: «—» без «Не хватает», кольцо — одна дуга «Трат» (сумма строки «обычно в месяц»), «+ Зарплата» тихо.
    expect(q('[data-rest-none]')).not.toBeNull()
    expect(txt(q('[data-month-top]'))).not.toContain('Не хватает')
    expect(all('[data-month-ring] circle[data-part]').map((c) => c.getAttribute('data-part'))).toEqual(['spend'])
    expect(txt(q('[data-section="spend"]'))).toContain(sp(plain(148_000)))
    // К-14 (FG-08): при «Установить план» подписи под «Траты» нет — понятно по кнопке.
    expect(txt(q('[data-section="spend"]'))).not.toContain('обычно в месяц')
    expect(txt(q('[data-plan-fact]'))).toBe('Установить план')

    // «Поставить план» — маленькая брендовая в строке «Траты» → лист: три строки из «обычно по неделям».
    const { state, ctx } = A.store.planInput(K)
    const fact = planByFact(state, ctx, 'a', todayIso())!
    expect(fact.rows.map((r) => [r.categoryId, r.amount])).toEqual([['sc_food', 109_000], ['sc_cafe', 26_000], ['sc_transport', 13_000]])
    await press(q('[data-plan-fact]'), '«Поставить план»')
    expect(all('[data-plan-fact-row]').map((r) => r.getAttribute('data-plan-fact-row'))).toEqual(['sc_food', 'sc_cafe', 'sc_transport'])
    expect(txt(q('[data-plan-fact-sheet]'))).toContain(sp(plain(109_000)))
    await press(q('[data-plan-fact-save]'), '«Поставить»')
    expect(txt(q('[data-plan-fact-done]'))).toContain('План поставлен')
    expect((A.store.householdDoc.spendPlans ?? []).filter((x) => !x.deletedAt).map((x) => [x.by, x.categoryId, x.amount])).toEqual(fact.rows.map((r) => ['a', r.categoryId, r.amount]))
    expect(q('[data-plan-fact]')).toBeNull()

    // Сегмент «Неделя»: полоса плана брендом, «осталось 33 419 / 33 419» (трат на W43 нет), точки на «Месяце» нет.
    await press(button('Неделя'), 'сегмент «Неделя»')
    expect(router.currentRoute.value.path).toBe('/week')
    expect(q('[data-week-plan]')).not.toBeNull()
    expect(txt(q('[data-week-rest]'))).toBe(`осталось ${sp(plain(33_419))} / ${sp(money(33_419))}`)
    expect(q('[data-plan-dot]')).toBeNull()

    // «+ Зарплата» → лист оклада → 300 000 → «Остаётся» числом, равным monthPlan().rest.
    await press(button('Месяц'), 'сегмент «Месяц»')
    await press(q('[data-add-salary]'), '«+ Зарплата»')
    await type(q<HTMLInputElement>('[role="dialog"] input[data-salary-now], [role="dialog"] [data-salary-now] input'), '300 000', 'оклад')
    expect(A.store.people.find((p) => p.id === 'a')?.salary).toBe(300_000)
    const after = A.store.planInput(K)
    const rest = monthPlan(after.state, after.ctx).rest
    expect(q('[data-rest-none]')).toBeNull()
    expect(sp(txt(q('[data-rest]')))).toContain(sp(plain(Math.abs(rest))))
  })

  it('(б) заметка нажатиями: «+» → «Заметка» (сразу после «Траты») → текст и сумма → «Сохранить» → карточка на «Неделе», ✓ — сделано; у Аруны после синка — нет; viewer — без «+»', async () => {
    server = fakeServer(planFamilyDoc())
    const A = await phone('a')
    await open(A, '/week')
    expect(router.currentRoute.value.path).toBe('/week')
    await press(plus(), '«+»')
    const items = all('[role="dialog"] a, [role="dialog"] button').map(txt).filter(Boolean)
    expect(items.findIndex((t) => t.startsWith('Заметка'))).toBe(items.findIndex((t) => t.startsWith('Трата')) + 1)
    await press(all('[role="dialog"] a, [role="dialog"] button').find((b) => txt(b).startsWith('Заметка')), 'пункт «Заметка»')
    expect(router.currentRoute.value.query.note).toBe('1')
    expect(q('[data-note-sheet]')).not.toBeNull()
    expect(txt(q('[data-note-sheet]'))).toContain('Всплывёт на своей неделе. Видите только вы.')
    await type(q<HTMLInputElement>('input[data-note-text], [data-note-text] input'), 'Продлить страховку', 'текст заметки')
    await type(q<HTMLInputElement>('input[data-note-amount], [data-note-amount] input'), '60000', 'сумма заметки')
    await press(q('[data-note-save]'), '«Сохранить»')
    expect(A.store.notes).toEqual([expect.objectContaining({ text: 'Продлить страховку', date: '2026-10-23', amount: 60_000 })])
    const card = q('[data-note]')
    expect(txt(card)).toContain('Продлить страховку')
    expect(txt(card)).toContain(`23 октября · ${sp(plain(60_000))}`)
    await press(q('[data-note-done]'), '✓ заметки')
    expect(A.store.notes[0].doneAt).toEqual(expect.any(String))
    // Деньги заметки не трата: сумма недели не изменилась.
    expect(txt(q('[data-week-total]'))).not.toContain('60')

    // Личный документ ушёл на сервер; у Аруны его нет, у viewer нет «+».
    setActivePinia(A.pinia)
    await A.store.syncPrivate(A.client)
    await A.store.syncHousehold(A.client)
    const B = await phone('b')
    await open(B, '/week')
    expect(q('[data-note]')).toBeNull()
    const V = await phone('b', 'viewer', 'u-v')
    await open(V, '/week')
    expect(router.currentRoute.value.path).toBe('/month')
    expect(plus()).toBeNull()
    expect(q('[data-note]')).toBeNull()
  })

  it('(в) viewer новой семьи на «Месяце»: «—» без «+ Зарплата», без «Поставить план» и «В платежи»; на «Деньгах» — без «Добавить»', async () => {
    const A = await newFamily()
    setActivePinia(A.pinia)
    expect(A.store.planFactCall()).not.toBeNull()
    const V = await phone('b', 'viewer', 'u-v')
    await open(V, '/month')
    expect(router.currentRoute.value.path).toBe('/month')
    expect(q('[data-rest-none]')).not.toBeNull()
    expect(q('[data-add-salary]')).toBeNull()
    expect(q('[data-plan-fact]')).toBeNull()
    await press(q('[data-section="dues"] [data-row-open]'), 'строка «Платежи»')
    expect(q('[data-found-pay]')).toBeNull()
    await open(V, '/money')
    expect(txt(q('main'))).not.toContain('Добавить')
    expect(q('[data-capital-salaries]')).toBeNull()
  })
})
