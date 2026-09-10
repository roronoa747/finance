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
  /** Планирует новый оклад с указанного месяца, сохраняя прежний в истории. */
  amendSalary: (id: PersonId, from: string, amount: number, reason?: string) => void
  /** Исправляет текущий оклад: он был введён неверно, история ни при чём. */
  correctSalary: (id: PersonId, amount: number) => void
  setCategoryAmount: (key: CategoryKey, amount: number) => void

  addGoal: (g: Pick<Goal, 'name' | 'need' | 'have' | 'monthly' | 'hue'>) => void
  removeGoal: (id: string) => void
  /** Правка цели. Накопленное меняется через seed, чтобы взносы остались целы. */
  updateGoal: (id: string, patch: Partial<Pick<Goal, 'name' | 'need' | 'hue' | 'monthly'>> & { have?: number }) => void
  setGoalMonthly: (id: string, monthly: number) => void
  contribute: (id: string, amount: number, by: PersonId) => void

  addWish: (w: Pick<WishItem, 'name' | 'price' | 'by' | 'url'>) => void
  toggleBought: (id: string) => void
  removeWish: (id: string) => void

  amendObligation: (id: string, from: string, amount: number, reason?: string) => void
  addObligation: (o: Pick<Obligation, 'name' | 'note' | 'day' | 'category' | 'estimate'> & { amount: number }) => void
  /** Правит действующую сумму: это исправление ошибки, а не изменение с даты. */
  correctObligation: (id: string, amount: number) => void
  updateObligation: (id: string, patch: Partial<Pick<Obligation, 'name' | 'note' | 'day' | 'estimate'>>) => void
  removeObligation: (id: string) => void
  removeCredit: (id: string) => void
  updateCredit: (
    id: string,
    patch: Partial<Pick<Credit, 'name' | 'note' | 'principal' | 'annualRate' | 'payment' | 'day'>>,
  ) => void
  setDeposit: (id: string, patch: Partial<NonNullable<Account['deposit']>>) => void
  setAccountAmount: (id: string, amount: number) => void
  updateAccount: (
    id: string,
    patch: Partial<Pick<Account, 'name' | 'note' | 'amount' | 'kind' | 'currency' | 'foreignAmount' | 'rate' | 'rateAt'>>,
  ) => void
  removeAccount: (id: string) => void
  addAccount: (
    a: Pick<Account, 'name' | 'note' | 'amount' | 'kind' | 'deposit' | 'currency' | 'foreignAmount' | 'rate' | 'rateAt'>,
  ) => void
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

      amendSalary: (id, from, amount, reason) =>
        set((s) => ({
          people: s.people.map((p) => {
            if (p.id !== id) return p
            // Первая версия описывает то, что было до сих пор: иначе прошлое
            // осталось бы без суммы и старые месяцы обнулились бы.
            const base = p.salaryVersions?.length
              ? p.salaryVersions
              : [{ from: '2000-01', amount: p.salary }]
            const versions = [...base.filter((v) => v.from !== from), { from, amount, reason }]
              .sort((a, b) => a.from.localeCompare(b.from))
            return touch({ ...p, salaryVersions: versions })
          }),
          status: 'dirty',
        })),

      correctSalary: (id, amount) =>
        set((s) => ({
          people: s.people.map((p) => {
            if (p.id !== id) return p
            const cur = (p.salaryVersions ?? []).filter((v) => v.from <= monthKey()).pop()
            return touch({
              ...p,
              salary: amount,
              salaryVersions: cur
                ? p.salaryVersions!.map((v) => (v.from === cur.from ? { ...v, amount } : v))
                : p.salaryVersions,
            })
          }),
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

      updateGoal: (id, patch) =>
        set((s) => ({
          goals: s.goals.map((g) => {
            if (g.id !== id) return g
            const { have, ...rest } = patch
            if (have === undefined) return touch({ ...g, ...rest })
            // Накопленное складывается из seed и взносов. Правим seed, иначе
            // ручная правка суммы стёрла бы историю пополнений.
            const sum = g.movements.reduce((a, m) => a + m.amount, 0)
            const seed = Math.max(0, have - sum)
            return touch({ ...g, ...rest, seed, have: Math.max(0, seed + sum) })
          }),
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

      /**
       * Исправление ошибки в текущей сумме — это НЕ то же самое, что изменение
       * с будущего месяца. Здесь мы правим действующую версию: значит, сумма
       * была введена неверно с самого начала. Для «с ноября станет меньше»
       * есть amendObligation, который добавляет новую версию и оставляет
       * историю нетронутой.
       */
      correctObligation: (id, amount) =>
        set((s) => ({
          obligations: s.obligations.map((o) => {
            if (o.id !== id) return o
            const sorted = [...o.versions].sort((a, b) => a.from.localeCompare(b.from))
            const current = sorted.filter((v) => v.from <= monthKey()).pop()
            if (!current) return o
            return touch({
              ...o,
              versions: o.versions.map((v) => (v.from === current.from ? { ...v, amount } : v)),
            })
          }),
          status: 'dirty',
        })),

      updateObligation: (id, patch) =>
        set((s) => ({
          obligations: s.obligations.map((o) => (o.id === id ? touch({ ...o, ...patch }) : o)),
          status: 'dirty',
        })),

      removeObligation: (id) =>
        set((s) => ({
          obligations: s.obligations.map((o) =>
            o.id === id ? { ...o, deletedAt: now(), updatedAt: now() } : o,
          ),
          status: 'dirty',
        })),

      removeCredit: (id) =>
        set((s) => ({
          credits: s.credits.map((c) =>
            c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c,
          ),
          status: 'dirty',
        })),

      updateCredit: (id, patch) =>
        set((s) => ({
          credits: s.credits.map((c) => (c.id === id ? touch({ ...c, ...patch }) : c)),
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

      updateAccount: (id, patch) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? touch({ ...a, ...patch }) : a)),
          status: 'dirty',
        })),

      /*
        Цель может лежать на счёте — тогда её накопления не считаются вторым
        активом, иначе одни и те же деньги вошли бы в капитал дважды. Если счёт
        удалить, не разорвав связь, деньги исчезнут совсем: счёта уже нет, а
        цель всё ещё считается лежащей на нём.
      */
      removeAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id ? { ...a, deletedAt: now(), updatedAt: now() } : a,
          ),
          goals: s.goals.map((g) => (g.accountId === id ? touch({ ...g, accountId: null }) : g)),
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
      migrate: (persisted: unknown, from: number) => {
        const s = (persisted ?? {}) as Record<string, unknown>

        // Стираем ТОЛЬКО при переходе с версий, где лежал демонстрационный
        // пример. Всё, что новее, переносим как есть: данные семьи не должны
        // пропадать из-за очередного обновления приложения.
        if (from >= 3) return s

        return {
          ...seedState(),
          settings: (s.settings as Settings) ?? defaultSettings,
          householdId: (s.householdId as string | null) ?? null,
          membership: (s.membership as Membership[]) ?? [],
          rev: 0,
          lastSyncedAt: null as string | null,
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
        /*
          forceReplace НЕ сохраняем намеренно.
          Он нужен ровно на один обмен — заменить облачную копию после сброса.
          Пока он лежал в хранилище, устройство, которое давно не открывали,
          при запуске заменяло облако своим устаревшим состоянием и стирало
          всё, что успели ввести на другом телефоне.
        */
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

/**
 * Оклад, действующий в указанном месяце.
 * Без версий возвращает текущее значение — так работают все, кто ещё не
 * планировал изменений.
 */
export function salaryAt(p: Person, key = monthKey()): number {
  const v = (p.salaryVersions ?? [])
    .filter((x) => x.from <= key)
    .sort((a, b) => a.from.localeCompare(b.from))
  return v.length ? v[v.length - 1].amount : p.salary
}

/** Ближайшее запланированное изменение оклада. */
export function nextSalaryChange(p: Person, key = monthKey()) {
  const future = (p.salaryVersions ?? [])
    .filter((x) => x.from > key)
    .sort((a, b) => a.from.localeCompare(b.from))
  if (!future.length) return null
  return { ...future[0], delta: future[0].amount - salaryAt(p, key) }
}

export const totalIncome = (people: Person[], key = monthKey()) =>
  people.filter(alive).reduce((a, p) => a + salaryAt(p, key), 0)

export const mandatoryMonthly = (categories: Category[]) =>
  categories.filter((c) => c.key === 'd1' || c.key === 'd2' || c.key === 'd4')
    .reduce((a, c) => a + c.amount, 0)

/**
 * Накопленное по целям — это тоже деньги семьи.
 *
 * Пока цель не привязана к счёту, её накопления больше нигде не учтены:
 * человек ввёл «уже накоплено 2 млн», а капитал показал минус, потому что
 * видел только кредит. Когда появится привязка цели к вкладу, эти суммы
 * начнут браться со счёта и здесь считаться перестанут — для того и флаг.
 */
/**
 * Суммы по разделам бюджета.
 *
 * Жильё, кредиты и цели НЕ вводятся руками: они уже описаны обязательствами,
 * кредитами и планом по целям. Держать их отдельным числом значит завести
 * вторую версию правды, которая немедленно разойдётся с первой — что и
 * случилось: человек завёл аренду и цель, а бюджет остался в нулях.
 *
 * Руками задаётся только «еда и быт»: это единственная статья, которую мы
 * принципиально не отслеживаем по операциям. Свободный остаток — то, что
 * осталось от дохода.
 */
export function budgetAmounts(state: Pick<State, 'categories' | 'obligations' | 'credits' | 'goals' | 'people'>) {
  const key = monthKey()
  const housing = liveObligations(state.obligations)
    .filter((o) => o.category === 'd1')
    .reduce((a, o) => a + amountAt(o, key), 0)
  const other = liveObligations(state.obligations)
    .filter((o) => o.category !== 'd1' && o.category !== 'd2')
    .reduce((a, o) => a + amountAt(o, key), 0)
  const debts =
    liveCredits(state.credits).reduce((a, c) => a + c.payment, 0) +
    liveObligations(state.obligations)
      .filter((o) => o.category === 'd2')
      .reduce((a, o) => a + amountAt(o, key), 0)
  const goals = liveGoals(state.goals).reduce((a, g) => a + g.monthly, 0)
  const living = (state.categories.find((c) => c.key === 'd4')?.amount ?? 0) + other
  const income = totalIncome(state.people)
  const free = income - housing - debts - goals - living

  return { d1: housing, d2: debts, d3: goals, d4: living, d5: free, income }
}

/**
 * Месяцы подряд со взносами, считая назад от текущего.
 *
 * Раньше на экране стояла «7 месяцев» — просто написанное в коде число.
 * Такая цифра хуже, чем её отсутствие: она выглядит как факт, но не значит
 * ничего, и первый же человек, который сверит её с реальностью, перестанет
 * верить и остальным цифрам.
 *
 * Текущий месяц не обрывает серию, даже если взноса ещё не было: он не
 * закончился, и наказывать за это рано.
 */
export function contributionStreak(movements: { date: string; amount: number }[]): number {
  const months = new Set(
    movements.filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7)),
  )
  if (!months.size) return 0

  let streak = 0
  let cursor = monthKey()
  if (!months.has(cursor)) cursor = addMonthsKey(cursor, -1)

  while (months.has(cursor)) {
    streak++
    cursor = addMonthsKey(cursor, -1)
  }
  return streak
}

/** Локальный сдвиг ключа месяца — чтобы не тянуть сюда весь модуль дат. */
function addMonthsKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export const goalSavings = (goals: Goal[]) =>
  liveGoals(goals)
    .filter((g) => !g.accountId)
    .reduce((a, g) => a + Math.max(0, g.have), 0)

export const netWorth = (accounts: Account[], credits: Credit[], goals: Goal[] = []) =>
  liveAccounts(accounts).reduce((a, x) => a + x.amount, 0) +
  goalSavings(goals) -
  liveCredits(credits).reduce((a, c) => a + c.principal, 0)
