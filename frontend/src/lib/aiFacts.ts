import type { RateBook, ReviewCandidate, ReviewFact, ReviewPayload, ReviewReason, SyncDoc } from '@/types/finance'
import {
  HABIT_NAMES,
  SHIFT_REASON_TEXT,
  activePlan,
  cushionCover,
  debtsOverview,
  derivedCredits,
  dreamShift,
  firstDebt,
  fundsOf,
  goalTerm,
  habitImages,
  imageLine,
  interestImage,
  liveSpendCategories,
  moneySettingsOf,
  monthChanges,
  monthPlan,
  monthsLabel,
  planForecast,
  reviewSpendRows,
  shiftSpan,
  spendCategoryName,
  spendCompare,
  spendFact,
  stepCandidates,
  stepEffectText,
  usualMonths,
  type HabitImage,
  type InterestImage,
  type MonthPlanCtx,
  type MonthPlanState,
  type StepCandidate,
  type UploadPeriod,
} from '@/lib/finance'
import { maskNames } from '@/lib/aiSummary'
import { addMonths, monthBy } from '@/lib/dates'
import { money } from '@/lib/money'

/**
 * Факты и кандидаты разбора v2 (бэклог «ИИ-польза», Р-2, Р-19, AU-11). Модель не пишет цифр: код готовит факты — что
 * изменилось к прошлому месяцу, сроки мечт, подушку, долги, 1–2 главных раздела трат, главный образ месяца — и
 * кандидатов шага; модель ссылается на факт `{fN}` и выбирает кандидата по id, цифру подставляет сервер. Здесь —
 * только вызовы `finance.ts` и формат (`money`, `monthBy`, `shiftSpan`): своей арифметики над деньгами нет.
 * `about` — без цифр, имена участников — «участник N» (`maskNames`); названия статей, целей и разделов — как есть
 * (согласие «без ваших имён»).
 */

/** Фактов не больше (ручка берёт 1…30). */
export const REVIEW_FACTS_MAX = 30
/** Мечт очереди в фактах: первая — главная. */
const REVIEW_DREAMS = 3
/** Ручка берёт строку до 200 знаков (иначе 400 всему разбору) — длинное название своё укорачиваем. */
export const REVIEW_TEXT_MAX = 200
const NAME_MAX = 40

/** Обрезка по знакам (не по половинкам суррогатной пары) с «…». */
function clip(s: string, max: number): string {
  const chars = [...s]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s
}
const nm = (s: string) => clip(s, NAME_MAX)

/** Что ещё нужно, кроме документа: книга курсов, загрузки выписок (факт трат) и повод разбора. */
export type ReviewEnv = { book?: RateBook | null; uploads?: UploadPeriod[]; reason?: ReviewReason }

/** Факты и кандидаты для ручки и, локально, кандидат по id ответа (`c1` → `StepCandidate` для `DoSheet`). */
export type ReviewFacts = { payload: ReviewPayload; byId: Map<string, StepCandidate> }

const pctText = (n: number) => `${String(n).replace('.', ',')} %`

/** Числа строки-образа (Р-24): `imageLine` пишет их все — сервер сверяет каждое. */
function imageRaw(image: HabitImage | InterestImage): number[] {
  if (!('habit' in image)) return [image.yearly]
  if (image.kind === 'dream') return image.share !== null ? [image.yearly!, image.share] : [image.yearly!]
  return [image.months!]
}

/**
 * Факты месяца `key` по общему документу (Р-2). Вход плана — как у экранов (`financeStore.planInput`): документ с
 * производными кредитами и книгой курсов, итоги трат, загрузки выписок. Пустая семья — мало фактов, без падений.
 */
export function buildReviewFacts(doc: SyncDoc, key: string, env: ReviewEnv = {}): ReviewFacts {
  const people = doc.people ?? []
  const mask = (s: string) => maskNames(s, people)
  const state: MonthPlanState = { ...doc, credits: derivedCredits(doc.credits ?? [], doc.payments ?? []), book: env.book ?? null }
  const ctx: MonthPlanCtx = { key, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: env.uploads ?? [] }
  const plan = monthPlan(state, ctx)

  const facts: ReviewFact[] = []
  const fact = (about: string, value: string, raw: ReviewFact['raw']) =>
    facts.push({ id: `f${facts.length + 1}`, about: clip(mask(about), REVIEW_TEXT_MAX), value: clip(value, REVIEW_TEXT_MAX), raw })

  // Доход, платежи, остаток — и что изменилось к прошлому месяцу.
  const changes = monthChanges(state, ctx, plan)
  if (plan.income.total > 0) fact('доход месяца', money(plan.income.total), plan.income.total)
  if (changes.prevIncome > 0 && changes.incomeMore > 0) fact('доход больше прошлого месяца на', money(changes.incomeMore), changes.incomeMore)
  if (changes.prevIncome > 0 && changes.incomeLess > 0) fact('доход меньше прошлого месяца на', money(changes.incomeLess), changes.incomeLess)
  if (plan.duesTotal > 0) fact('платежи месяца', money(plan.duesTotal), plan.duesTotal)
  for (const d of changes.newDues.slice(0, 2)) fact(`новый платёж «${nm(d.name)}»`, money(d.amount), d.amount)
  if (plan.short > 0) fact('не хватает на платежи и траты', money(plan.short), plan.short)
  else fact('остаётся в месяце после платежей, трат и целей', money(plan.rest), plan.rest)

  // Мечты очереди: срок, сдвиг месяца с причиной, сколько осталось.
  const snap = (doc.termSnaps ?? []).find((s) => !s.deletedAt && s.id === key) ?? null
  const plans = activePlan(doc.plans ?? [])
  const dreams = plan.queue.filter((q) => q.kind === 'goal' && q.goalId && q.paused !== 'off').slice(0, REVIEW_DREAMS)
  dreams.forEach((item, i) => {
    const goal = (doc.goals ?? []).find((g) => g.id === item.goalId)
    if (!goal) return
    const forecast = plans && item.paused === 'plan' ? planForecast(plans, state, key) : undefined
    const term = goalTerm(item, goal, key, forecast)
    const name = `«${nm(goal.name)}»`
    if (term.doneMonth) fact(`${i === 0 ? 'главная мечта' : 'мечта'} ${name} — срок`, monthBy(term.doneMonth, key), term.doneMonth)
    const shift = dreamShift(state, ctx, snap, goal.id)
    if (shift) {
      // Раздел — в «ёлочках», как пишет его модель: цифры названия («Кафе 24») сервер пропускает только внутри «».
      const why = shift.reason === 'spend' && shift.name ? `«${nm(shift.name)}» выше плана` : SHIFT_REASON_TEXT[shift.reason](shift.name && nm(shift.name))
      const days = Math.abs(shift.days)
      fact(`срок мечты ${name} за месяц ${shift.days > 0 ? 'отодвинулся' : 'приблизился'} (${why}) на`, shiftSpan(days), days)
    }
    if (term.remaining > 0) fact(`осталось собрать на мечту ${name}`, money(term.remaining), term.remaining)
  })

  // Подушка — на сколько месяцев хватит.
  const cushion = fundsOf(state).cushion
  if (cushion) {
    const cover = cushionCover(plan.queue.find((q) => q.goalId === cushion.id), cushion, moneySettingsOf(state))
    if (cover.months !== null) fact('подушки хватит на', monthsLabel(cover.months), cover.months)
  }

  // Долги — когда без долгов и какой первым.
  const debts = debtsOverview({ ...state, plans: doc.plans }, key)
  if (debts.total > 0 && debts.freeMonth) fact('без долгов — срок', monthBy(debts.freeMonth, key), debts.freeMonth)
  const first = firstDebt(state)
  if (first) fact(`первым закрываем «${nm(first.name)}» — самая высокая ставка`, pctText(first.rate), first.rate)

  // 1–2 главных раздела трат: факт, обычно, план, % дохода.
  for (const r of reviewSpendRows(spendCompare(state, ctx).rows)) {
    const cat = `«${nm(r.name)}»`
    if (r.amount !== null) fact(`траты на ${cat} в этом месяце`, money(r.amount), r.amount)
    if (r.usual !== null) fact(`обычно у вас на ${cat} в месяц`, money(r.usual), r.usual)
    if (r.plan !== null) fact(`план на ${cat} в месяц`, money(r.plan), r.plan)
    if (r.share !== null) fact(`${cat} — доля дохода`, pctText(r.share), r.share)
  }

  // Главный образ месяца — крупнейший из привычки и процентов банку (оба — ₸ в месяц).
  const habit = habitImages(state, key)[0] ?? null
  const interest = interestImage(state)
  const image = habit && (!interest || habit.monthly >= interest.perMonth) ? habit : interest
  if (image && 'habit' in image) {
    const h = image
    const name = `«${HABIT_NAMES[h.habit]}»`
    fact(`привычка ${name} — в месяц`, money(h.monthly), h.monthly)
    // Перенос уже сделан (Х-9) — не повод звать перенести ещё раз.
    if (h.moved) fact(`уже переносим из ${name} в мечту каждый месяц`, money(h.moved), h.moved)
    else fact(`во что складывается привычка ${name}`, mask(imageLine(h)), imageRaw(h))
  } else if (image) {
    fact('проценты банку в месяц', money(image.perMonth), image.perMonth)
    fact('во что складываются проценты банку за год', mask(imageLine(image)), imageRaw(image))
  }

  // Итог закрытого прошлого месяца — для повода «месяц», если выписки его покрывают целиком.
  const prev = addMonths(key, -1)
  if (env.reason === 'month' && usualMonths(people, ctx.totals, ctx.uploads, key, 1)[0] === prev) {
    const past = monthPlan(state, { ...ctx, key: prev })
    const spent = spendFact(past.spend)
    if (spent !== null) fact('прошлый месяц — потрачено', money(spent), spent)
    if (past.spendTotal > 0) fact('прошлый месяц — план трат', money(past.spendTotal), past.spendTotal)
  }

  // Кандидаты «Сделать» — из кода; суммы и эффект — оттуда же.
  const categories = liveSpendCategories(doc.spendCategories)
  const debtName = plan.queue.find((q) => q.kind === 'debt')?.name ?? 'долг'
  const goalName = (id: string) => (doc.goals ?? []).find((g) => g.id === id)?.name ?? ''
  const byId = new Map<string, StepCandidate>()
  const candidates: ReviewCandidate[] = stepCandidates(state, ctx).map((c, i) => {
    const id = `c${i + 1}`
    byId.set(id, c)
    const { from, to } = c.shift
    const about =
      c.kind === 'move' && from !== 'rest' && to !== 'debt'
        ? `из плана «${nm(spendCategoryName(categories, from.categoryId))}» в мечту «${nm(goalName(to.goalId))}»`
        : c.kind === 'prepay'
          ? `досрочно в «${nm(debtName)}» из остатка месяца`
          : 'из остатка месяца в подушку'
    return { id, kind: c.kind, about: clip(mask(about), REVIEW_TEXT_MAX), value: money(c.shift.amount), effect: stepEffectText(c) }
  })

  return { payload: { facts: facts.slice(0, REVIEW_FACTS_MAX), candidates }, byId }
}

/** «Что ушло» (Р-9) — читаемый список, не JSON: «доход месяца: 1 200 000 ₸», шаги — с суммой и эффектом. */
export function factsLines(payload: ReviewPayload): string[] {
  return [
    ...payload.facts.map((f) => `${f.about}: ${f.value}`),
    ...payload.candidates.map((c) => `шаг — ${c.about}: ${c.value}${c.effect ? ` · ${c.effect}` : ''}`),
  ]
}
