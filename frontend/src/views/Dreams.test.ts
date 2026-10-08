import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { money, pct } from '@/lib/money'
import { HUES } from '@/lib/palette'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import type { SyncDoc, WishItem } from '@/types/finance'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { renderScreen } from '@/test/screenState'
import Dreams from './Dreams.vue'

// Дозагрузка шаблонных фото — счётчик вызовов вместо сети (Unsplash и сервер фото).
const retried = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/goalPhoto')>()),
  retryTemplatePhotos: async () => {
    retried.n += 1
    return 0
  },
}))

/**
 * «Мечты» (B2C-48, Р-42; SSR): мечта по центру, «Цели» и «Желания» строками; недельного нет. Строки
 * «Свободно · до зарплаты» нет (Р-116) — она в подсказке у «Остаётся» в «Месяце» (`MonthPlan.dom.test.ts`, B2C-108). Семья — `planFamilyDoc` (Ильяс a / Аруна b, аренда 220 000,
 * три долга, три цели, доход 1 200 000). «Сейчас» — четверг 17 сентября 2026 (неделя 14–20 сентября).
 */
const NOW = '2026-09-17T07:00:00Z'
const NBSP = ' '
const total = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: T0,
})
const upload = (slot: 'a' | 'b', id: string) => ({ id, slot, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-17', ops_count: 10, created_at: T0 })
const wish = (id: string, name: string, price: number, extra: Partial<WishItem> = {}): WishItem => ({
  id, name, price, by: 'a', addedOn: '2026-09-01', bought: false, updatedAt: T0, ...extra,
})
const WISHES = [
  wish('w1', 'Наушники', 89_000, { list: 'a' }),
  wish('w2', 'Кофемашина', 145_000, { by: 'b', list: 'all' }),
  wish('w0', 'Куплено давно', 10_000, { bought: true, boughtOn: '2026-09-02' }),
  wish('w3', 'Кроссовки', 60_000, { by: 'a', list: 'b' }),
  wish('w4', 'Палатка', 120_000),
]

/** Тексты брендовых кнопок (`bg-brand`) на экране. */
const brandButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*\bbg-brand text-brand-ink[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())

/** Недельное — только на «Неделе» (Р-42, Р-43). */
const WEEKLY = ['Эта неделя', 'Картины недели', 'Неделя пока пустая', 'Не разобрано', 'Загрузить выписку', 'Пришла зарплата', 'Остались деньги', 'Свободно до конца месяца', 'по факту', 'по плану', 'уточнится']

describe('views/Dreams.vue — «Мечты» строками (B2C-48)', () => {
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
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}, uploads: ReturnType<typeof upload>[] = []) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads })
    await useOperationsStore().loadUploads()
    return useFinanceStore()
  }
  const withMain = (): Partial<SyncDoc> => ({ goals: planFamilyDoc().goals.map((g) => (g.id === 'car' ? { ...g, main: true } : g)) })

  it('мечта по центру: процент и название (срок — на экране цели, Р-116); «Цели» — все мечты, кроме главной, с процентом; «+ Новая» — ссылка', async () => {
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    // Машина: 200 000 из 3 000 000 → 7 %; месяца «· июль 2030» под мечтой нет — он на экране цели.
    expect(html).toContain(`7${NBSP}%`)
    expect(html).toContain('text-ink-2">Машина</span>')
    expect(html).not.toContain(`июль${NBSP}2030`)
    expect(html).toContain('href="/goals/new"')
    expect(html).toContain('+ Новая')
    expect(html).toContain('Добавить фото')
    expect(html).toContain('>Цели<')
    for (const g of planFamilyDoc().goals.filter((x) => x.id !== 'car')) {
      expect(html).toContain(g.name)
      expect(html).toContain(`${pct(g.have, g.need)}${NBSP}%`)
    }
    // Главная — не строкой списка: «Машина» только в подписи мечты.
    expect(html).not.toContain('font-semibold text-ink">Машина</span>')
    // У строк целей срока «к <месяц>» нет (Р-116).
    expect(html).not.toMatch(/>к [а-я]+/)
    // Ни одной брендовой кнопки: «+ Новая» и «Все N» — ссылки, желания — строки целиком.
    expect(brandButtons(html)).toEqual([])
    for (const w of WEEKLY) expect(html).not.toContain(w)
  })

  it('строки «Свободно · до зарплаты» на «Мечтах» нет и при выписке месяца (числа — в подсказке «Месяца», B2C-108)', async () => {
    const totals = [
      total('a', 'week', '2026-W38', 'sc_food', 62_000),
      total('a', 'month', '2026-09', 'sc_food', 184_000),
      total('a', 'month', '2026-09', 'sc_credit', 58_000),
      total('a', 'month', '2026-09', '_unknown', 40_000),
    ]
    await family('member', 'a', { ...withMain(), spendTotals: totals }, [upload('a', 'u1')])
    const html = await renderScreen(Dreams, '/')
    expect(html).not.toContain('Свободно')
    expect(html).not.toContain(money(523_000))
    expect(html).not.toMatch(/[Дд]о зарплаты/)
    for (const w of WEEKLY) expect(html).not.toContain(w)
  })

  it('до первой выписки — ни «Свободно», ни «До зарплаты» на «Мечтах» нет', async () => {
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    expect(html).not.toContain('Свободно')
    expect(html).not.toContain('До зарплаты')
  })

  it('«Желания» — первые три некупленных: фото-плашка, вся строка — кнопка, цена справа, подпись — чьё; «Все N» = некупленных → /wishes', async () => {
    await family('member', 'a', { ...withMain(), wishlist: WISHES })
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('>Желания<')
    expect(html).toMatch(/href="\/wishes"[^>]*>Все 4</)
    expect(html).toContain('Наушники')
    // Строка — кнопка целиком: название, подпись «чьё», цена справа (Р-116; кнопки «Открыть» нет).
    const row = (name: string, whose: string, price: number) =>
      new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*>${name}</span>(?:(?!</button>)[\\s\\S])*>${whose}</span>(?:(?!</button>)[\\s\\S])*>${money(price)}</span>`)
    expect(html).toMatch(row('Наушники', 'Ильяс', 89_000))
    expect(html).toMatch(row('Кофемашина', 'общие', 145_000))
    expect(html).toMatch(row('Кроссовки', 'Аруна', 60_000))
    expect(html).not.toContain('Палатка')
    expect(html).not.toContain('Куплено давно')
    expect(html).not.toMatch(/>\s*Открыть\s*</)
  })

  it('без главной мечты — «На что копим?» с одной брендовой «Выбрать мечту», путь к «Желаниям» есть; у viewer — без кнопки', async () => {
    await family('member', 'a', { goals: [], wishlist: WISHES })
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('На что копим?')
    expect(brandButtons(html)).toEqual(['Выбрать мечту'])
    expect(html).not.toContain('>Цели<')
    expect(html).toMatch(/href="\/wishes"[^>]*>Все 4</)
    expect(html).toContain('Наушники')

    setActivePinia(createPinia())
    await family('viewer', 'b', { goals: [] })
    const viewer = await renderScreen(Dreams, '/')
    expect(viewer).toContain('На что копим?')
    expect(viewer).not.toContain('Выбрать мечту')
    expect(viewer).toMatch(/href="\/wishes"[^>]*>Все</)
    expect(viewer).not.toContain('+ Желание')
  })

  it('пусто в желаниях: участник — одна строка «+ Желание», viewer — только «Все»', async () => {
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('+ Желание')
    expect(html.match(/\+ Желание/g)?.length).toBe(1)
  })

  it('viewer — мечта и списки; без «+ Новая», «Добавить фото», «+ Желание»; желания — строками-кнопками (ведут в список)', async () => {
    await family('viewer', 'b', { ...withMain(), wishlist: WISHES })
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain(`7${NBSP}%`)
    expect(html).toContain('Подушка')
    expect(html).not.toContain('+ Новая')
    expect(html).not.toContain('Добавить фото')
    expect(html).not.toContain('+ Желание')
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*>Наушники<\/span>/)
    expect(html).not.toContain('Открыть')
    expect(html).not.toContain('До зарплаты')
    for (const w of WEEKLY) expect(html).not.toContain(w)
  })

  it('недельного нет и при незнакомых продавцах, решениях и выписках обоих (всё это — «Неделя»)', async () => {
    const op = (id: string, date: string, amount: number, merchant: string): Operation => ({
      id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false,
    })
    writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: 'h-family:u-b', ops: { o1: op('o1', '2026-09-15', -3_000, 'SHOP A') } })
    useFinanceStore().claimFor('h-family')
    const totals = [total('a', 'week', '2026-W38', 'sc_food', 62_000), total('b', 'week', '2026-W38', 'sc_food', 20_000)]
    // Аруна, 17-е, зарплата 20-го — раньше на главном было «Пришла?».
    await family('member', 'b', { ...withMain(), spendTotals: totals }, [upload('a', 'u1'), upload('b', 'u2')])
    const html = await renderScreen(Dreams, '/')
    for (const w of WEEKLY) expect(html).not.toContain(w)
    expect(html).not.toContain(money(82_000))
  })

  it('цвет — токены; плашка цели без фото — её оттенок из пары HUES', async () => {
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    const hues = new Set(Object.values(HUES).flatMap((h) => [h.light.toLowerCase(), h.dark.toLowerCase()]))
    const literals = [...html.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => m[0].toLowerCase())
    expect(literals.length).toBeGreaterThan(0)
    expect(literals.filter((c) => !hues.has(c))).toEqual([])
    expect(html).not.toMatch(/rgb\(/i)
  })

  it('открытие экрана: шаблонные фото дозагружает только участник — у viewer ни Unsplash, ни 403 от сервера фото', async () => {
    for (const role of ['viewer', 'member'] as const) {
      setActivePinia(createPinia())
      await family(role, 'b', withMain())
      let vm: Record<string, any> = {}
      const grab = { created(this: any) { if ('refresh' in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(Dreams, '/', undefined, [grab])
      retried.n = 0
      vm.refresh()
      expect(retried.n).toBe(role === 'member' ? 1 : 0)
    }
  })
})
