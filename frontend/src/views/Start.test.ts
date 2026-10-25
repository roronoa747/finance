import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useApplePayStore } from '@/stores/applepay'
import type { PdfRow } from '@/lib/statements/pdf'
import { parseStatement } from '@/lib/statements/parsers'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import { useOperationsStore } from '@/stores/operations'
import { templateById } from '@/lib/goalTemplates'
import { T0, authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { SyncDoc } from '@/types/finance'
import type { Operation } from '@/lib/statements/types'
import Start from './Start.vue'
import { useInvite } from '@/components/useInvite'

/**
 * Первый запуск «сначала траты» (B2C-19, бэклог «первый» FR-01; Блок 5 «Фидбек», Р-35, FB-21; SSR): вступление → мечта →
 * «Тратьте как обычно» (выписка / Apple Pay / «Позже») → партнёр → «Неделя» или главный. Зарплату и повторы первый запуск
 * больше не спрашивает: «Это ваш доход?» — вопрос «Недели» (`useIncomeAnswer.test.ts`, `Week.dom.test.ts`), повторы —
 * «нашли в выписке» в «Месяце» (`MonthPlan.dom.test.ts`). Куда ведут кнопки — DOM-тест.
 */
const fixtures = import.meta.glob<PdfRow[]>('../lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspiOps = (name = 'kaspi-01') => parseStatement(fixtures[`../lib/statements/fixtures/${name}.rows.json`]).operations

const storage = new Map<string, string>()
function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
}

function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', doc: SyncDoc = defaultSyncDoc()) {
  useAuthStore().setAuthData(authAs(role, slot))
  const store = useFinanceStore()
  store.claimFor('h-family')
  store.setHouseholdDoc(doc, 1)
  return store
}
/** Своя копия операций — как после «Отправить» (стор операций читает её при создании). */
function seedOps(ops: Operation[], user = 'u-a') {
  writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: `h-family:${user}`, ops: Object.fromEntries(ops.map((o) => [o.id, o])) })
}
const act = (name: string, state: Record<string, unknown> = {}) => screenMixin(state, (s) => (s[name] as () => void)())
/** Тексты брендовых кнопок (`variant` default) — правило 12: одна главная на экране. */
const brandButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*class="(?:[^"]*\s)?bg-brand\s[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())

describe('views/Start.vue — первый запуск «сначала траты» (B2C-19, FR-01, FB-21, SSR)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    // Сети нет: картинка шаблона, личный документ и статус Apple Pay не уходят.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('FB-21, TL-10: после вступления новая семья начинает с мечты («1 из 3»); шаг «Тратьте как обычно» («2 из 3») — фото мечты, без плиток выбора, одна брендовая «Загрузить выписку», тихое «Позже»; механики в заголовке нет', async () => {
    const store = family()
    const dream = await renderScreen(Start, '/start/dream')
    expect(dream).toContain('На что копим?')
    expect(dream).toContain('1 из 3')

    store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    const html = await renderScreen(Start, '/start/spend')
    expect(html).toContain('>Тратьте как обычно</h1>')
    expect(html).toContain('Через пару недель покажем, куда уходит')
    expect(html).toContain('2 из 3')
    // Мечта семьи — образом (Р-30): имя мечты на плитке.
    expect(html).toContain('data-start-dream')
    expect(html).toContain('Машина')
    // Путь один (не iPhone) — выбирать нечего: плиток нет (Р-10 «Хвостов»).
    expect(html).not.toContain('data-start-path')
    expect(html).toContain('data-start-upload')
    // Одна брендовая кнопка (правило 12): «Загрузить выписку»; «Позже» — тихо; полей зарплаты и вопросов нет.
    expect(brandButtons(html)).toEqual(['Загрузить выписку'])
    expect(html).toContain('data-start-later')
    expect(html).toContain('accept="application/pdf,.pdf"')
    for (const t of ['Зарплата в месяц', 'Есть PDF из банка', 'Это ваш доход?', 'Нашли', 'Выбрать файл']) expect(html).not.toContain(t)
    // Р-9: «выписка» / «PDF» — не в заголовке и подписи шага.
    const head = html.slice(html.indexOf('<h1'), html.indexOf('</p>', html.indexOf('<h1')))
    expect(head).not.toMatch(/выписк|PDF/i)
    // Одна строка + подсказка про файл (правило 12).
    expect(html).toContain('Файл остаётся на телефоне')
    expect(html).toContain('aria-label="Пояснение"')
  })

  it('FB-21, TL-10: без мечты — плитка без фото; iPhone с ярлыком — две плитки («Выписка» нажата), выбрана Apple Pay — главная «Подключить Apple Pay»; iPhone до ответа статуса и Android — плиток нет', async () => {
    family()
    const ap = useApplePayStore()
    ap.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    // Статус Apple Pay ещё не пришёл (`ap.load()` в пути) — вид с одним путём: плитки не мигают.
    const waiting = await renderScreen(Start, '/start/spend')
    expect(waiting).not.toContain('data-start-path')
    expect(brandButtons(waiting)).toEqual(['Загрузить выписку'])
    ap.status = { connected: false, phones: 0, waiting: false, shortcut_url: 'https://example.test/shortcut', shortcut_url_legacy: 'https://example.test/legacy' } as never
    expect(ap.available).toBe(true)
    const html = await renderScreen(Start, '/start/spend')
    expect(html).toContain('data-start-dream')
    expect(html).toContain('>Мечта</div>')
    expect(html).toContain('data-start-path="applepay"')
    expect(html).toMatch(/aria-pressed="true"[^>]*data-start-path="statement"|data-start-path="statement"[^>]*aria-pressed="true"/)
    expect(brandButtons(html)).toEqual(['Загрузить выписку'])
    // Слово «Apple Pay» — на плитке; без «Pay»-дублей в заголовке и подписи.
    expect(html.slice(html.indexOf('<h1'), html.indexOf('</p>', html.indexOf('<h1')))).not.toContain('Pay')
    const chosen = await renderScreen(Start, '/start/spend', undefined, [screenMixin({ path: 'applepay' })])
    expect(brandButtons(chosen)).toEqual(['Подключить Apple Pay'])
    expect(chosen).not.toContain('Файл остаётся на телефоне')

    // Android с тем же статусом — путь один: плиток нет, выбор Apple Pay не действует.
    ap.userAgent = 'Mozilla/5.0 (Linux; Android 14)'
    const android = await renderScreen(Start, '/start/spend', undefined, [screenMixin({ path: 'applepay' })])
    expect(android).not.toContain('data-start-path')
    expect(brandButtons(android)).toEqual(['Загрузить выписку'])
    expect(android).toContain('data-start-later')
  })

  it('FR-01: старые адреса — `/start/upload`, `/start/salary`, `/start/questions` → траты, `/start/month` → партнёр; чужой шаг → первый непройденный (FR-08)', async () => {
    const store = family()
    store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    for (const path of ['/start/upload', '/start/salary', '/start/questions']) expect(await renderScreen(Start, path), path).toContain('>Тратьте как обычно</h1>')
    const month = await renderScreen(Start, '/start/month')
    expect(month).toContain('Пригласите партнёра')
    expect(month).toContain('3 из 3')
    // Мечта уже есть — чужой шаг ведёт к тратам, а не к вступлению заново.
    expect(await renderScreen(Start, '/start/nope')).toContain('>Тратьте как обычно</h1>')

    setActivePinia(createPinia())
    family('member', 'b', { ...planFamilyDoc(), people: [planFamilyDoc().people[0]] })
    expect(await renderScreen(Start, '/start/salary')).toContain('>Тратьте как обычно</h1>')
    for (const path of ['/start/month', '/start/dream', '/start/invite']) {
      const html = await renderScreen(Start, path)
      expect(html).toContain('data-intro-page')
      expect(html).not.toContain('На что копим?')
    }
  })

  it('FR-08: `/start` без шага — первый непройденный: ничего нет → вступление; цель есть → траты; партнёр семьи, где первый участник не закончил, — свой путь без мечты', async () => {
    const store = family()
    expect(await renderScreen(Start, '/start')).toContain('data-intro-page')
    store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    const spend = await renderScreen(Start, '/start')
    expect(spend).toContain('>Тратьте как обычно</h1>')
    expect(spend).toContain('2 из 3')

    // Код выдан, первый участник закрыл приложение до «Готово» (`setupDoneAt` нет): партнёр — не новая семья.
    setActivePinia(createPinia())
    family('member', 'b', { ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 450_000, payday: 12, updatedAt: T0 }], goals: store.householdDoc.goals })
    expect(await renderScreen(Start, '/start')).toContain('data-intro-page')
    for (const path of ['/start/dream', '/start/invite']) expect(await renderScreen(Start, path)).not.toContain('На что копим?')
    const partner = await renderScreen(Start, '/start/spend')
    expect(partner).toContain('>Тратьте как обычно</h1>')
    // `/ux`: единственный шаг — без полосы «1 из 1».
    expect(partner).not.toContain('1 из 1')
    expect(brandButtons(partner)).toEqual(['Загрузить выписку'])
  })

  it('FR-08: партнёр закончил раньше первого участника («Позже» на тратах) — семья отмечена настроенной им, он — onboardedAt без оклада', async () => {
    const store = family('member', 'b', { ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 450_000, payday: 12, updatedAt: T0 }] })
    await renderScreen(Start, '/start/spend', undefined, [act('afterSpend')])
    expect(store.people.find((p) => p.id === 'b')).toMatchObject({ name: 'b', onboardedAt: expect.any(String) })
    expect(store.people.find((p) => p.id === 'b')?.salary ?? 0).toBe(0)
    expect(store.setupDone).toBe(true)
  })

  it('выписка на шаге трат: операции — себе (как «Отправить»), вопросов нет, оклад не записан — «Неделя» спросит про доход сама', async () => {
    const store = family()
    const ops = useOperationsStore()
    const send = vi.spyOn(ops, 'send').mockImplementation(async () => {
      for (const o of kaspiOps()) ops.ops[o.id] = o
    })
    const parsed = parseStatement(fixtures['../lib/statements/fixtures/kaspi-01.rows.json'])
    await renderScreen(Start, '/start/spend', undefined, [screenMixin({}, (s) => void (s.uploadParsed as (f: unknown[]) => Promise<void>)([{ name: 'выписка.pdf', parsed }]))])
    expect(send).toHaveBeenCalled()
    expect(Object.keys(ops.ops).length).toBeGreaterThan(0)
    expect(store.people.find((p) => p.id === 'a')?.salary ?? 0).toBe(0)
    expect(store.obligations).toEqual([])
    expect(store.merchantRules).toEqual([])
  })

  it('шаг 1 — «На что копим?» внутри первого запуска («1 из 3»); шаг 3 — код партнёра; «Пропустить» в шапке, внизу одна главная; finish ставит setupDoneAt и onboardedAt', async () => {
    const store = family('member', 'a', { ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }] })
    const dream = await renderScreen(Start, '/start/dream')
    expect(dream).toContain('На что копим?')
    expect(dream).toContain('1 из 3')
    // FR-03: «Пока без мечты» внизу нет — «Пропустить» в шапке.
    expect(dream).not.toContain('Пока без мечты')
    expect(dream).toContain('data-skip')
    await renderScreen(Start, '/start/dream', undefined, [
      screenMixin({ step: 'form', template: templateById('car'), name: 'Машина', needText: '3 000 000', term: '18' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    expect(store.goals[0]).toMatchObject({ name: 'Машина', template: 'car', monthly: 166_667 })
    expect(store.queue[0].goal?.name).toBe('Машина')

    const invite = await renderScreen(Start, '/start/invite')
    expect(invite).toContain('Пригласите партнёра')
    expect(invite).toContain('Мечты и покупки — одни на двоих.')
    expect(invite).not.toContain('Бюджет общий')
    expect(invite).toContain('3 из 3')
    expect(invite).toContain('Создать код')
    // FR-03: «Позже» и строка под ним ушли — без партнёра «Пропустить» в шапке, пояснение — в подсказке.
    expect(invite).not.toContain('Позже')
    expect(invite).not.toContain('Один человек — тоже семья.')
    expect(invite).toContain('data-skip')
    // Одна брендовая кнопка внизу: до кода — «Создать код», с кодом — «Готово».
    expect(brandButtons(invite)).toEqual(['Создать код'])
    // Код общий на сессию и семью (`useInvite`, Н-11): создан — виден и шагу первого запуска.
    vi.spyOn(useAuthStore(), 'createInvite').mockResolvedValue({ code: 'K7Q2M9' } as never)
    await useInvite().make()
    const withCode = await renderScreen(Start, '/start/invite')
    expect(withCode).toContain('Готово')
    expect(brandButtons(withCode)).toEqual(['Готово'])
    // `/ux`: с кодом «Пропустить» в шапке делало бы то же, что «Готово», — его нет.
    expect(withCode).not.toContain('data-skip')
    expect(store.setupDone).toBe(false)
    await renderScreen(Start, '/start/invite', undefined, [act('finish')])
    expect(store.setupDone).toBe(true)
    expect(store.people[0].onboardedAt).toBe('2026-09-24T07:00:00.000Z')
  })

  it('партнёр по коду: «Тратьте как обычно» про себя, «Позже» — people[b] с onboardedAt без оклада, семья не трогается', async () => {
    const base = planFamilyDoc()
    const store = family('member', 'b', { ...base, people: [base.people[0]] })
    seedOps(kaspiOps('kaspi-02'), 'u-b')
    const html = await renderScreen(Start, '/start/spend')
    expect(html).not.toContain('1 из 1')
    expect(html).not.toContain('Это ваш доход?')
    await renderScreen(Start, '/start/spend', undefined, [act('afterSpend')])
    expect(store.people.find((p) => p.id === 'b')).toMatchObject({ name: 'b', onboardedAt: '2026-09-24T07:00:00.000Z' })
    expect(store.householdDoc.setupDoneAt).toBe(base.setupDoneAt)
    expect(store.goals).toHaveLength(3)
  })
})
