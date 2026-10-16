import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TERM_SNAPS_KEPT, useFinanceStore } from './finance'
import { useAuthStore } from './auth'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { TermSnap } from '@/types/finance'

/** AU-04 (Р-6): снимок срока мечт — участник пишет один раз на месяц; viewer не пишет; живых — не больше 3. */
describe('stores/finance — снимок срока мечт', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T07:00:00Z'))
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = (role: 'member' | 'viewer', termSnaps: TermSnap[] = []) => {
    useAuthStore().setAuthData(authAs(role))
    const f = useFinanceStore()
    f.householdDoc = planFamilyDoc({ termSnaps })
    return f
  }
  const old = (id: string): TermSnap => ({ id, at: `${id}-01T03:00:00.000Z`, income: 1, dueIds: [], goals: [], updatedAt: T0 })

  it('участник без снимка месяца — записан один раз; повторный вызов — без записи', () => {
    const f = setup('member')
    expect(f.ensureTermSnap()).toBe(true)
    const snap = f.termSnapFor('2026-10')!
    expect(snap).toMatchObject({ id: '2026-10', income: 1_200_000 })
    expect(snap.goals.map((g) => g.goalId)).toEqual(['cushion', 'trip', 'car'])
    expect(f.unsent).toBe(true)
    expect(f.ensureTermSnap()).toBe(false)
    expect(f.householdDoc.termSnaps).toHaveLength(1)
  })

  it('viewer — не пишет', () => {
    const f = setup('viewer')
    expect(f.ensureTermSnap()).toBe(false)
    expect(f.householdDoc.termSnaps ?? []).toHaveLength(0)
  })

  it(`живых не больше ${TERM_SNAPS_KEPT}: старшие — надгробия без данных`, () => {
    const f = setup('member', [old('2026-07'), old('2026-08'), old('2026-09')])
    f.ensureTermSnap()
    const list = f.householdDoc.termSnaps ?? []
    expect(list.filter((s) => !s.deletedAt).map((s) => s.id).sort()).toEqual(['2026-08', '2026-09', '2026-10'])
    const dead = list.find((s) => s.id === '2026-07')!
    expect(dead.deletedAt).toBeTruthy()
    expect(dead.goals).toEqual([])
  })
})
