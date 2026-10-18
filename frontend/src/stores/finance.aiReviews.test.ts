import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { AI_REVIEWS_KEPT, useFinanceStore } from './finance'
import type { AiReview } from '@/types/finance'

/** AI-09 (бэклог «ИИ», Р-4): разбор месяца — последний по `at`; живых в документе не больше 12. */
describe('stores/finance — разборы месяца ИИ', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    setActivePinia(createPinia())
  })

  const draft = (month: string, at: string): Omit<AiReview, 'id' | 'updatedAt'> => ({
    month, at, by: 'a', good: `хорошо ${at}`, risk: 'риск', steps: [{ text: 'шаг', screen: null }], sent: null,
  })

  it('aiReviewOf — последний живой разбор месяца по at', () => {
    const f = useFinanceStore()
    f.saveAiReview(draft('2026-10', '2026-10-02T08:00:00.000Z'))
    const late = f.saveAiReview(draft('2026-10', '2026-10-05T08:00:00.000Z'))
    f.saveAiReview(draft('2026-10', '2026-10-03T08:00:00.000Z'))
    f.saveAiReview(draft('2026-11', '2026-11-01T08:00:00.000Z'))
    expect(f.aiReviewOf('2026-10')?.id).toBe(late.id)
    expect(f.aiReviewOf('2026-09')).toBeNull()
  })

  it(`живых не больше ${AI_REVIEWS_KEPT}: старшие — надгробия без текста и сводки`, () => {
    const f = useFinanceStore()
    for (let i = 1; i <= AI_REVIEWS_KEPT + 2; i++) f.saveAiReview(draft('2026-10', `2026-10-${String(i).padStart(2, '0')}T08:00:00.000Z`))
    const list = f.householdDoc.aiReviews ?? []
    expect(list).toHaveLength(AI_REVIEWS_KEPT + 2)
    const dead = list.filter((r) => r.deletedAt)
    expect(dead.map((r) => r.at)).toEqual(['2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z'])
    expect(dead.every((r) => r.good === '' && r.steps.length === 0 && r.sent === null)).toBe(true)
    expect(f.unsent).toBe(true)
  })
})
