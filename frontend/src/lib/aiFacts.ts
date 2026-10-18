import type { OpenTarget, ReviewAction, ReviewFact, ReviewPayload, ReviewPayloadV3, ReviewReason, SyncDoc } from '@/types/finance'
import {
  HABIT_NAMES,
  SHIFT_REASON_TEXT,
  activePlan,
  cushionCover,
  debtsOverview,
  dreamShift,
  findMonth,
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
  reviewFindings,
  reviewScenario,
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
  type ReviewFinding,
  type ReviewScenario,
  type StepCandidate,
} from '@/lib/finance'
import { maskNames } from '@/lib/aiSummary'
import { addMonths, monthBy } from '@/lib/dates'
import { money } from '@/lib/money'
import { plural } from '@/lib/utils'

/**
 * Факты и действия разбора v3 (бэклог «Разбор», Р-5, Р-6, Р-7, Р-16, RZ-03; v2 — «ИИ-польза», AU-11). Модель не пишет
 * цифр: код готовит факты — находки семьи (`reviewFindings`: утечки, что раздуло, новые и подорожавшие списания,
 * двойные, сценарий «мечта раньше»), затем факты v2 (доход и перемены, мечты, подушка, долги, разделы, образ, итог
 * прошлого месяца) — и действия: «Сделать» (кандидаты `stepCandidates`) и «Открыть» (экран предмета находки). Модель
 * ссылается на факт `{fN}` и выбирает действие по id, цифру подставляет сервер. Здесь — только вызовы `finance.ts` и
 * формат (`money`, `monthBy`, `shiftSpan`): своей арифметики над деньгами нет. `about` — без цифр (кроме названий в «»),
 * имена участников — «участник N» (`maskNames`); продавцы — как в находках (без людей и «ИП + фамилия», RZ-01).
 */

/** Фактов не больше (ручка берёт 1…40). */
export const REVIEW_FACTS_MAX = 40
/** Фактам v2 — не меньше этого места, если они есть: находки не вытесняют доход, сроки мечт и долги (RZ-03, Handoff). */
const REVIEW_BASE_MIN = 16
/** Действий не больше (ручка берёт 1…9). */
export const REVIEW_ACTIONS_MAX = 9
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
/** Название в «ёлочках»: свои «» внутри названия сломали бы границы — убираем. */
const nm = (s: string) => `«${clip(s.replace(/[«»]/g, '').trim(), NAME_MAX)}»`

/** Вход плана месяца — `financeStore.planInput(key)`: тот же, что у экранов и «Сделать» листа разбора. */
export type PlanInput = { state: MonthPlanState; ctx: MonthPlanCtx }

/**
 * Факты и действия для ручки и, локально, что стоит за id ответа: кандидат «Сделать» (`a1` → `StepCandidate` для
 * `DoSheet`), экран «Открыть» (`OpenTarget`), находка действия — для счётчика (Р-19; у «Сделать» — null).
 */
export type ReviewFactsV3 = {
  payload: ReviewPayloadV3
  doById: Map<string, StepCandidate>
  openById: Map<string, OpenTarget>
  findings: ReviewFinding[]
  byAction: Map<string, ReviewFinding | null>
}

const pctText = (n: number) => `${String(n).replace('.', ',')} %`
const times = (n: number) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`

/** Числа строки-образа (Р-24): `imageLine` пишет их все — сервер сверяет каждое. */
function imageRaw(image: HabitImage | InterestImage): number[] {
  if (!('habit' in image)) return [image.yearly]
  if (image.kind === 'dream') return image.share !== null ? [image.yearly!, image.share] : [image.yearly!]
  return [image.months!]
}

type Draft = Omit<ReviewFact, 'id'>

/** Факты одной находки (Р-5): слова — черновик, финал — `/ux` Блока 2. */
function findingFacts(f: ReviewFinding, thisMonth: boolean): Draft[] {
  const out: Draft[] = []
  const put = (about: string, value: string, raw: ReviewFact['raw']) => out.push({ about, value, raw })
  if (f.kind === 'leak') {
    const who = `частые траты у ${nm(f.name)}`
    put(`${who} — в месяц`, money(f.monthly), f.monthly)
    put(`${who} — раз в месяц`, times(f.count), f.count)
    put(`${who} — за год`, money(f.yearly), f.yearly)
    if (f.image?.kind === 'dream') put(`${who} за год — доля мечты ${nm(f.image.name)}`, pctText(f.image.share), f.image.share)
    else if (f.image) put(`${who} за год — это`, f.image.name, f.image.price)
  } else if (f.kind === 'grew') {
    const cat = nm(f.name)
    put(`траты на ${cat} выше обычного на`, money(f.growth), f.growth)
    if (f.why.kind === 'purchases') for (const i of f.why.items) put(`что раздуло ${cat}: ${nm(i.name)}`, money(i.amount), i.amount)
    else {
      put(`покупок в ${cat} ${thisMonth ? 'в этом' : 'в прошлом'} месяце`, times(f.why.count), f.why.count)
      put(`обычно покупок в ${cat} в месяц`, times(f.why.usualCount), f.why.usualCount)
    }
  } else if (f.kind === 'recurring') {
    const who = `новое регулярное списание ${nm(f.name)}, которого нет в плане`
    put(`${who} — в месяц`, money(f.amount), f.amount)
    put(`${who} — за год`, money(f.yearly), f.yearly)
  } else if (f.kind === 'pricier') {
    put(`подписка ${nm(f.name)} стала дороже: было`, money(f.was), f.was)
    put(`подписка ${nm(f.name)} стала дороже: стало`, money(f.amount), f.amount)
  } else {
    put(`списание ${nm(f.name)} прошло дважды одной суммой`, money(f.amount), f.amount)
  }
  return out
}

/** Факты сценария «если убрать — мечта раньше» (Р-5 (4)). */
function scenarioFacts(s: ReviewScenario): Draft[] {
  const who = `если убрать ${nm('name' in s.finding ? s.finding.name : '')}`
  if ('days' in s) return [{ about: `${who} — мечта ${nm(s.goalName)} раньше на`, value: shiftSpan(s.days), raw: s.days }]
  const out: Draft[] = []
  if (s.saved > 0) out.push({ about: `${who} — процентов банку меньше на`, value: money(s.saved), raw: s.saved })
  if (s.months > 0) out.push({ about: `${who} — долг ${nm(s.creditName)} закроется раньше на`, value: monthsLabel(s.months), raw: s.months })
  return out
}

/** Экран предмета находки для «Открыть» (Р-18) и слова действия. */
function openOf(f: ReviewFinding): { target: OpenTarget; about: string } {
  if (f.kind === 'grew') return { target: { kind: 'cat', id: f.categoryId, name: f.name }, about: `открыть траты ${nm(f.name)}` }
  if (f.kind === 'pricier') return { target: { kind: 'obligation', id: f.obligationId, name: f.name }, about: `открыть подписку ${nm(f.name)}` }
  return {
    target: { kind: 'seller', id: f.key, name: f.name, ...(f.categoryId ? { categoryId: f.categoryId } : {}) },
    about: `открыть покупки у ${nm(f.name)}`,
  }
}

/** Факты v2 месяца (AU-11) — состав тот же. */
function baseFacts(doc: SyncDoc, input: PlanInput, reason: ReviewReason | undefined, plan: ReturnType<typeof monthPlan>): Draft[] {
  const people = doc.people ?? []
  const { state, ctx } = input
  const key = ctx.key
  const out: Draft[] = []
  const fact = (about: string, value: string, raw: ReviewFact['raw']) => out.push({ about, value, raw })

  // Доход, платежи, остаток — и что изменилось к прошлому месяцу.
  const changes = monthChanges(state, ctx, plan)
  if (plan.income.total > 0) fact('доход месяца', money(plan.income.total), plan.income.total)
  if (changes.prevIncome > 0 && changes.incomeMore > 0) fact('доход больше прошлого месяца на', money(changes.incomeMore), changes.incomeMore)
  if (changes.prevIncome > 0 && changes.incomeLess > 0) fact('доход меньше прошлого месяца на', money(changes.incomeLess), changes.incomeLess)
  if (plan.duesTotal > 0) fact('платежи месяца', money(plan.duesTotal), plan.duesTotal)
  for (const d of changes.newDues.slice(0, 2)) fact(`новый платёж ${nm(d.name)}`, money(d.amount), d.amount)
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
    const name = nm(goal.name)
    if (term.doneMonth) fact(`${i === 0 ? 'главная мечта' : 'мечта'} ${name} — срок`, monthBy(term.doneMonth, key), term.doneMonth)
    const shift = dreamShift(state, ctx, snap, goal.id)
    if (shift) {
      // Раздел — в «ёлочках», как пишет его модель: цифры названия («Кафе 24») сервер пропускает только внутри «».
      const why = shift.reason === 'spend' && shift.name ? `${nm(shift.name)} выше плана` : SHIFT_REASON_TEXT[shift.reason](shift.name && clip(shift.name, NAME_MAX))
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
  const debts = debtsOverview(state, key)
  if (debts.total > 0 && debts.freeMonth) fact('без долгов — срок', monthBy(debts.freeMonth, key), debts.freeMonth)
  const first = firstDebt(state)
  if (first) fact(`первым закрываем ${nm(first.name)} — самая высокая ставка`, pctText(first.rate), first.rate)

  // 1–2 главных раздела трат: факт, обычно, план, % дохода.
  for (const r of reviewSpendRows(spendCompare(state, ctx).rows)) {
    const cat = nm(r.name)
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
    else fact(`во что складывается привычка ${name}`, maskNames(imageLine(h), people), imageRaw(h))
  } else if (image) {
    fact('проценты банку в месяц', money(image.perMonth), image.perMonth)
    fact('во что складываются проценты банку за год', maskNames(imageLine(image), people), imageRaw(image))
  }

  // Итог закрытого прошлого месяца — для повода «месяц», если выписки его покрывают целиком.
  const prev = addMonths(key, -1)
  if (reason === 'month' && usualMonths(people, ctx.totals, ctx.uploads, key, 1)[0] === prev) {
    const past = monthPlan(state, { ...ctx, key: prev })
    const spent = spendFact(past.spend)
    if (spent !== null) fact('прошлый месяц — потрачено', money(spent), spent)
    if (past.spendTotal > 0) fact('прошлый месяц — план трат', money(past.spendTotal), past.spendTotal)
  }
  return out
}

/**
 * Факты и действия разбора v3 месяца `input.ctx.key` по общему документу (Р-5, Р-16). Факты: сначала находки и
 * сценарий (находка — целиком или никак), затем факты v2 — им оставлено не меньше `REVIEW_BASE_MIN` мест; всего ≤ 40.
 * Действия: «Сделать» первыми, затем «Открыть» по одному на предмет находки (дубли `kind:id` схлопнуты); ≤ 9.
 * Пустая семья — факты v2, действий может не быть, без падений.
 */
export function buildReviewFacts(doc: SyncDoc, input: PlanInput, reason?: ReviewReason): ReviewFactsV3 {
  const people = doc.people ?? []
  const mask = (s: string) => maskNames(s, people)
  const { state, ctx } = input
  const plan = monthPlan(state, ctx)
  const base = baseFacts(doc, input, reason, plan)

  const findings = reviewFindings(state, ctx)
  const scenario = reviewScenario(state, ctx, findings)
  const thisMonth = findMonth(ctx) === ctx.key
  const budget = REVIEW_FACTS_MAX - Math.min(base.length, REVIEW_BASE_MIN)
  const found: Draft[] = []
  const shown: ReviewFinding[] = []
  for (const f of findings) {
    const own = findingFacts(f, thisMonth)
    if (found.length + own.length > budget) break
    found.push(...own)
    shown.push(f)
  }
  const scenarioOwn = scenario && shown.includes(scenario.finding) ? scenarioFacts(scenario) : []
  const withScenario = scenarioOwn.length > 0 && found.length + scenarioOwn.length <= budget
  if (withScenario) found.push(...scenarioOwn)

  const facts: ReviewFact[] = [...found, ...base].slice(0, REVIEW_FACTS_MAX).map((d, i) => ({
    id: `f${i + 1}`,
    about: clip(mask(d.about), REVIEW_TEXT_MAX),
    value: clip(d.value, REVIEW_TEXT_MAX),
    raw: d.raw,
  }))

  // Действия: «Сделать» — кандидаты кода (те же слова, что у v2); «Открыть» — предметы находок и сценария.
  const categories = liveSpendCategories(doc.spendCategories)
  const debtName = plan.queue.find((q) => q.kind === 'debt')?.name ?? 'долг'
  const goalName = (id: string) => (doc.goals ?? []).find((g) => g.id === id)?.name ?? ''
  const actions: ReviewAction[] = []
  const doById = new Map<string, StepCandidate>()
  const openById = new Map<string, OpenTarget>()
  const byAction = new Map<string, ReviewFinding | null>()
  const nextId = () => `a${actions.length + 1}`
  for (const c of stepCandidates(state, ctx)) {
    if (actions.length >= REVIEW_ACTIONS_MAX) break
    const id = nextId()
    const { from, to } = c.shift
    const about =
      c.kind === 'move' && from !== 'rest' && to !== 'debt'
        ? `из плана ${nm(spendCategoryName(categories, from.categoryId))} в мечту ${nm(goalName(to.goalId))}`
        : c.kind === 'prepay'
          ? `досрочно в ${nm(debtName)} из остатка месяца`
          : 'из остатка месяца в подушку'
    actions.push({ id, kind: 'do', about: clip(mask(about), REVIEW_TEXT_MAX), value: money(c.shift.amount), effect: stepEffectText(c) })
    doById.set(id, c)
    byAction.set(id, null)
  }
  const opens: { target: OpenTarget; about: string; finding: ReviewFinding }[] = shown.map((f) => ({ ...openOf(f), finding: f }))
  if (scenario && withScenario) {
    opens.push(
      'days' in scenario
        ? { target: { kind: 'goal', id: scenario.goalId, name: scenario.goalName }, about: `открыть мечту ${nm(scenario.goalName)}`, finding: scenario.finding }
        : { target: { kind: 'credit', id: scenario.creditId, name: scenario.creditName }, about: `открыть долг ${nm(scenario.creditName)}`, finding: scenario.finding },
    )
  }
  const seen = new Set<string>()
  for (const o of opens) {
    const k = `${o.target.kind}:${o.target.id}`
    if (seen.has(k) || actions.length >= REVIEW_ACTIONS_MAX) continue
    seen.add(k)
    const id = nextId()
    actions.push({ id, kind: 'open', about: clip(mask(o.about), REVIEW_TEXT_MAX), value: '', effect: '' })
    openById.set(id, o.target)
    byAction.set(id, o.finding)
  }

  return { payload: { v: 3, facts, actions }, doById, openById, findings, byAction }
}

/**
 * Адрес «Открыть» (Р-18): раздел — лист раздела «Месяца», мечта — экран цели, долг и платёж — листы «Денег» по адресу,
 * продавец — история с чипом его раздела (экрана продавца нет).
 */
export function openPath(target: OpenTarget): string {
  const q = encodeURIComponent
  if (target.kind === 'cat') return `/month?cat=${q(target.id)}`
  if (target.kind === 'goal') return `/goals/${q(target.id)}`
  if (target.kind === 'credit') return `/money/debts?credit=${q(target.id)}`
  if (target.kind === 'obligation') return `/money?obligation=${q(target.id)}`
  return target.categoryId ? `/money/history?cat=${q(target.categoryId)}` : '/money/history'
}

/** «Что ушло» (Р-9) — читаемый список, не JSON: «доход месяца: 1 200 000 ₸»; шаги — с суммой и эффектом; «открыть — …». */
export function factsLines(payload: ReviewPayload | ReviewPayloadV3): string[] {
  const step = (c: { about: string; value: string; effect: string }) => `шаг — ${c.about}: ${c.value}${c.effect ? ` · ${c.effect}` : ''}`
  const rest =
    'actions' in payload
      ? payload.actions.map((a) => (a.kind === 'do' ? step(a) : `открыть — ${a.about.replace(/^открыть /, '')}`))
      : payload.candidates.map(step)
  return [...payload.facts.map((f) => `${f.about}: ${f.value}`), ...rest]
}
