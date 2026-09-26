import { describe, expect, it } from 'vitest'
import type { PdfRow } from '../pdf'
import type { Operation, OperationKind } from '../types'
import freedom01 from '../fixtures/freedom-01.rows.json'
import freedom02 from '../fixtures/freedom-02.rows.json'
import kaspi01 from '../fixtures/kaspi-01.rows.json'
import { isFreedom, parseFreedom } from './freedom'

const sumBy = (ops: Operation[]) => {
  const out: Partial<Record<OperationKind, number>> = {}
  for (const o of ops) out[o.kind] = (out[o.kind] ?? 0) + o.amount
  return out
}
const countBy = (ops: Operation[]) => {
  const out: Partial<Record<OperationKind, number>> = {}
  for (const o of ops) out[o.kind] = (out[o.kind] ?? 0) + 1
  return out
}
const find = (ops: Operation[], p: Partial<Operation>) =>
  ops.filter((o) => Object.entries(p).every(([k, v]) => o[k as keyof Operation] === v))

describe('parseFreedom — freedom-01 (июнь–июль, 4 страницы)', () => {
  const res = parseFreedom(freedom01)

  it('период, количество; валютные — в skipped с причиной', () => {
    expect(res).toMatchObject({ bank: 'freedom', from: '2025-06-26', to: '2025-07-26', skipped: 5, skippedForeign: 5 })
    expect(res.operations).toHaveLength(42)
    expect(countBy(res.operations)).toEqual({ purchase: 30, 'transfer-out': 5, 'transfer-in': 6, other: 1 })
  })

  it('суммы по видам — эталон по фикстуре (тиын отброшены)', () => {
    expect(sumBy(res.operations)).toEqual({ purchase: -454_851, 'transfer-out': -92_200, 'transfer-in': 906_902, other: -12 })
  })

  it('«Сумма в обработке» — покупка или перевод по деталям; детали в две строки склеены', () => {
    expect(res.operations[0]).toMatchObject({
      date: '2025-07-26', amount: -1_260, kind: 'purchase', merchant: 'MAGAZIN SMALL MARKET ASTANA Q. KZ',
      note: 'Сумма в обработке', internal: false, categoryId: null,
    })
    expect(find(res.operations, { date: '2025-07-26', amount: -2_000 })[0]).toMatchObject({ kind: 'transfer-out', note: 'Сумма в обработке' })
  })

  it('люди: полное ФИО → «Имя Ф.», исходящий «Имя Ф. Безвозмездный перевод»', () => {
    expect(find(res.operations, { date: '2025-07-22', amount: 60_000 })[0]).toMatchObject({
      kind: 'transfer-in', merchant: 'Дана К.', counterparty: 'Дана К.', note: 'Пополнение · Безвозмездный перевод',
    })
    expect(find(res.operations, { date: '2025-07-21', amount: -15_000 })[0]).toMatchObject({
      kind: 'transfer-out', counterparty: 'Дана К.', note: 'Перевод · Безвозмездный перевод',
    })
    expect(find(res.operations, { date: '2025-06-28' })[0].counterparty).toBe('Алихан С.')
    expect(find(res.operations, { merchant: 'Перевод с карты на карту' }).every((o) => !o.counterparty)).toBe(true)
  })

  it('конвертация в тенге — внутренняя; детали из 4 строк; 3-строчный «Платеж»', () => {
    const conv = find(res.operations, { date: '2025-07-20', amount: 36_902 })[0]
    expect(conv).toMatchObject({ kind: 'transfer-in', internal: true })
    expect(conv.merchant).toBe('Перевод валюты Freedom на счет KZ**KZT. По договору №SRV- от 11.05.2023')
    expect(find(res.operations, { date: '2025-07-17' })[0]).toMatchObject({
      kind: 'purchase', note: 'Платеж', merchant: 'ТОО "Aviata" За оплату билета /услугу/продукты/товар заказ AMKKFVAM Aviata',
    })
  })

  it('возврат, списание кешбэка, пополнения', () => {
    expect(find(res.operations, { date: '2025-07-15', amount: 1_160 })[0]).toMatchObject({
      kind: 'purchase', merchant: 'Возврат. Отмена покупки YANDEX. GO',
    })
    expect(find(res.operations, { kind: 'other' })[0]).toMatchObject({ amount: -12, merchant: 'Возврат кешбека по cap_id= на сумму 12.3 KZT' })
    expect(find(res.operations, { merchant: 'Пополнение через банкомат' }).map((o) => o.kind)).toEqual(['transfer-in', 'transfer-in'])
  })

  it('идемпотентность и одинаковые покупки дня', () => {
    expect(parseFreedom(freedom01).operations.map((o) => o.id)).toEqual(res.operations.map((o) => o.id))
    expect(new Set(res.operations.map((o) => o.id)).size).toBe(42)
    const twins = find(res.operations, { date: '2025-07-24', amount: -1_550 })
    expect(twins).toHaveLength(2)
    expect(twins[0].id).not.toBe(twins[1].id)
  })
})

describe('parseFreedom — freedom-02 (июль–август)', () => {
  const res = parseFreedom(freedom02)

  it('период, количество, суммы', () => {
    expect(res).toMatchObject({ from: '2025-07-26', to: '2025-08-26', skipped: 2, skippedForeign: 2 })
    expect(res.operations).toHaveLength(21)
    expect(sumBy(res.operations)).toEqual({ purchase: -50_955, 'transfer-out': -195_000, 'transfer-in': 80_003 })
  })

  it('ячейка, разорванная между страницами, и сумма ниже даты — одна операция, строки по порядку', () => {
    expect(find(res.operations, { date: '2025-08-02' })[0]).toMatchObject({
      amount: -9_576, kind: 'purchase', note: 'Платеж',
      merchant: 'ТОО "Arbuz Group (Арбуз Груп)" За оплату билета/услугу/продукты /товар заказ Arbuz',
    })
    // Соседи разрыва не задеты.
    expect(find(res.operations, { date: '2025-08-03' })[0].merchant).toBe('Перевод с карты на карту')
    expect(find(res.operations, { date: '2025-08-01' })[0].merchant).toBe('SMALL SUPERMARKET AST1 ALMATY KZ')
  })
})

describe('гвард результата (Р-23)', () => {
  it('нет 6+ цифр и полных ФИО; у покупок есть продавец', () => {
    for (const rows of [freedom01, freedom02]) {
      for (const o of parseFreedom(rows).operations) {
        const text = [o.merchant, o.counterparty, o.note].join(' ')
        expect(text).not.toMatch(/\d{6,}/)
        expect(text).not.toMatch(/Кенесова|Маратовна|Сапаров|Серикович/)
        if (o.kind === 'purchase') expect(o.merchant).not.toBe('')
      }
    }
  })

  it('номер договора и IBAN в деталях вычищаются', () => {
    const rows: PdfRow[] = structuredClone(freedom01)
    for (const r of rows) {
      for (const c of r.cells) {
        c.text = c.text.replace('KZ**KZT', 'KZ00551Z000000000KZT').replace('№SRV-', '№SRV-0022412')
      }
    }
    const conv = find(parseFreedom(rows).operations, { date: '2025-07-20', amount: 36_902 })[0]
    expect(conv.merchant).toBe('Перевод валюты Freedom на счет . По договору №SRV- от 11.05.2023')
  })
})

describe('ошибки', () => {
  it('не Freedom → not-freedom; нет таблицы → empty', () => {
    expect(isFreedom(kaspi01)).toBe(false)
    expect(() => parseFreedom(kaspi01)).toThrow(expect.objectContaining({ code: 'not-freedom' }))
    const noTable: PdfRow[] = freedom01.filter((r) => r.page === 1)
    expect(() => parseFreedom(noTable)).toThrow(expect.objectContaining({ code: 'empty' }))
  })

  it('строка без суммы — skipped, остальные разобраны', () => {
    const rows: PdfRow[] = structuredClone(freedom02)
    rows.find((r) => r.cells[0].text === '26.08.2025')!.cells[1].text = '-1,68O.00 ₸'
    const res = parseFreedom(rows)
    expect(res.skipped).toBe(3)
    expect(res.skippedForeign).toBe(2)
    expect(res.operations).toHaveLength(20)
  })
})
