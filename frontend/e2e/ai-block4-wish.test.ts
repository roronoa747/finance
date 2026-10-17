import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import AppShell from '../src/components/AppShell.vue'
import Wishes from '../src/views/Wishes.vue'
import { at, fakeServer, phone, screen, setOnline, type FakeServer } from './support/family'

/**
 * Блок 4 «ИИ» (AI-15, AI-16): «Из скриншота» отменено владельцем 2026-10-18 (≈ 5 ₸ за скриншот — желание ссылкой);
 * осталось «+» → «Покупка в список желаний» → лист «Новое желание» сразу (`/wishes?new=1`). Два телефона на фейковом
 * сервере (`support/family`): телефон 1 добавляет желание из этого листа, партнёр видит его с ценой после синка.
 * Экраны — SSR (`screen`): нажатия — `screenMixin`. Браузер — стенд §6.
 */
describe('e2e / ИИ Блок 4 — «+» → новое желание сразу', () => {
  let server: FakeServer
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  const signIn = (p: { pinia: Pinia }, slot: 'a' | 'b') => {
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs('member', slot))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-10-18T07:00:00Z')
    setOnline(true)
    server = fakeServer(planFamilyDoc({ wishlist: [] }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('пункт «+» ведёт в лист «Новое желание»; «Добавить в список» → желание с ценой у партнёра после синка', async () => {
    const A = await phone(server)
    const B = await phone(server)
    signIn(A, 'a')

    let to = ''
    await screen(A.pinia, AppShell, '/', undefined, [
      screenMixin({ addOpen: true }, (s) => {
        to = (s.actions as { to: string; title: string }[]).find((x) => x.title === 'Покупка в список желаний')!.to
      }),
    ])
    expect(to).toBe('/wishes?new=1')

    // Адрес пункта открывает лист сразу — без «+» в шапке списка (было 3 нажатия, стало 2).
    expect(await screen(A.pinia, Wishes, to)).toContain('Новое желание')
    expect(await screen(A.pinia, Wishes, '/wishes')).not.toContain('Новое желание')

    await screen(A.pinia, Wishes, to, undefined, [
      screenMixin({ wishName: 'Плед', wishPrice: '24 990' }, (s) => void (s.createWish as () => Promise<void>)()),
    ])
    expect(on(A).store.wishlist.map((w) => [w.name, w.price])).toEqual([['Плед', 24_990]])
    await A.store.syncHousehold(A.client)

    signIn(B, 'b')
    await on(B).store.syncHousehold(B.client)
    expect(B.store.wishlist.find((w) => w.name === 'Плед')).toMatchObject({ price: 24_990, by: 'a' })
    const seen = await screen(B.pinia, Wishes, '/wishes')
    expect(seen).toContain('Плед')
    expect(seen).toContain(money(24_990))
  })

  it('«Из скриншота» нет нигде — ни у семьи с ИИ', async () => {
    const A = await phone(server)
    signIn(A, 'a')
    useAuthStore().ai = true
    const html = await screen(A.pinia, Wishes, '/wishes?new=1')
    expect(html).toContain('Новое желание')
    expect(html).not.toContain('скриншот')
  })
})
