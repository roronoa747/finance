import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { GOAL_TEMPLATES } from '@/lib/goalTemplates'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import GoalDetail from './GoalDetail.vue'

// Сервер фото и сжатие — заглушки: проверяется только, какое фото остаётся у цели и какое удаляется.
const photos = vi.hoisted(() => ({ deleted: [] as string[], next: 'ph-new', fail: false }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async () => {
    if (photos.fail) throw new Error('offline')
    return photos.next
  }),
  deletePhoto: vi.fn(async (id: string) => {
    photos.deleted.push(id)
  }),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

type Handlers = { onFile: (f: Blob) => Promise<void>; onTemplate: (t: unknown) => Promise<void> }

// Критик Блока 3: замена фото цели удаляет прежнее с сервера (иначе байты — сирота); сбой — прежнее остаётся.
describe('GoalDetail — замена фото цели', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    })
    store.clear()
    photos.deleted = []
    photos.fail = false
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('member'))
    const doc = planFamilyDoc()
    doc.goals = doc.goals.map((g) => (g.id === 'trip' ? { ...g, photoId: 'ph-old', photoCredit: null } : g))
    useFinanceStore().setHouseholdDoc(doc, 1)
  })

  async function handlers(): Promise<Handlers> {
    let h: Handlers | null = null
    await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({}, (s) => {
      // Обращение к полям выбирает экран цели (первый компонент, где они есть), а не оболочку;
      // сам строгий прокси наружу не отдаём — await тронул бы у него `then`.
      h = { onFile: s.onFile as Handlers['onFile'], onTemplate: s.onTemplate as Handlers['onTemplate'] }
    })])
    return h!
  }
  const trip = () => useFinanceStore().goals.find((g) => g.id === 'trip')!

  it('своё фото: новое у цели, прежнее удалено; сбой загрузки — прежнее на месте и не удалено', async () => {
    const h = await handlers()
    await h.onFile(new Blob(['x']))
    expect(trip().photoId).toBe('ph-new')
    expect(photos.deleted).toEqual(['ph-old'])

    photos.deleted = []
    photos.fail = true
    photos.next = 'ph-newer'
    await h.onFile(new Blob(['y']))
    expect(trip().photoId).toBe('ph-new')
    expect(photos.deleted).toEqual([])
  })

  it('шаблон: картинка загружена — прежнее фото удалено', async () => {
    const h = await handlers()
    photos.next = 'ph-tpl'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['img']) })))
    await h.onTemplate(GOAL_TEMPLATES.find((t) => t.id === 'japan')!)
    vi.unstubAllGlobals()
    expect(trip().photoId).toBe('ph-tpl')
    expect(trip().template).toBe('japan')
    expect(photos.deleted).toEqual(['ph-old'])
  })
})
