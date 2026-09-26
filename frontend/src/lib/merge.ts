import type { DebtPlan, Goal, Obligation, SyncDoc, Tracked } from '@/types/finance'
import { goalHave } from '@/lib/finance'

/**
 * Слияние двух версий документа — сердце синхронизации.
 *
 * Два правила, и оба выбраны так, чтобы деньги не могли пропасть:
 *
 *  1. Списки, в которые только добавляют (взносы в цели, версии обязательств,
 *     отметки оплат), объединяются по идентификатору. Если Ильяс и Аруна внесли
 *     по взносу или отметили по платежу офлайн, после слияния будут оба.
 *     Побеждать по времени тут нельзя — это молча съело бы чужой платёж.
 *
 *  2. Описательные поля берут последнюю правку по updatedAt. Название цели или
 *     срок — вещи, где «последний прав» никого не разоряет, а проигравшая
 *     версия всё равно остаётся в истории документа на сервере.
 *
 *  3. Незнакомое не теряется. После деплоя старый код на телефоне отрабатывает
 *     ещё один запуск и сливает документ, в котором уже есть данные нового кода.
 *     Поле сущности, которого нет у победителя (ключа нет вовсе), берётся у
 *     проигравшей версии; явный null у победителя — значение, а не отсутствие.
 *     Незнакомый ключ верхнего уровня: список объектов с id сливается по id,
 *     как известные списки; прочее берётся со стороны, где ключ есть, а при
 *     обеих — у remote (сервера). Этот код незнакомый ключ править не умеет,
 *     значит его локальное значение — прошлая копия с сервера, и свежее то, что
 *     на сервере сейчас. Выбор детерминирован; для равных значений слияние
 *     коммутативно.
 *
 * Слияние коммутативно и идемпотентно: порядок аргументов не меняет результат,
 * повторное слияние ничего не портит. Это важно, потому что при конфликте
 * версий клиент сливает и пробует снова — и так может повторяться. Оговорка:
 * при равном updatedAt побеждает local, а время надгробия, поставленного на
 * обеих сторонах, берётся у local, — деньги от этого не меняются (хвост §4).
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
    const loser = winner === mine ? item : mine
    // Поля, которых победитель не знает, остаются от проигравшего (правило 3).
    const merged = mergeDeletion({ ...loser, ...winner }, mine, item)
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

function mergeGoal(winner: Goal, a: Goal, b: Goal): Goal {
  const movements = unionById(a.movements ?? [], b.movements ?? []).sort((x, y) =>
    y.date.localeCompare(x.date),
  )
  // seed — со стороны, где его позже правили руками (якорь seedSetAt): поздний взнос
  // партнёра выигрывает запись, но правку «Уже накоплено» не откатывает. Без якоря
  // (или при равных) — у победителя, как было.
  const sa = a.seedSetAt ?? ''
  const sb = b.seedSetAt ?? ''
  const side = sa === sb ? winner : sa > sb ? a : b
  const seed = side.seed ?? winner.seed ?? a.seed ?? b.seed ?? 0
  return {
    ...winner,
    ...(side.seedSetAt != null ? { seedSetAt: side.seedSetAt } : {}),
    seed,
    movements,
    // Пересчёт из объединённого списка — единственный способ не потерять взнос.
    // Формула та же, что у стора (goalHave): остаток не ниже нуля.
    have: goalHave(seed, movements),
  }
}

/**
 * План: статус идёт в одну сторону — active → cancelled или done, повторный выбор — новый
 * id. Поэтому «активный» — самый слабый статус, как у надгробия: конец плана не теряется,
 * даже если часы отменившего телефона отстают. «Завершён» сильнее «отменён» (Р-5): партнёр
 * офлайн отменил план, который здесь уже закрыл последний долг, — план уходит в историю
 * завершённым. Дата и итог — той стороны, чей статус взят; равные статусы — по последней правке.
 */
function mergePlan(winner: DebtPlan, a: DebtPlan, b: DebtPlan): DebtPlan {
  const rank = (p: DebtPlan) => (p.status === 'done' ? 2 : p.status === 'cancelled' ? 1 : 0)
  if (rank(winner) === Math.max(rank(a), rank(b))) return winner
  const end = rank(a) > rank(b) ? a : b
  return { ...winner, status: end.status, endedAt: end.endedAt, result: end.result }
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

type WithId = Tracked & { id: string }

function isIdList(v: unknown): v is WithId[] {
  return (
    Array.isArray(v) &&
    v.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string')
  )
}

/**
 * Ключи верхнего уровня, которых этот код не знает (правило 3). Знакомые — те,
 * что mergeDocs сливает явно (`known`): новый ключ достаточно добавить туда.
 */
function mergeUnknownKeys(local: SyncDoc, remote: SyncDoc, known: SyncDoc): Record<string, unknown> {
  const l = local as unknown as Record<string, unknown>
  const r = remote as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (key in known) continue
    const a = l[key]
    const b = r[key]
    if (a === undefined) out[key] = b
    else if (b === undefined) out[key] = a
    else if (isIdList(a) && isIdList(b)) out[key] = mergeList(a, b, (x) => x.id)
    else out[key] = b
  }
  return out
}

export function mergeDocs(local: SyncDoc, remote: SyncDoc): SyncDoc {
  // «Начать бюджет заново» (PV-21): то, что было до сброса, с документом после него не
  // сливается — слияние по id вернуло бы стёртое, а `setupDoneAt` не снять. Сторона со
  // свежей меткой сброса побеждает целиком (и офлайн-правки другой стороны до встречи с
  // ним — «Стереть всё» отменить нельзя).
  const lr = local.resetAt ?? ''
  const rr = remote.resetAt ?? ''
  if (lr !== rr) return lr > rr ? { ...local } : { ...remote }

  const known: SyncDoc = {
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
    // Отметка неизменна, кроме надгробия: по id, удаление сильнее. Остатки из них
    // выводит finance.ts, поэтому здесь пересчитывать нечего.
    payments: mergeList(local.payments ?? [], remote.payments ?? [], (x) => x.id),
    // Планы «Сначала долги» (PV-14): статус и итог — по последней правке, «завершён»
    // сильнее «отменён». Два активных после офлайна остаются оба — активным считается
    // поздний (`activePlan`, Р-9).
    plans: mergeList(local.plans ?? [], remote.plans ?? [], (x) => x.id, mergePlan),
    // Выписки (B2C-02): разделы трат — LWW по id; итог участника за период — запись с id
    // `участник:вид:период:раздел`, её целиком заменяет свежий пересчёт (Р-21).
    spendCategories: mergeList(local.spendCategories ?? [], remote.spendCategories ?? [], (x) => x.id),
    spendTotals: mergeList(local.spendTotals ?? [], remote.spendTotals ?? [], (x) => x.id),
    // Метки равны (или их нет) — сброс один и тот же.
    ...(lr ? { resetAt: lr } : {}),
  }
  return { ...mergeUnknownKeys(local, remote, known), ...known }
}

/**
 * Пустой ли документ на сервере — тогда заливаем своё, а не сливаем с ничем. Пустота
 * после «Начать бюджет заново» — не пустота: её не перезаписывают, с ней сливаются.
 */
export function isEmptyDoc(doc: Partial<SyncDoc> | null | undefined): boolean {
  if (!doc) return true
  return (
    !doc.people?.length &&
    !doc.goals?.length &&
    !doc.categories?.length &&
    !doc.obligations?.length &&
    !doc.setupDoneAt &&
    !doc.resetAt
  )
}
