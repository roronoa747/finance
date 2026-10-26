import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { doneGoals, netWorth } from '../src/lib/finance'
import type { Goal } from '../src/types/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

vi.mock('../src/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Блок 4 «понятность» (PN-12…PN-15, Р-13): «Сбылось» на двух телефонах с фейковым сервером (`support/family`), 10 октября
 * 2026. «Отпуск» накоплен целиком: 3 000 000 (взнос 50 000 в августе 2025 → «за 14 месяцев»). (а) «Сбылось» с экрана →
 * `doneAt`, капитал −3 000 000, очередь и «Цели» без неё, альбом с ней, экран «за 14 месяцев»; (б) цель на Kaspi Gold —
 * счёт −have, «Вернуть в мечты» — всё назад; (в) A «Сбылось» офлайн, B взнос офлайн → после синка `doneAt` стоит, `have`
 * со взносом, альбом у обоих; (г) viewer — альбом есть, кнопок нет; (д) старый документ без `doneAt` — прежние числа;
 * (е, приёмка) «Ещё нет» и «Сбылось» из меню у мечты не на 100 %, партнёр после синка.
 * Экраны — SSR (`screen`), действия — методами экрана (`screenMixin`); браузер — на стенде §6.
 */
type Phone = Awaited<ReturnType<typeof phone>>

const fullTrip = (extra: Partial<Goal> = {}) =>
  planFamilyDoc().goals.map((g) =>
    g.id === 'trip'
      ? { ...g, seed: 2_950_000, have: 3_000_000, movements: [{ id: 'm-aug', date: '2025-08-15T05:00:00.000Z', amount: 50_000, by: 'a' as const }], ...extra }
      : g,
  )

describe('e2e / понятность Блок 4 — «Сбылось»', () => {
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
    at('2026-10-10T08:00:00Z')
    server = fakeServer(planFamilyDoc({ goals: fullTrip(), goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 } }))
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
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ')
  const worth = (p: Phone) => netWorth(on(p).store.accounts, p.store.credits, p.store.goals)
  const worthOnScreen = async (p: Phone) => text((await screen(p.pinia, Money, '/money')).match(/data-worth[^>]*>([^<]*)</)![1]).trim()
  // Действие миксина срабатывает один раз — на каждое нажатие свой миксин.
  const tapDone = () => screenMixin({}, (s) => (s.markDone as () => void)())

  it('(а) «Сбылось» с экрана: doneAt, момент «за 14 месяцев», капитал −3 000 000, очередь без неё, альбом с ней', async () => {
    const a = await as('member', 'a')
    const before = worth(a)
    expect((await worthOnScreen(a)).replace(/\D/g, '')).toBe(String(before))
    const ask = text(await screen(a.pinia, GoalDetail, '/goals/trip'))
    // FG-24: тонкая строка «Купили?» с маленькими «Ещё нет» / «Сбылось».
    expect(ask).toContain('Купили?')
    expect(ask).not.toContain('Пополнить')

    const moment = text(await screen(a.pinia, GoalDetail, '/goals/trip', undefined, [tapDone()]))
    expect(a.store.goals.find((g) => g.id === 'trip')!.doneAt).toBe('2026-10-10T08:00:00.000Z')
    expect(moment).toContain('Сбылось!')
    expect(moment).toContain('за 14 месяцев')

    expect(worth(a)).toBe(before - 3_000_000)
    expect(a.store.queue.map((q) => q.id)).not.toContain('trip')
    expect(a.store.heroGoal?.id).not.toBe('trip')

    const screenDone = text(await screen(a.pinia, GoalDetail, '/goals/trip'))
    expect(screenDone).toContain('Сбылось в октябре 2026')
    expect(screenDone).not.toContain('Пополнить')
    expect(screenDone).not.toContain('Подробнее')

    const dreams = text(await screen(a.pinia, Dreams, '/'))
    expect(dreams).toContain('Сбылось · 1')
    expect(dreams).not.toContain('Отпуск')
    // Лист «Сбылось» (FG-21: ссылка у «Целей», лист телепортом — в SSR его нет): строки листа — из состояния экрана.
    let album: string[] = []
    await screen(a.pinia, Dreams, '/', undefined, [
      screenMixin({}, (s) => (album = (s.done as Goal[]).map((g) => `${g.name} ${(s.doneMeta as (g: Goal) => string)(g)}`))),
    ])
    expect(album).toEqual(['Отпуск окт 2026 · за 14 мес.'])
  })

  it('(б) цель на счёте: Kaspi Gold −3 000 000, «Вернуть в мечты» — счёт, капитал и очередь назад', async () => {
    // Деньги цели лежат на карте: на ней 5 000 000, из них 3 000 000 — «Отпуск».
    const doc = planFamilyDoc({ goals: fullTrip({ accountId: 'card' }), goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 } })
    doc.accounts = doc.accounts.map((x) => (x.id === 'card' ? { ...x, amount: 5_000_000 } : x))
    server = fakeServer(doc)
    const a = await as('member', 'a')
    const card = () => a.store.accounts.find((x) => x.id === 'card')!.amount
    const [card0, worth0] = [card(), worth(a)]
    expect(card0).toBe(5_000_000)
    await screen(a.pinia, GoalDetail, '/goals/trip', undefined, [tapDone()])
    // Покупка списана с карты: 5 000 000 → 2 000 000; капитал −3 000 000 (цель на счёте в капитал сама не входила).
    expect(card()).toBe(2_000_000)
    expect(worth(a)).toBe(worth0 - 3_000_000)

    await screen(a.pinia, GoalDetail, '/goals/trip', undefined, [screenMixin({}, (s) => (s.menu as (x: string) => void)('undo'))])
    expect(a.store.goals.find((g) => g.id === 'trip')!.doneAt).toBeNull()
    expect(card()).toBe(card0)
    expect(worth(a)).toBe(worth0)
    expect(a.store.queue.map((q) => q.id)).toContain('trip')
  })

  it('(в) два телефона: A «Сбылось» офлайн, B взнос офлайн → doneAt стоит, have со взносом, альбом у обоих', async () => {
    const a = await as('member', 'a')
    const b = await as('member', 'b')
    // Оба офлайн: A отмечает, B (не видел отметки) позже вносит 20 000.
    on(a).store.markGoalDone('trip')
    at('2026-10-10T09:00:00Z')
    on(b).store.contribute('trip', 20_000, 'b', 'премия')
    // Сеть вернулась: A, затем B (409 → слияние), затем A подтягивает.
    await on(a).store.syncHousehold(a.client)
    await on(b).store.syncHousehold(b.client)
    await on(a).store.syncHousehold(a.client)
    for (const p of [a, b]) {
      const g = on(p).store.goals.find((x) => x.id === 'trip')!
      expect(g.doneAt).toBe('2026-10-10T08:00:00.000Z')
      expect(g.have).toBe(3_020_000)
      expect(doneGoals(p.store.goals).map((x) => x.id)).toEqual(['trip'])
      expect(text(await screen(p.pinia, Dreams, '/'))).toContain('Сбылось · 1')
    }
  })

  it('(г) viewer: альбом видит, на 100 % — «Накоплено» без кнопок, у сбывшейся — без меню', async () => {
    server = fakeServer(planFamilyDoc({ goals: fullTrip({ doneAt: '2026-09-20T08:00:00.000Z' }) }))
    const v = await as('viewer', 'b')
    expect(text(await screen(v.pinia, Dreams, '/'))).toContain('Сбылось · 1')
    const done = await screen(v.pinia, GoalDetail, '/goals/trip')
    expect(text(done)).toContain('Сбылось в сентябре 2026')
    expect(done).not.toContain('aria-label="Меню цели"')

    server = fakeServer(planFamilyDoc({ goals: fullTrip() }))
    const v2 = await as('viewer', 'b')
    const full = await screen(v2.pinia, GoalDetail, '/goals/trip')
    expect(text(full)).toContain('Накоплено')
    expect(full).not.toContain('data-goal-done')
    expect(full).not.toContain('data-goal-not-yet')
  })

  it('(д) старый документ без doneAt — прежние числа: капитал с накоплением, очередь та же, альбома нет', async () => {
    const a = await as('member', 'a')
    const goals = a.store.goals
    expect(goals.every((g) => !('doneAt' in g))).toBe(true)
    // Счета 2 000 000 + цели вне счёта 400 000 + 3 000 000 + 200 000 − долги 1 540 000 = 4 060 000.
    expect(worth(a)).toBe(2_000_000 + 400_000 + 3_000_000 + 200_000 - (1_000_000 + 300_000 + 240_000))
    expect(a.store.queue.map((q) => q.id)).toContain('trip')
    expect(await screen(a.pinia, Dreams, '/')).not.toContain('data-done-album')
  })

  it('(е) приёмка: «Ещё нет» прячет вопрос; «Сбылось» из меню у мечты не на 100 % — капитал −have, партнёр видит после синка', async () => {
    const a = await as('member', 'a')
    // «Ещё нет» — вопроса нет до следующего открытия, на месте прежняя карточка срока; doneAt не пишется.
    const later = text(await screen(a.pinia, GoalDetail, '/goals/trip', undefined, [screenMixin({ notYet: true })]))
    expect(later).not.toContain('Купили?')
    expect(a.store.goals.find((g) => g.id === 'trip')!.doneAt).toBeUndefined()

    // «Машина» — 200 000 из 3 000 000: вопроса нет, но «Сбылось» в меню есть (купили раньше, чем накопили).
    const car = await screen(a.pinia, GoalDetail, '/goals/car', undefined, [screenMixin({ menuOpen: true })])
    expect(car).not.toContain('data-goal-ask')
    expect(car).toContain('data-goal-done-menu')
    const before = worth(a)
    const moment = text(await screen(a.pinia, GoalDetail, '/goals/car', undefined, [screenMixin({}, (s) => (s.menu as (x: string) => void)('done'))]))
    expect(moment).toContain('Сбылось!')
    // Ни взносов, ни seedSetAt — «за 1 месяц».
    expect(moment).toContain('за 1 месяц')
    expect(worth(a)).toBe(before - 200_000)
    expect(a.store.queue.map((q) => q.id)).not.toContain('car')

    const b = await as('member', 'b')
    await on(a).store.syncHousehold(a.client)
    await on(b).store.syncHousehold(b.client)
    expect(worth(b)).toBe(worth(a))
    expect(text(await screen(b.pinia, Dreams, '/'))).toContain('Сбылось · 1')
    expect(text(await screen(b.pinia, GoalDetail, '/goals/car'))).toContain('Сбылось в октябре 2026')
  })
})
