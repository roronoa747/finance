import { describe, expect, it } from 'vitest'
import { accountBalance, shiftedBase, spendAccountOf, spendOwners, spentSince } from '@/lib/finance'
import type { Account, AccountShift, AccountSpent } from '@/types/finance'
import type { Operation } from '@/lib/statements/types'
import { shiftedOps } from '@/lib/statements/matching'
import { spendTotals } from '@/lib/statements/model'

/** F2-06 (Р-5): счёт для трат — явная отметка или единственная тенговая карта («оба»). */

const T0 = '2026-10-01T00:00:00.000Z'
const acc = (id: string, p: Partial<Account> = {}): Account => ({ id, name: id, note: '', amount: 100_000, kind: 'card', updatedAt: T0, ...p })

describe('F2-06: spendAccountOf / spendOwners', () => {
  it('явная отметка — счёт этого человека; партнёру — нет', () => {
    const list = [acc('k1'), acc('k2', { spendBy: 'a' })]
    expect(spendAccountOf(list, 'a')?.id).toBe('k2')
    expect(spendAccountOf(list, 'b')).toBeNull()
    expect(spendOwners(list[1], list)).toEqual(['a'])
    expect(spendOwners(list[0], list)).toEqual([])
  })

  it('«оба» — счёт обоих', () => {
    const list = [acc('k1', { spendBy: 'both' }), acc('k2')]
    expect(spendAccountOf(list, 'a')?.id).toBe('k1')
    expect(spendAccountOf(list, 'b')?.id).toBe('k1')
    expect(spendOwners(list[0], list)).toEqual(['a', 'b'])
  })

  it('единственная карта без отметок — сама, хозяин «оба»; наличные рядом не мешают', () => {
    const list = [acc('k1'), acc('cash', { kind: 'cash' }), acc('dep', { kind: 'deposit' })]
    expect(spendAccountOf(list, 'a')?.id).toBe('k1')
    expect(spendOwners(list[0], list)).toEqual(['a', 'b'])
  })

  it('две карты без отметок — счёта для трат нет', () => {
    expect(spendAccountOf([acc('k1'), acc('k2')], 'a')).toBeNull()
  })

  it('вклад, конверт, валютная — никогда, даже с отметкой', () => {
    const list = [
      acc('dep', { kind: 'deposit', spendBy: 'a' }),
      acc('env', { kind: 'envelope', spendBy: 'a' }),
      acc('usd', { currency: 'USD', spendBy: 'a' }),
    ]
    expect(spendAccountOf(list, 'a')).toBeNull()
    expect(spendAccountOf([acc('usd', { currency: 'USD' })], 'a')).toBeNull()
  })

  it('явный null у единственной карты — счёта для трат нет', () => {
    expect(spendAccountOf([acc('k1', { spendBy: null })], 'a')).toBeNull()
  })

  it('удалённый счёт — нет; единственной живой картой становится другая', () => {
    expect(spendAccountOf([acc('k1', { spendBy: 'a', deletedAt: T0 })], 'a')).toBeNull()
    const list = [acc('k1', { deletedAt: T0 }), acc('k2')]
    expect(spendAccountOf(list, 'b')?.id).toBe('k2')
  })

  it('наличные с отметкой — счёт для трат; у человека один счёт (две отметки — первая)', () => {
    const list = [acc('cash', { kind: 'cash', spendBy: 'b' }), acc('k1', { spendBy: 'both' })]
    expect(spendAccountOf(list, 'b')?.id).toBe('cash')
    expect(spendAccountOf(list, 'a')?.id).toBe('k1')
    expect(spendOwners(list[1], list)).toEqual(['a'])
  })
})

/** F2-07 (Р-6): нетто своих операций после сверки и вклад записей в остаток. */

const ANCHOR = '2026-10-10T06:00:00.000Z' // 10 октября, 11:00 по Алматы
const op = (id: string, amount: number, p: Partial<Operation> = {}): Operation => ({
  id, bank: 'kaspi', date: '2026-10-12', amount, kind: amount < 0 ? 'purchase' : 'income', merchant: id, categoryId: null, internal: false, ...p,
})
const none = new Set<string>()

describe('F2-07: spentSince', () => {
  it('ручная, Apple Pay и выписочная траты — плюсом; деньги целые', () => {
    const ops = [
      op('hand', -2_500, { bank: 'hand', date: '2026-10-12' }),
      op('tap', -1_200, { bank: 'card', source: 'tap', at: '2026-10-11T09:00:00Z', date: '2026-10-11' }),
      op('stm', -3_300),
    ]
    const s = spentSince(ops, none, ANCHOR)
    expect(s).toBe(7_000)
    expect(Number.isInteger(s)).toBe(true)
  })

  it('возврат (refund) уменьшает трату; приход, которым вернули, второй раз не считается', () => {
    const ops = [op('buy', -10_000, { refund: { amount: 4_000, opId: 'back' } }), op('back', 4_000, { internal: true })]
    expect(spentSince(ops, none, ANCHOR)).toBe(6_000)
  })

  it('возврат после сверки за трату до сверки или отмеченную платежом — обычный приход (минусом)', () => {
    const before = [op('buy', -10_000, { date: '2026-10-05', refund: { amount: 4_000, opId: 'back' } }), op('back', 4_000, { internal: true })]
    expect(spentSince(before, none, ANCHOR)).toBe(-4_000)
    const paid = [op('buy', -10_000, { refund: { amount: 4_000, opId: 'back' } }), op('back', 4_000, { internal: true })]
    expect(spentSince(paid, new Set(['buy']), ANCHOR)).toBe(-4_000)
  })

  it('приход — минусом; перевод себе на счёт — минусом, со счёта — плюсом', () => {
    expect(spentSince([op('in', 50_000)], none, ANCHOR)).toBe(-50_000)
    expect(spentSince([op('self-in', 20_000, { internal: true, kind: 'transfer-in' })], none, ANCHOR)).toBe(-20_000)
    expect(spentSince([op('self-out', -30_000, { internal: true, kind: 'transfer-out' })], none, ANCHOR)).toBe(30_000)
  })

  it('отмеченная платежом, ждущая «это платёж по …?» и зарплата «Пришла» (в marked) — 0', () => {
    const ops = [op('rent', -220_000), op('ask', -58_000), op('salary', 700_000)]
    expect(spentSince(ops, new Set(['rent', 'ask', 'salary']), ANCHOR)).toBe(0)
  })

  it('граница сверки: at до/после; дата в день сверки — нет, на следующий — да; ручная — по моменту внесения', () => {
    expect(spentSince([op('t1', -100, { at: '2026-10-10T05:59:00Z', date: '2026-10-10' })], none, ANCHOR)).toBe(0)
    expect(spentSince([op('t2', -100, { at: '2026-10-10T06:01:00Z', date: '2026-10-10' })], none, ANCHOR)).toBe(100)
    expect(spentSince([op('d0', -100, { date: '2026-10-10' })], none, ANCHOR)).toBe(0)
    expect(spentSince([op('d1', -100, { date: '2026-10-11' })], none, ANCHOR)).toBe(100)
    expect(spentSince([op('d-1', -100, { date: '2026-10-09' })], none, ANCHOR)).toBe(0)
    expect(spentSince([op('h-before', -100, { bank: 'hand', date: '2026-10-10', at: '2026-10-10T05:00:00Z' })], none, ANCHOR)).toBe(0)
    expect(spentSince([op('h-after', -100, { bank: 'hand', date: '2026-10-10', at: '2026-10-10T07:00:00Z' })], none, ANCHOR)).toBe(100)
    // Ручная без момента внесения (старая, с другого телефона) — по дате, как выписка.
    expect(spentSince([op('h0', -100, { bank: 'hand', date: '2026-10-10' })], none, ANCHOR)).toBe(0)
    expect(spentSince([op('h1', -100, { bank: 'hand', date: '2026-10-11' })], none, ANCHOR)).toBe(100)
  })

  it('без якоря — все операции', () => {
    expect(spentSince([op('old', -100, { date: '2020-01-01' }), op('new', -200)], none, null)).toBe(300)
  })

  it('валютная покупка без пересчёта (amount 0) — 0', () => {
    expect(spentSince([op('fx', 0, { kind: 'purchase', fx: { currency: 'USD', amount: 1_000 } })], none, ANCHOR)).toBe(0)
  })
})

describe('F2-07: accountBalance с тратами', () => {
  const card = acc('k1', { amount: 245_000, amountSetAt: ANCHOR })
  const spent = (p: Partial<AccountSpent>): AccountSpent => ({ id: 'k1:a', accountId: 'k1', by: 'a', since: ANCHOR, amount: 5_000, updatedAt: T0, ...p })
  const ctx = (list: AccountSpent[], accounts: Account[] = [card]) => ({ spent: list, accounts })

  it('действующая запись — минус; обе записи «оба» — минус обе', () => {
    expect(accountBalance(card, [], ctx([spent({})]))).toBe(240_000)
    expect(accountBalance(card, [], ctx([spent({}), spent({ id: 'k1:b', by: 'b', amount: 7_000 })]))).toBe(233_000)
  })

  it('устаревший since (сверка после записи) — не действует: баланс = введённой сумме', () => {
    expect(accountBalance(card, [], ctx([spent({ since: '2026-10-01T00:00:00.000Z' })]))).toBe(245_000)
    expect(accountBalance(card, [], ctx([spent({ since: null })]))).toBe(245_000)
  })

  it('чужой счёт и не хозяин — не действуют', () => {
    expect(accountBalance(card, [], ctx([spent({ accountId: 'k2', id: 'k2:a' })]))).toBe(245_000)
    const mine = acc('k1', { amount: 245_000, amountSetAt: ANCHOR, spendBy: 'b' })
    expect(accountBalance(mine, [], ctx([spent({})], [mine]))).toBe(245_000)
  })

  it('нет счетов в ctx — хозяев нет, трат нет', () => {
    expect(accountBalance(card, [], { spent: [spent({})] })).toBe(245_000)
  })

  it('отрицательное нетто (приходы) — плюсом', () => {
    expect(accountBalance(card, [], ctx([spent({ amount: -10_000 })]))).toBe(255_000)
  })

  it('shiftedBase с тратами сохраняет видимый остаток: сдвиг на дельту, траты не теряются и не удваиваются', () => {
    const c = ctx([spent({ amount: 45_000 })])
    expect(accountBalance(card, [], c)).toBe(200_000)
    const base = shiftedBase(card, [], -50_000, c)
    expect(base).toBe(195_000)
    expect(accountBalance({ ...card, amount: base }, [], c)).toBe(150_000)
    // Снять больше видимого нельзя — не ниже нуля видимого
    expect(accountBalance({ ...card, amount: shiftedBase(card, [], -500_000, c) }, [], c)).toBe(0)
  })

  it('сверка (новый якорь) обнуляет вклад трат', () => {
    const c = ctx([spent({ amount: 45_000 })])
    const fresh = { ...card, amount: 199_000, amountSetAt: '2026-10-20T08:00:00.000Z' }
    expect(accountBalance(fresh, [], { ...c, accounts: [fresh] })).toBe(199_000)
  })
})

/** FG-15 (F2-Х1): пара «сдвиг рукой ↔ строка выписки» не попадает в потраченное, но остаётся в итогах разделов. */
describe('FG-15: spentSince с парой сдвига', () => {
  const sh = (id: string, amount: number, kind: AccountShift['kind'], date = '2026-10-11'): AccountShift => ({
    id, accountId: 'k1', amount, date, by: 'a', kind, updatedAt: T0,
  })

  it('взнос 50 000 с карты + строка «На депозит −50 000» — нетто без неё; другая трата считается', () => {
    const ops = [op('dep', -50_000, { kind: 'transfer-out', internal: true, merchant: 'На депозит' }), op('shop', -12_500)]
    expect(spentSince(ops, none, ANCHOR)).toBe(62_500)
    const shifted = shiftedOps(ops, [sh('s1', -50_000, 'goal-in')], 'a')
    expect(spentSince(ops, new Set([...none, ...shifted]), ANCHOR)).toBe(12_500)
  })

  it('внеплановый доход +30 000 + приход +30 000 в выписке — один раз (сдвигом)', () => {
    const ops = [op('in', 30_000)]
    expect(spentSince(ops, shiftedOps(ops, [sh('s1', 30_000, 'income')], 'a'), ANCHOR)).toBe(0)
  })

  it('покупка мечты done −120 000 + трата −120 000: в spentSince её нет, раздел трат её считает', () => {
    const ops = [op('trip', -120_000, { categoryId: 'travel' }), op('cafe', -3_000, { categoryId: 'travel' })]
    const shifted = shiftedOps(ops, [sh('s1', -120_000, 'done')], 'a')
    expect(spentSince(ops, shifted, ANCHOR)).toBe(3_000)
    const totals = spendTotals(ops, 'a', 'month', '2026-10', T0, { marked: none, categories: [] })
    expect(totals.find((t) => t.categoryId === 'travel')?.amount).toBe(123_000)
  })
})
