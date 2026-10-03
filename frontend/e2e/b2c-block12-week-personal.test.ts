import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, unknownGroups } from '../src/lib/statements/model'
import { OTHER_CATEGORY } from '../src/lib/statements/dictionary'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { Decision } from '../src/lib/finance'
import { GOAL_TYPES, templateById } from '../src/lib/goalTemplates'
import { planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import GoalNew from '../src/views/GoalNew.vue'
import Money from '../src/views/Money.vue'
import MyCircle from '../src/views/MyCircle.vue'
import Settings from '../src/views/Settings.vue'
import Statements from '../src/views/Statements.vue'
import Wishes from '../src/views/Wishes.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

// Сжатие картинки — в браузере (canvas); здесь проверяется путь фото, а не пиксели.
vi.mock('../src/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b })),
}))

/**
 * Блок 12 «Неделя и личное» (B2C-67): два телефона и viewer на фейковом сервере, четверг 24 сентября 2026
 * (неделя 21–27). Часть 1 — пачка: 12 ИП из выписки Ильяса разбираются за два ответа (три строки → «Продукты»,
 * «Выбрать все» → «Не помню»), у Аруны новые итоги; часть 2 — «Выписки»: галочки обоих; часть 3 — свой кружок у
 * партнёра на трёх вкладках; часть 4 — новые шаблоны целей; часть 5 — желание по ссылке (клиент превью подменён:
 * Go на моках не откроет тестовую страницу на loopback — её блокирует SSRF-проверка, живая ссылка — на стенде).
 * Нажатия — обработчиками компонентов (`screenMixin`).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
    await useOperationsStore().loadUploads(p.client)
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const op = (date: string, amount: number, merchant: string, categoryId: string | null = null): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
})

/** 12 незнакомых ИП на этой неделе — хвост, как в настоящих выписках владельца. */
const IP = ['ИП Абенова', 'ИП Жумабаева', 'ИП Сейткали', 'ИП Ким', 'ИП Нурланова', 'ИП Оспанов', 'ИП Ахметова', 'ИП Байжанов', 'ИП Тулегенова', 'ИП Искаков', 'ИП Мусина', 'ИП Ли']
const IP_AMOUNT = (i: number) => 1_000 * (i + 1) // 1 000 … 12 000

async function upload(p: Phone, slot: 'a' | 'b', operations: Omit<Operation, 'id'>[]) {
  const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0, operations: assignIds(operations) }
  setActivePinia(p.pinia)
  const ops = useOperationsStore()
  ops.setDraft([{ name: `${slot}.pdf`, parsed }])
  await ops.send(p.client)
  await p.store.syncHousehold(p.client)
  return ops
}

const uploadA = (A: Phone) =>
  upload(A, 'a', [op('2026-09-22', -18_000, 'Magnum', 'sc_food'), ...IP.map((m, i) => op(`2026-09-2${2 + (i % 3)}`, -IP_AMOUNT(i), m))])

/** Неделя Ильяса в документе: сумма по разделу. */
const weekOf = (p: Phone, categoryId: string) =>
  (p.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W39' && t.categoryId === categoryId).reduce((a, t) => a + t.amount, 0)

/** Кружки участников в HTML: фон и содержимое (как `Settings.test.ts`). */
const circles = (html: string) => [...html.matchAll(/<span class="grid shrink-0 place-items-center rounded-full[^"]*"[^>]*style="background:([^;"]+);?"[^>]*>\s*([^<]*?)\s*<\/span>/g)].map((m) => [m[1].trim(), m[2]])

describe('e2e / B2C Блок 12 — «Неделя и личное» на двух телефонах', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('часть 1 — пачка: 12 ИП за два ответа (три строки → «Продукты», «Выбрать все» → «Не помню»), у Аруны новые итоги; больше не спрашивается', async () => {
    const A = await phone(server, st, 'a')
    const ops = await uploadA(A)
    const B = await phone(server, st, 'b')
    expect(weekOf(B, '_unknown')).toBe(78_000) // 1 000 + … + 12 000

    const first = text(await screen(A.pinia, Statements, '/week'))
    expect(first).toContain('Без раздела · 12')
    expect(first).toContain('Выбрать все')
    expect(first).toContain('Ещё 6') // 6 строк + «Ещё K · сумма ›»

    // Ответ 1: отмечены три строки → чип «Продукты».
    const three = (s: Record<string, unknown>) => (s.decision as Decision).groups!.filter((g) => ['ИП Абенова', 'ИП Ким', 'ИП Ли'].includes(g.label))
    const second = text(await screen(A.pinia, Statements, '/week', undefined, [
      screenMixin({}, (s) => (s.answerBatch as (m: unknown[], to: unknown) => void)(three(s).map((g) => g.match), { categoryId: 'sc_food' })),
    ]))
    expect(second).toContain('Без раздела · 9')
    expect(second).not.toContain('ИП Абенова')

    // Ответ 2: «Выбрать все» → «Не помню» — все оставшиеся в «Прочее».
    const third = text(await screen(A.pinia, Statements, '/week', undefined, [
      screenMixin({}, (s) => (s.answerBatch as (m: unknown[], to: unknown) => void)((s.decision as Decision).groups!.map((g) => g.match), { categoryId: OTHER_CATEGORY })),
    ]))
    expect(third).not.toContain('Без раздела')
    await vi.runOnlyPendingTimersAsync()
    await ops.flush(A.client)
    expect(unknownGroups(ops.all)).toHaveLength(0)

    await sync(A, B)
    expect(weekOf(B, 'sc_food')).toBe(18_000 + 1_000 + 4_000 + 12_000)
    expect(weekOf(B, OTHER_CATEGORY)).toBe(78_000 - 17_000)
    expect(weekOf(B, '_unknown')).toBe(0)

    // «Не помню» — правило: тот же ИП в следующей выписке не спрашивается.
    setActivePinia(A.pinia)
    await upload(A, 'a', [op('2026-09-24', -2_500, 'ИП Сейткали')])
    expect(unknownGroups(useOperationsStore().all)).toHaveLength(0)
  })

  it('часть 2 — «Выписки»: Ильяс загрузил — у обоих его день и «ещё нет» Аруны; Аруна загрузила — две галочки у обоих', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    for (const p of [A, B]) {
      const html = text(await screen(p.pinia, Statements, '/week'))
      expect(html).toContain('Выписки')
      expect(html).toMatch(/Ильяс (пн|вт|ср|чт|пт|сб|вс)/)
      expect(html).toContain('Аруна ещё нет')
    }
    await upload(B, 'b', [op('2026-09-23', -3_000, 'Magnum', 'sc_food')])
    await sync(B, A)
    for (const p of [A, B]) {
      const html = text(await screen(p.pinia, Statements, '/week'))
      expect(html).not.toContain('ещё нет')
      expect(html).toMatch(/Аруна (пн|вт|ср|чт|пт|сб|вс)/)
    }
  })

  it('часть 3 — свой кружок: Ильяс выбрал 🦊 и цвет — Аруна видит его в «Деньгах», «Неделе» и «Настройках»; своё у Аруны — буква', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    const circle = text(await screen(A.pinia, MyCircle, '/settings/me', undefined, [
      screenMixin({}, (s) => {
        const set = s.set as (p: Record<string, unknown>) => void
        set({ emoji: '🦊' })
        set({ color: 's8' })
      }),
    ]))
    expect(circle).toContain('Смайлик')
    expect(A.store.people.find((p) => p.id === 'a')).toMatchObject({ emoji: '🦊', color: 's8' })
    await sync(A, B)
    for (const [view, path] of [[Money, '/money'], [Statements, '/week'], [Settings, '/settings']] as const) {
      const shown = circles(await screen(B.pinia, view, path))
      expect(shown, path).toContainEqual(['var(--s8)', '🦊'])
      expect(shown, path).not.toContainEqual(['var(--pa)', 'И'])
    }
    expect(circles(await screen(B.pinia, Settings, '/settings'))).toContainEqual(['var(--pb)', 'А'])
    // Правит только свой: экран Аруны — её кружок.
    expect(await screen(B.pinia, MyCircle, '/settings/me')).toContain('aria-pressed="true" aria-label="Буква А"')
  })

  it('часть 4 — «Новая цель»: 11 тем с фото и «Своё фото»; «Хадж, Умра» ставит фото и цвет шаблона', async () => {
    const A = await phone(server, st, 'a')
    const html = await screen(A.pinia, GoalNew, '/goals/new')
    for (const k of GOAL_TYPES) expect(html, k.type).toContain(`>${k.name}<`)
    for (const id of ['wedding', 'baby', 'study', 'renovation', 'cushion', 'hajj']) expect(html).toContain(templateById(id)!.photo.unsplashId)
    expect(html).toContain('Своё фото')

    const form = await screen(A.pinia, GoalNew, '/goals/new', undefined, [
      screenMixin({}, (s) => {
        ;(s.pickType as (t: string) => void)('hajj')
        ;(s.next as () => void)()
      }),
    ])
    expect(form).toContain(templateById('hajj')!.photo.unsplashId)
    expect(form).toContain('Хадж, Умра')
    expect(form).toContain('Tibvia')
  })

  it('часть 5 — желание по ссылке: фото и название со страницы, цена человека; Аруна видит желание с фото; viewer — без поля', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Dyson Airwrap Complete', blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }) })
    const uploads: Blob[] = []
    vi.spyOn(apiClient, 'uploadPhoto').mockImplementation(async (b: Blob) => {
      uploads.push(b)
      return { id: 'ph-dyson' }
    })
    let box: { onLink: (t: string) => Promise<void>; create: () => Promise<void>; set: (k: string, v: unknown) => void } | null = null
    await screen(A.pinia, Wishes, '/wishes', undefined, [
      screenMixin({ openWishModal: true }, (s) => {
        const raw = s
        box = { onLink: s.onLink as (t: string) => Promise<void>, create: s.createWish as () => Promise<void>, set: (k, v) => Reflect.set(raw, k, v) }
      }),
    ])
    box!.set('wishUrl', 'https://kaspi.kz/shop/p/dyson-airwrap-1/')
    await box!.onLink('https://kaspi.kz/shop/p/dyson-airwrap-1/')
    box!.set('wishPrice', '289 990')
    await box!.create()
    const wish = A.store.wishlist.find((w) => w.name === 'Dyson Airwrap Complete')!
    expect(wish).toMatchObject({ price: 289_990, url: 'https://kaspi.kz/shop/p/dyson-airwrap-1/', photoId: 'ph-dyson' })
    expect(uploads).toHaveLength(1)

    await sync(A, B)
    expect(B.store.wishlist.find((w) => w.name === 'Dyson Airwrap Complete')).toMatchObject({ photoId: 'ph-dyson', price: 289_990 })
    expect(text(await screen(B.pinia, Wishes, '/wishes'))).toContain('Dyson Airwrap Complete')

    const V = await phone(server, st, 'a', 'viewer')
    const viewer = await screen(V.pinia, Wishes, '/wishes', undefined, [screenMixin({ openWishModal: true })])
    expect(viewer).toContain('Dyson Airwrap Complete')
    expect(viewer).not.toContain('Вставьте ссылку')
  })

  it('часть 6 (приёмка) — пачка в разборе выписки: ответы до «Отправить» уходят правилами, на «Неделе» пачки нет; viewer видит «Выписки» без загрузки и решений', async () => {
    const A = await phone(server, st, 'a')
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const parsed: ParsedStatement = {
      bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0,
      operations: assignIds(IP.map((m, i) => op(`2026-09-2${2 + (i % 3)}`, -IP_AMOUNT(i), m))),
    }
    ops.setDraft([{ name: 'a.pdf', parsed }])

    // Разбор: та же карточка-пачка над «Отправить».
    const draft = text(await screen(A.pinia, Statements, '/week'))
    expect(draft).toContain('Без раздела · 12')
    expect(draft).toContain('Отправить')

    // Три строки → «Продукты», остальные — «Выбрать все» → «Не помню»: два ответа, правила в памяти продавцов.
    const after = text(await screen(A.pinia, Statements, '/week', undefined, [
      screenMixin({}, (s) => {
        const answer = s.answerBatch as (m: unknown[], to: unknown) => void
        const groups = () => (s.decision as Decision).groups!
        answer(groups().filter((g) => ['ИП Абенова', 'ИП Ким', 'ИП Ли'].includes(g.label)).map((g) => g.match), { categoryId: 'sc_food' })
        answer(groups().map((g) => g.match), { categoryId: OTHER_CATEGORY })
      }),
    ]))
    expect(after).not.toContain('Без раздела')
    const rules = A.store.merchantRules.filter((r) => !r.deletedAt)
    expect(rules.filter((r) => r.to.categoryId === OTHER_CATEGORY)).toHaveLength(9)
    expect(rules.filter((r) => r.to.categoryId === 'sc_food')).toHaveLength(3)

    await ops.send(A.client)
    await A.store.syncHousehold(A.client)
    expect(unknownGroups(ops.all)).toHaveLength(0)
    expect(text(await screen(A.pinia, Statements, '/week'))).not.toContain('Без раздела')
    const B = await phone(server, st, 'b')
    expect(weekOf(B, OTHER_CATEGORY)).toBe(78_000 - 17_000)

    const V = await phone(server, st, 'a', 'viewer')
    const viewer = text(await screen(V.pinia, Statements, '/week'))
    expect(viewer).toContain('Выписки')
    expect(viewer).toMatch(/Ильяс (пн|вт|ср|чт|пт|сб|вс)/)
    expect(viewer).not.toContain('Загрузить выписку')
    expect(viewer).not.toContain('Без раздела')
  })
})
