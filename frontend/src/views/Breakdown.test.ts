import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import type { Allocation, Payment, SyncDoc } from '@/types/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import BreakdownRing from '@/components/kit/BreakdownRing.vue'
import Breakdown from './Breakdown.vue'

/**
 * Разбор кольцом (B2C-57; SSR). Семья `planFamilyDoc`: аренда 220 000 + платежи кредитов 58 000 +
 * 25 000 + 20 000 = «Обязательное» 323 000; «Жизнь» — d4 150 000; «Мечты» — взносы целей 30 000 +
 * 40 000 + 60 000 = 130 000; «Запас», «Долги», «Подушка», «Траты» — нули (пустые, не видны).
 * Пришла зарплата Ильяса 700 000: остаётся 700 000 − 323 000 − 150 000 − 130 000 = 97 000.
 */
type NodeFs = { readFileSync(path: URL, encoding: string): string }
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs

const PATH = '/week/breakdown?from=salary&person=a&period=2026-10'
const brandButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*\bbg-brand text-brand-ink[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())
const chips = (html: string) => [...html.matchAll(/data-chip="(\w+)"/g)].map((m) => m[1])
const salary = (who: 'a' | 'b', amount: number): Payment => ({
  id: `s-${who}`, kind: 'salary', targetId: who, period: '2026-10', amount, accountId: 'card', by: who, at: '2026-10-10T05:00:00.000Z', updatedAt: T0,
})
const ORDERED = { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, orderedAt: T0, updatedAt: T0 }

describe('views/Breakdown.vue — разбор кольцом (B2C-57)', () => {
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
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc({ payments: [salary('a', 700_000)], moneySettings: ORDERED, ...extra }), 1)
  }

  it('кольцо: остаётся 97 000 из 700 000; чипы — непустые статьи по порядку; карточка — «Обязательное» 323 000', async () => {
    family()
    const html = await renderScreen(Breakdown, PATH)
    expect(html).toContain(`Остаётся ${money(97_000)} из ${money(700_000)}`)
    expect(html).toContain(money(97_000))
    expect(chips(html)).toEqual(['must', 'life', 'dreams'])
    expect(html).toContain(money(323_000))
    expect(html).toContain('аренда, 3 кредита')
    expect(brandButtons(html)).toEqual(['Разложить'])
    expect(html).toContain('role="switch"')
    expect(html).toContain('Изменить порядок')
  })

  it('выключенная статья: «Мечты» выключены — остаётся 97 000 + 130 000 = 227 000, сумма зачёркнута', async () => {
    family()
    const html = await renderScreen(Breakdown, PATH, undefined, [screenMixin({ off: ['dreams'], picked: 'dreams' })])
    expect(html).toContain(`Остаётся ${money(227_000)}`)
    // Выключенная статья — её сумма зачёркнута (сколько бы она получила), как в макете.
    expect(html).toContain(`line-through">${money(130_000)}`)
    expect(html).toContain('data-chip="dreams"')
    expect(html).toMatch(/aria-pressed="false"[^>]*data-chip="dreams"/)
  })

  it('нехватка: семья из одного, зарплата 400 000 — не хватает 603 000 − 400 000 = 203 000', async () => {
    family('member', 'a', { people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }], payments: [salary('a', 400_000)] })
    const html = await renderScreen(Breakdown, PATH)
    expect(html).toContain(`не хватает ${money(203_000)}`)
    expect(html).toContain(`Остаётся ${money(0)}`)
  })

  it('недозакрытое ждёт зарплату партнёра: 400 000 при окладе Аруны 500 000 — «ждёт зарплату Аруна», нехватки нет', async () => {
    family('member', 'a', { payments: [salary('a', 400_000)] })
    // 400 000: Обязательное 323 000, Жизнь 77 000 из 150 000 — остальное докроет оклад Аруны.
    const html = await renderScreen(Breakdown, PATH, undefined, [screenMixin({ picked: 'life' })])
    expect(html).toContain('ждёт зарплату Аруна')
    expect(html).not.toContain('не хватает')
    expect(html).toContain(money(77_000))
  })

  it('viewer: кольцо и статусы, без «Разложить», переключателей и «Изменить порядок»', async () => {
    family('viewer', 'b')
    const html = await renderScreen(Breakdown, PATH)
    expect(html).toContain(`Остаётся ${money(97_000)}`)
    expect(brandButtons(html)).toEqual([])
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Изменить порядок')
  })

  it('уже разложено: кольцо записи без кнопки, «<кто> · <когда>»; партнёр видит то же', async () => {
    const rec: Allocation = {
      id: 'r1', kind: 'breakdown', source: 'salary', sourceId: 'a', period: '2026-10', by: 'a', at: '2026-10-10T06:00:00.000Z', updatedAt: T0,
      total: 700_000, parts: [{ target: 'must', amount: 323_000 }, { target: 'life', amount: 150_000 }, { target: 'dreams', amount: 130_000 }],
    }
    family('member', 'b', { allocations: [rec] })
    const html = await renderScreen(Breakdown, PATH)
    expect(html).toContain('Разложено')
    expect(html).toContain(`остаётся ${money(97_000)}`)
    expect(html).toContain('Ильяс ·')
    expect(brandButtons(html)).toEqual([])
  })

  it('гвард: в экране и ките кольца нет денежных формул — суммы только из finance.ts', () => {
    for (const file of ['./Breakdown.vue', '../components/kit/BreakdownRing.vue']) {
      const src = fs.readFileSync(new URL(file, import.meta.url), 'utf-8')
      expect(src).not.toMatch(/\.reduce\(/)
      const mustache = [...src.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1])
      for (const expr of mustache) expect(expr, expr).not.toMatch(/[\w)\]]\s*[-+*/]\s*[\w(]/)
    }
    const view = fs.readFileSync(new URL('./Breakdown.vue', import.meta.url), 'utf-8')
    expect(view).not.toMatch(/Math\./)
  })
})

describe('kit/BreakdownRing — конечный вид без движения', () => {
  it('SSR («уменьшить движение»): углы секторов сразу конечные — 0–180°, 180–270°, дорожка 270–360°', async () => {
    const app = createSSRApp(BreakdownRing, { segments: [{ key: 'must', share: 0.5, color: 'var(--s1)' }, { key: 'life', share: 0.25, color: 'var(--s5)' }] })
    const html = await renderToString(app)
    expect(html).toContain('var(--s1) 0deg 180deg')
    expect(html).toContain('var(--s5) 180deg 270deg')
    expect(html).toContain('var(--track) 270deg 360deg')
    expect(html).toContain('var(--shadow-ring)')
    expect(html).toContain('color-mix(in srgb, var(--ink) 35%, transparent)')
  })
})
