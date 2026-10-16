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
 * же продавца по `normalizeMerchant`; (2) нет — **единственная** такая же по сумме и дате у того же банка или `card`
 * (фантом п. 3 не в счёт, если единственное касание не-фантом ближе его по дате);
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

  // Фантом этой выписки: банк выписки, дата в `[from, to − 1 день]` — уходит по п. 3 в любом случае.
  const phantom = (ph: Operation) => files.some((f) => ph.bank === f.bank && ph.date >= f.from && dayNumber(ph.date) < dayNumber(f.to))

  // (2) единственный кандидат того же банка или «карты». Фантом этой выписки не делает строку неоднозначной, если
  // единственный не-фантом ближе любого фантома (кофе каждый день: касание последнего дня — пара своей строке).
  for (const st of left) {
    const candidates = phone.filter((ph) => !out.has(ph.id) && sameBank(st, ph) && sameMoney(st, ph) && gap(st, ph) <= 1)
    const real = candidates.filter((ph) => !phantom(ph))
    const pick =
      candidates.length === 1
        ? candidates[0]
        : real.length === 1 && candidates.every((ph) => ph === real[0] || gap(st, ph) > gap(st, real[0]))
          ? real[0]
          : undefined
    if (pick) out.add(pick.id)
  }

  // (3) фантомы внутри периода выписки своего банка, кроме последнего дня.
  for (const ph of phone) if (phantom(ph)) out.add(ph.id)
  return out
}
