import type { AccentKey, CategoryKey, HueKey, ThemeChoice } from '@/lib/palette'

export type PersonId = 'a' | 'b' | 'c'

/**
 * Всё, что синхронизируется, несёт отметку времени и метку удаления.
 *
 * updatedAt нужен, чтобы при слиянии двух устройств выигрывала последняя
 * правка КАЖДОЙ сущности по отдельности, а не всего документа целиком —
 * иначе переименование цели на одном телефоне затрёт новую цель на другом.
 *
 * deletedAt нужен, потому что удаление вырезанием из массива при синхронизации
 * не работает: у партнёра запись осталась, и она вернётся обратно. Удалённое
 * помечается и продолжает ездить между устройствами как надгробие.
 */
export type Tracked = {
  updatedAt: string
  deletedAt?: string | null
}

export type Person = Tracked & {
  id: PersonId
  name: string
  /**
   * Текущий оклад без бонусов. Остаётся как значение по умолчанию,
   * когда версий ещё нет.
   */
  salary: number
  /**
   * Версии оклада с месяцем вступления в силу — как у обязательств.
   * Правка одним полем затирала прошлое: месячные срезы за прошедшие
   * месяцы пересчитывались по новой зарплате и переставали сходиться
   * с реальностью.
   */
  salaryVersions?: ObligationVersion[]
  /** День месяца, когда приходит зарплата. У двоих он разный. */
  payday: number
  /**
   * Когда участник закончил свою часть настройки.
   *
   * Раньше признаком служила зарплата больше нуля — и это было ошибкой:
   * ноль бывает законным (декрет, между работами), а любое обнуление данных
   * заново открывало мастер и зацикливало его.
   */
  onboardedAt?: string | null
}

export type Category = Tracked & {
  key: CategoryKey
  name: string
  note: string
  amount: number
}

export type GoalMovement = {
  id: string
  /** ISO-дата */
  date: string
  /** Со знаком: минус — забрали из цели обратно. */
  amount: number
  by: PersonId
  note?: string
}

export type Goal = Tracked & {
  id: string
  name: string
  need: number
  /**
   * Сумма, с которой цель завели. Дальше не меняется сама по себе —
   * только явным редактированием.
   */
  seed: number
  /**
   * Накопленное = seed + сумма всех взносов. Всегда пересчитывается, никогда
   * не правится напрямую.
   *
   * Так сделано ради слияния: если оба сделали взнос офлайн, побеждать по
   * времени нельзя — один взнос просто исчезнет. Взносы объединяются по
   * идентификатору, а сумма считается заново из объединённого списка.
   */
  have: number
  monthly: number
  hue: HueKey
  /** Доля 0..1, где цель должна быть по плану на сегодня. */
  planPct: number
  movements: GoalMovement[]
  /**
   * Счёт, на котором физически лежат накопления цели.
   * Пока не задан, накопления считаются отдельным активом — иначе введённое
   * «уже накоплено» нигде бы не учитывалось и капитал уходил бы в минус.
   */
  accountId?: string | null
}

export type WishItem = Tracked & {
  id: string
  name: string
  price: number
  by: PersonId
  addedOn: string
  url?: string
  bought: boolean
  boughtOn?: string
}

/**
 * Сумма обязательства не перезаписывается никогда. Каждое изменение —
 * новая версия с месяца, в котором она вступает в силу. Отсюда берётся
 * и история, и событие «освободилось N ₸ в месяц».
 */
export type ObligationVersion = {
  /** Ключ месяца вида «2026-11» */
  from: string
  amount: number
  reason?: string
}

export type Obligation = Tracked & {
  id: string
  name: string
  note: string
  /** День платежа */
  day: number
  category: CategoryKey
  versions: ObligationVersion[]
  /** Сумма плавает (коммуналка) — показываем как оценку, а не как факт. */
  estimate?: boolean
  parentId?: string
}

export type Currency = 'KZT' | 'USD' | 'EUR'

export type Account = Tracked & {
  id: string
  name: string
  note: string
  /** Всегда в тенге — по нему считается капитал. */
  amount: number
  kind: 'card' | 'cash' | 'deposit' | 'envelope'
  /**
   * Валютный счёт хранит и сумму в валюте, и курс, по которому её перевели.
   * Курс вводится вручную и запоминается вместе с датой: так прошлые цифры
   * не переписываются при каждом скачке курса, а человек видит, по какому
   * курсу считалось.
   */
  currency?: Currency
  foreignAmount?: number
  rate?: number
  rateAt?: string
  deposit?: {
    annualRate: number
    months: number
    monthlyTopUp: number
    capitalize: boolean
  }
}

export type Credit = Tracked & {
  id: string
  name: string
  note: string
  principal: number
  /** ГЭСВ — годовая эффективная ставка вознаграждения из договора. */
  annualRate: number
  payment: number
  day: number
}

/** Документ, который ездит между устройствами. Настройки оформления в него не входят: */
/** тема и цвета — дело устройства, партнёр не должен перекрашивать чужое приложение. */
export type SyncDoc = {
  people: Person[]
  categories: Category[]
  goals: Goal[]
  wishlist: WishItem[]
  obligations: Obligation[]
  accounts: Account[]
  credits: Credit[]
  /**
   * Когда закончили первичную настройку бюджета. Пустое значит, что показываем
   * мастер. Живёт в общем документе, а не в настройках устройства: второй
   * участник, зайдя со своего телефона, не должен снова проходить настройку
   * жилья и кредитов — у него будет только свой короткий шаг про доход.
   */
  setupDoneAt?: string | null
}

export type SyncStatus = 'offline' | 'idle' | 'syncing' | 'dirty' | 'error' | 'conflict'

export type Membership = {
  householdId: string
  householdName: string
  userId: string
  slot: PersonId
  displayName: string
  role: 'member' | 'viewer'
}

export type Settings = {
  theme: ThemeChoice
  accent: AccentKey
  categories: Record<CategoryKey, HueKey>
  inflation: number
}
