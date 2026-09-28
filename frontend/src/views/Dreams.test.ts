import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { money } from '@/lib/money'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import type { Allocation, SyncDoc } from '@/types/finance'
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
 * Главный «Мечты» (B2C-14, SSR): герой, плитки, картина недели, «Свободно» по факту, решение.
 * Семья — `planFamilyDoc` (Ильяс a / Аруна b, аренда 220 000, три долга, три цели, доход
 * 1 200 000). «Сейчас» — четверг 17 сентября 2026 (ISO-неделя W38, 14–20 сентября).
 */
const NOW = '2026-09-17T07:00:00Z'
const total = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: T0,
})
const upload = (slot: 'a' | 'b', id: string) => ({ id, slot, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-17', ops_count: 10, created_at: T0 })

describe('views/Dreams.vue — главный «Мечты» (B2C-14)', () => {
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

  it('герой — главная мечта: процент, «накоплено из нужно», «будет вашей в …»; остальные — плитками, плюс «Новая мечта»', async () => {
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    // Машина: 200 000 из 3 000 000 → 7 %; по 60 000 в месяц — 47 взносов → июль 2030.
    expect(html).toContain('До мечты')
    expect(html).toContain('7 %')
    expect(html).toContain(`Машина · 200 000 из ${money(3_000_000)} · будет вашей в июле 2030`)
    expect(html).toContain('Добавить фото')
    expect(html).toContain('Подушка')
    expect(html).toContain('Отпуск')
    expect(html).toContain('13 %')
    expect(html).toContain('Новая мечта')
    expect(html).toContain('href="/wishes"')
    // Цвет — только токены.
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
    expect(html).toContain('bg-surface-3')
  })

  it('без пометки главная — первая живая; без целей — «На что копим?» с кнопкой, у viewer — без кнопки', async () => {
    await family()
    expect(await renderScreen(Dreams, '/')).toContain('Подушка · 400 000 из')
    setActivePinia(createPinia())
    await family('member', 'a', { goals: [] })
    const empty = await renderScreen(Dreams, '/')
    expect(empty).toContain('На что копим?')
    expect(empty).toContain('Одна мечта с фото — и этот экран покажет, сколько до неё осталось.')
    expect(empty).toContain('Выбрать мечту')
    setActivePinia(createPinia())
    await family('viewer', 'b', { goals: [] })
    const viewer = await renderScreen(Dreams, '/')
    expect(viewer).toContain('На что копим?')
    expect(viewer).not.toContain('Выбрать мечту')
  })

  it('ещё нет выписок: «Картины недели пока нет» с кнопкой, «Свободно» — «—» и «появится после первой выписки»', async () => {
    await family()
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('Эта неделя · 14–20 сентября')
    expect(html).toContain('Картины недели пока нет')
    expect(html).toContain('Загрузите первую выписку — картина появится здесь.')
    expect(html).toContain('Загрузить выписку')
    expect(html).toContain('Свободно до конца месяца')
    expect(html).toContain('появится после первой выписки')
    expect(html).toMatch(/type-big[^>]*text-ink-3[^>]*>\s*—\s*</)
  })

  it('выписка только Ильяса: «без выписки Аруна», картина по его разделам, «Свободно» по факту его выписки — посчитано руками', async () => {
    const totals = [
      total('a', 'week', '2026-W38', 'sc_food', 62_000),
      total('a', 'week', '2026-W38', 'sc_cafe', 28_000),
      total('a', 'week', '2026-W38', '_unknown', 10_000),
      total('a', 'month', '2026-09', 'sc_food', 184_000),
      total('a', 'month', '2026-09', 'sc_credit', 58_000),
      total('a', 'month', '2026-09', '_unknown', 40_000),
    ]
    await family('member', 'a', { spendTotals: totals }, [upload('a', 'u1')])
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain(money(100_000))
    expect(html).toContain('без выписки Аруна')
    expect(html).toContain('Продукты')
    expect(html).toContain(money(62_000))
    expect(html).toContain('Кафе и рестораны')
    expect(html).toContain(`не разобрано ${money(10_000)}`)
    expect(html).toContain('Картина недели дополнится, когда Аруна загрузит выписку.')
    expect(html).toContain('href="/week"')
    // Свободно = доход 1 200 000 − обязательства и кредиты сентября 323 000 (аренда 220 000, кредит
    // 58 000, кредитка 25 000, рассрочка 20 000) − взносы в цели 130 000 − траты по выписке 224 000
    // (продукты 184 000 + не разобрано 40 000; кредит 58 000 уже в плане — не вычитается) = 523 000.
    expect(html).toContain(money(523_000))
    expect(html).toContain('пока по выписке Ильяс · уточнится, когда Аруна загрузит')
    expect(html).toContain('aria-valuenow="44"') // 523 000 / 1 200 000
  })

  it('обе выписки: «по выпискам обоих», сумма обоих по разделу, «по факту выписок обоих · 3 дня до зарплаты · Аруна»', async () => {
    const totals = [
      total('a', 'week', '2026-W38', 'sc_food', 62_000),
      total('b', 'week', '2026-W38', 'sc_food', 20_000),
      total('a', 'month', '2026-09', 'sc_food', 184_000),
      total('b', 'month', '2026-09', 'sc_food', 40_000),
    ]
    await family('member', 'a', { spendTotals: totals }, [upload('a', 'u1'), upload('b', 'u2')])
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('по выпискам обоих')
    expect(html).toContain(money(82_000))
    expect(html).not.toContain('без выписки')
    // 1 200 000 − 323 000 − 130 000 − 224 000 = 523 000
    expect(html).toContain(money(523_000))
    expect(html).toContain('по факту выписок обоих · 3 дня до зарплаты · Аруна')
  })

  it('решение: ближайшая своя зарплата «пришла?» у Аруны (20-е, через 3 дня), у Ильяса решений нет; у viewer карточки и «Новой мечты» нет', async () => {
    await family('member', 'b', withMain())
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('Пришла зарплата Аруна?')
    expect(html).toContain(`${money(500_000)} · 20 сентября`)
    expect(html).toContain('>Пришла<')
    expect(html).toContain('>Потом<')

    setActivePinia(createPinia())
    await family('member', 'a', withMain())
    const a = await renderScreen(Dreams, '/')
    expect(a).not.toContain('Пришла зарплата')
    expect(a).not.toContain('aria-live')

    setActivePinia(createPinia())
    await family('viewer', 'b', withMain())
    const viewer = await renderScreen(Dreams, '/')
    expect(viewer).not.toContain('Пришла зарплата')
    expect(viewer).not.toContain('Новая мечта')
    expect(viewer).not.toContain('Добавить фото')
    expect(viewer).toContain('До мечты')
  })

  /* ---------- критик Блока 3 ---------- */

  /** Тексты брендовых кнопок (`bg-brand`) на экране. */
  const brandButtons = (html: string) =>
    [...html.matchAll(/<button[^>]*\bbg-brand text-brand-ink[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())

  it('одна брендовая кнопка на экране (правило 12): без мечты — «Выбрать мечту», ответы решения и загрузка тихие; с мечтой — ответ решения', async () => {
    // Аруна, 17-е, зарплата 20-го — решение «Пришла?»; выписок нет; мечты нет.
    await family('member', 'b', { goals: [] })
    const empty = await renderScreen(Dreams, '/')
    expect(empty).toContain('Пришла зарплата Аруна?')
    expect(empty).toContain('Загрузить выписку')
    expect(brandButtons(empty)).toEqual(['Выбрать мечту'])
    expect(empty).toMatch(/<button[^>]*bg-surface-3[^>]*>\s*Пришла\s*</)

    setActivePinia(createPinia())
    await family('member', 'b', withMain())
    expect(brandButtons(await renderScreen(Dreams, '/'))).toEqual(['Пришла'])
  })

  it('выписки есть, но не за эту неделю: «Неделя пока пустая» — без механики в заголовке', async () => {
    const old = { ...upload('a', 'u1'), period_to: '2026-09-10' }
    await family('member', 'a', withMain(), [old])
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('Неделя пока пустая')
    expect(html).toContain('Загрузите выписку — картина недели появится здесь.')
    expect(html).not.toContain('Выписки за эту неделю')
    expect(html).not.toContain('Картины недели пока нет')
  })

  it('«Остались деньги?» отвечен, если остаток месяца уже разложен семьёй (партнёр не вводит сумму второй раз); ответ «Недели» в JSON-виде тоже читается', async () => {
    vi.setSystemTime(new Date('2026-09-28T07:00:00Z')) // 28 сентября, Алматы
    const rest = (period: string, extra: Partial<Allocation> = {}): Allocation => ({
      id: `rest-${period}`, source: 'rest', sourceId: period, period, by: 'b', at: T0, total: 50_000, parts: [{ target: 'trip', amount: 50_000 }], updatedAt: T0, ...extra,
    })
    await family('member', 'a', { allocations: [rest('2026-08')] })
    expect(await renderScreen(Dreams, '/')).toContain('Остались деньги с сентября?')

    setActivePinia(createPinia())
    await family('member', 'a', { allocations: [rest('2026-09', { deletedAt: T0 })] })
    expect(await renderScreen(Dreams, '/')).toContain('Остались деньги с сентября?')

    setActivePinia(createPinia())
    await family('member', 'a', { allocations: [rest('2026-09')] })
    expect(await renderScreen(Dreams, '/')).not.toContain('Остались деньги')

    // Ответ на /week, записанный прежним JSON-видом ('"2026-09"'), главный тоже понимает (readMonthEnd).
    setActivePinia(createPinia())
    storage.set('ff_month_end', '"2026-09"')
    await family('member', 'a')
    expect(await renderScreen(Dreams, '/')).not.toContain('Остались деньги')
  })

  it('решение «Не разобрано» — незнакомые продавцы только этой недели, сумма из ядра (unknownSummary)', async () => {
    const op = (id: string, date: string, amount: number, merchant: string, categoryId: string | null = null): Operation => ({
      id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
    })
    // Неделя 14–20 сентября: SHOP A дважды (3 000 + 4 000) и CAFE B 5 000 — два продавца, 12 000.
    // Прошлая неделя и узнанные траты не считаются.
    const list = [
      op('o1', '2026-09-15', -3_000, 'SHOP A'),
      op('o2', '2026-09-16', -4_000, 'SHOP A'),
      op('o3', '2026-09-16', -5_000, 'CAFE B'),
      op('o4', '2026-09-10', -9_000, 'OLD C'),
      op('o5', '2026-09-15', -20_000, 'MAGNUM', 'sc_food'),
    ]
    writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: 'h-family:u-a', ops: Object.fromEntries(list.map((o) => [o.id, o])) })
    useFinanceStore().claimFor('h-family')
    await family('member', 'a', withMain())
    const html = await renderScreen(Dreams, '/')
    expect(html).toContain('Не разобрано: 2 продавца')
    expect(html).toContain(`${money(12_000)} за неделю`)
  })

  it('открытие главного: шаблонные фото дозагружает только участник — у viewer ни Unsplash, ни 403 от сервера фото', async () => {
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
