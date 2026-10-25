import { describe, expect, it } from 'vitest'
import { spendAccountOf, spendOwners } from '@/lib/finance'
import type { Account } from '@/types/finance'

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
