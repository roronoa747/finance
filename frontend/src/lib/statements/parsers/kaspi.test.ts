import { describe, expect, it } from 'vitest'
import type { PdfRow } from '../pdf'
import type { Operation, OperationKind } from '../types'
import kaspi01 from '../fixtures/kaspi-01.rows.json'
import kaspi02 from '../fixtures/kaspi-02.rows.json'
import freedom01 from '../fixtures/freedom-01.rows.json'
import { StatementFormatError } from './common'
import { detectBank, parseStatement } from './index'
import { isKaspi, parseKaspi } from './kaspi'

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

describe('parseKaspi — kaspi-01 (июнь–июль, 4 страницы)', () => {
  const res = parseKaspi(kaspi01)

  it('период, количество, ничего не пропущено', () => {
    expect(res).toMatchObject({ bank: 'kaspi', from: '2025-06-26', to: '2025-07-26', skipped: 0 })
    expect(res.operations).toHaveLength(60)
    expect(countBy(res.operations)).toEqual({ purchase: 32, 'transfer-in': 9, 'transfer-out': 14, cash: 1, fee: 3, other: 1 })
  })

  it('суммы по видам — эталон по фикстуре (тиын отброшены)', () => {
    expect(sumBy(res.operations)).toEqual({
      purchase: -109_499, 'transfer-in': 298_455, 'transfer-out': -385_403, cash: -20_000, fee: -1_050, other: 500_000,
    })
  })

  it('проверенные строки: первая, покупка, перевод человеку, возврат', () => {
    expect(res.operations[0]).toMatchObject({
      bank: 'kaspi', date: '2025-07-26', amount: -20, kind: 'purchase', merchant: 'Аппарат самообслуживания',
      note: 'Покупка', categoryId: null, internal: false,
    })
    expect(res.operations[0].counterparty).toBeUndefined()
    expect(find(res.operations, { date: '2025-07-25', amount: -15_000 })[0]).toMatchObject({ kind: 'transfer-out', counterparty: 'Дана К.' })
    expect(find(res.operations, { date: '2025-07-22', amount: 1_990 })[0]).toMatchObject({ kind: 'purchase', merchant: 'Small' })
    expect(find(res.operations, { date: '2025-07-20', kind: 'purchase', merchant: 'Beeline Интернет дома' })[0].amount).toBe(-1_175)
  })

  it('люди: двойное имя, казахская буква, латиница', () => {
    const who = new Set(res.operations.map((o) => o.counterparty).filter(Boolean))
    expect(who).toEqual(new Set(['Дана К.', 'Марат С.', 'Нур Али Т.', 'Ruslan T.', 'Жанна Қ.']))
    expect(find(res.operations, { merchant: 'На карту Freedom Finance Bank*1234' })[0]).toMatchObject({ kind: 'transfer-out', internal: false })
  })

  it('перенос в «Операции» и «Деталях» склеивается', () => {
    expect(find(res.operations, { date: '2025-07-24', amount: -151_790 })[0]).toMatchObject({
      kind: 'transfer-out', merchant: 'Оплата Kaspi Кредита', note: 'Перевод на свой счет', internal: false,
    })
    expect(find(res.operations, { date: '2025-07-17', amount: 60_000 })[0]).toMatchObject({
      kind: 'transfer-in', merchant: 'С Kaspi Депозита', note: 'Поступление со своего счета', internal: true,
    })
    expect(find(res.operations, { date: '2025-07-10', amount: 500_000 })[0]).toMatchObject({ kind: 'other', note: 'Зачисление кредита' })
    expect(find(res.operations, { date: '2025-07-15', amount: -2_000 })[0].merchant)
      .toBe('Центральная мечеть. Оплата за вход на смотровую площадку')
  })

  it('комиссия и снятие', () => {
    expect(find(res.operations, { kind: 'fee' }).map((o) => o.merchant)).toEqual([
      'Комиссия за перевод на карту др. банка', 'Комиссия за снятие наличных сверх лимита', 'Комиссия за перевод на карту др. банка',
    ])
    expect(find(res.operations, { kind: 'cash' })[0]).toMatchObject({ amount: -20_000, merchant: 'Банкомат Tumar' })
  })

  it('идемпотентность: два разбора — те же id; одинаковые платежи дня — разные id', () => {
    expect(parseKaspi(kaspi01).operations.map((o) => o.id)).toEqual(res.operations.map((o) => o.id))
    expect(new Set(res.operations.map((o) => o.id)).size).toBe(60)
    const twins = find(res.operations, { date: '2025-07-26', amount: -380 })
    expect(twins).toHaveLength(2)
    expect(twins[0].id).not.toBe(twins[1].id)
  })
})

describe('parseKaspi — kaspi-02 (август–сентябрь)', () => {
  const res = parseKaspi(kaspi02)

  it('период, количество, суммы', () => {
    expect(res).toMatchObject({ from: '2025-08-15', to: '2025-09-15', skipped: 0 })
    expect(res.operations).toHaveLength(21)
    expect(sumBy(res.operations)).toEqual({
      purchase: -36_825, 'transfer-in': 253_000, 'transfer-out': -203_790, cash: -30_000, fee: -400,
    })
  })

  it('одинаковые проезды в один день — разные id, повтор разбора — те же', () => {
    const rides = find(res.operations, { date: '2025-09-02', amount: -300 })
    expect(rides).toHaveLength(2)
    expect(rides[0].id).not.toBe(rides[1].id)
    expect(parseKaspi(kaspi02).operations.map((o) => o.id)).toEqual(res.operations.map((o) => o.id))
  })
})

describe('гвард результата (Р-23)', () => {
  it('ни в одном текстовом поле нет 6+ цифр; у покупок есть продавец', () => {
    for (const rows of [kaspi01, kaspi02]) {
      for (const o of parseKaspi(rows).operations) {
        expect([o.merchant, o.counterparty, o.note].join(' ')).not.toMatch(/\d{6,}/)
        if (o.kind === 'purchase') expect(o.merchant).not.toBe('')
      }
    }
  })

  it('длинные цифры в деталях вычищаются', () => {
    const rows: PdfRow[] = structuredClone(kaspi02)
    const row = rows.find((r) => r.cells[0].text === '14.09.25')!
    row.cells[3].text = 'Magnum 1234567890'
    const op = find(parseKaspi(rows).operations, { date: '2025-09-14' })[0]
    expect(op.merchant).toBe('Magnum')
  })
})

describe('ошибки и пропуски', () => {
  it('не Kaspi → not-kaspi; реестр → null', () => {
    expect(isKaspi(freedom01)).toBe(false)
    expect(() => parseKaspi(freedom01)).toThrow(StatementFormatError)
    expect(() => parseKaspi(freedom01)).toThrow(expect.objectContaining({ code: 'not-kaspi' }))
    expect(detectBank(kaspi01)).toBe('kaspi')
    expect(detectBank([])).toBeNull()
  })

  it('нет таблицы или ни одной операции → empty', () => {
    const noTable: PdfRow[] = [{ page: 1, y: 700, cells: [{ x: 40, text: 'АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz' }] }]
    expect(() => parseKaspi(noTable)).toThrow(expect.objectContaining({ code: 'empty' }))
    const onlyHeader = kaspi02.filter((r) => !/^\d\d\.\d\d\.\d\d$/.test(r.cells[0].text))
    expect(() => parseStatement(onlyHeader)).toThrow(expect.objectContaining({ code: 'empty' }))
  })

  it('неразобранная строка внутри таблицы — в skipped, остальное разобрано', () => {
    const rows: PdfRow[] = structuredClone(kaspi02)
    rows.find((r) => r.cells[0].text === '14.09.25')!.cells[1].text = '- 3 4OO,00 ₸'
    const res = parseKaspi(rows)
    expect(res.skipped).toBe(1)
    expect(res.operations).toHaveLength(20)
  })
})
