import type { OpenTarget, PersonId, ReviewAction, ReviewCardFact, ReviewFact, ReviewPayload, ReviewPayloadV3, ReviewPayloadV4, ReviewReason, SyncDoc } from '@/types/finance'
import {
  HABIT_NAMES,
  PLAN_LINE,
  PRICIER_LINE,
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
  reviewCards,
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
  whereSplit,
  type MonthPlanCtx,
  type MonthPlanState,
  type ReviewCard,
  type ReviewCardsOpts,
  type ReviewFinding,
  type ReviewScenario,
  type StepCandidate,
  type WherePart,
} from '@/lib/finance'
import { maskNames } from '@/lib/aiSummary'
import { weekendShare } from '@/lib/statements/finds'
import { shortMerchant } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { addMonths, monthBy, monthKey } from '@/lib/dates'
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
/**
 * Продавец в словах разбора — коротко, без города и страны (Х-2, `shortMerchant`): модель пишет имя «как в about», крупная
 * цифра совета — это же `about`, — экран показывает то же короткое имя. В документе (`reviewFinds`) — как печатает банк.
 */
const seller = (f: ReviewFinding) => (f.kind === 'grew' || f.kind === 'pricier' ? f.name : shortMerchant(f.name))

/** Вход плана месяца — `financeStore.planInput(key)`: тот же, что у экранов и «Сделать» листа разбора. */
export type PlanInput = { state: MonthPlanState; ctx: MonthPlanCtx }

/**
 * Факты и действия для ручки и, локально, что стоит за id ответа: кандидат «Сделать» (`a1` → `StepCandidate` для
 * `DoSheet`), экран «Открыть» (`OpenTarget`); для счётчика (Р-19) — находка факта (`byFact`: факты находки и её
 * сценария; у фактов v2 — нет) и находка действия (`byAction`; у «Сделать» — null).
 */
export type ReviewFactsV3 = {
  payload: ReviewPayloadV3
  doById: Map<string, StepCandidate>
  openById: Map<string, OpenTarget>
  findings: ReviewFinding[]
  byFact: Map<string, ReviewFinding>
  byAction: Map<string, ReviewFinding | null>
  /** Короткая подпись крупной цифры по id факта (находки и сценарий; RZ-15) — совет хранит её рядом с фактом. */
  labels: Map<string, string>
}

const pctText = (n: number) => `${String(n).replace('.', ',')} %`
const times = (n: number) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`

/**
 * Черновик факта; `label` — короткая подпись крупной цифры совета для экрана («в месяц · Магазин у дома»; владелец
 * 2026-10-19, RZ-15): `about` — строка для модели, на экране шумна. В тело ручки подпись не уходит.
 */
type Draft = Omit<ReviewFact, 'id'> & { label?: string }
/** Название в подписи — без «ёлочек», коротко. */
const bare = (s: string) => clip(s.replace(/[«»]/g, '').trim(), NAME_MAX)

/** Факты одной находки (Р-5): всё — за месяц, фактов «за год» нет (бэклог «Фидбек», Р-8, Р-19). */
function findingFacts(f: ReviewFinding, thisMonth: boolean): Draft[] {
  const out: Draft[] = []
  const put = (about: string, value: string, raw: ReviewFact['raw'], label: string) => out.push({ about, value, raw, label })
  if (f.kind === 'leak') {
    const s = bare(seller(f))
    const who = `частые траты у ${nm(seller(f))}`
    put(`${who} — в месяц`, money(f.monthly), f.monthly, `в месяц · ${s}`)
    put(`${who} — раз в месяц`, times(f.count), f.count, `в месяц · ${s}`)
    if (f.image?.kind === 'dream')
      put(`${who} в месяц — это доля взноса в мечту ${nm(f.image.name)}`, pctText(f.image.share), f.image.share, `взноса в «${bare(f.image.name)}» · ${s}`)
    else if (f.image) put(`${who} в месяц — это`, f.image.name, f.image.price, `в месяц · ${s}`)
  } else if (f.kind === 'grew') {
    const cat = nm(f.name)
    const c = bare(f.name)
    put(`траты на ${cat} выше обычного на`, money(f.growth), f.growth, `сверх обычного · ${c}`)
    if (f.why.kind === 'purchases')
      for (const i of f.why.items) put(`что раздуло ${cat}: ${nm(shortMerchant(i.name))}`, money(i.amount), i.amount, `${bare(shortMerchant(i.name))} · ${c}`)
    else {
      put(`покупок в ${cat} ${thisMonth ? 'в этом' : 'в прошлом'} месяце`, times(f.why.count), f.why.count, `покупок за месяц · ${c}`)
      put(`обычно покупок в ${cat} в месяц`, times(f.why.usualCount), f.why.usualCount, `обычно за месяц · ${c}`)
    }
  } else if (f.kind === 'recurring') {
    const s = bare(seller(f))
    const who = `новое регулярное списание ${nm(seller(f))}, которого нет в плане`
    put(`${who} — в месяц`, money(f.monthly), f.monthly, `в месяц · ${s}`)
  } else if (f.kind === 'pricier') {
    // Годовая подписка — разница как есть, «раз в год» (Р-19); её `monthly` — двенадцатая часть, для сортировки и счётчика.
    const every = f.every === 'year' ? 'раз в год' : 'в месяц'
    const diff = f.amount - f.was
    put(`подписка ${nm(f.name)} стала дороже: было`, money(f.was), f.was, `было · ${bare(f.name)}`)
    put(`подписка ${nm(f.name)} стала дороже: стало`, money(f.amount), f.amount, `стало · ${bare(f.name)}`)
    put(`подписка ${nm(f.name)} стала дороже на — ${every}`, money(diff), diff, `дороже ${every} · ${bare(f.name)}`)
  } else {
    const s = bare(seller(f))
    put(`списание ${nm(seller(f))} прошло дважды одной суммой — лишнее в месяц`, money(f.monthly), f.monthly, `лишнее в месяц · ${s}`)
  }
  return out
}

/** Факты сценария «если убрать — мечта раньше» (Р-5 (4)). */
function scenarioFacts(s: ReviewScenario): Draft[] {
  const who = `если убрать ${nm(seller(s.finding))}`
  const without = `без ${bare(seller(s.finding))}`
  if ('days' in s) return [{ about: `${who} — мечта ${nm(s.goalName)} раньше на`, value: shiftSpan(s.days), raw: s.days, label: `«${bare(s.goalName)}» раньше · ${without}` }]
  const out: Draft[] = []
  if (s.saved > 0) out.push({ about: `${who} — процентов банку меньше на`, value: money(s.saved), raw: s.saved, label: `меньше процентов · ${without}` })
  if (s.months > 0)
    out.push({ about: `${who} — долг ${nm(s.creditName)} закроется раньше на`, value: monthsLabel(s.months), raw: s.months, label: `«${bare(s.creditName)}» раньше · ${without}` })
  return out
}

/** Экран предмета находки для «Открыть» (Р-18) и слова действия. */
function openOf(f: ReviewFinding): { target: OpenTarget; about: string } {
  if (f.kind === 'grew') return { target: { kind: 'cat', id: f.categoryId, name: f.name }, about: `открыть траты ${nm(f.name)}` }
  if (f.kind === 'pricier') return { target: { kind: 'obligation', id: f.obligationId, name: f.name }, about: `открыть подписку ${nm(f.name)}` }
  return {
    target: { kind: 'seller', id: f.key, name: seller(f), ...(f.categoryId ? { categoryId: f.categoryId } : {}) },
    about: `открыть покупки у ${nm(seller(f))}`,
  }
}

/**
 * Факты v2 месяца (AU-11) — состав тот же. С `by` (разбор v4, бэклог «Фидбек», Р-23) — разделы трат, привычка и причина
 * сдвига мечты — свои; доход, мечты, подушка и долги — семьи.
 */
function baseFacts(doc: SyncDoc, input: PlanInput, reason: ReviewReason | undefined, plan: ReturnType<typeof monthPlan>, by?: PersonId): Draft[] {
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
    const shift = dreamShift(state, ctx, snap, goal.id, by)
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
  for (const r of reviewSpendRows(spendCompare(state, ctx, by).rows)) {
    const cat = nm(r.name)
    if (r.amount !== null) fact(`траты на ${cat} в этом месяце`, money(r.amount), r.amount)
    if (r.usual !== null) fact(`обычно у вас на ${cat} в месяц`, money(r.usual), r.usual)
    if (r.plan !== null) fact(`план на ${cat} в месяц`, money(r.plan), r.plan)
    if (r.share !== null) fact(`${cat} — доля дохода`, pctText(r.share), r.share)
  }

  // Главный образ месяца — крупнейший из привычки и процентов банку (оба — ₸ в месяц).
  const habit = habitImages(state, key, by)[0] ?? null
  const interest = interestImage(state)
  const image = habit && (!interest || habit.monthly >= interest.perMonth) ? habit : interest
  if (image && 'habit' in image) {
    const h = image
    const name = `«${HABIT_NAMES[h.habit]}»`
    fact(`привычка ${name} — в месяц`, money(h.monthly), h.monthly)
    // Перенос уже сделан (Х-9) — не повод звать перенести ещё раз.
    if (h.moved) fact(`уже переносим из ${name} в мечту каждый месяц`, money(h.moved), h.moved)
    // Образ «за год — доля мечты» модели не идёт (бэклог «Фидбек», Р-8): годовых цифр в разборе нет. Срок «накопить» и
    // «окупится» — одно число строки (`imageLine`), сервер сверяет его.
    else if (h.kind !== 'dream') fact(`во что складывается привычка ${name}`, maskNames(imageLine(h), people), [h.months!])
  } else if (image) {
    // «Проценты банку за год» — тоже нет (Р-8): только месяц.
    fact('проценты банку в месяц', money(image.perMonth), image.perMonth)
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
  const owners: ReviewFinding[] = [] // находка факта `found[i]` — тем же порядком
  const shown: ReviewFinding[] = []
  for (const f of findings) {
    const own = findingFacts(f, thisMonth)
    if (found.length + own.length > budget) break
    found.push(...own)
    owners.push(...own.map(() => f))
    shown.push(f)
  }
  const scenarioOwn = scenario && shown.includes(scenario.finding) ? scenarioFacts(scenario) : []
  const withScenario = scenarioOwn.length > 0 && found.length + scenarioOwn.length <= budget
  if (withScenario) {
    found.push(...scenarioOwn)
    owners.push(...scenarioOwn.map(() => scenario!.finding))
  }

  const facts: ReviewFact[] = [...found, ...base].slice(0, REVIEW_FACTS_MAX).map((d, i) => ({
    id: `f${i + 1}`,
    about: clip(mask(d.about), REVIEW_TEXT_MAX),
    value: clip(d.value, REVIEW_TEXT_MAX),
    raw: d.raw,
  }))
  const byFact = new Map(owners.map((f, i) => [`f${i + 1}`, f]))
  // Подписи крупной цифры — у фактов находок и сценария (RZ-15); в тело ручки не идут.
  const labels = new Map(found.flatMap((d, i) => (d.label && i < REVIEW_FACTS_MAX ? [[`f${i + 1}`, clip(mask(d.label), REVIEW_TEXT_MAX)] as const] : [])))

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

  return { payload: { v: 3, facts, actions }, doById, openById, findings, byFact, byAction, labels }
}

/* ---------------- разбор v4 (бэклог «Фидбек», Р-23, Р-26, Р-28, FB-16) ---------------- */

/** Факты, подписи и карточки разбора v4: `cardById` — карточка кода по id тела (`c1`…), `cards` — все карточки кода. */
export type ReviewFactsV4 = {
  payload: ReviewPayloadV4
  cards: ReviewCard[]
  cardById: Map<string, ReviewCard>
  labels: Map<string, string>
}

/** Части «Куда ушло» словами модели (Р-25). */
const WHERE_ABOUT: Record<WherePart['key'], string> = { sellers: 'траты у продавцов', people: 'переводы людям', cash: 'наличные', payments: 'платежи без отметки' }

/** Предмет карточки словами разбора: продавец — коротко (`shortMerchant`), раздел, привычка и мечта — как есть. */
const subjectOf = (c: ReviewCard) => (c.subject ? (c.kind === 'oneoff' || c.kind === 'recurring' || c.kind === 'double' ? shortMerchant(c.subject) : c.subject) : '')

/**
 * Что карточка значит для модели (Р-28): вид и предмет — продавец, раздел, привычка, мечта; люди и наличные — только
 * «переводы людям» / «наличные», без имён (имя есть лишь в строке экрана `line`, сюда не идёт). Без цифр.
 */
function cardAbout(c: ReviewCard): string {
  const s = nm(subjectOf(c))
  switch (c.kind) {
    case 'unknown':
      return 'траты без раздела — разобрать'
    case 'people':
      return 'переводы людям — разобрать, кому и за что'
    case 'cash':
      return 'наличные без заметки — записать, на что'
    case 'oneoff':
      return `покупка у ${s} похожа на разовую — отметить`
    case 'week':
      return 'неделя дороже обычной — отметить разовую трату'
    case 'recurring':
      return `регулярное ${s} не в платежах — добавить в платежи`
    case 'habit': {
      const a = c.target.kind === 'image' ? c.target.image.action : null
      return `привычка ${s} — перенести часть в мечту${a?.kind === 'move' ? ` ${nm(a.goalName)}` : ''}`
    }
    case 'small':
      return `мелкие покупки — часть плана в мечту ${s}`
    case 'plan':
      return `раздел ${s} — поставить план`
    case 'pricier':
      return `подписка ${s} подорожала — обновить сумму`
    case 'double':
      return `списание ${s} прошло дважды — разобрать`
  }
}

/** Факты одной карточки: её крупная цифра (у «Мелочи» — ещё на сколько раньше мечта), с подписью для экрана. */
function cardFacts(c: ReviewCard): Draft[] {
  const s = subjectOf(c)
  const value = c.figure.unit === 'pct' ? pctText(c.figure.value) : money(c.figure.value)
  const put = (about: string, label: string): Draft => ({ about, value, raw: c.figure.value, label })
  switch (c.kind) {
    case 'unknown':
      return [put('траты без раздела — доля своих трат месяца', 'своих трат без раздела')]
    case 'people':
      return [put('переводы людям в этом месяце', 'в месяц · переводы людям')]
    case 'cash':
      return [put('наличные в этом месяце', 'в месяц · наличные')]
    case 'oneoff':
      return [put(`похоже на разовую покупку у ${nm(s)}`, `похоже на разовую · ${bare(s)}`)]
    case 'week':
      return [put('неделя месяца дороже обычной на', 'дороже обычной недели')]
    case 'recurring':
      return [put(`регулярное списание ${nm(s)} не в платежах — в месяц`, `в месяц · ${bare(s)}`)]
    case 'habit':
      return [put(`привычка ${nm(s)} — в месяц`, `в месяц · ${bare(s)}`)]
    case 'small': {
      const out = [put('мелкие покупки в этом месяце', 'в месяц · мелкие покупки')]
      const days = c.target.kind === 'do' && c.target.candidate.kind === 'move' ? c.target.candidate.effect.days : null
      if (days) out.push({ about: `если часть плана — в мечту ${nm(s)}, она раньше на`, value: shiftSpan(days), raw: days, label: `«${bare(s)}» раньше` })
      return out
    }
    case 'plan':
      return [c.line === PLAN_LINE.none ? put(`траты на ${nm(s)} без плана в этом месяце`, `без плана · ${bare(s)}`) : put(`траты на ${nm(s)} выше плана на`, `сверх плана · ${bare(s)}`)]
    case 'pricier':
      // Годовая — разница раз в год, как v3 (Р-19).
      return [c.line.endsWith(PRICIER_LINE.year) ? put(`подписка ${nm(s)} стала дороже на — раз в год`, `дороже раз в год · ${bare(s)}`) : put(`подписка ${nm(s)} стала дороже на`, `дороже · ${bare(s)}`)]
    case 'double':
      return [put(`списание ${nm(s)} прошло дважды — лишнее`, `лишнее · ${bare(s)}`)]
  }
}

/**
 * Факты и карточки разбора v4 участника `by` (Р-23, Р-26): карточки кода (`reviewCards` по своим операциям `ops`) —
 * их цифры фактами, «Куда ушло» долями (`whereSplit`, выходные — `weekendShare`), затем факты v2 месяца — разделы,
 * привычка и сдвиг мечты свои, доход, мечты, подушка и долги — семьи; всего ≤ 40. В модель не уходят (Р-28): имена людей
 * из переводов, имена участников (`maskNames`), даты операций, «ИП + фамилия» и 6+ цифр (продавцы — по `sellerOk`).
 * Карточек нет — тело без карточек (ручка его не примет; стор не спрашивает).
 */
export function buildReviewFactsV4(
  doc: SyncDoc,
  input: PlanInput,
  ops: Operation[],
  by: PersonId,
  reason?: ReviewReason,
  opts: ReviewCardsOpts = {},
): ReviewFactsV4 {
  const people = doc.people ?? []
  const mask = (s: string) => maskNames(s, people)
  const { state, ctx } = input
  const plan = monthPlan(state, ctx)
  const cards = reviewCards({ ...doc, ...state }, ctx, ops, by, opts)
  const own: Draft[] = cards.flatMap(cardFacts)
  const split = whereSplit(state, ctx, by)
  for (const p of split?.parts ?? []) if (p.amount > 0) own.push({ about: `${WHERE_ABOUT[p.key]} — доля своих трат месяца`, value: pctText(p.share), raw: p.share })
  const weekend = split ? weekendShare(ops, split.month, ctx.spendCategories) : null
  if (weekend) {
    own.push({ about: 'траты по выходным — доля свободных трат месяца', value: pctText(weekend.share), raw: weekend.share })
    own.push({ about: 'выходные — доля дней месяца', value: pctText(weekend.days), raw: weekend.days })
  }
  const drafts = [...own, ...baseFacts(doc, input, reason, plan, by)].slice(0, REVIEW_FACTS_MAX)
  const facts: ReviewFact[] = drafts.map((d, i) => ({ id: `f${i + 1}`, about: clip(mask(d.about), REVIEW_TEXT_MAX), value: clip(d.value, REVIEW_TEXT_MAX), raw: d.raw }))
  const labels = new Map(drafts.flatMap((d, i) => (d.label ? [[`f${i + 1}`, clip(mask(d.label), REVIEW_TEXT_MAX)] as const] : [])))
  const cardById = new Map(cards.map((c, i) => [`c${i + 1}`, c]))
  const sent: ReviewCardFact[] = cards.map((c, i) => ({ id: `c${i + 1}`, kind: c.kind, about: clip(mask(cardAbout(c)), REVIEW_TEXT_MAX) }))
  return { payload: { v: 4, facts, cards: sent }, cards, cardById, labels }
}

/**
 * Адрес «Открыть» (Р-18): раздел — лист раздела «Месяца», мечта — экран цели, долг и платёж — листы «Денег» по адресу,
 * продавец — история с чипом его раздела (экрана продавца нет). Лист долга по `?credit=` открывает «Капитал»
 * (`CapitalLists`), не квадрат «Долги»: Р-18 писал `/money/debts?credit=`, там адрес ничего не открывал (стенд RZ-08) —
 * `/money?credit=`, как «Изменить платёж» долга на «Месяце». Раздел — лист **того месяца, что на картинке** (`month` —
 * месяц находок; Х-9, владелец 2026-10-19, RZ-13): не текущий — `/month?month=<месяц>&cat=<id>`, иначе `/month?cat=<id>`.
 */
export function openPath(target: OpenTarget, month?: string): string {
  const q = encodeURIComponent
  if (target.kind === 'cat') return month && month !== monthKey() ? `/month?month=${q(month)}&cat=${q(target.id)}` : `/month?cat=${q(target.id)}`
  if (target.kind === 'goal') return `/goals/${q(target.id)}`
  if (target.kind === 'credit') return `/money?credit=${q(target.id)}`
  if (target.kind === 'obligation') return `/money?obligation=${q(target.id)}`
  return target.categoryId ? `/money/history?cat=${q(target.categoryId)}` : '/money/history'
}

/** «Что ушло» (Р-9) — читаемый список, не JSON: «доход месяца: 1 200 000 ₸»; шаги — с суммой и эффектом; «открыть — …». */
export function factsLines(payload: ReviewPayload | ReviewPayloadV3 | ReviewPayloadV4): string[] {
  const step = (c: { about: string; value: string; effect: string }) => `шаг — ${c.about}: ${c.value}${c.effect ? ` · ${c.effect}` : ''}`
  const rest =
    'cards' in payload
      ? payload.cards.map((c) => `карточка — ${c.about}`)
      : 'actions' in payload
      ? payload.actions.map((a) => (a.kind === 'do' ? step(a) : `открыть — ${a.about.replace(/^открыть /, '')}`))
      : payload.candidates.map(step)
  return [...payload.facts.map((f) => `${f.about}: ${f.value}`), ...rest]
}
