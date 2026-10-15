import type { Person, PersonId, RateBook, SyncDoc } from '@/types/finance'
import {
  activePlan,
  debtsOverview,
  derivedCredits,
  goalTerm,
  monthPlan,
  openGoals,
  planForecast,
  ratePercent,
  monthSpendByCategory,
  spendFact,
  untilPayday,
  type UploadPeriod,
} from '@/lib/finance'
import { today } from '@/lib/dates'

/**
 * Сводка месяца для разбора ИИ (бэклог «ИИ», Р-3): цифры месяца, посчитанные `finance.ts`, и траты по разделам.
 * Это и есть всё, что уходит в модель, и то, что человек видит в «что ушло» (Р-9). Значения — целые тенге (ставки —
 * проценты); имена людей заменены на «участник N» (по слоту: a — 1, b — 2, c — 3). Нет заметок, операций, продавцов,
 * желаний и личного документа.
 */
export type MonthSummaryAI = {
  /** Месяц `YYYY-MM`. */
  month: string
  /** Дней до ближайшей зарплаты; null — зарплат не ждём. */
  daysToPayday: number | null
  income: { total: number; byPerson: { who: string; amount: number }[] }
  /** Платежи месяца: обязательства и кредиты. */
  dues: { total: number; items: { name: string; amount: number }[] }
  /**
   * Траты: `total` — план трат месяца (раздел «Траты» «Месяца»), `fact` — потрачено по выпискам (null — выписок за
   * месяц нет), `byCategory` — он же по разделам (`monthSpendByCategory`: вместе дают `fact`), «Без раздела» —
   * неразобранное.
   */
  spend: { total: number; fact: number | null; byCategory: { name: string; amount: number }[] }
  /** Остаётся после платежей, трат и целей (крупная цифра «Месяца»). */
  rest: number
  /** Не хватает на платежи и траты. */
  short: number
  /** Доход − платежи − траты: что получает очередь целей; меньше нуля — не хватает. */
  free: number
  /** Уже отложено в этом месяце по очереди. */
  saved: number
  debts: { total: number; items: { name: string; left: number; payment: number; ratePercent: number | null; endMonth: string | null }[] }
  /** Цели и фонды: `want` — сколько собрать, `have` — собрано, `monthlyPut` — сколько план даёт в этом месяце. */
  goals: { name: string; want: number; have: number; monthlyPut: number; doneMonth: string | null; paused: boolean }[]
}

/** Что ещё нужно сводке, кроме документа: книга курсов (валютные оклады и платежи) и загрузки выписок (факт трат). */
export type SummaryEnv = { book?: RateBook | null; uploads?: UploadPeriod[] }

const SLOT_NO: Record<PersonId, number> = { a: 1, b: 2, c: 3 }
const who = (id: PersonId) => `участник ${SLOT_NO[id]}`

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** «ё» пишут и через «е»: «Пётр» — и «Петра». */
const yo = (s: string) => s.replace(/[её]/giu, '[её]')
/** Окончания падежей имени после основы: Дан-ы, Мари-ей, Айгул-ью, Андре-я, Павл-ом. */
const CASE = '(?:а|я|ы|и|е|у|ю|ь|й|ой|ей|ою|ею|ом|ем|ём|ью)'

/**
 * Формы слова имени: «Ерлан» — с любым хвостом («Ерлану», «Ерланова»); на гласную, -ь, -й — основа без последней буквы
 * и окончание падежа («Дана» → «Даны», «Мария» → «Марии», «Айгуль» → «Айгули»); беглая гласная — «Павел» → «Павла».
 * Короче 3 букв («Вы», «Ян») — целым словом или с окончанием, иначе «Выплата» стала бы участником.
 */
function nameForms(word: string): string {
  const w = yo(escapeRe(word))
  if (word.length < 3) return `${w}${CASE}?`
  const forms = [`${w}\\p{L}*`]
  if (/[аяьйеёоиыуюэ]$/iu.test(word)) forms.push(`${yo(escapeRe(word.slice(0, -1)))}${CASE}`)
  else if (word.length >= 4 && /[еёо]$/iu.test(word.slice(0, -1))) forms.push(`${yo(escapeRe(word.slice(0, -2) + word.slice(-1)))}${CASE}`)
  return `(?:${forms.join('|')})`
}

/**
 * Имя участника в тексте («Кредит Айгуль», «Подарок Ерлану», «Кружок Даны») → «участник N». Каждое слово имени — без
 * учёта регистра, во всех падежах (`nameForms`). Удалённые участники — тоже: их имя могло остаться в названии статьи.
 */
export function maskNames(text: string, people: Pick<Person, 'id' | 'name'>[]): string {
  let out = text
  for (const p of people) {
    for (const word of (p.name ?? '').split(/[\s\p{P}]+/u)) {
      if (word.length < 2) continue
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${nameForms(word)}(?![\\p{L}\\p{N}])`, 'giu')
      out = out.replace(re, (_m, before: string) => `${before}${who(p.id)}`)
    }
  }
  return out
}

/**
 * Сводка месяца `key` (Р-3) — только вызывает `finance.ts` и раскладывает ответы: своей арифметики над деньгами нет.
 * Кредиты — производные (остаток из отметок), как у экранов; вход плана — тот же, что `financeStore.planInput`.
 */
export function buildMonthSummary(doc: SyncDoc, key: string, now: Date, env: SummaryEnv = {}): MonthSummaryAI {
  const people = doc.people ?? []
  const mask = (s: string) => maskNames(s, people)
  const payments = doc.payments ?? []
  const credits = derivedCredits(doc.credits ?? [], payments)
  const book = env.book ?? null
  const state = { ...doc, credits, book }
  const spendCategories = doc.spendCategories ?? []
  const totals = doc.spendTotals ?? []
  const plan = monthPlan(state, { key, totals, spendCategories, uploads: env.uploads ?? [] })

  const payday = untilPayday(
    { people, obligations: doc.obligations, credits, accounts: doc.accounts, payments, book, fxExchanges: doc.fxExchanges },
    today(now),
  )

  // Разделы — та же правда, что «потрачено» (`spend.fact`): вместе с «Без раздела» дают его же.
  const picture = monthSpendByCategory(people, totals, spendCategories, key, env.uploads ?? [])
  const byCategory = picture.rows.map((r) => ({ name: mask(r.name), amount: r.amount }))
  if (picture.unknown > 0) byCategory.push({ name: 'Без раздела', amount: picture.unknown })

  const debts = debtsOverview({ ...state, plans: doc.plans }, key)

  const plans = activePlan(doc.plans ?? [])
  const goals = openGoals(doc.goals ?? []).map((g) => {
    const item = plan.queue.find((q) => q.goalId === g.id)
    const forecast = plans && item?.paused === 'plan' ? planForecast(plans, { goals: doc.goals, credits, obligations: doc.obligations, payments }, key) : undefined
    const term = goalTerm(item, g, key, forecast)
    return {
      name: mask(g.name),
      want: term.need,
      have: g.have,
      monthlyPut: item?.given ?? 0,
      doneMonth: term.doneMonth,
      paused: term.off || !!item?.paused,
    }
  })

  return {
    month: key,
    daysToPayday: payday ? payday.inDays : null,
    income: { total: plan.income.total, byPerson: plan.income.byPerson.map((x) => ({ who: who(x.person), amount: x.amount })) },
    dues: { total: plan.duesTotal, items: plan.dues.map((d) => ({ name: mask(d.name), amount: d.amount })) },
    spend: { total: plan.spendTotal, fact: spendFact(plan.spend), byCategory },
    rest: plan.rest,
    short: plan.short,
    free: plan.free,
    saved: plan.putTotal,
    debts: {
      total: debts.total,
      items: debts.rows.map((r) => ({
        name: mask(r.name),
        left: r.left,
        payment: r.payment,
        ratePercent: r.rateUnknown ? null : ratePercent(r.rate),
        endMonth: r.endMonth,
      })),
    },
    goals,
  }
}

/** Все числа сводки по порядку обхода (Р-3: число ответа, которого здесь нет, — брак; та же проверка у заготовки демо). */
export function summaryNumbers(s: unknown): number[] {
  if (typeof s === 'number') return [s]
  if (Array.isArray(s)) return s.flatMap(summaryNumbers)
  if (s && typeof s === 'object') return Object.values(s).flatMap(summaryNumbers)
  return []
}
