import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { liveWishlist } from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import type { SyncDoc, WishItem } from '../src/types/finance'
import Goals from '../src/views/Goals.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import { screenMixin } from '../src/test/screenState'
import { at, fakeServer, phone, screen, setOnline, type FakeServer } from './support/family'

/**
 * Блок 4 паритета — покупки и цели (PV-18, PV-19): два телефона на одном фейковом сервере
 * (`support/family`). Браузерная проверка — на стенде §6.
 */
describe('e2e / PV Блок 4 — покупки и цели на двух телефонах', () => {
  const T0 = '2026-09-01T00:00:00.000Z'
  let server: FakeServer

  const wish = (w: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'price'>): WishItem => ({
    by: 'a', addedOn: '2026-09-10T06:00:00.000Z', bought: false, updatedAt: T0, ...w,
  })

  function seed(): SyncDoc {
    return {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      wishlist: [
        wish({ id: 'pan', name: 'Сковорода', price: 18_000 }),
        wish({ id: 'kettle', name: 'Чайник', price: 12_000, by: 'b', addedOn: '24.09.2026' }),
        wish({ id: 'vac', name: 'Пылесос', price: 180_000, by: 'b', bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
      ],
    }
  }

  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    setOnline(true)
    server = fakeServer(seed())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('PV-18 — покупки', () => {
    it('A правит название и цену → B видит; B возвращает купленное в список → A видит его в активных', async () => {
      const A = await phone(server)
      const B = await phone(server)

      at('2026-09-24T08:00:00Z')
      on(A).store.updateWish('pan', { name: 'Сковорода Tefal', price: 21_000 })
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)
      expect(B.store.wishlist.find((w) => w.id === 'pan')).toMatchObject({ name: 'Сковорода Tefal', price: 21_000 })
      const seen = await screen(B.pinia, Goals, '/goals?tab=wish')
      expect(seen).toContain('Сковорода Tefal')
      expect(seen).toContain(`>${plain(21_000)}</span>`)

      at('2026-09-24T09:00:00Z')
      B.store.toggleBought('vac')
      await B.store.syncHousehold(B.client)
      await on(A).store.syncHousehold(A.client)
      expect(A.store.wishlist.find((w) => w.id === 'vac')).toMatchObject({ bought: false, boughtOn: null })
      const back = await screen(A.pinia, Goals, '/goals?tab=wish')
      const active = back.slice(0, back.indexOf('Уже купили'))
      expect(active).toContain('Пылесос')
      expect(back).toContain('Пока ничего')
    })

    it('A удаляет покупку и отмечает другую купленной → у B её нет, итог «Уже купили» = сумма цен купленных', async () => {
      const A = await phone(server)
      const B = await phone(server)

      at('2026-09-24T08:00:00Z')
      on(A).store.removeWish('kettle')
      A.store.toggleBought('pan')
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)

      const live = liveWishlist(B.store.wishlist)
      expect(live.map((w) => w.id)).not.toContain('kettle')
      const html = await screen(B.pinia, Goals, '/goals?tab=wish')
      expect(html).not.toContain('Чайник')
      const bought = live.filter((w) => w.bought)
      expect(bought.map((w) => w.id).sort()).toEqual(['pan', 'vac'])
      expect(html).toContain(money(bought.reduce((a, w) => a + w.price, 0)))
      expect(html).toContain(money(198_000))
      expect(html).toContain('Ильяс · куплено 24 сентября')
    })

    it('новая покупка A — в начале списка у A, у B — с датой добавления (порядок у B — слияния, как в React)', async () => {
      const A = await phone(server)
      const B = await phone(server)
      on(A).store.addWish({ name: 'Утюг', price: 25_000, by: 'a' })
      expect(A.store.wishlist[0].name).toBe('Утюг')
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)
      // `mergeList` дописывает незнакомую запись в конец (React `store/merge.ts:38-60` — так же).
      expect(B.store.wishlist.find((w) => w.name === 'Утюг')).toMatchObject({ addedOn: '2026-09-24T07:00:00.000Z' })
      expect(await screen(B.pinia, Goals, '/goals?tab=wish')).toContain('Ильяс · 24 сентября')
    })
  })

  describe('PV-19 — цель', () => {
    const ring = (have: number, need: number) => `stroke-dasharray="${((have / need) * 2 * Math.PI * 34).toFixed(1)} `

    it('A правит «Уже накоплено» → у B сумма и кольцо обновились, история взносов на месте', async () => {
      server.data.goals = [
        { id: 'trip', name: 'Отпуск', need: 1_000_000, seed: 100_000, have: 150_000, monthly: 50_000, hue: 'teal', planPct: 0,
          movements: [{ id: 'm1', date: '2026-09-05T06:00:00.000Z', amount: 50_000, by: 'b' }], updatedAt: T0 },
      ]
      const A = await phone(server)
      const B = await phone(server)
      expect(await screen(B.pinia, GoalDetail, '/goals/trip')).toContain(ring(150_000, 1_000_000))

      at('2026-09-24T08:00:00Z')
      on(A).store.updateGoal('trip', { have: 400_000 })
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)

      expect(B.store.goals[0]).toMatchObject({ seed: 350_000, have: 400_000 })
      expect(B.store.goals[0].movements.map((m) => m.id)).toEqual(['m1'])
      const html = await screen(B.pinia, GoalDetail, '/goals/trip')
      expect(html).toContain(`${plain(400_000)} из ${plain(1_000_000)} ₸`)
      expect(html).toContain(ring(400_000, 1_000_000))
      expect(html).toContain(`+${plain(50_000)} ₸`)
    })

    it('A вводит «Откладывать в месяц» числом → B видит сумму и новую дату', async () => {
      server.data.goals = [
        { id: 'trip', name: 'Отпуск', need: 1_000_000, seed: 100_000, have: 100_000, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
      ]
      const A = await phone(server)
      const B = await phone(server)
      at('2026-09-24T08:00:00Z')
      await screen(A.pinia, GoalDetail, '/goals/trip', undefined, [
        screenMixin({}, (s) => (s.onMonthly as (t: string) => void)('73 000')),
      ])
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)
      expect(B.store.goals[0].monthly).toBe(73_000)
      const html = await screen(B.pinia, GoalDetail, '/goals/trip')
      expect(html).toContain(money(73_000))
      // 900 000 при 73 000 в месяц — 13 взносов с сентября: сентябрь 2027.
      expect(html).toContain('Цель закроется в сентябре 2027')
      expect(html).not.toContain('type="range"')
    })
  })
})
