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
  /** Кто сейчас вошёл. Единственный надёжный способ понять, чья это карточка. */
  userId: string | null
  membership: Membership[]
  rev: number
  status: SyncStatus
  lastSyncedAt: string | null
  lastError: string | null
  /**
   * Локальное состояние должно ЗАМЕНИТЬ облачное, а не слиться с ним.
   * Нужно ровно для сброса: иначе стёртые данные вернулись бы обратно при
   * первом же обмене, потому что слияние честно восстановило бы их с сервера.
   */
  forceReplace: boolean

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
  addObligation: (o: Pick<Obligation, 'name' | 'note' | 'day' | 'category' | 'estimate'> & { amount: number }) => void
  setDeposit: (id: string, patch: Partial<NonNullable<Account['deposit']>>) => void
  setAccountAmount: (id: string, amount: number) => void
  addAccount: (a: Pick<Account, 'name' | 'note' | 'amount' | 'kind' | 'deposit'>) => void
  addCredit: (c: Pick<Credit, 'name' | 'note' | 'principal' | 'annualRate' | 'payment' | 'day'>) => void

  /** Заводит участников из состава семьи: имена берутся из аккаунтов, а не из кода. */
  adoptMembers: (members: Membership[]) => void
  finishSetup: () => void

  setTheme: (t: ThemeChoice) => void
  setAccent: (a: AccentKey) => void
  setCategoryHue: (key: CategoryKey, hue: HueKey) => void

  /* --- синхронизация --- */
  getDoc: () => SyncDoc
  applyDoc: (doc: SyncDoc, rev: number) => void
  setSync: (patch: Partial<Pick<State, 'status' | 'rev' | 'lastSyncedAt' | 'lastError' | 'householdId' | 'userId' | 'membership' | 'forceReplace'>>) => void
  markDirty: () => void

  resetAll: () => void
}

/** Любая правка синхронизируемых данных проходит через это — иначе слияние сломается. */
function touch<T extends { updatedAt: string }>(x: T): T {
  return { ...x, updatedAt: now() }
}

/**
 * Пустой бюджет.
 *
 * Никаких выдуманных зарплат, целей и покупок: чужие цифры на первом экране
 * мешают понять, что здесь твоё, а что нет, и их всё равно пришлось бы удалять
 * руками. Всё, что нужно, спрашивает мастер первичной настройки.
 *
 * Единственное, что заводится заранее, — пять корзин бюджета. Это не данные,
 * а структура: к ним привязаны цвета разделов, и пользователь их переименовывает
 * и наполняет, а не создаёт с нуля.
 */
function seedState(): SyncDoc {
  const t = now()

  const categories: Category[] = [
    { key: 'd1', name: 'Жильё', note: 'аренда, коммуналка, интернет', amount: 0, updatedAt: t },
    { key: 'd2', name: 'Кредиты', note: 'обязательные платежи', amount: 0, updatedAt: t },
    { key: 'd3', name: 'Цели', note: 'взносы в накопления', amount: 0, updatedAt: t },
    { key: 'd4', name: 'Еда и быт', note: 'продукты, транспорт, мелочи', amount: 0, updatedAt: t },
    { key: 'd5', name: 'Свободно', note: 'считается само — это остаток', amount: 0, updatedAt: t },
  ]

  return {
    people: [],
    categories,
    goals: [],
    wishlist: [],
    obligations: [],
    accounts: [],
    credits: [],
    setupDoneAt: null,
  }
}

const defaultSettings: Settings = {
  theme: 'auto',
  accent: 'emerald',
  categories: { d1: 'blue', d2: 'brick', d3: 'green', d4: 'ochre', d5: 'steel' },
  inflation: 0.102,
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seedState(),
      settings: defaultSettings,

      householdId: null,
      userId: null,
      membership: [],
      rev: 0,
      status: 'offline',
      lastSyncedAt: null,
      lastError: null,
      forceReplace: false,

      /*
        Заводит участника, если его ещё нет.
        Без облака состав семьи взять неоткуда, и при первой настройке правка
        уходила бы в пустой список — доход молча не сохранялся.
      */
      setPerson: (id, patch) =>
        set((s) => {
          const exists = s.people.some((p) => p.id === id)
          const people = exists
            ? s.people.map((p) => (p.id === id ? touch({ ...p, ...patch }) : p))
            : [
                ...s.people,
                {
                  id,
                  name: 'Вы',
                  salary: 0,
                  payday: 1,
                  ...patch,
                  updatedAt: now(),
                } as Person,
              ]
          return { people, status: 'dirty' }
        }),

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

      addObligation: ({ amount, ...o }) =>
        set((s) => ({
          obligations: [
            ...s.obligations,
            {
              ...o,
              id: uid(),
              // Первая версия суммы действует «всегда»: нижняя граница нам не важна,
              // важно, что дальше сумма не перезаписывается, а получает новые версии.
              versions: [{ from: '2000-01', amount }],
              updatedAt: now(),
            },
          ],
          status: 'dirty',
        })),

      addAccount: (a) =>
        set((s) => ({
          accounts: [...s.accounts, { ...a, id: uid(), updatedAt: now() }],
          status: 'dirty',
        })),

      addCredit: (c) =>
        set((s) => ({
          credits: [...s.credits, { ...c, id: uid(), updatedAt: now() }],
          status: 'dirty',
        })),

      /*
        Имена участников приходят из аккаунтов Supabase, а не из кода.
        Слот (a/b/c) задаёт цвет и приходит оттуда же, поэтому цвет человека
        одинаковый на обоих телефонах.
      */
      adoptMembers: (members) =>
        set((s) => {
          const known = new Map(s.people.map((p) => [p.id, p]))
          let changed = false
          const people = members.map((m) => {
            const existing = known.get(m.slot)
            // Имя не перезаписываем: человек мог переименовать себя в приложении,
            // и подставлять сюда логин из почты значило бы откатывать его правку.
            if (existing) return existing
            changed = true
            return {
              id: m.slot,
              name: m.displayName,
              salary: 0,
              payday: 1,
              updatedAt: now(),
            } as Person
          })
          // Тех, кто уже был, но кого нет в составе, не трогаем: возможно, состав
          // просто ещё не догрузился, а терять данные из-за этого нельзя.
          for (const p of s.people) if (!people.some((x) => x.id === p.id)) people.push(p)
          return changed ? { people, status: 'dirty' } : {}
        }),

      finishSetup: () => set(() => ({ setupDoneAt: now(), status: 'dirty' })),

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
          setupDoneAt: s.setupDoneAt ?? null,
        }
      },

      applyDoc: (doc, rev) =>
        set(() => ({
          people: doc.people ?? [], categories: doc.categories ?? [], goals: doc.goals ?? [],
          wishlist: doc.wishlist ?? [], obligations: doc.obligations ?? [],
          accounts: doc.accounts ?? [], credits: doc.credits ?? [],
          setupDoneAt: doc.setupDoneAt ?? null,
          rev,
        })),

      setSync: (patch) => set(() => patch),
      markDirty: () => set(() => ({ status: 'dirty' })),

      resetAll: () =>
        set({ ...seedState(), status: 'dirty', forceReplace: true }),
    }),
    {
      name: 'kazna-v1',
      version: 3,
      /**
       * Переход на третью версию стирает данные, а не переносит их.
       *
       * До неё приложение стартовало с придуманного примера — чужие зарплаты,
       * цели и покупки. Часть этого успела уехать в облако. Переносить такое
       * бессмысленно: это не данные семьи, а декорация, которую всё равно
       * пришлось бы удалять руками.
       *
       * Настройки оформления и привязку к семье сохраняем — их заводили осознанно.
       * Флаг forceReplace заставит облачную копию замениться на пустую, иначе
       * стёртое вернулось бы обратно при первом же обмене.
       */
      migrate: (persisted: unknown) => {
        const s = (persisted ?? {}) as Record<string, unknown>
        return {
          ...seedState(),
          settings: (s.settings as Settings) ?? defaultSettings,
          householdId: (s.householdId as string | null) ?? null,
          membership: (s.membership as Membership[]) ?? [],
          rev: 0,
          lastSyncedAt: null as string | null,
          forceReplace: true,
        }
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
        setupDoneAt: s.setupDoneAt,
        settings: s.settings,
        householdId: s.householdId,
        userId: s.userId,
        membership: s.membership,
        rev: s.rev,
        lastSyncedAt: s.lastSyncedAt,
        // Сохраняем: если после сброса закрыть приложение до синхронизации,
        // намерение стереть должно пережить перезапуск, иначе облако вернёт старое.
        forceReplace: s.forceReplace,
      }),
    },
  ),
)

/* ---------------- производные величины ---------------- */

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt

/**
 * Чей это телефон — определяется по идентификатору аккаунта, и только по нему.
 *
 * Раньше «я» вычислялось как первый участник, для которого нашлась карточка
 * в бюджете. Пока человек был один, это работало. Как только присоединился
 * второй, приложение показало ему имя первого и записало его доход в чужую
 * карточку — деньги оказались приписаны не тому человеку.
 *
 * null означает «состав ещё не пришёл»: в этом случае лучше подождать, чем
 * угадать. Без облака участник ровно один, и это слот «a».
 */
export function mySlot(state: Pick<State, 'membership' | 'userId'>): PersonId | null {
  if (!state.membership.length) return 'a'
  if (!state.userId) return null
  return state.membership.find((m) => m.userId === state.userId)?.slot ?? null
}

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
