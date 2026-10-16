import { withinShare } from '@/lib/finance'
import { dayNumber, normalizeMerchant } from './model'
import type { BankId, Operation } from './types'

/**
 * Допуск суммы покупки в валюте (Р-16): телефон пересчитал по курсу Нацбанка, банк списал по своему — разница в
 * пределах 3 %.
 */
export const PHONE_FX_TOLERANCE = 0.03

/** Период файла выписки: банк и даты `YYYY-MM-DD`. */
export type StatementSpan = { bank: BankId; from: string; to: string }

const sameMoney = (st: Operation, ph: Operation) =>
  Math.sign(st.amount) === Math.sign(ph.amount) &&
  ph.amount !== 0 &&
  (ph.fx ? withinShare(st.amount, ph.amount, PHONE_FX_TOLERANCE) : st.amount === ph.amount)

const gap = (st: Operation, ph: Operation) => Math.abs(dayNumber(st.date) - dayNumber(ph.date))

/**
 * Банк касания может быть строкой этой выписки: тот же или не узнан (`card`). Касание Halyk не строка выписки Kaspi, даже
 * с тем же продавцом и суммой: кофе за 1 200 ₸ в понедельник с Halyk и во вторник Kaspi QR — две траты (критик Б1).
 */
const sameBank = (st: Operation, ph: Operation) => ph.bank === st.bank || ph.bank === 'card'

/**
 * Какие траты с телефона заменяет выписка (Р-2 «выписка — истина», порядок Р-16). Для каждой строки выписки:
 * (1) операция с телефона того же банка (или `card`), знака, суммы (из валюты — в пределах 3 %), даты ±1 день и того
 * же продавца по `normalizeMerchant`; (2) нет — **единственная** такая же по сумме и дате у того же банка или `card`;
 * (3) операции с телефона банка выписки с датой в `[from, to − 1 день]` без пары — фантом (отклонённая оплата, повтор
 * триггера), тоже уходят: последний день выписки бывает неполным. Каждая операция с телефона — не больше чем в одной
 * паре, ближайшая по дате побеждает. Отдаёт id операций с телефона.
 */
export function replacedByStatement(statementOps: Operation[], phoneOps: Operation[], files: StatementSpan[]): Set<string> {
  const out = new Set<string>()
  const lines = statementOps.filter((o) => !o.source && !o.internal && o.amount !== 0).sort((a, b) => a.date.localeCompare(b.date))
  const phone = phoneOps.filter((o) => o.source)
  const left: Operation[] = []

  // (1) тот же продавец.
  for (const st of lines) {
    const merchant = normalizeMerchant(st.merchant)
    let best: Operation | undefined
    for (const ph of phone) {
      if (out.has(ph.id) || !sameBank(st, ph) || !sameMoney(st, ph) || gap(st, ph) > 1 || normalizeMerchant(ph.merchant) !== merchant) continue
      if (!best || gap(st, ph) < gap(st, best)) best = ph
    }
    if (best) out.add(best.id)
    else left.push(st)
  }

  // (2) единственный кандидат того же банка или «карты».
  for (const st of left) {
    const candidates = phone.filter((ph) => !out.has(ph.id) && sameBank(st, ph) && sameMoney(st, ph) && gap(st, ph) <= 1)
    if (candidates.length === 1) out.add(candidates[0].id)
  }

  // (3) фантомы внутри периода выписки своего банка, кроме последнего дня.
  for (const f of files) {
    const last = dayNumber(f.to)
    for (const ph of phone) {
      if (ph.bank === f.bank && ph.date >= f.from && dayNumber(ph.date) < last) out.add(ph.id)
    }
  }
  return out
}
