import { describe, expect, it } from 'vitest'
import { categorize, normalizeMerchant, pairInternalTransfers } from './model'
import { parseStatement } from './parsers'
import type { PdfRow } from './pdf'
import type { Operation, ParsedStatement } from './types'
import kaspi01 from './fixtures/kaspi-01.rows.json'
import kaspi02 from './fixtures/kaspi-02.rows.json'
import freedom01 from './fixtures/freedom-01.rows.json'
import freedom02 from './fixtures/freedom-02.rows.json'

// Замер B2C-08 (Р-12, Р-29): какую долю строк и суммы трат словарь не узнаёт — решение по
// Блоку 6 («спросить ИИ»). Памяти семьи нет — честная оценка для чужой семьи. На фикстурах
// гоняется всегда; на корпусе — только с STATEMENTS_DIR (локально, в CI пропущен).

/** Порог Р-29: заметная доля незнакомого. */
export const THRESHOLD = { ops: 0.15, amount: 0.25 }

interface Cell {
  bank: string
  month: string
  spendOps: number
  unknownOps: number
  spend: number
  unknownSpend: number
}

const share = (a: number, b: number) => (b ? a / b : 0)
const pct = (x: number) => `${(x * 100).toFixed(1)} %`

/** Разбор → пары внутренних переводов → только словарь → счёт по банку и месяцу. */
function measure(statements: ParsedStatement[]) {
  const all = pairInternalTransfers(statements.flatMap((s) => s.operations))
  const ops: Operation[] = all.map((op) => ({ ...op, ...categorize(op, []) }))
  const cells = new Map<string, Cell>()
  const unknownNames = new Map<string, number>()
  // Из чего состоит незнакомое: ИИ получит только название (Р-12) — по «ИП <фамилия>» и
  // переводу без получателя он раздел тоже не угадает.
  const kinds = { entrepreneur: 0, transfer: 0, other: 0 }
  for (const op of ops) {
    if (op.amount >= 0 || op.internal) continue
    const month = op.date.slice(0, 7)
    for (const bank of [op.bank, 'все']) {
      const key = `${bank}:${month}`
      const c = cells.get(key) ?? { bank, month, spendOps: 0, unknownOps: 0, spend: 0, unknownSpend: 0 }
      c.spendOps += 1
      c.spend += -op.amount
      if (op.categoryId === null) {
        c.unknownOps += 1
        c.unknownSpend += -op.amount
      }
      cells.set(key, c)
    }
    // Людей в топ не пишем: получатель — не название продавца.
    if (op.categoryId === null) {
      if (op.kind !== 'purchase') kinds.transfer += 1
      else if (/^(ip|ип)\s/i.test(op.merchant.trim())) kinds.entrepreneur += 1
      else kinds.other += 1
    }
    if (op.categoryId === null && !op.counterparty) {
      const name = normalizeMerchant(op.merchant)
      unknownNames.set(name, (unknownNames.get(name) ?? 0) + 1)
    }
  }
  const rows = [...cells.values()].sort((a, b) => a.bank.localeCompare(b.bank) || a.month.localeCompare(b.month))
  const months = rows.filter((r) => r.bank === 'все')
  const average = {
    ops: months.reduce((s, r) => s + share(r.unknownOps, r.spendOps), 0) / (months.length || 1),
    amount: months.reduce((s, r) => s + share(r.unknownSpend, r.spend), 0) / (months.length || 1),
  }
  const top = [...unknownNames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20)
  const noticeable = average.ops > THRESHOLD.ops || average.amount > THRESHOLD.amount
  return { rows, average, top, noticeable, kinds }
}

function report(m: ReturnType<typeof measure>): string {
  const lines = ['банк · месяц · строк трат · незнакомых · доля строк · доля суммы']
  for (const r of m.rows) {
    lines.push(`${r.bank} · ${r.month} · ${r.spendOps} · ${r.unknownOps} · ${pct(share(r.unknownOps, r.spendOps))} · ${pct(share(r.unknownSpend, r.spend))}`)
  }
  lines.push(`среднее по месяцам: строк ${pct(m.average.ops)}, суммы ${pct(m.average.amount)}`)
  lines.push(`порог Р-29: строк > ${pct(THRESHOLD.ops)} или суммы > ${pct(THRESHOLD.amount)} → ${m.noticeable ? 'заметно' : 'ниже порога'}`)
  const k = m.kinds
  const n = k.entrepreneur + k.transfer + k.other
  lines.push(`состав незнакомых строк: ИП с фамилией ${pct(share(k.entrepreneur, n))}, переводы и прочее без продавца ${pct(share(k.transfer, n))}, другие покупки ${pct(share(k.other, n))}`)
  lines.push('топ незнакомых (название · строк):')
  for (const [name, n] of m.top) lines.push(`  ${name} · ${n}`)
  return lines.join('\n')
}

describe('замер незнакомых на фикстурах', () => {
  const m = measure([kaspi01, kaspi02, freedom01, freedom02].map((rows) => parseStatement(rows)))

  it('эталон по фикстуре: kaspi, сентябрь — 9 строк трат, одна незнакомая', () => {
    // Руками по kaspi-02: 560 (аппарат — незнакомое), 3 400, 151 790, 2 100, 7 000, 1 175,
    // 300, 300, 12 000; приход 160 000 — не трата.
    expect(m.rows.find((r) => r.bank === 'kaspi' && r.month === '2025-09')).toEqual({
      bank: 'kaspi', month: '2025-09', spendOps: 9, unknownOps: 1, spend: 178_625, unknownSpend: 560,
    })
  })

  it('доли считаются по месяцам и складываются в среднее; в топе нет людей', () => {
    for (const r of m.rows) expect(r.unknownOps).toBeLessThanOrEqual(r.spendOps)
    expect(m.average.ops).toBeGreaterThan(0)
    expect(m.average.ops).toBeLessThan(1)
    expect(m.top.map(([name]) => name)).not.toContain('дана к')
    expect(report(m)).toContain('среднее по месяцам')
  })
})

type NodeFs = {
  readdirSync(path: string): string[]
  readFileSync(path: string): Uint8Array
  writeFileSync(path: string, data: string): void
}
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const DIR = env.STATEMENTS_DIR

describe.skipIf(!DIR)('замер незнакомых на корпусе (STATEMENTS_DIR)', () => {
  it('разбирает весь корпус и печатает доли', async () => {
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs
    const { pdfToRows } = await import('./pdf')
    const statements: ParsedStatement[] = []
    for (const bank of fs.readdirSync(DIR!).filter((name) => !name.includes('.'))) {
      for (const file of fs.readdirSync(`${DIR}/${bank}`)) {
        if (!file.toLowerCase().endsWith('.pdf')) continue
        const bytes = fs.readFileSync(`${DIR}/${bank}/${file}`)
        const rows: PdfRow[] = await pdfToRows(bytes.slice().buffer as ArrayBuffer)
        statements.push(parseStatement(rows))
      }
    }
    expect(statements.length).toBeGreaterThan(0)
    const text = report(measure(statements))
    console.log(text)
    if (env.CORPUS_REPORT) fs.writeFileSync(env.CORPUS_REPORT, text)
  })
})
