import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { apiClient } from '../src/api/client'
import { money } from '../src/lib/money'
import { templateById, templateCredit, themePhotos, type GoalTemplate } from '../src/lib/goalTemplates'
import type { WishItem } from '../src/types/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import GoalDetail from '../src/views/GoalDetail.vue'
import Wishes from '../src/views/Wishes.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

// Сжатие в Node не декодирует картинку (нет canvas) — как в e2e Блока 3: байты идут как есть.
vi.mock('../src/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

/**
 * Блок 4а «понятность» (PN-33, PN-34) на двух телефонах с фейковым сервером (`support/family`), 12 октября 2026:
 * (а) у существующей мечты лист «Фото мечты» → тема → 3-е фото → `template` `<тип>-3` и новое фото; второй телефон
 * после синка видит то же, лист у него отмечает 3-е; (б) «Желания» с купленными — «Уже купили · N» свёрнуто, раскрытие
 * показывает купленное и сумму; viewer видит то же. Экраны — SSR (`screen`), нажатия — методами экрана (`screenMixin`).
 */
type Phone = Awaited<ReturnType<typeof phone>>

const wish = (w: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'price'>): WishItem => ({
  by: 'a', addedOn: '2026-09-10T06:00:00.000Z', bought: false, updatedAt: T0, ...w,
})

describe('e2e / понятность Блок 4а — мечты: доводка', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    // «Машина» заведена из темы «Машина» — первое фото темы уже загружено.
    const base = planFamilyDoc()
    server = fakeServer(planFamilyDoc({
      goals: base.goals.map((g) => (g.id === 'car' ? { ...g, template: 'car', photoId: 'ph-car-old', photoCredit: templateCredit(templateById('car')!) } : g)),
      wishlist: [
        wish({ id: 'pan', name: 'Сковорода', price: 18_000 }),
        wish({ id: 'vac', name: 'Пылесос', price: 180_000, by: 'b', bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
        wish({ id: 'iron', name: 'Утюг', price: 25_000, bought: true, boughtOn: '2026-09-22T15:00:00.000Z' }),
      ],
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs(role, slot))
    return p
  }
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  const sync = async (from: Phone, to: Phone) => {
    await on(from).store.syncHousehold(from.client)
    await on(to).store.syncHousehold(to.client)
  }
  /** Кружки ряда «другие фото» в листе: `aria-pressed` по порядку. */
  const row = (html: string) => {
    const box = html.match(/data-theme-photos[^>]*>([\s\S]*?)<\/div>/)
    return box ? [...box[1].matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1]) : []
  }

  it('(а) «Фото мечты» у существующей мечты → тема → 3-е фото → `car-3` и новое фото; второй телефон после синка — то же', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    await sync(A, B)
    const car = themePhotos('car')
    expect(car.length).toBeGreaterThanOrEqual(3)

    // Лист открыт: тема мечты выделена, ряд её фото, отмечено первое — то, что у мечты сейчас.
    const sheet = await screen(on(A).pinia, GoalDetail, '/goals/car', undefined, [screenMixin({ pickerOpen: true })])
    expect(sheet).toContain('Фото мечты')
    expect(row(sheet)).toEqual(car.map((_, i) => String(i === 0)))
    expect(sheet).toContain(car[2].photo.unsplashId)

    // Нажатие на 3-й кружок и «Выбрать это»: шаблон скачивается с CDN, сжимается и загружается.
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(url)
      return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }))
    }))
    vi.spyOn(apiClient, 'uploadPhoto').mockResolvedValue({ id: 'ph-car-3' })
    let picked: GoalTemplate | null = null
    await screen(A.pinia, GoalDetail, '/goals/car', undefined, [
      screenMixin({ pickerOpen: true }),
      screenMixin({}, (s) => {
        const pick = s.variants as GoalTemplate[]
        s.pickedId = pick[2].id
        picked = s.picked as GoalTemplate
        ;(s.confirm as () => void)()
      }),
    ])
    expect(picked!.id).toBe('car-3')
    await vi.waitFor(() => expect(A.store.goals.find((g) => g.id === 'car')).toMatchObject({ template: 'car-3', photoId: 'ph-car-3' }))
    expect(fetched.some((u) => u.includes(car[2].photo.unsplashId))).toBe(true)
    expect(A.store.goals.find((g) => g.id === 'car')!.photoCredit).toEqual(templateCredit(car[2]))

    await sync(A, B)
    expect(on(B).store.goals.find((g) => g.id === 'car')).toMatchObject({ template: 'car-3', photoId: 'ph-car-3' })
    const sheetB = await screen(B.pinia, GoalDetail, '/goals/car', undefined, [screenMixin({ pickerOpen: true })])
    expect(row(sheetB)).toEqual(car.map((_, i) => String(i === 2)))
  })

  it('(б) «Желания»: «Уже купили · 2» свёрнуто — купленного и суммы нет; раскрытие показывает; viewer — то же', async () => {
    const A = await as('member', 'a')
    const V = await as('viewer', 'b')
    await sync(A, V)

    for (const p of [A, V]) {
      const closed = await screen(on(p).pinia, Wishes, '/wishes')
      expect(closed).toMatch(/aria-expanded="false"[^>]*data-bought-toggle/)
      expect(closed).toContain('Уже купили · 2')
      expect(closed).toContain('Сковорода')
      expect(closed).not.toContain('Пылесос')
      expect(closed).not.toContain('Утюг')
      expect(closed).not.toContain(money(205_000))

      // Нажатие на строку — обработчиком экрана.
      const open = await screen(p.pinia, Wishes, '/wishes', undefined, [screenMixin({}, (s) => (s.toggleBoughtOpen as () => void)())])
      expect(open).toMatch(/aria-expanded="true"[^>]*data-bought-toggle/)
      expect(open).toContain('Пылесос')
      expect(open).toContain('Утюг')
      expect(open).toContain(money(205_000))
    }
  })
})
