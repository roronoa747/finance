import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Account, Category, Credit, Goal, Membership, Obligation, Person, PersonId,
  Settings, SyncDoc, SyncStatus, WishItem,
} from './types'
import type { AccentKey, CategoryKey, HueKey, ThemeChoice } from '@/lib/palette'
import { monthKey } from '@/lib/dates'

const uid = () => Math.random().toString(36).slice(2, 10)
const now = () => new Date().toISOString()

export type State = SyncDoc & {
  settings: Settings

  /* --- состояние синхронизации; в документ не входит --- */
  householdId: string | null
  membership: Membership[]
  rev: number
  status: SyncStatus
  lastSyncedAt: string | null
  lastError: string | null

  setPerson: (id: PersonId, patch: Partial<Person>) => void
  setCategoryAmount: (key: CategoryKey, amount: number) => void

  addGoal: (g: Pick<Goal, 'name' | 'need' | 'have' | 'monthly' | 'hue'>) => void
  removeGoal: (id: string) => void
  setGoalMonthly: (id: string, monthly: number) => void
  contribute: (id: string, amount: number, by: PersonId) => void

  addWish: (w: Pick<WishItem, 'name' | 'price' | 'by' | 'url'>) => void
  toggleBought: (id: string) => void
  removeWish: (id: string) => void

  amendObligation: (id: string, from: string, amount: number, reason?: string) => void
  setDeposit: (id: string, patch: Partial<NonNullable<Account['deposit']>>) => void
  setAccountAmount: (id: string, amount: number) => void

  setTheme: (t: ThemeChoice) => void
  setAccent: (a: AccentKey) => void
  setCategoryHue: (key: CategoryKey, hue: HueKey) => void

  /* --- синхронизация --- */
  getDoc: () => SyncDoc
  applyDoc: (doc: SyncDoc, rev: number) => void
  setSync: (patch: Partial<Pick<State, 'status' | 'rev' | 'lastSyncedAt' | 'lastError' | 'householdId' | 'membership'>>) => void
  markDirty: () => void

  resetAll: () => void
}

/** Любая правка синхронизируемых данных проходит через это — иначе слияние сломается. */
function touch<T extends { updatedAt: string }>(x: T): T {
  return { ...x, updatedAt: now() }
}

function seedState(): SyncDoc {
  const t = now()

  const people: Person[] = [
    { id: 'a', name: 'Ильяс', salary: 620_000, payday: 10, updatedAt: t },
    { id: 'b', name: 'Аруна', salary: 430_000, payday: 25, updatedAt: t },
  ]

  const categories: Category[] = [
    { key: 'd1', name: 'Жильё', note: 'аренда · коммуналка · интернет', amount: 308_000, updatedAt: t },
    { key: 'd2', name: 'Кредит', note: 'обязательный платёж', amount: 117_000, updatedAt: t },
    { key: 'd3', name: 'Цели', note: 'взносы в накопления', amount: 250_000, updatedAt: t },
    { key: 'd4', name: 'Еда и быт', note: 'продукты, транспорт, мелочи', amount: 220_000, updatedAt: t },
    { key: 'd5', name: 'Свободно', note: 'распределяется в конце месяца', amount: 155_000, updatedAt: t },
  ]

  const goals: Goal[] = [
    { id: 'flat', name: 'Первая квартира', need: 6_000_000, seed: 1_840_000, have: 1_840_000, monthly: 180_000, hue: 'green', planPct: 0.3, movements: [], updatedAt: t },
    { id: 'cushion', name: 'Подушка безопасности', need: 2_600_000, seed: 940_000, have: 940_000, monthly: 40_000, hue: 'blue', planPct: 0.38, movements: [], updatedAt: t },
    { id: 'trip', name: 'Отпуск', need: 900_000, seed: 610_000, have: 610_000, monthly: 30_000, hue: 'teal', planPct: 0.62, movements: [], updatedAt: t },
  ]

  const wishlist: WishItem[] = [
    { id: uid(), name: 'Диван в гостиную', price: 320_000, by: 'b', addedOn: '12 августа', bought: false, updatedAt: t },
    { id: uid(), name: 'Робот-пылесос', price: 140_000, by: 'a', addedOn: '2 сентября', bought: false, updatedAt: t },
    { id: uid(), name: 'Сковорода', price: 18_000, by: 'a', addedOn: '28 августа', bought: false, updatedAt: t },
    { id: uid(), name: 'Микроволновка', price: 65_000, by: 'b', addedOn: '10 августа', bought: true, boughtOn: '14 августа', updatedAt: t },
  ]

  const obligations: Obligation[] = [
    {
      id: 'rent', name: 'Аренда', note: 'квартира', day: 5, category: 'd1', updatedAt: t,
      versions: [
        { from: '2025-01', amount: 280_000 },
        { from: '2026-11', amount: 220_000, reason: 'Переезд' },
      ],
    },
    { id: 'utilities', name: 'Коммуналка', note: 'плавает по сезону', day: 15, category: 'd1', parentId: 'rent', estimate: true, versions: [{ from: '2025-01', amount: 22_000 }], updatedAt: t },
    { id: 'internet', name: 'Интернет', note: 'подпункт жилья', day: 18, category: 'd1', parentId: 'rent', versions: [{ from: '2025-01', amount: 6_000 }], updatedAt: t },
  ]

  const accounts: Account[] = [
    { id: 'otbasy', name: 'Отбасы · Первая квартира', note: 'жилищный вклад', amount: 1_840_000, kind: 'deposit', deposit: { annualRate: 0.02, months: 24, monthlyTopUp: 180_000, capitalize: true }, updatedAt: t },
    { id: 'halyk', name: 'Депозит · Подушка', note: 'Halyk', amount: 940_000, kind: 'deposit', deposit: { annualRate: 0.165, months: 12, monthlyTopUp: 40_000, capitalize: true }, updatedAt: t },
    { id: 'kaspi', name: 'Карта · Kaspi', note: 'повседневный счёт', amount: 240_000, kind: 'card', updatedAt: t },
    { id: 'usd', name: 'Наличные · доллары', note: '$1 200', amount: 640_000, kind: 'cash', updatedAt: t },
    { id: 'trip-env', name: 'Конверт · Отпуск', note: 'лежит на карте', amount: 610_000, kind: 'envelope', updatedAt: t },
  ]

  const credits: Credit[] = [
    { id: 'consumer', name: 'Потребительский кредит', note: 'Halyk', principal: 1_640_000, annualRate: 0.234, payment: 117_000, day: 12, updatedAt: t },
  ]

  return { people, categories, goals, wishlist, obligations, accounts, credits }
}

const defaultSettings: Settings = {
  theme: 'auto',
  accent: 'emerald',
  categories: { d1: 'blue', d2: 'brick', d3: 'green', d4: 'ochre', d5: 'steel' },
  inflation: 0.102,
}

const DOC_KEYS = ['people', 'categories', 'goals', 'wishlist', 'obligations', 'accounts', 'credits'] as const

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seedState(),
      settings: defaultSettings,

      householdId: null,
      membership: [],
      rev: 0,
      status: 'offline',
      lastSyncedAt: null,
      lastError: null,

      setPerson: (id, patch) =>
        set((s) => ({
          people: s.people.map((p) => (p.id === id ? touch({ ...p, ...patch }) : p)),
          status: 'dirty',
        })),

      setCategoryAmount: (key, amount) =>
        set((s) => ({
          categories: s.categories.map((c) => (c.key === key ? touch({ ...c, amount }) : c)),
          status: 'dirty',
        })),

      addGoal: (g) =>
        set((s) => ({
          goals: [
            ...s.goals,
            { ...g, id: uid(), seed: g.have, planPct: 0, movements: [], updatedAt: now() },
          ],
          status: 'dirty',
        })),

      // Не вырезаем из массива: у партнёра запись осталась бы и вернулась при слиянии.
      removeGoal: (id) =>
        set((s) => ({
          goals: s.goals.map((g) => (g.id === id ? { ...g, deletedAt: now(), updatedAt: now() } : g)),
          status: 'dirty',
        })),

      setGoalMonthly: (id, monthly) =>
        set((s) => ({
          goals: s.goals.map((g) => (g.id === id ? touch({ ...g, monthly }) : g)),
          status: 'dirty',
        })),

      contribute: (id, amount, by) =>
        set((s) => ({
          goals: s.goals.map((g) => {
            if (g.id !== id) return g
            const movements = [
              { id: uid(), date: now(), amount, by },
              ...g.movements,
            ]
            const total = movements.reduce((acc, m) => acc + m.amount, 0)
            return touch({ ...g, movements, have: Math.max(0, g.seed + total) })
          }),
          status: 'dirty',
        })),

      addWish: (w) =>
        set((s) => ({
          wishlist: [
            { ...w, id: uid(), bought: false, addedOn: 'сегодня', updatedAt: now() },
            ...s.wishlist,
          ],
          status: 'dirty',
        })),

      toggleBought: (id) =>
        set((s) => ({
          wishlist: s.wishlist.map((w) =>
            w.id === id
              ? touch({ ...w, bought: !w.bought, boughtOn: !w.bought ? 'сегодня' : undefined })
              : w,
          ),
          status: 'dirty',
        })),

      removeWish: (id) =>
        set((s) => ({
          wishlist: s.wishlist.map((w) =>
            w.id === id ? { ...w, deletedAt: now(), updatedAt: now() } : w,
          ),
          status: 'dirty',
        })),

      amendObligation: (id, from, amount, reason) =>
        set((s) => ({
          obligations: s.obligations.map((o) =>
            o.id === id
              ? touch({
                  ...o,
                  versions: [...o.versions.filter((v) => v.from !== from), { from, amount, reason }]
                    .sort((x, y) => x.from.localeCompare(y.from)),
                })
              : o,
          ),
          status: 'dirty',
        })),

      setDeposit: (id, patch) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id && a.deposit ? touch({ ...a, deposit: { ...a.deposit, ...patch } }) : a,
          ),
          status: 'dirty',
        })),

      setAccountAmount: (id, amount) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? touch({ ...a, amount }) : a)),
          status: 'dirty',
        })),

      // Оформление — дело устройства. В общий документ не попадает, чтобы партнёр
      // не перекрашивал чужое приложение.
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setAccent: (accent) => set((s) => ({ settings: { ...s.settings, accent } })),
      setCategoryHue: (key, hue) =>
        set((s) => ({
          settings: { ...s.settings, categories: { ...s.settings.categories, [key]: hue } },
        })),

      getDoc: () => {
        const s = get()
        return {
          people: s.people, categories: s.categories, goals: s.goals, wishlist: s.wishlist,
          obligations: s.obligations, accounts: s.accounts, credits: s.credits,
        }
      },

      applyDoc: (doc, rev) =>
        set(() => ({
          people: doc.people ?? [], categories: doc.categories ?? [], goals: doc.goals ?? [],
          wishlist: doc.wishlist ?? [], obligations: doc.obligations ?? [],
          accounts: doc.accounts ?? [], credits: doc.credits ?? [],
          rev,
        })),

      setSync: (patch) => set(() => patch),
      markDirty: () => set(() => ({ status: 'dirty' })),

      resetAll: () => set({ ...seedState(), rev: 0, status: 'offline' }),
    }),
    {
      name: 'kazna-v1',
      version: 2,
      // Данные уже введены на телефоне — молча их терять нельзя.
      migrate: (persisted: unknown, from: number) => {
        const s = persisted as Record<string, unknown>
        if (from >= 2 || !s) return s
        const t = now()
        const stamp = <T extends object>(arr: unknown): T[] =>
          Array.isArray(arr) ? arr.map((x) => ({ updatedAt: t, ...(x as object) })) as T[] : []

        for (const key of DOC_KEYS) s[key] = stamp(s[key])

        // У целей появилось поле seed: восстанавливаем его из накопленного минус взносы.
        s.goals = (s.goals as Goal[]).map((g) => {
          const sum = (g.movements ?? []).reduce((a, m) => a + m.amount, 0)
          return { ...g, seed: g.seed ?? Math.max(0, (g.have ?? 0) - sum) }
        })

        return { ...s, householdId: null, membership: [], rev: 0, status: 'offline' }
      },
      /**
       * Сохраняем явным списком. Статус синхронизации и текст ошибки не пишем:
       * при запуске они определяются заново, а сохранённое «синхронизировано»
       * соврало бы после перезагрузки без сети.
       */
      partialize: (s) => ({
        people: s.people,
        categories: s.categories,
        goals: s.goals,
        wishlist: s.wishlist,
        obligations: s.obligations,
        accounts: s.accounts,
        credits: s.credits,
        settings: s.settings,
        householdId: s.householdId,
        membership: s.membership,
        rev: s.rev,
        lastSyncedAt: s.lastSyncedAt,
      }) as unknown as State,
    },
  ),
)

/* ---------------- производные величины ---------------- */

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt

export const liveGoals = (goals: Goal[]) => goals.filter(alive)
export const liveWishlist = (list: WishItem[]) => list.filter(alive)
export const liveObligations = (list: Obligation[]) => list.filter(alive)
export const liveAccounts = (list: Account[]) => list.filter(alive)
export const liveCredits = (list: Credit[]) => list.filter(alive)

/** Сумма обязательства, действующая в указанном месяце. */
export function amountAt(o: Obligation, key = monthKey()): number {
  const active = o.versions.filter((v) => v.from <= key).sort((a, b) => a.from.localeCompare(b.from))
  return active.length ? active[active.length - 1].amount : 0
}

/** Ближайшее будущее изменение суммы — из него рождается событие «освободится N ₸». */
export function nextChange(o: Obligation, key = monthKey()) {
  const future = o.versions.filter((v) => v.from > key).sort((a, b) => a.from.localeCompare(b.from))
  if (!future.length) return null
  const current = amountAt(o, key)
  return { ...future[0], delta: future[0].amount - current }
}

export const totalIncome = (people: Person[]) =>
  people.filter(alive).reduce((a, p) => a + p.salary, 0)

export const mandatoryMonthly = (categories: Category[]) =>
  categories.filter((c) => c.key === 'd1' || c.key === 'd2' || c.key === 'd4')
    .reduce((a, c) => a + c.amount, 0)

export const netWorth = (accounts: Account[], credits: Credit[]) =>
  liveAccounts(accounts).reduce((a, x) => a + x.amount, 0) -
  liveCredits(credits).reduce((a, c) => a + c.principal, 0)
