/**
 * Что мастер настройки сохраняет по нажатию «Готово» (PV-06, Р-22).
 *
 * В React шаги сохранялись по одному, а «Пропустить» и «Пока без цели» звали
 * переход мимо сохранения: введённое оставалось в полях, но никуда не писалось.
 * Во Vue набор шагов — `computed` от данных семьи: запись на шаге жилья
 * схлопнула бы шаги до одного. Поэтому всё пишется разом в `finish()`, а пропуск
 * — флаг шага. Решение «что сохранять» — только здесь: чистая функция, её
 * можно проверить в Node без кнопок.
 */
import { parseMoney } from '@/lib/money'
import { goalMonthly, rateFromSchedule } from '@/lib/finance'
import type { HueKey } from '@/lib/palette'

export type SetupForm = {
  tenure: 'rent' | 'mortgage' | 'own'
  housing: string
  housingDay: string
  utilities: string
  hasCredit: 'no' | 'yes'
  creditPrincipal: string
  creditPayment: string
  creditRateMode: 'rate' | 'term'
  creditRate: string
  creditTerm: string
  creditDay: string
  goalName: string
  goalNeed: string
  goalHave: string
  goalMonths: string
  goalHue: HueKey
}

/** Шаги, пропущенные кнопкой «Пропустить» / «Пока без цели». */
export type SetupSkips = { housing: boolean; credit: boolean; goal: boolean }

type NewObligation = {
  name: string
  note: string
  day: number
  category: 'd1'
  amount: number
  estimate?: boolean
}

export type SetupPlan = {
  housing?: { obligations: NewObligation[]; d1: number }
  credit?: {
    credit: { name: string; note: string; principal: number; annualRate: number; payment: number; day: number }
    d2: number
  }
  goal?: { goal: { name: string; need: number; have: number; monthly: number; hue: HueKey }; d3: number }
}

const day = (v: string, fallback: number) => Math.min(28, Math.max(1, parseMoney(v) || fallback))

/** Ставка кредита: введена руками или выведена из остатка, платежа и срока. */
export function setupCreditRate(f: SetupForm): number | null {
  if (f.creditRateMode === 'rate') {
    const v = parseFloat(f.creditRate.replace(',', '.'))
    return Number.isFinite(v) && v > 0 ? v / 100 : null
  }
  return rateFromSchedule(parseMoney(f.creditPrincipal), parseMoney(f.creditPayment), parseMoney(f.creditTerm))
}

/** Сколько откладывать в цель, чтобы успеть за названный срок; 0 — цель не задана. */
export function setupGoalMonthly(f: SetupForm): number {
  const need = parseMoney(f.goalNeed)
  const have = parseMoney(f.goalHave)
  const months = Math.max(1, parseMoney(f.goalMonths) || 24)
  return need > 0 ? goalMonthly(Math.max(0, need - have), months) : 0
}

export function setupPlan(f: SetupForm, skips: SetupSkips): SetupPlan {
  const plan: SetupPlan = {}

  const housing = parseMoney(f.housing)
  const utilities = parseMoney(f.utilities)
  if (!skips.housing && housing + utilities > 0) {
    const obligations: NewObligation[] = []
    if (housing > 0) {
      obligations.push({
        name: f.tenure === 'rent' ? 'Аренда' : f.tenure === 'mortgage' ? 'Ипотека' : 'Жильё',
        note: f.tenure === 'own' ? 'содержание' : 'ежемесячный платёж',
        day: day(f.housingDay, 5),
        category: 'd1',
        amount: housing,
      })
    }
    if (utilities > 0) {
      obligations.push({
        name: 'Коммуналка',
        note: 'плавает по сезону',
        day: 15,
        category: 'd1',
        estimate: true,
        amount: utilities,
      })
    }
    plan.housing = { obligations, d1: housing + utilities }
  }

  const payment = parseMoney(f.creditPayment)
  if (!skips.credit && f.hasCredit === 'yes' && payment > 0) {
    plan.credit = {
      credit: {
        name: 'Кредит',
        note: 'ежемесячный платёж',
        principal: parseMoney(f.creditPrincipal),
        annualRate: setupCreditRate(f) ?? 0,
        payment,
        day: day(f.creditDay, 12),
      },
      d2: payment,
    }
  }

  const need = parseMoney(f.goalNeed)
  if (!skips.goal && need > 0) {
    const monthly = setupGoalMonthly(f)
    plan.goal = {
      goal: { name: f.goalName.trim() || 'Первая цель', need, have: parseMoney(f.goalHave), monthly, hue: f.goalHue },
      d3: monthly,
    }
  }

  return plan
}
