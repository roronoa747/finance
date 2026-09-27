import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { money } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import type { SpendTotal } from '@/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { renderScreen } from '@/test/screenState'
import Dreams from './Dreams.vue'

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
})
