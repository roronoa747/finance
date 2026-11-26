import { describe, expect, it } from 'vitest'
import { fromWire, toWire } from './operations'
import type { OperationWire } from '@/types/api'

const wire: OperationWire = {
  id: 'a1',
  bank: 'kaspi',
  date: '2026-11-20',
  amount: -1000,
  kind: 'purchase',
  merchant: 'Tau',
  category_id: 'sc_food',
  internal: false,
  updated_at: '2026-11-26T06:59:28.279821Z',
}

describe('база строки (updated_at с сервера)', () => {
  it('операция запоминает updated_at сервера и шлёт его как base_updated_at', () => {
    const op = fromWire(wire)
    expect(op.baseAt).toBe('2026-11-26T06:59:28.279821Z')
    expect(toWire(op).base_updated_at).toBe('2026-11-26T06:59:28.279821Z')
  })

  it('строка без базы (новая, ручная) уходит без base_updated_at', () => {
    const op = fromWire({ ...wire, updated_at: undefined })
    expect(op.baseAt).toBeUndefined()
    expect('base_updated_at' in toWire(op)).toBe(false)
  })
})
