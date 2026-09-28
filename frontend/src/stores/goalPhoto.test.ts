import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, DEMO_HOUSEHOLD } from './finance'
import { GOAL_TEMPLATES, templateById } from '@/lib/goalTemplates'
import { attachFile, attachTemplate, retryTemplatePhotos, type PhotoDeps } from '@/lib/photos/goalPhoto'

/** Фото цели в сторе и оркестрация «шаблон → скачать → сжать → загрузить» (B2C-17). */
describe('stores/finance — фото цели и шаблоны', () => {
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
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
  })

  function deps(overrides: Partial<PhotoDeps> = {}): PhotoDeps & { uploaded: Blob[]; fetched: string[] } {
    const uploaded: Blob[] = []
    const fetched: string[] = []
    return {
      uploaded,
      fetched,
      fetch: async (url) => {
        fetched.push(url)
        return { ok: true, blob: async () => new Blob([new Uint8Array(300_000)], { type: 'image/jpeg' }) }
      },
      compress: async (b) => ({ blob: new Blob([new Uint8Array(Math.min(b.size, 90_000))], { type: 'image/webp' }) }),
      upload: async (b) => {
        uploaded.push(b)
        return `ph-${uploaded.length}`
      },
      online: () => true,
      ...overrides,
    }
  }

  it('addGoal: первая цель — главная, шаблон записан; setGoalPhoto пишет id и автора, null — убирает', () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Япония', need: 1_800_000, monthly: 150_000, hue: 'plum', template: 'japan' })
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ main: true, template: 'japan' })
    expect(store.goals.find((g) => g.id === id)?.photoId).toBeUndefined()
    const second = store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 60_000, hue: 'steel' })
    expect(store.goals.find((g) => g.id === second)?.main).toBeUndefined()

    store.setGoalPhoto(id, 'ph-9', { author: 'Matthew Skinner', url: 'https://unsplash.com/photos/t05kfHeygbE' })
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ photoId: 'ph-9', photoCredit: { author: 'Matthew Skinner' } })
    store.setGoalPhoto(id, null)
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ photoId: null, photoCredit: null })
  })

  it('attachTemplate с сетью: шаблон и цвет сразу, картинка скачана с Unsplash, сжата, загружена; автор сохранён', async () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Мечта', need: 1_000_000, monthly: 50_000, hue: 'blue' })
    const d = deps()
    expect(await attachTemplate(store, id, templateById('japan')!, d)).toBe('uploaded')
    expect(d.fetched).toEqual(['https://images.unsplash.com/21/string-lights.JPG?w=1200&q=80&fm=jpg&fit=crop'])
    expect(d.uploaded[0].size).toBeLessThanOrEqual(150 * 1024)
    expect(store.goals.find((g) => g.id === id)).toMatchObject({
      template: 'japan', hue: 'plum', photoId: 'ph-1', photoCredit: { author: 'Matthew Skinner', url: 'https://unsplash.com/photos/t05kfHeygbE' },
    })
  })

  it('офлайн: цель с шаблоном без картинки; при сети retryTemplatePhotos дозагружает; в демо — никогда', async () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Мечта', need: 1_000_000, monthly: 50_000, hue: 'blue' })
    const offline = deps({ online: () => false })
    expect(await attachTemplate(store, id, templateById('bali')!, offline)).toBe('deferred')
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ template: 'bali', hue: 'green' })
    expect(store.goals.find((g) => g.id === id)?.photoId).toBeUndefined()
    expect(offline.uploaded).toHaveLength(0)

    // Сбой скачивания — тоже отложено.
    const broken = deps({ fetch: async () => ({ ok: false, blob: async () => new Blob() }) })
    expect(await attachTemplate(store, id, templateById('bali')!, broken)).toBe('deferred')

    const online = deps()
    expect(await retryTemplatePhotos(store, GOAL_TEMPLATES, online)).toBe(1)
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ photoId: 'ph-1', photoCredit: { author: 'Andrew Ridley' } })
    // Уже с картинкой — повторно не грузится.
    expect(await retryTemplatePhotos(store, GOAL_TEMPLATES, online)).toBe(0)
    expect(online.uploaded).toHaveLength(1)

    setActivePinia(createPinia())
    const demo = useFinanceStore()
    demo.claimFor(DEMO_HOUSEHOLD)
    const demoId = demo.addGoal({ name: 'Демо', need: 1, monthly: 1, hue: 'blue' })
    const d = deps()
    expect(await attachTemplate(demo, demoId, templateById('car')!, d)).toBe('deferred')
    expect(d.fetched).toEqual([])
    expect(demo.goals.find((g) => g.id === demoId)).toMatchObject({ template: 'car' })
  })

  // Критик Блока 3: смена фото на шаблон без сети подменяла шаблон и цвет, а картинка оставалась
  // прежней навсегда — дозагрузка цели с фото пропускает.
  it('замена фото на шаблон без сети или при сбое: шаблон, цвет и фото прежние — «offline»; с сетью — всё новое', async () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Мечта', need: 1_000_000, monthly: 50_000, hue: 'plum', template: 'japan' })
    store.setGoalPhoto(id, 'ph-old', { author: 'Matthew Skinner', url: 'https://unsplash.com/photos/t05kfHeygbE' })
    const goal = () => store.goals.find((g) => g.id === id)!
    const before = { template: 'japan', hue: 'plum', photoId: 'ph-old', photoCredit: { author: 'Matthew Skinner' } }

    expect(await attachTemplate(store, id, templateById('car')!, deps({ online: () => false }))).toBe('offline')
    expect(goal()).toMatchObject(before)
    const broken = deps({ fetch: async () => ({ ok: false, blob: async () => new Blob() }) })
    expect(await attachTemplate(store, id, templateById('car')!, broken)).toBe('offline')
    expect(goal()).toMatchObject(before)
    // Дозагрузке тут нечего делать: у цели своё фото, отложенного шаблона нет.
    expect(await retryTemplatePhotos(store, GOAL_TEMPLATES, deps())).toBe(0)

    const online = deps()
    expect(await attachTemplate(store, id, templateById('car')!, online)).toBe('uploaded')
    expect(goal()).toMatchObject({ template: 'car', hue: 'steel', photoId: 'ph-1', photoCredit: { author: templateById('car')!.photo.author } })
  })

  it('одна загрузка шаблона на цель: дозагрузка, пока «Новая мечта» ещё грузит, — без второго фото; после — снова можно', async () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Мечта', need: 1_000_000, monthly: 50_000, hue: 'blue' })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = deps({
      fetch: async () => {
        await gate
        return { ok: true, blob: async () => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }) }
      },
    })
    const first = attachTemplate(store, id, templateById('japan')!, slow)
    // Шаблон записан сразу — дозагрузка видит цель без фото, но картинка уже грузится.
    const retry = retryTemplatePhotos(store, GOAL_TEMPLATES, slow)
    release()
    expect(await first).toBe('uploaded')
    expect(await retry).toBe(0)
    expect(slow.uploaded).toHaveLength(1)
    expect(store.goals.find((g) => g.id === id)!.photoId).toBe('ph-1')

    // Загрузка закончилась — другая цель (и эта же позже) грузится как обычно.
    const other = store.addGoal({ name: 'Вторая', need: 1_000_000, monthly: 50_000, hue: 'blue' })
    const online = deps()
    expect(await attachTemplate(store, other, templateById('car')!, online)).toBe('uploaded')
    expect(online.uploaded).toHaveLength(1)
  })

  it('attachFile: своё фото — сжато и загружено без автора; шаблон снимается', async () => {
    const store = useFinanceStore()
    store.claimFor('h1')
    const id = store.addGoal({ name: 'Мечта', need: 1_000_000, monthly: 50_000, hue: 'blue', template: 'car' })
    const d = deps()
    expect(await attachFile(store, id, new Blob([new Uint8Array(2_000_000)], { type: 'image/jpeg' }), d)).toBe(true)
    expect(d.fetched).toEqual([])
    expect(d.uploaded).toHaveLength(1)
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ photoId: 'ph-1', photoCredit: null, template: null })
    expect(await attachFile(store, id, new Blob(), deps({ online: () => false }))).toBe(false)
  })
})
