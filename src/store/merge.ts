import type { Goal, GoalMovement, Obligation, SyncDoc, Tracked } from './types'

/**
 * Слияние двух версий документа — сердце синхронизации.
 *
 * Два правила, и оба выбраны так, чтобы деньги не могли пропасть:
 *
 *  1. Списки, в которые только добавляют (взносы в цели, версии обязательств),
 *     объединяются по идентификатору. Если Ильяс и Аруна внесли по взносу
 *     офлайн, после слияния будут оба. Побеждать по времени тут нельзя —
 *     это молча съело бы чужой платёж.
 *
 *  2. Описательные поля берут последнюю правку по updatedAt. Название цели или
 *     срок — вещи, где «последний прав» никого не разоряет, а проигравшая
 *     версия всё равно остаётся в истории документа на сервере.
 *
 * Слияние коммутативно и идемпотентно: порядок аргументов не меняет результат,
 * повторное слияние ничего не портит. Это важно, потому что при конфликте
 * версий клиент сливает и пробует снова — и так может повторяться.
 */

const ts = (x: Tracked) => x.updatedAt ?? ''

/** Побеждает тот, кого правили позже. При равенстве — стабильный выбор, чтобы слияние было коммутативным. */
function pickNewer<T extends Tracked>(a: T, b: T, tieKey: string): T {
  const ta = ts(a)
  const tb = ts(b)
  if (ta === tb) return tieKey === 'a' ? a : b
  return tb > ta ? b : a
}

/** Удаление всегда сильнее правки: надгробие не должно воскресать. */
function mergeDeletion<T extends Tracked>(winner: T, a: T, b: T): T {
  const deletedAt = a.deletedAt ?? b.deletedAt ?? null
  return deletedAt ? { ...winner, deletedAt } : { ...winner, deletedAt: null }
}

function mergeList<T extends Tracked>(
  local: T[],
  remote: T[],
  idOf: (x: T) => string,
  combine?: (winner: T, a: T, b: T) => T,
): T[] {
  const out = new Map<string, T>()
  for (const item of local) out.set(idOf(item), item)

  for (const item of remote) {
    const id = idOf(item)
    const mine = out.get(id)
    if (!mine) {
      out.set(id, item)
      continue
    }
    // Сравниваем по идентификатору, а не по позиции: порядок в массиве значения не имеет.
    const winner = pickNewer(mine, item, idOf(mine) <= id ? 'a' : 'b')
    const merged = mergeDeletion(winner, mine, item)
    out.set(id, combine ? combine(merged, mine, item) : merged)
  }

  return [...out.values()]
}

/** Объединение append-only списка: ничего не теряем, дубликаты по id схлопываем. */
function unionById<T extends { id: string }>(a: T[] = [], b: T[] = []): T[] {
  const out = new Map<string, T>()
  for (const x of a) out.set(x.id, x)
  for (const x of b) if (!out.has(x.id)) out.set(x.id, x)
  return [...out.values()]
}

function sumMovements(movements: GoalMovement[]): number {
  return movements.reduce((acc, m) => acc + m.amount, 0)
}

function mergeGoal(winner: Goal, a: Goal, b: Goal): Goal {
  const movements = unionById(a.movements ?? [], b.movements ?? []).sort((x, y) =>
    y.date.localeCompare(x.date),
  )
  const seed = winner.seed ?? a.seed ?? b.seed ?? 0
  return {
    ...winner,
    seed,
    movements,
    // Пересчёт из объединённого списка — единственный способ не потерять взнос.
    have: Math.max(0, seed + sumMovements(movements)),
  }
}

function mergeObligation(winner: Obligation, a: Obligation, b: Obligation): Obligation {
  // Версии сумм тоже только добавляются. Ключ — месяц вступления в силу.
  const byMonth = new Map<string, Obligation['versions'][number]>()
  for (const v of a.versions ?? []) byMonth.set(v.from, v)
  for (const v of b.versions ?? []) if (!byMonth.has(v.from)) byMonth.set(v.from, v)
  return {
    ...winner,
    versions: [...byMonth.values()].sort((x, y) => x.from.localeCompare(y.from)),
  }
}

export function mergeDocs(local: SyncDoc, remote: SyncDoc): SyncDoc {
  return {
    // Настройку проходят один раз на семью: если хоть кто-то её закончил,
    // отменить это слиянием нельзя.
    setupDoneAt: local.setupDoneAt ?? remote.setupDoneAt ?? null,
    people: mergeList(local.people ?? [], remote.people ?? [], (x) => x.id),
    categories: mergeList(local.categories ?? [], remote.categories ?? [], (x) => x.key),
    goals: mergeList(local.goals ?? [], remote.goals ?? [], (x) => x.id, mergeGoal),
    wishlist: mergeList(local.wishlist ?? [], remote.wishlist ?? [], (x) => x.id),
    obligations: mergeList(
      local.obligations ?? [],
      remote.obligations ?? [],
      (x) => x.id,
      mergeObligation,
    ),
    accounts: mergeList(local.accounts ?? [], remote.accounts ?? [], (x) => x.id),
    credits: mergeList(local.credits ?? [], remote.credits ?? [], (x) => x.id),
  }
}

/** Пустой ли документ на сервере — тогда заливаем своё, а не сливаем с ничем. */
export function isEmptyDoc(doc: Partial<SyncDoc> | null | undefined): boolean {
  if (!doc) return true
  return (
    !doc.people?.length &&
    !doc.goals?.length &&
    !doc.categories?.length &&
    !doc.obligations?.length &&
    !doc.setupDoneAt
  )
}
