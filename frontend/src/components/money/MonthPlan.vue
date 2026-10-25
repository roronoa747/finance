<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretDown, PhCaretRight, PhSparkle } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { useAiStore } from '@/stores/ai'
import { demoReview as demoReviewOf } from '@/lib/demo'
import type { AiReview } from '@/types/finance'
import { money, moneyIn, parseMoney, plain } from '@/lib/money'
import { dayLabel, monthBy, monthFrom, monthKey as monthNow, monthShort, MONTHS_NOM, parseMonthKey, todayIso } from '@/lib/dates'
import { foundPayments } from '@/lib/statements/firstRun'
import { spendColor } from '@/lib/palette'
import {
  DEBT_CARD,
  closerDays,
  cushionCover,
  freeByFact,
  allInDebt,
  findMonth,
  goalPace,
  habitImages,
  lastAccountFor,
  liveSpendCategories,
  monthPlan,
  monthSalaries,
  monthSubscriptions,
  pendingPuts,
  planByFact,
  planExtras,
  planPutSaves,
  planPuts,
  putsLeft,
  queueStatus,
  rkShare,
  spendCompare,
  spendFact,
  participantLines,
  spendPlansBy,
  sectionMonth,
  untilPayday,
  type ImageAction,
  type PlanDue,
  type PlanPut,
  type PlanQueueItem,
  type ReviewCard,
} from '@/lib/finance'
import { UNKNOWN_CATEGORY, plannedElsewhere } from '@/lib/statements/dictionary'
import type { PersonId } from '@/types/finance'
import { plural } from '@/lib/utils'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import { useFlash } from '@/components/kit/useFlash'
import { useFormCheck } from '@/components/kit/useFormCheck'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import SortableList from '@/components/kit/SortableList.vue'
import Tip from '@/components/kit/Tip.vue'
import Toast from '@/components/kit/Toast.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import ExtraIncomeSheet from '@/components/capital/ExtraIncomeSheet.vue'
import AffordSheet from '@/components/money/AffordSheet.vue'
import AiReport from '@/components/ai/AiReport.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'
import { useQuerySheet, useQueryValue } from '@/components/useQuerySheet'
import DueRow from '@/components/money/DueRow.vue'
import MonthRing from '@/components/money/MonthRing.vue'
import SalarySheet from '@/components/money/SalarySheet.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'
import SpendCategorySheet from '@/components/money/SpendCategorySheet.vue'
import SectionOpsList from '@/components/money/SectionOpsList.vue'
import OpSheet from '@/components/OpSheet.vue'
import AddPaymentSheet from '@/components/AddPaymentSheet.vue'
import HandSpendSheet from '@/components/week/HandSpendSheet.vue'
import ImageMoveSheet from '@/components/plan/ImageMoveSheet.vue'
import { templateById } from '@/lib/goalTemplates'
import { attachTemplate } from '@/lib/photos/goalPhoto'

/**
 * «План · Месяц» (Блок 15, Р-90; вид — Блок 5 «Фидбек», Р-30, Р-32, Figma «Месяц · Б» `18:105`): верхняя карточка —
 * малое кольцо-оглавление слева, «Остаётся» крупно справа с чипами «Хватит?» / «✦ Разбор», под чертой три строки-раздела
 * — Платежи · Траты · Цели и фонды (одна точка цвета раздела; призыв — подписью брендом); раздел раскрывается под строкой
 * нажатием цвета кольца или строки, один за раз, по умолчанию всё свёрнуто. Ниже — карточка зарплат: пришла — строка
 * подсвечена `--ok-soft`. Месяц — список дел одним языком (правило 12 «Смысловой флоу»):
 * платёж — «Оплатил» ✓ (Р-94), цель — «Отложил» ✓, зарплата — «Пришла» (Р-97); действие — нажатием своей строки,
 * лист с одной кнопкой. Подписки — одной строкой (Р-93), цели — короткими строками без фото (Р-92). Управление
 * Блока 14 — то же: плательщик, вкл/выкл, ⋮⋮; траты — строки «факт / план» участников и свои разделы, свой план — в листе раздела (FB-12). Всё считает `finance.ts`; здесь — показ и правки
 * документа через стор. Viewer — тот же план без переключателей, плательщиков, листов и кнопок.
 */
const props = defineProps<{ monthKey: string }>()

const route = useRoute()
const router = useRouter()
const finance = useFinanceStore()
const auth = useAuthStore()

const canEdit = computed(() => !auth.isViewer)
/** Подсказка у разделов месяца (бэклог «первый» Р-7; слова — владелец на `/ux`, Р-9): отметки живут внутри них; viewer — без призыва. */
const tipText = computed(() => (canEdit.value ? 'Нажмите на раздел и отметьте, что оплатили' : 'Платежи, траты и цели месяца'))
const me = computed<PersonId>(() => auth.slot ?? 'a')
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (id: PersonId | null) => people.value.find((p) => p.id === id)?.name ?? ''

// Вход плана — один на все экраны (`planInput`, ревью frontend Б14 Н-4).
const input = computed(() => finance.planInput(props.monthKey))
const state = computed(() => input.value.state)
const ctx = computed(() => input.value.ctx)
const plan = computed(() => monthPlan(state.value, ctx.value))
const debtTip = computed(() => allInDebt(state.value, ctx.value, plan.value))
const by = (x: string) => monthBy(x, props.monthKey)
const mon = computed(() => monthShort(props.monthKey, false))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(props.monthKey).month].toLowerCase())

/* ---------- круг — оглавление: какой раздел раскрыт (состояние экрана) ---------- */
type Section = 'dues' | 'spend' | 'queue'
const opened = ref<Section | null>(null)
const toggleSection = (k: string) => (opened.value = opened.value === k ? null : (k as Section))
/**
 * Доли кольца — суммы разделов. С доходом «Траты» — план (`spendTotal`, как считает «Остаётся»); без дохода (Х-23,
 * владелец 2026-10-23) — та же сумма, что в строке «Траты» («обычно в месяц» до плана), иначе кольцо пустое при числах
 * в строках.
 */
const parts = computed(() =>
  sections.value.map((s) => ({ key: s.key, amount: s.key === 'spend' && !noIncome.value ? plan.value.spendTotal : s.total, color: s.color })),
)

/* ---------- список дел: «Отложил» (Р-97) и деньги сверх плана (Р-86) ---------- */
const puts = computed(() => planPuts(state.value, plan.value))
const putById = computed(() => new Map(puts.value.map((p) => [p.id, p])))
const pending = computed(() => (canEdit.value ? pendingPuts(puts.value) : []))
const pendingTotal = computed(() => putsLeft(pending.value))
const extras = computed(() =>
  canEdit.value ? planExtras(state.value, { ...ctx.value, rawCredits: finance.householdDoc.credits }) : { freed: null, closed: null },
)
/* «Ближе на N дней» (PN-09, Р-15): один тост на «Отложил» и «Отложил всё» — первая цель по очереди и «и ещё M»; фонды и
 * долг дней не дают; ни у одной цели нет темпа — тоста нет. Темп и остаток — до записи взносов. */
const { note: closerNote, flash: flashCloser } = useFlash()
function savePuts(list: PlanPut[]) {
  const closer = list.flatMap((p) => {
    if (p.kind !== 'goal' || !p.goalId || p.left <= 0) return []
    const g = finance.goals.find((x) => x.id === p.goalId && !x.deletedAt)
    const days = g ? closerDays(p.left, goalPace(g, props.monthKey)) : null
    return days ? [{ name: p.name, days }] : []
  })
  finance.putPlan(planPutSaves(plan.value, list), { by: me.value, note: 'по плану месяца' })
  if (!closer.length) return
  const [first] = closer
  // «и ещё 2 цели», а не «и ещё 2» — без слова новичок не понимает, чего ещё (`/ux` Блока 3).
  const more = closer.length - 1
  flashCloser(`${first.name} ближе на ${first.days} ${plural(first.days, 'день', 'дня', 'дней')}${more > 0 ? ` · и ещё ${more} ${plural(more, 'цель', 'цели', 'целей')}` : ''}`)
}
function onFreed() {
  const f = extras.value.freed
  if (f) finance.applyPlan(f, { by: me.value, note: 'освободившийся платёж' })
}
function onClosed() {
  const c = extras.value.closed
  if (c) finance.applyPlan(c, { by: me.value, note: 'закрытый долг' })
}
const freedMeta = computed(() => {
  const f = extras.value.freed
  return f ? `С ${monthFrom(f.record.period, false)} свободно +${money(f.add)} в месяц` : ''
})

const spentFact = computed(() => spendFact(plan.value.spend))
/**
 * Траты в сравнении (Р-5, AU-01) — только свои разделы (FB-12, Р-18): факт, план, «обычно», «Не разобрано», «Разовые» и
 * «Платежи без отметки» — мои; точка — у раздела выше обычного и у заголовка «Траты». Семейное «потрачено» в заголовке —
 * как было. Viewer разделов не видит (матрица §3); его слот может совпасть со слотом участника — поэтому пусто по
 * `canEdit`, не по `me`.
 */
const compare = computed(() => {
  const c = spendCompare(state.value, ctx.value, me.value)
  return canEdit.value ? c : { ...c, rows: [], unknown: 0, oneOff: 0, unmarkedPayments: 0 }
})
/**
 * Строки участников (Р-7): у каждого «факт / план» одной строкой, свой первым. В семье из одного своя строка повторила
 * бы заголовок — строк нет; viewer видит строки всегда (разделов у него нет).
 */
const lines = computed(() => {
  const list = participantLines(plan.value, people.value, canEdit.value ? me.value : null)
  return list.length > 1 || !canEdit.value ? list : []
})
/**
 * Строки разделов: `dot` — есть что сделать; тогда точка цвета раздела пульсирует (К-12, FG-08, вариант составителя:
 * индикатор вместо текста-призыва), а текст зова `call` слышит читалка и видит `title` точки. Подпись — всегда
 * нейтральная: «K из N оплачено · N потрачено · K из M отложено» (Р-14 «Figma»). Зовы: «Платежи» — освободившийся
 * платёж или повторы в выписке (их список — в раскрытом разделе); «Траты» — раздел выше обычного; «Цели и фонды» —
 * закрытый долг или взносы, что ждут «Отложил». Предмет каждого зова — внутри раскрытого раздела.
 */
const queueMeta = computed(() => (puts.value.length ? `${puts.value.filter((p) => p.done).length} из ${puts.value.length} отложено` : 'взносов нет'))
const sections = computed(() => [
  {
    key: 'dues' as const,
    name: 'Платежи',
    color: '--s1',
    total: plan.value.duesTotal,
    // Платежей месяца нет, а повторы в выписке есть (Р-35) — подпись «платежей нет», зов — точкой (К-12): список найденных
    // — в раскрытом разделе.
    meta: foundMeta.value ? 'платежей нет' : `${plan.value.dues.filter((d) => d.paid).length} из ${plan.value.dues.length} оплачено`,
    dot: !!extras.value.freed || foundMeta.value,
    call: extras.value.freed ? 'освободился платёж' : `нашли ${found.value.length} в выписке`,
  },
  {
    key: 'spend' as const,
    name: 'Траты',
    color: '--s8',
    // «Установить план» (Р-36, К-14): подписи нет — понятно по кнопке; сумма — итог расчёта. Факт — «N потрачено» (К-7).
    total: planFact.value ? planFact.value.total : plan.value.spendTotal,
    meta: planFact.value ? '' : spentFact.value !== null ? `${plain(spentFact.value)} потрачено` : 'по плану',
    dot: !planFact.value && compare.value.rows.some((r) => r.over),
    call: 'больше обычного',
  },
  {
    key: 'queue' as const,
    name: 'Цели и фонды',
    color: '--s3',
    total: plan.value.queueTotal,
    meta: queueMeta.value,
    dot: pending.value.length > 0 || !!extras.value.closed,
    call: extras.value.closed && !pending.value.length ? 'долг закрыт' : queueMeta.value,
  },
])

/* ---------- зарплаты: пришла — подсветка строки; нажатие строки — лист: «Пришла» у своей, «Изменить оклад» ---------- */
const salaries = computed(() =>
  monthSalaries(plan.value, { people: finance.people, payments: finance.payments }).map((s) => ({
    ...s,
    // Свою зарплату отмечает только сам участник (Р-13), когда её день настал или близко.
    canMark: canEdit.value && auth.slot === s.person && s.open,
  })),
)

/*
 * Подсказка у «Остаётся» (Р-116, переехало с «Мечт»): «Свободно» по факту выписок (Р-47 — до выписки месяца числа нет)
 * и дни до зарплаты. Считает `finance.ts` — те же `freeByFact` и `untilPayday`, что были на «Мечтах».
 */
const fx = useFxStore()
const ops = useOperationsStore()
const free = computed(() =>
  freeByFact(
    { ...finance.householdDoc, credits: finance.credits, book: fx.book },
    finance.householdDoc.spendTotals ?? [],
    finance.householdDoc.spendCategories ?? [],
    props.monthKey,
    ops.uploads,
  ),
)
const paydayText = computed(() => {
  if (props.monthKey !== monthNow()) return ''
  const p = untilPayday({
    people: finance.people,
    obligations: finance.obligations,
    credits: finance.credits,
    accounts: finance.householdAccounts,
    payments: finance.payments,
    fxExchanges: finance.fxExchanges,
    book: fx.book,
  })
  if (!p) return ''
  return p.inDays === 0 ? 'Сегодня зарплата' : `До зарплаты ${p.inDays} ${plural(p.inDays, 'день', 'дня', 'дней')}`
})
// Лист зарплаты — общий с «Капиталом» (`SalarySheet`, Р-108).
const salaryFor = ref<PersonId | null>(null)
const salarySheet = computed(() => salaries.value.find((s) => s.person === salaryFor.value) ?? null)

/* ---------- внеплановый доход: тихо в карточке зарплат и из «+» (`?income=1`) ---------- */
const incomeOpen = ref(false)
watch(
  () => route.query.income,
  (v) => {
    if (v === '1' && canEdit.value) incomeOpen.value = true
  },
  { immediate: true },
)

/*
 * ---------- «Хватит?» из «+» (`?afford=1`, PN-17) и тихой кнопкой под «Остаётся» (владелец, приёмка Б5 — вход для
 * всех ролей): ничего не пишет — гарда viewer нет ----------
 */
const { open: affordOpen, close: closeAfford } = useQuerySheet('afford')

/*
 * ---------- разбор месяца ИИ (бэклог «ИИ», Р-4, AI-09; v2 — «ИИ-польза», AU-13; v3 — «Разбор», RZ-07): у остатка
 * рядом с «Хватит?» ----------
 * Есть разбор месяца — отчёт с ним без запроса (партнёр, viewer); нет — согласие (Р-9), запрос (повод `month`), разбор в
 * общий документ. Обычно он уже пришёл сам (`ai.autoReview`). Только текущий месяц. Отчёт — оверлей по адресу
 * `?review=1[&card=<n>]` (Р-17): закрыли — параметры сняты; открыт с разбором — разбор «увиден». Точка — разбор есть, а
 * на этом телефоне его не открывали (общее с точками «Плана» и «Месяца» — `ai.seenReview`).
 */
const ai = useAiStore()
/** Демо (Р-13, AU-14): заранее написанный разбор с «Сделать» и «что ушло» — фактами демо; без запроса, в документ не пишется. */
const demoReview = computed<AiReview | null>(() =>
  auth.isDemo
    ? {
        id: 'demo-review', month: props.monthKey, at: new Date().toISOString(), by: 'a', updatedAt: '',
        ...demoReviewOf(finance.householdDoc, finance.planInput(props.monthKey), ops.all),
      }
    : null,
)
const review = computed(() => demoReview.value ?? finance.aiReviewOf(props.monthKey))
/**
 * Карточки кода разбора v4 (бэклог «Фидбек», Р-23, Р-24, Р-27): участнику текущего месяца — по своим операциям, свежие;
 * и без ИИ (вариант А); сборка одна — стор ИИ `cardsOf` (те же карточки уходят модели и ставят ✦). Viewer — нет (отчёт
 * v1–v3 общего документа, как был).
 */
const v4Cards = computed<ReviewCard[] | null>(() =>
  canEdit.value && props.monthKey === monthNow()
    ? ai.cardsOf(props.monthKey)
    : null,
)
/** ИИ разбора: участник с ИИ, не сказавший «Не надо» (Р-9), или демо — пилюля «✦ Разбор»; без ИИ — «Разбор» (только карточки). */
const reviewAi = computed(() => (ai.available && ai.consent !== 'off') || auth.isDemo)
/** Пилюля — участнику всегда (текущий месяц, v4); viewer — если в общем документе есть разбор (v1–v3) и у семьи ИИ. */
const reviewShown = computed(() => props.monthKey === monthNow() && (!!v4Cards.value || reviewAi.value || (!!review.value && auth.ai)))
/** «Не разобрано» без разбора ИИ — своя метка «увидено» (`ai.seenReview`): сумма изменилась — точка снова. */
const unknownSeenKey = computed(() => {
  const u = v4Cards.value?.find((c) => c.kind === 'unknown')
  return u ? `unknown:${props.monthKey}:${u.monthly}` : null
})
/** Точка: свой новый разбор; без разбора — новая карточка «Не разобрано». */
const reviewDot = computed(() => (review.value ? review.value.id !== ai.seenReview : !!unknownSeenKey.value && unknownSeenKey.value !== ai.seenReview))
const { open: reviewOpen, close: closeReview } = useQuerySheet('review', ['card'])
/** Номер совета, с которого стартует отчёт (`&card=<n>` — ✦ у предмета, Блок 3). */
const reviewCard = computed(() => {
  const n = Number(route.query.card)
  return Number.isInteger(n) && n >= 1 ? n : null
})
// Отчёт открыт и в нём разбор (открыли, ответ пришёл при открытом, «Обновить») — увиден. Закрыли, пока «Думаю…», —
// не видели: позовёт точка (правило 12, `/ux`).
watch(
  [() => reviewOpen.value && reviewShown.value, () => review.value?.id],
  ([shown]) => {
    const seen = review.value?.id ?? unknownSeenKey.value
    if (shown && seen) ai.markReviewSeen(seen)
  },
  { immediate: true },
)
// Ушли с адреса отчёта («Открыть» — экран предмета, в том числе `/month?cat=`) до того, как дошёл его собственный
// `?review=1`, — закрыт: параметра «до» не было, и `useQuerySheet` сам этого не заметит.
watch(
  () => route.fullPath,
  () => {
    if (reviewOpen.value && route.query.review !== '1') reviewOpen.value = false
  },
)
/** Отчёт — по адресу: «Назад» его закрывает, ✦ у предмета (Блок 3) ведёт сюда же. */
function showReview() {
  reviewOpen.value = true
  if (route.query.review !== '1') void router.push({ query: { ...route.query, review: '1' } })
}
async function openReview() {
  // Свой разбор есть (v1–v3 — у viewer) или ИИ нет / «Не надо» — отчёт как есть: карточки кода без мысли (Р-27).
  if (review.value || !reviewAi.value || auth.isDemo) {
    if (ai.reviewState !== 'thinking') ai.reviewState = 'idle'
    showReview()
    return
  }
  if (!ai.available) return
  if (!(await ai.ensureConsent())) {
    // Личный документ не подтянулся (нет сети) — сказать, а не молчать; «Не надо» и свайп — просто ничего.
    if (ai.consentFailed) {
      ai.reviewState = 'failed'
      showReview()
    }
    return
  }
  // «Думаю…» — до открытия: отчёт без разбора сразу показывает, что ответ в пути.
  const run = ai.runReview(props.monthKey, 'month')
  showReview()
  await run
}
async function refreshReview() {
  if (await ai.ensureConsent()) await ai.runReview(props.monthKey, 'refresh')
}

/* ---------- кто платит (Р-80) ---------- */
type PayerTarget = { kind: 'obligation' | 'credit' | 'goal' | 'debt'; id: string; name: string; payer: PersonId | null }
const payerFor = ref<PayerTarget | null>(null)
function pick(person: PersonId) {
  const t = payerFor.value
  payerFor.value = null
  if (t && t.payer !== person) finance.setPayer(t.kind, t.id, person)
}

/* ---------- платежи: подписки группой (Р-93), «Оплатил» нажатием строки (Р-94) ---------- */
const dueKey = (d: PlanDue) => `${d.kind}:${d.targetId}`
const grouped = computed(() => monthSubscriptions(plan.value.dues, finance.obligations, finance.people))
type DueLine = { key: string; day: number; due: PlanDue | null }
const dueLines = computed<DueLine[]>(() => {
  const lines: DueLine[] = grouped.value.rest.map((d) => ({ key: dueKey(d), day: d.day, due: d }))
  if (grouped.value.subs) lines.push({ key: 'subs', day: grouped.value.subs.day, due: null })
  return lines.sort((a, b) => a.day - b.day || (a.due?.name ?? '').localeCompare(b.due?.name ?? ''))
})
const subsOpen = ref(false)
/*
 * ✦ совета ИИ (RZ-10): кнопка — у самого предмета; свёрнутые раздел и «Подписки · N» с таким предметом внутри зовут
 * издалека тем же ✦ без кнопки (правило 12: зов — значком у заголовка, не блоком). У заголовка раздела — одна метка:
 * точка «есть что сделать», если она есть, ✦ — только без точки (владелец 2026-10-19, Х-12 — А, RZ-16).
 */
const marked = (d: PlanDue) => ai.markFor(d.kind, d.targetId) !== null
const subsMarked = computed(() => grouped.value.byWho.some((w) => w.group.parts.some((g) => g.rows.some(marked))))
/** ✦ у цели и фонда очереди — совет про мечту / подушку; у карточки долга — про её кредит (досрочка, «Открыть» долга). */
const queueMark = (q: PlanQueueItem) => (q.kind === 'debt' ? ai.markFor('credit', q.creditId) : ai.markFor('goal', q.goalId))
const sectionMarked = computed(() => ({
  dues: plan.value.dues.some(marked),
  spend: compare.value.rows.some((r) => ai.markFor('cat', r.categoryId) !== null),
  queue: plan.value.queue.some((q) => queueMark(q) !== null),
}))
/** Кнопка строки раздела и очереди — только название; сумму и подпись читалка слышит описанием (`/ux` «Разбор» 3). */
const uid = useId()
// «Освободится» — подсказкой у своего платежа: в общем списке или у группы подписок, где он лежит.
const freedAt = computed(() => {
  const id = extras.value.freed?.obligationId
  if (!id) return null
  if (grouped.value.rest.some((d) => d.kind === 'obligation' && d.targetId === id)) return `obligation:${id}`
  return grouped.value.subs ? 'subs' : (dueLines.value[0]?.key ?? null)
})

const payFor = ref<string | null>(null)
const paySheet = computed(() => plan.value.dues.find((d) => dueKey(d) === payFor.value) ?? null)
const markFor = ref<{ due: PlanDue; account: string | null | undefined } | null>(null)
/** «Оплатил»: одно нажатие — со счёта прошлой оплаты (Р-5); счёт спросить не у кого или сумма-оценка — лист отметки. */
function pay(d: PlanDue) {
  payFor.value = null
  const last = lastAccountFor(finance.payments, d.targetId, finance.accounts)
  const estimate = d.kind === 'obligation' && !!d.obligation.estimate
  if (last === undefined || estimate) markFor.value = { due: d, account: last }
  else finance.markPaid(d.kind, d.targetId, me.value, { period: props.monthKey, accountId: last })
}
/** Долг человеку — «Отдал», как у его строки в «Долгах» (мелочи Р-5). */
const givenDue = (d: PlanDue) => d.kind === 'credit' && !!d.credit.person
function unpay(d: PlanDue) {
  payFor.value = null
  finance.unmarkPaid(d.kind, d.targetId, props.monthKey)
}
/** «Изменить платёж» — лист платежа в «Деньгах» (справочник, Р-91). */
function editDue(d: PlanDue) {
  payFor.value = null
  void router.push({ path: '/money', query: d.kind === 'credit' ? { credit: d.targetId } : { obligation: d.targetId } })
}
const dueNote = (d: PlanDue) => (d.kind === 'obligation' && d.obligation.estimate ? 'примерно' : '')
const askPayer = (d: PlanDue) => (payerFor.value = { kind: d.kind, id: d.targetId, name: d.name, payer: d.payer })

/* ---------- траты: строки участников и свои разделы (FB-12), свой план — в листе раздела ---------- */
const categories = computed(() => {
  const all = finance.householdDoc.spendCategories ?? []
  return liveSpendCategories(all).filter((c) => !plannedElsewhere(c.id, all))
})
const spendShare = (fact: number | null, planned: number | null) =>
  fact === null || !planned || planned <= 0 ? 0 : Math.min(100, Math.round((fact / planned) * 100))
/** Лист раздела: нажатие строки или адрес `?cat=<id>` («Открыть» совета и строка «Куда ушло» отчёта, Р-18, RZ-08); закрыли — параметр снят. */
const { value: catFor, close: closeCat } = useQueryValue('cat')
/**
 * Месяц листов раздела и «Не разобрано»: поверх отчёта v4 — месяц его карточек (`findMonth` по своим выпискам: в первые
 * дни месяца — прошлый), иначе — месяц экрана (критик 4б: «Разобрать» 12 трат открывал пустой лист текущего месяца).
 */
const sheetMonth = computed(() => (reviewOpen.value && v4Cards.value ? findMonth(ctx.value, me.value) : props.monthKey))
const sheetCompare = computed(() =>
  sheetMonth.value === props.monthKey || !canEdit.value ? compare.value : spendCompare(state.value, { ...ctx.value, key: sheetMonth.value }, me.value),
)
const catRow = computed(() => sheetCompare.value.rows.find((r) => r.categoryId === catFor.value) ?? null)
/** Раздел семьи, где у меня нет ни трат, ни плана (`?cat=` из отчёта): лист «нет трат», цифр партнёра нет (FB-12). */
const catNone = computed(() => (canEdit.value && catFor.value && !catRow.value ? (categories.value.find((c) => c.id === catFor.value)?.name ?? null) : null))
const catRk = computed(() => (catRow.value?.group ? rkShare(state.value, ctx.value, catRow.value.group, me.value) : null))
/** Свой план раздела — строка `monthPlan().spend`; плана нет — 0. План партнёра — его раздел (Р-18). */
const catPlans = computed(() => (catFor.value ? spendPlansBy(plan.value, people.value.filter((p) => p.id === me.value), catFor.value) : []))
/** Образ привычки раздела (Р-24, AU-29): один, самый крупный; считает `habitImages` по 3 закрытым месяцам. */
const images = computed(() => habitImages(state.value, props.monthKey))
const catImage = computed(() => images.value.find((i) => i.categoryId === catFor.value) ?? null)
/**
 * Свои операции раздела за месяц (FB-05, Р-14): `sectionMonth` по своей копии (партнёру — только его, viewer — нет);
 * «Ещё N» — все. Строка выписки — лист операции поверх листа раздела, ручная — «Трата».
 */
const catAll = ref(false)
watch(catFor, () => (catAll.value = false))
const catOps = computed(() => {
  if (!catFor.value || !canEdit.value) return null
  const { marked, categories } = ops.totalMarks(ops.shown)
  return sectionMonth(ops.shown, { month: sheetMonth.value, categoryId: catFor.value, marked, categories, ...(catAll.value ? { limit: Infinity } : {}) })
})
const catOp = ref<string | null>(null)
const catHand = ref<string | null>(null)
function openCatHand(id: string) {
  closeCat()
  closeOneOff()
  closeUnknown()
  closeUnmarked()
  catHand.value = id
}
/**
 * «Разовые» (FB-07, Р-16): тихая строка под разделами — сумма своих разовых (`spendCompare.oneOff` с `by`); лист — свои
 * разовые месяца (`sectionMonth` с `oneOff`), строка — лист операции, где «Разовую» можно снять. Viewer — без листа.
 */
const { open: oneOffOpen, close: closeOneOff } = useQuerySheet('oneoff')
const oneOffAll = ref(false)
watch(oneOffOpen, () => (oneOffAll.value = false))
const oneOffOps = computed(() => {
  if (!oneOffOpen.value || !canEdit.value) return null
  const { marked, categories } = ops.totalMarks(ops.shown)
  const list = sectionMonth(ops.shown, { month: props.monthKey, oneOff: true, marked, categories, ...(oneOffAll.value ? { limit: Infinity } : {}) })
  return list.count ? list : null
})
const moveAction = ref<Extract<ImageAction, { kind: 'move' }> | null>(null)
/** Действие образа: мечта — сразу на её экран; желание — тост; «Перенести в мечту» — лист с цифрами. */
function imageAct(a: ImageAction) {
  if (!canEdit.value) return
  closeCat()
  if (a.kind === 'goal') {
    const tpl = templateById(a.template)
    const id = finance.addGoal({ name: a.name, need: a.need, monthly: a.monthly, hue: tpl?.hue ?? 'steel', template: a.template })
    // Картинка шаблона — как у новой мечты из `GoalNew` (без сети — позже, `retryTemplatePhotos`).
    if (tpl) void attachTemplate(finance, id, tpl)
    void router.push(`/goals/${id}`)
  } else if (a.kind === 'wish') {
    finance.addWish({ name: a.name, price: a.price, by: me.value })
    flashCloser('В желаниях')
  } else if (a.kind === 'move') moveAction.value = a
  else void router.push('/money/debts/faster')
}
/**
 * «Не разобрано» (FB-17, Р-24): тихая строка под разделами — лист своих трат месяца без раздела (`sectionMonth` с
 * `UNKNOWN_CATEGORY`), строка — лист операции («куда отнести?»). Его же открывает карточка разбора «Разобрать».
 */
const { open: unknownOpen, close: closeUnknown } = useQuerySheet('unknown')
const unknownAll = ref(false)
watch(unknownOpen, () => (unknownAll.value = false))
const unknownOps = computed(() => {
  if (!unknownOpen.value || !canEdit.value) return null
  const { marked, categories } = ops.totalMarks(ops.shown)
  const list = sectionMonth(ops.shown, { month: sheetMonth.value, categoryId: UNKNOWN_CATEGORY, marked, categories, ...(unknownAll.value ? { limit: Infinity } : {}) })
  return list.count ? list : null
})
/**
 * «Платежи без отметки» (Х-6, Р-7): тихая строка под «Разовыми» — сумма строк разделов платежей без отметки
 * (`spendCompare.unmarkedPayments`); лист — эти строки (`sectionMonth` с `payments`), у строки с повтором продавца —
 * «В платежи» (`AddPaymentSheet`; кредит — лист кредита). Строка с вопросом «это платёж по …?» уже отмечена
 * (`markedOps`) — её здесь нет. Отметили — строка уходит, сумма пересчитывается. Viewer — без листа.
 */
const { open: unmarkedOpen, close: closeUnmarked } = useQuerySheet('unmarked')
const unmarkedAll = ref(false)
watch(unmarkedOpen, () => (unmarkedAll.value = false))
const unmarkedOps = computed(() => {
  if (!unmarkedOpen.value || !canEdit.value) return null
  const { marked, categories } = ops.totalMarks(ops.shown)
  const list = sectionMonth(ops.shown, { month: props.monthKey, payments: true, marked, categories, recurring: ops.recurringFor, ...(unmarkedAll.value ? { limit: Infinity } : {}) })
  return list.count ? list : null
})

/**
 * Кнопки карточек разбора v4 (FB-17, Р-24): существующий лист поверх отчёта, адрес отчёта (`?review=1&card=n`) не
 * трогается — закрыли лист, отчёт на той же карточке. «Сделать» — `DoSheet` в отчёте, «Обновить сумму» — экран платежа.
 */
const sheetZ = computed(() => (reviewOpen.value ? 60 : 50))
const payOp = ref<string | null>(null)
function reviewAct(card: ReviewCard) {
  const t = card.target
  if (t.kind === 'op') catOp.value = t.opId
  else if (t.kind === 'cat') catFor.value = t.categoryId
  else if (t.kind === 'unknown') unknownOpen.value = true
  else if (t.kind === 'pay') payOp.value = t.opId
  else if (t.kind === 'image' && t.image.action?.kind === 'move') moveAction.value = t.image.action
  else if (t.kind === 'plan') editSpend(me.value, t.categoryId, t.amount)
}

function editCatPlan(personId: PersonId, amount: number) {
  const id = catFor.value
  closeCat()
  if (id) editSpend(personId, id, amount)
}
const spendEdit = ref<{ by: PersonId; categoryId: string; amount: string; fresh: boolean } | null>(null)
function editSpend(personId: PersonId, categoryId?: string, amount = 0) {
  if (!canEdit.value) return
  spendEdit.value = { by: personId, categoryId: categoryId ?? categories.value[0]?.id ?? '', amount: amount ? plain(amount) : '', fresh: !categoryId }
}
const spendForm = useFormCheck(() => [['category', !spendEdit.value?.categoryId && 'Выберите раздел']])
function saveSpend() {
  const e = spendEdit.value
  spendEdit.value = null
  if (e?.categoryId) finance.setSpendPlan(e.by, e.categoryId, parseMoney(e.amount))
}

/* ---------- цели и фонды — короткие строки (Р-92), очередь ⋮⋮ (Р-84), «Отложил» нажатием ---------- */
const queueIds = computed(() => plan.value.queue.map((q) => q.id))
const queueById = computed(() => new Map(plan.value.queue.map((q) => [q.id, q])))

/** Строка состояния — только когда есть что сказать (правило 12): пауза, нехватка, собрано (`queueStatus`). */
function statusOf(q: PlanQueueItem): { text: string; warn?: boolean } | null {
  const st = queueStatus(q, { debtPlan: !!finance.activePlan })
  // Подушка (PN-20): когда сказать нечего или собрано — «хватит на N мес.» (та же `cushionCover`, что экран); пауза и нехватка — как у всех.
  if (q.fund === 'cushion' && (!st || st.kind === 'collected')) {
    const goal = finance.goals.find((g) => g.id === q.goalId)
    const months = goal ? cushionCover(q, goal, finance.moneySettings).months : null
    if (months != null) return { text: `хватит на ${months.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мес.` }
  }
  if (!st) return null
  switch (st.kind) {
    case 'off':
      return { text: 'на паузе' }
    case 'planPause':
      return { text: 'на паузе ради плана' }
    // С планом «Сначала долги» сумма карточки — шаг плана (Р-82); шага в долг в этом месяце нет — так и пишем.
    case 'debtByPlan':
      return { text: 'по плану «Сначала долги»' }
    case 'debtNoAmount':
      return { text: canEdit.value ? 'задайте сумму в месяц' : 'по графику' }
    case 'collected':
      return { text: 'собрано' }
    case 'noMonthly':
      return { text: 'взнос не задан' }
    case 'short':
      return { text: `не хватает ${money(st.amount)}`, warn: true }
    case 'shortAll':
      return { text: 'в этом месяце не хватает', warn: true }
  }
}

/** Вкл/выкл (Р-83): выключенная — на паузе с этой минуты и дальше. */
const toggle = (id: string, on: boolean) => finance.pauseGoal(id, !on)

const putFor = ref<string | null>(null)
const putSheet = computed(() => (putFor.value ? (putById.value.get(putFor.value) ?? null) : null))
const debtEdit = ref<string | null>(null)
/**
 * Строка с суммой месяца — лист «Отложил»; без суммы — к цели или к сумме карточки долга, как в Блоке 14. В прошлом
 * месяце (он открыт планом, пока своя зарплата не отложена) цель по одной не отмечается: первая же запись закрыла бы
 * месяц сводкой, а остальные цели остались бы без отметки — там только «Отложил всё».
 */
function openItem(q: PlanQueueItem) {
  if (canEdit.value && props.monthKey >= monthNow() && putById.value.has(q.id)) putFor.value = q.id
  else openDetail(q)
}
function openDetail(q: Pick<PlanQueueItem, 'kind' | 'goalId'>) {
  putFor.value = null
  if (q.kind === 'debt') {
    if (canEdit.value) debtEdit.value = plain(finance.debtCard.monthly)
    return
  }
  if (q.goalId) void router.push(`/goals/${q.goalId}`)
}
function onPut(p: PlanPut) {
  putFor.value = null
  savePuts([p])
}
function onUnput(p: PlanPut) {
  putFor.value = null
  if (p.goalId) finance.unputPlan(p.goalId, props.monthKey, p.undo, me.value)
}
function saveDebt() {
  const v = parseMoney(debtEdit.value ?? '')
  debtEdit.value = null
  finance.setDebtCard({ monthly: Math.max(0, v) })
}
const debtName = computed(() => plan.value.queue.find((q) => q.id === DEBT_CARD)?.name ?? '')

/* ---------- Блок 5 «Фидбек», FB-21: «нашли в выписке» (Р-35), «Поставить план» (Р-36), месяц без дохода (Р-37) ---------- */
/** Повторы из своих выписок, ещё не платежи, — только текущий месяц и участнику. */
const found = computed(() =>
  canEdit.value && props.monthKey === monthNow() ? foundPayments(ops.shown, { rules: finance.merchantRules, payments: finance.payments, today: todayIso(), amountOf: ops.amountOf }) : [],
)
/** Подпись «нашли N в выписке» — когда платежей месяца нет и повторы есть. */
const foundMeta = computed(() => plan.value.dues.length === 0 && found.value.length > 0)
/** Предложение плана по моим неделям: только текущий месяц, пока своего плана нет. */
const planFact = computed(() => (canEdit.value && props.monthKey === monthNow() ? planByFact(state.value, ctx.value, me.value, todayIso()) : null))
const PLAN_FACT_TOP = 3
const planFactOpen = ref(false)
const planFactAll = ref(false)
watch(planFactOpen, () => (planFactAll.value = false))
const planFactRows = computed(() => (planFact.value ? (planFactAll.value ? planFact.value.rows : planFact.value.rows.slice(0, PLAN_FACT_TOP)) : []))
const spendColorOf = (id: string) => spendColor(categories.value.find((c) => c.id === id) ?? null)
const { note: planFactNote, flash: flashPlanFact } = useFlash()
function savePlanFact() {
  const p = planFact.value
  planFactOpen.value = false
  if (!p) return
  for (const r of p.rows) finance.setSpendPlan(me.value, r.categoryId, r.amount)
  flashPlanFact('План поставлен')
}
/** Дохода месяца нет (Р-37): «Остаётся» и «—»; свой оклад не указан — «+ Зарплата». */
const noIncome = computed(() => plan.value.income.total === 0)
const noSalary = computed(() => canEdit.value && (people.value.find((p) => p.id === me.value)?.salary ?? 0) === 0)
const salaryEdit = ref<PersonId | null>(null)

// Фонда ещё нет (Р-82): тихая строка «+ Запас» / «+ Подушка» — заводит и открывает его взнос.
const missingFunds = computed(() =>
  canEdit.value ? (['reserve', 'cushion'] as const).filter((k) => !plan.value.queue.some((q) => q.kind === 'fund' && q.fund === k)) : [],
)
function addFund(kind: 'reserve' | 'cushion') {
  const id = finance.ensureFund(kind)
  void router.push(`/goals/${id}`)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!--
      Верхняя карточка (Блок 5 «Фидбек», Р-30, Figma `18:119`): малое кольцо-оглавление слева (платежи · траты · цели
      долями дохода; цвет раскрывает раздел), справа «Остаётся» с подсказкой, число крупно (≤ 34 px) и чипы «Хватит?» /
      «✦ Разбор»; под чертой в той же карточке — три строки разделов. Подсказка — над карточкой: под ней на 390 px она
      ушла бы под панель вкладок; подсказка стоит у своего предмета — разделов, «Хватит?» и кольцо её не гасят.
    -->
    <Card flush class="px-3.5" data-month-top>
        <div class="flex items-center gap-4 py-3.5">
          <MonthRing :parts="parts" :total="plan.income.total" :active="opened" pickable @pick="toggleSection" />
          <div class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <!-- «из N», «Свободно» по выпискам и дни до зарплаты — в подсказке у слова (Р-116), крупно — одно число. -->
            <!-- Дохода месяца нет (Р-37: оклад не указан) — «Остаётся» и «—», без «Не хватает» и красного; кольцо — доли из сумм разделов (Х-23). -->
            <span class="flex items-center gap-1">
              <span class="text-[13px] font-semibold text-ink-2">{{ plan.short > 0 && !noIncome ? 'Не хватает' : 'Остаётся' }}</span>
              <Hint label="Остаётся" data-rest-hint>
                <span v-if="noIncome" class="block">Доход месяца не указан.</span>
                <span v-else class="block num">Из {{ money(plan.income.total) }} дохода месяца.</span>
                <span v-if="free.byFact" class="block num" data-free>Свободно по выпискам — {{ money(free.amount) }}.</span>
                <span v-if="paydayText" class="block" data-payday>{{ paydayText }}.</span>
              </Hint>
            </span>
            <span v-if="noIncome" class="font-num text-[29px] font-bold leading-none num text-ink-2" data-rest-none>—</span>
            <span v-else-if="plan.short > 0" class="font-num text-[29px] font-bold leading-none num text-warn">{{ money(plan.short) }}</span>
            <span v-else class="font-num text-[29px] font-bold leading-none num text-ink" data-rest>{{ money(plan.rest) }}</span>
            <!--
              Действие у своего предмета (правило 12): «Хватит?» — у остатка; «✦ Разбор» (Р-3, Р-22, RZ-08) — заметный
              вход в отчёт, точка — разбор новый на этом телефоне.
            -->
            <span class="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" data-afford-open @click="affordOpen = true">Хватит?</Button>
              <Button
                v-if="reviewShown"
                variant="secondary"
                size="sm"
                class="relative gap-1.5"
                :aria-label="review || !reviewAi ? (reviewDot ? 'Разбор месяца, новый' : 'Разбор месяца') : 'Разобрать месяц'"
                data-review-open
                @click="openReview"
              >
                <PhSparkle v-if="reviewAi" :size="14" weight="fill" class="text-brand" aria-hidden="true" data-review-sparkle />Разбор
                <span v-if="reviewDot" class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-canvas bg-brand" data-review-dot aria-hidden="true" />
              </Button>
            </span>
          </div>
        </div>

        <!--
          Три раздела под чертой: одна точка — цвет раздела; зов («освободился платёж», «нашли в выписке», «больше
          обычного», ждут «Отложил», совет ИИ) — пульсом точки (К-12, FG-08; было — подписью брендом, Р-32), ✦ совета ИИ —
          после имени; раскрытие — под строкой, один за раз.
        -->
        <Tip id="tab-month" :text="tipText" above>
        <div class="border-t border-line py-0.5" data-sections>
        <template v-for="s in sections" :key="s.key">
          <!--
            Строка — div с кнопкой-названием на всю строку (`row-open`): рядом живёт маленькая «Поставить план» (Р-36),
            кнопки в кнопке нет; «раскрыто» для читалки — у кнопки (критик Блока 5: `aria-expanded` на div без роли не читается).
          -->
          <div
            class="press relative flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-[13px] text-left first:border-t-0"
            :data-section="s.key"
            @click="toggleSection(s.key)"
          >
            <!-- Зов (К-12): точка пульсирует — есть что сделать или совет ИИ; текст зова — `title` и читалке. -->
            <span
              class="size-3 shrink-0 rounded-full"
              :class="(s.dot || sectionMarked[s.key]) && 'fx-pulse'"
              :style="{ background: `var(${s.color})` }"
              :title="s.dot ? s.call : sectionMarked[s.key] ? 'есть совет ИИ' : undefined"
              :data-section-call="s.dot || sectionMarked[s.key] ? (s.dot ? s.call : 'есть совет ИИ') : undefined"
              aria-hidden="true"
            />
            <span class="flex min-w-0 flex-1 flex-col leading-[1.2]">
              <button type="button" class="row-open text-left text-[16.5px] font-bold text-ink" :aria-expanded="opened === s.key" data-row-open>
                {{ s.name
                }}<template v-if="s.dot"><span class="sr-only">, {{ s.call }}</span></template
                ><template v-else-if="sectionMarked[s.key]"><PhSparkle :size="12" weight="fill" class="ml-1.5 inline-block align-middle text-brand" aria-hidden="true" data-section-mark /><span class="sr-only">, есть совет ИИ</span></template>
              </button>
              <span v-if="s.meta" class="text-[12.5px] text-ink-2 num" data-section-meta :data-section-found="s.key === 'dues' && foundMeta ? found.length : undefined">{{ s.meta }}</span>
            </span>
            <!-- «Установить план» (Р-36, К-14): маленькая брендовая у своего предмета — строки «Траты», пока своего плана нет. -->
            <span v-if="s.key === 'spend' && planFact" class="relative z-10 shrink-0" @click.stop>
              <Button size="xs" data-plan-fact @click="planFactOpen = true">Установить план</Button>
            </span>
            <span class="font-num text-[16px] font-bold num text-ink">{{ money(s.total) }}</span>
            <PhCaretRight :size="15" class="shrink-0 text-ink-3 transition-transform" :class="opened === s.key && 'rotate-90'" />
          </div>

          <!-- Платежи: по дням; подписки — одной строкой -->
          <div v-if="opened === 'dues' && s.key === 'dues'" class="pb-2.5" data-dues>
            <p v-if="!dueLines.length && !found.length" class="py-2 type-meta">Платежей нет</p>
            <template v-for="l in dueLines" :key="l.key">
              <DueRow
                v-if="l.due"
                :id="l.key"
                :due="l.due"
                :mon="mon"
                :payer-name="personName(l.due.payer)"
                :note="dueNote(l.due)"
                :can-edit="canEdit"
                :mark="ai.markFor(l.due.kind, l.due.targetId)"
                @open="payFor = l.key"
                @payer="askPayer(l.due)"
              />

              <!-- Подписки · N — свёрнуто; ✓ у группы — когда списались все; ручные группы — подзаголовками -->
              <div v-else-if="grouped.subs" class="border-t border-line first:border-t-0" data-subs>
                <button type="button" class="press flex w-full cursor-pointer items-center gap-2.5 py-[11px] text-left" :aria-expanded="subsOpen" @click="subsOpen = !subsOpen">
                  <span class="grid w-[38px] shrink-0 place-items-center">
                    <span class="grid size-[30px] place-items-center rounded-[9px] bg-surface-2 text-[15px] text-ink-2" aria-hidden="true">↻</span>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <!-- Совет ИИ про подписку внутри — ✦ у свёрнутой группы зовёт издалека (правило 12), кнопка — у самой подписки. -->
                    <span class="flex min-w-0 items-center gap-1.5 text-[15.5px] font-semibold text-ink">
                      <span class="truncate">Подписки · {{ grouped.subs.count }}</span>
                      <template v-if="subsMarked"><PhSparkle :size="12" weight="fill" class="shrink-0 text-brand" aria-hidden="true" data-subs-mark /><span class="sr-only">, есть совет ИИ</span></template>
                    </span>
                    <span class="text-[12.5px] text-ink-2 num" data-subs-status>
                      {{ grouped.subs.allPaid ? 'все списались' : `${grouped.subs.paid} из ${grouped.subs.count} списались` }}
                    </span>
                  </span>
                  <span class="font-num text-[15px] font-bold num whitespace-nowrap" :class="grouped.subs.allPaid ? 'font-semibold text-ink-2' : 'text-ink'">
                    <span v-if="grouped.subs.allPaid" class="font-extrabold text-ok" data-subs-done>✓ </span>{{ money(grouped.subs.total) }}
                  </span>
                  <PhCaretRight :size="15" class="shrink-0 text-ink-3 transition-transform" :class="subsOpen && 'rotate-90'" />
                </button>
                <!-- Раскрыто — по «чья» (PN-27): «Общие · N», «<имя> · N»; одна часть — без подзаголовков -->
                <div v-if="subsOpen" class="mb-2 ml-[18px] border-l-2 border-line pl-3.5">
                  <template v-for="w in grouped.byWho" :key="w.who">
                    <p v-if="grouped.byWho.length > 1" class="pb-0.5 pt-3 text-[13px] font-semibold text-ink" :data-subs-who="w.who">{{ w.name }} · {{ w.group.count }}</p>
                    <template v-for="g in w.group.parts" :key="g.groupId ?? ''">
                      <p v-if="g.name" class="pb-0.5 pt-2.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-2">{{ g.name }}</p>
                      <DueRow
                        v-for="d in g.rows"
                        :id="dueKey(d)"
                        :key="d.targetId"
                        :due="d"
                        :mon="mon"
                        :payer-name="personName(d.payer)"
                        :note="dueNote(d)"
                        :can-edit="canEdit"
                        :mark="ai.markFor(d.kind, d.targetId)"
                        @open="payFor = dueKey(d)"
                        @payer="askPayer(d)"
                      />
                    </template>
                  </template>
                </div>
              </div>

              <!-- «Освободится» — у своего платежа; пока зарплата не отложена, кнопка тихая -->
              <div v-if="extras.freed && freedAt === l.key" class="mb-2.5 flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-freed>
                <span class="min-w-0 flex-1">{{ freedMeta }}</span>
                <Button size="sm" :variant="pending.length ? 'secondary' : 'default'" @click="onFreed">К «{{ extras.freed.name }}»</Button>
              </div>
            </template>
            <!--
              «Нашли в выписке» (Блок 5 «Фидбек», Р-35, FB-21; раньше — вопросы «Записать?» первого запуска): повторы
              продавцов из своих выписок, которые ещё не платежи, — под платежами месяца; «В платежи» — форма с заполнением
              (путь FB-09), после записи строка уходит.
            -->
            <div v-if="found.length" :class="dueLines.length ? 'mt-1 border-t border-line pt-1' : ''" data-found-list>
              <p class="py-1.5 text-[12.5px] text-ink-2">Нашли в выписке</p>
              <div v-for="f in found" :key="f.key" class="flex items-center gap-2.5 py-2" :data-found-row="f.opId">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[15px] font-semibold text-ink">{{ f.name }}</span>
                  <span class="block text-[12.5px] text-ink-2 num">≈ {{ f.day }}-го</span>
                </span>
                <span class="font-num text-[15px] font-semibold num text-ink">{{ money(f.amount) }}</span>
                <Button variant="secondary" size="xs" class="shrink-0" :data-found-pay="f.opId" @click="payOp = f.opId">В платежи</Button>
              </div>
            </div>
          </div>

          <!--
            Траты (FB-12, Р-7, Р-18): сверху у каждого участника одна строка «факт / план» без нажатия; ниже — «Мои разделы»:
            одна цифра у строки (факт; выписок нет — план), полоса факт/план, точка — трат больше обычного; нажатие — лист
            раздела (обычно, свой план, справка). Разделов партнёра нет; viewer — только строки участников.
          -->
          <div v-if="opened === 'spend' && s.key === 'spend'" class="pb-1" data-spends>
            <div v-for="l in lines" :key="l.by" class="flex flex-col gap-1 border-t border-line py-2.5 first:border-t-0" :data-spend-person="l.by">
              <span class="flex w-full items-center justify-between gap-2 text-[15px]">
                <span class="min-w-0 truncate text-ink">{{ l.name }}</span>
                <span class="whitespace-nowrap num" data-person-amount>
                  <template v-if="l.fact !== null"><b class="font-semibold text-ink">{{ l.plan ? plain(l.fact) : money(l.fact) }}</b><span v-if="l.plan" class="text-ink-2"> / {{ money(l.plan) }}</span></template>
                  <span v-else class="text-ink-2">план {{ money(l.plan) }}</span>
                </span>
              </span>
              <span v-if="l.plan" class="block h-[3px] w-full overflow-hidden rounded-pill bg-track">
                <i class="block h-full rounded-pill bg-s8" :style="{ width: `${spendShare(l.fact, l.plan)}%` }" />
              </span>
            </div>
            <p v-if="lines.length && canEdit" class="pb-1.5 pt-4 type-section" data-spend-mine>Мои разделы</p>
            <!-- Кнопка строки — название, растянутое на строку (`row-open`); ✦ совета ИИ — рядом своей кнопкой (RZ-10). -->
            <div
              v-for="r in compare.rows"
              :key="r.categoryId"
              class="press relative flex w-full cursor-pointer flex-col gap-1 border-t border-line py-2.5 text-left first:border-t-0"
              :data-spend-row="r.categoryId"
              :data-over="r.over || undefined"
              @click="catFor = r.categoryId"
            >
              <span class="flex w-full items-center justify-between gap-2 text-[15px]">
                <span class="flex min-w-0 items-center">
                  <button type="button" class="row-open min-w-0 truncate text-left text-ink" data-row-open :aria-describedby="`${uid}-s-${r.categoryId}`">
                    {{ r.name
                    }}<template v-if="r.over"><span class="ml-1.5 inline-block size-2 rounded-full bg-brand align-middle" data-spend-dot aria-hidden="true" /><span class="sr-only">, больше обычного</span></template>
                  </button>
                  <AdviceMark :n="ai.markFor('cat', r.categoryId)" />
                </span>
                <span :id="`${uid}-s-${r.categoryId}`" class="whitespace-nowrap num" data-spend-amount>
                  <b v-if="r.amount !== null" class="font-semibold text-ink">{{ money(r.amount) }}</b>
                  <span v-else class="text-ink-2">план {{ money(r.plan ?? 0) }}</span>
                </span>
              </span>
              <span v-if="r.plan" class="block h-[5px] w-full overflow-hidden rounded-pill bg-track">
                <i class="block h-full rounded-pill bg-s8" :style="{ width: `${spendShare(r.amount, r.plan)}%` }" />
              </span>
            </div>
            <!-- «Не разобрано» (Х-1): тихо, без точки, лист своих трат без раздела — чтобы строки сходились с «потрачено» заголовка -->
            <button
              v-if="compare.unknown > 0"
              type="button"
              class="press flex w-full cursor-pointer items-center justify-between gap-2 border-t border-line py-2.5 text-left text-[15px] text-ink-2 first:border-t-0"
              data-spend-unknown
              :disabled="!canEdit"
              @click="unknownOpen = true"
            >
              <span>Не разобрано</span>
              <span class="whitespace-nowrap num">{{ money(compare.unknown) }}</span>
            </button>
            <!-- «Разовые» (FB-07): так же тихо, но с листом своих разовых -->
            <button
              v-if="compare.oneOff > 0"
              type="button"
              class="press flex w-full cursor-pointer items-center justify-between gap-2 border-t border-line py-2.5 text-left text-[15px] text-ink-2 first:border-t-0"
              data-spend-oneoff
              @click="oneOffOpen = true"
            >
              <span>Разовые</span>
              <span class="whitespace-nowrap num">{{ money(compare.oneOff) }}</span>
            </button>
            <!-- «Платежи без отметки» (Х-6): как «Не разобрано» — строки разделов платежей без отметки, лист с «В платежи» -->
            <button
              v-if="compare.unmarkedPayments > 0"
              type="button"
              class="press flex w-full cursor-pointer items-center justify-between gap-2 border-t border-line py-2.5 text-left text-[15px] text-ink-2 first:border-t-0"
              data-spend-unmarked
              :disabled="!canEdit"
              @click="unmarkedOpen = true"
            >
              <span>Платежи без отметки</span>
              <span class="whitespace-nowrap num">{{ money(compare.unmarkedPayments) }}</span>
            </button>
            <button
              v-if="canEdit"
              type="button"
              class="press flex w-full cursor-pointer items-center border-t border-line py-2.5 text-left text-[14.5px] font-semibold text-ink-2 first:border-t-0"
              data-spend-add
              @click="editSpend(me)"
            >
              + Раздел
            </button>
            <p v-if="!lines.length && !canEdit" class="py-3 type-meta">Плана трат нет</p>
          </div>

          <!-- Цели и фонды по очереди: короткие строки; ⋮⋮ — выше раньше получает деньги; нажатие — «Отложил» -->
          <div v-if="opened === 'queue' && s.key === 'queue'" class="pb-1" data-queue-list>
            <div v-if="extras.closed" class="mb-2.5 flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-closed>
              <span class="min-w-0 flex-1">{{ extras.closed.name }} закрыт · {{ money(extras.closed.amount) }}</span>
              <Button size="sm" :variant="pending.length ? 'secondary' : 'default'" @click="onClosed">Отложить</Button>
            </div>
            <div v-if="pending.length" class="pb-2 pt-0.5">
              <Button size="sm" data-put-all @click="savePuts(pending)">Отложил всё · {{ money(pendingTotal) }}</Button>
            </div>
            <SortableList
              :ids="queueIds"
              :disabled="!canEdit"
              :label="(id) => `Переставить: ${queueById.get(id)?.name ?? ''}`"
              @move="(id, i) => finance.moveInQueue(id, i)"
            >
              <template #default="{ id }">
                <template v-if="queueById.get(id)">
                  <div
                    class="press relative flex cursor-pointer items-center gap-2.5 py-2.5"
                    :data-queue="id"
                    @click="openItem(queueById.get(id)!)"
                  >
                    <!-- Кнопка строки — название (растянута `row-open`); ✦ совета ИИ про цель или долг — рядом (RZ-11). -->
                    <span class="flex min-w-0 flex-1 flex-col gap-px">
                      <span class="flex min-w-0 items-center">
                        <button
                          type="button"
                          class="row-open min-w-0 truncate text-left text-[15.5px] font-semibold"
                          :class="queueById.get(id)!.paused ? 'text-ink-2' : 'text-ink'"
                          data-row-open
                          :aria-describedby="statusOf(queueById.get(id)!) ? `${uid}-q-${id} ${uid}-g-${id}` : `${uid}-g-${id}`"
                        >
                          {{ queueById.get(id)!.name }}
                        </button>
                        <AdviceMark :n="queueMark(queueById.get(id)!)" />
                      </span>
                      <span v-if="statusOf(queueById.get(id)!)" :id="`${uid}-q-${id}`" class="text-[12px] num" :class="statusOf(queueById.get(id)!)!.warn ? 'text-warn' : 'text-ink-2'" data-status>
                        {{ statusOf(queueById.get(id)!)!.text }}
                      </span>
                    </span>
                    <button
                      v-if="canEdit && queueById.get(id)!.payer"
                      type="button"
                      data-no-drag
                      class="press relative z-10 shrink-0 cursor-pointer rounded-full"
                      :aria-label="`Платит ${personName(queueById.get(id)!.payer)}. Сменить`"
                      @click.stop="
                        payerFor = {
                          kind: queueById.get(id)!.kind === 'debt' ? 'debt' : 'goal',
                          id: queueById.get(id)!.goalId ?? DEBT_CARD,
                          name: queueById.get(id)!.name,
                          payer: queueById.get(id)!.payer,
                        }
                      "
                    >
                      <Avatar :id="queueById.get(id)!.payer!" :name="personName(queueById.get(id)!.payer)" :size="24" />
                    </button>
                    <Avatar v-else-if="queueById.get(id)!.payer" :id="queueById.get(id)!.payer!" :name="personName(queueById.get(id)!.payer)" :size="24" />
                    <span
                      :id="`${uid}-g-${id}`"
                      class="font-num text-[15px] num whitespace-nowrap"
                      :class="putById.get(id)?.done || queueById.get(id)!.paused ? 'font-semibold text-ink-2' : 'font-bold text-ink'"
                      data-given
                    >
                      <span v-if="putById.get(id)?.done" class="font-extrabold text-ok" data-put-done>✓ </span>{{ money(queueById.get(id)!.given) }}
                    </span>
                    <span v-if="canEdit" data-no-drag class="relative z-10 shrink-0" @click.stop>
                      <Toggle
                        :model-value="queueById.get(id)!.paused !== 'off'"
                        :label="queueById.get(id)!.name"
                        tone="ok"
                        @update:model-value="toggle(id, $event)"
                      />
                    </span>
                  </div>
                  <!-- Одна готовая подсказка (Р-83): весь свободный остаток — в долг -->
                  <div v-if="id === DEBT_CARD && debtTip" class="mb-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-debt-tip>
                    Всё в долг — закроете {{ by(debtTip.month) }}
                  </div>
                </template>
              </template>
            </SortableList>
            <button
              v-for="k in missingFunds"
              :key="k"
              type="button"
              class="press flex w-full cursor-pointer items-center border-t border-line py-2.5 text-left text-[14.5px] font-semibold text-ink-2 first:border-t-0"
              @click="addFund(k)"
            >
              + {{ k === 'reserve' ? 'Запас' : 'Подушка' }}
            </button>
            <p v-if="!queueIds.length && !missingFunds.length" class="py-3 type-meta">Целей нет</p>
          </div>
        </template>
        </div>
        </Tip>
    </Card>

    <!--
      Зарплаты — ниже разделов (Figma `18:167`): строка нажимается — лист зарплаты (дата, «хватает ли», приходы по ритму
      «N из M пришли», обмены — там, Р-116); пришла (месячный ритм — `came`; по ритму — все приходы) — строка подсвечена
      `--ok-soft` (владелец 2026-10-23: без ✓ и «0 из 2 пришли»); ждущая — сумма тоже чёрная (К-8, FG-08; «≈» у плавающей). «Обменял» — у
      своей пришедшей валютной, в строке; «Пришла» — у своей открытой, в строке (PN-02, правило 12: действие у предмета;
      та же отметка, что в листе — `useSalaryTap`).
    -->
    <Card v-if="salaries.length || canEdit" tight class="flex flex-col gap-1">
      <template v-for="(s, i) in salaries" :key="s.person">
        <div v-if="i > 0" class="mx-0 h-px bg-line" />
        <div
          class="press relative -mx-2 flex cursor-pointer items-center gap-2.5 rounded-[12px] px-2 py-2"
          :class="s.came && 'bg-ok-soft'"
          :data-salary="s.person"
          :data-can-mark="s.canMark || undefined"
          :data-came="s.came || undefined"
          @click="salaryFor = s.person"
        >
          <Avatar :id="s.person" :name="s.name" :size="30" />
          <!-- Лист открывает и viewer — только чтение: дата и «хватает» живут лишь там (критик Б17). -->
          <button type="button" class="row-open flex min-w-0 flex-1 flex-col gap-px text-left" data-row-open>
            <span class="truncate text-[16px] font-semibold text-ink">{{ s.name }}</span>
          </button>
          <span v-if="s.came && s.foreign" class="relative z-10 shrink-0" @click.stop>
            <SalaryExchange :person-id="s.person" :period="monthKey" part="button" />
          </span>
          <!--
            Одна отметка на счёт прошлого раза, лист строки не открывает; без прошлого счёта — лист отметки.
            Кнопка — в слоте «Обменял», слева от суммы (/ux Блока 1 «понятность»): суммы строк в одной колонке
            и до, и после отметки, число не прыгает.
          -->
          <span v-if="s.canMark" class="relative z-10 shrink-0" @click.stop>
            <SalaryRow button small :person-id="s.person" :period="monthKey" />
          </span>
          <div class="flex flex-col items-end">
            <b class="font-num text-[16px] num whitespace-nowrap text-ink">{{ s.floating && !s.came ? '≈ ' : '' }}{{ money(s.amount) }}</b>
            <span v-if="s.fx" class="text-[12.5px] font-semibold text-ink-2 num whitespace-nowrap" data-salary-fx>{{ moneyIn(s.fx.amount, s.fx.currency) }}</span>
          </div>
        </div>
      </template>
      <template v-if="canEdit">
        <div v-if="salaries.length" class="h-px bg-line" />
        <!-- Свой оклад не указан (Р-37) — тихая «+ Зарплата» → «Изменить оклад» (`SalaryDialog`); партнёр без оклада — его дело. -->
        <div v-if="noSalary"><Button variant="ghost" size="sm" class="-ml-2" data-add-salary @click="salaryEdit = me">+ Зарплата</Button></div>
        <div><Button variant="ghost" size="sm" class="-ml-2" data-extra-income @click="incomeOpen = true">+ Внеплановый доход</Button></div>
      </template>
    </Card>

    <!-- Итога «Отложим · Потратим · Остаётся» нет (Р-116): повтор кольца и строк разделов. -->

    <!-- Зарплата: своя и ждём — «Пришла» (и «Другая сумма или счёт»); тихо — отметка пришедшей и «Изменить оклад» -->
    <SalarySheet :month-key="monthKey" :line="salarySheet" @close="salaryFor = null" />
    <ExtraIncomeSheet :open="incomeOpen" @close="incomeOpen = false" />
    <AffordSheet :open="affordOpen" @close="closeAfford" />
    <AiReport
      :open="reviewOpen && reviewShown"
      :month-key="monthKey"
      :review="review"
      :example="auth.isDemo"
      :card="reviewCard"
      :cards="v4Cards"
      @close="closeReview"
      @refresh="refreshReview"
      @act="reviewAct"
    />

    <!-- Платёж: одна кнопка «Оплатил»; тихо — «Изменить платёж» -->
    <Sheet :open="!!paySheet" :title="paySheet?.name ?? ''" @close="payFor = null">
      <template v-if="paySheet">
        <p class="type-meta">{{ dayLabel(paySheet.day, monthKey) }}{{ paySheet.payer ? ` · платит ${personName(paySheet.payer)}` : '' }}</p>
        <p class="mb-3 font-num text-[32px] font-bold leading-tight num text-ink">{{ dueNote(paySheet) ? '≈ ' : '' }}{{ money(paySheet.amount) }}</p>
        <div class="flex flex-col gap-1.5">
          <template v-if="paySheet.paid">
            <p class="p-1 text-center text-[14px] font-semibold text-ok" data-paid>{{ givenDue(paySheet) ? '✓ Отдал' : '✓ Оплачено' }}</p>
            <Button variant="ghost" size="md" class="w-full" data-unpay @click="unpay(paySheet)">Не оплачено</Button>
          </template>
          <Button v-else class="w-full" data-pay @click="pay(paySheet)">{{ givenDue(paySheet) ? 'Отдал' : 'Оплатил' }}</Button>
          <Button variant="ghost" size="md" class="w-full" @click="editDue(paySheet)">Изменить платёж</Button>
        </div>
      </template>
    </Sheet>
    <MarkSheet
      v-if="markFor"
      open="mark"
      :kind="markFor.due.kind"
      :target-id="markFor.due.targetId"
      :period="monthKey"
      :title="markFor.due.name"
      :amount="markFor.due.amount"
      :account="markFor.account"
      :first-time="markFor.account === undefined"
      @close="markFor = null"
    />

    <!-- Цель: одна кнопка «Отложил»; отложенное планом — «Не отложено» -->
    <Sheet :open="!!putSheet" :title="putSheet?.name ?? ''" @close="putFor = null">
      <template v-if="putSheet">
        <p class="type-meta">{{ monthName }}{{ putSheet.payer ? ` · откладывает ${personName(putSheet.payer)}` : '' }}</p>
        <p class="mb-3 font-num text-[32px] font-bold leading-tight num text-ink">{{ money(putSheet.amount) }}</p>
        <div class="flex flex-col gap-1.5">
          <template v-if="putSheet.done">
            <p class="p-1 text-center text-[14px] font-semibold text-ok" data-put>✓ Отложено</p>
            <Button v-if="putSheet.undo > 0" variant="ghost" size="md" class="w-full" data-unput @click="onUnput(putSheet)">Не отложено</Button>
          </template>
          <template v-else>
            <p v-if="putSheet.put > 0" class="text-center type-meta num">уже отложено {{ money(putSheet.put) }}</p>
            <Button class="w-full" data-put-one @click="onPut(putSheet)">Отложил{{ putSheet.put > 0 ? ` · ${money(putSheet.left)}` : '' }}</Button>
          </template>
          <Button variant="ghost" size="md" class="w-full" @click="openDetail(putSheet)">{{ putSheet.kind === 'debt' ? 'Сумма в месяц' : 'Открыть цель' }}</Button>
        </div>
      </template>
    </Sheet>

    <!-- Кто платит — одно нажатие, кнопки нет -->
    <Sheet :open="!!payerFor" :title="payerFor ? `Кто платит: ${payerFor.name.toLowerCase()}?` : ''" @close="payerFor = null">
      <div class="flex flex-col gap-2">
        <button
          v-for="p in people"
          :key="p.id"
          type="button"
          class="press flex cursor-pointer items-center gap-3 rounded-[16px] border-[1.5px] px-3.5 py-3 text-left text-[16px] font-semibold text-ink"
          :class="payerFor?.payer === p.id ? 'border-ink bg-surface-2' : 'border-line'"
          @click="pick(p.id)"
        >
          <Avatar :id="p.id" :name="p.name" :size="34" />{{ p.name }}
          <span v-if="payerFor?.payer === p.id" class="ml-auto font-extrabold text-ok">✓</span>
        </button>
        <p class="text-center text-[12.5px] text-ink-2">С {{ monthFrom(monthKey, false) }} и дальше</p>
      </div>
    </Sheet>

    <!-- Раздел трат: факт, обычно, план, «до плана», справка РК; план каждого — «Изменить» (member) -->
    <!-- Прошлый месяц (план до отложенной зарплаты) — без «Изменить»: план раздела общий на будущее (Х-9, RZ-13). -->
    <SpendCategorySheet
      :row="catRow"
      :rk="catRk"
      :plans="catPlans"
      :can-edit="canEdit && sheetMonth >= monthNow()"
      :image="catImage"
      :month="sheetMonth"
      :ops="catOps"
      :none="catNone"
      :z="sheetZ"
      @close="closeCat"
      @edit="editCatPlan"
      @image="imageAct"
      @more="catAll = true"
      @open="(id) => (catOp = id)"
      @hand="openCatHand"
    />
    <Sheet :open="oneOffOpen && canEdit" title="Разовые" @close="closeOneOff">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-oneoff-amount>{{ money(compare.oneOff) }}</p>
      <p class="mt-1 text-[14px] text-ink-2">не входят в обычные траты</p>
      <SectionOpsList v-if="oneOffOps" :ops="oneOffOps" @more="oneOffAll = true" @open="(id) => (catOp = id)" @hand="openCatHand" />
    </Sheet>
    <Sheet :open="unknownOpen && canEdit" title="Не разобрано" :z="sheetZ" @close="closeUnknown">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-unknown-amount>{{ money(sheetCompare.unknown) }}</p>
      <p class="mt-1 text-[14px] text-ink-2">траты без раздела</p>
      <SectionOpsList v-if="unknownOps" :ops="unknownOps" data-unknown-ops @more="unknownAll = true" @open="(id) => (catOp = id)" @hand="openCatHand" />
    </Sheet>
    <Sheet :open="unmarkedOpen && canEdit" title="Платежи без отметки" :z="sheetZ" @close="closeUnmarked">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-unmarked-amount>{{ money(compare.unmarkedPayments) }}</p>
      <p class="mt-1 text-[14px] text-ink-2">ещё не в платежах</p>
      <SectionOpsList
        v-if="unmarkedOps"
        :ops="unmarkedOps"
        @more="unmarkedAll = true"
        @open="(id) => (catOp = id)"
        @hand="openCatHand"
        @pay="(id) => (payOp = id)"
      />
    </Sheet>
    <OpSheet :op-id="catOp" :z="sheetZ + 10" @close="catOp = null" />
    <AddPaymentSheet :op-id="payOp" :z="sheetZ + 20" @close="payOp = null" />
    <HandSpendSheet v-if="canEdit" :open="catHand !== null" :op-id="catHand" @close="catHand = null" />
    <ImageMoveSheet :action="moveAction" :z="sheetZ" @close="moveAction = null" />

    <!-- Сумма раздела трат -->
    <Sheet :open="!!spendEdit" :title="spendEdit?.fresh ? 'Траты на месяц' : 'Сколько в месяц'" :z="sheetZ" @close="spendEdit = null">
      <template v-if="spendEdit">
        <Field v-if="spendEdit.fresh" label="Раздел" name="category">
          <Select v-model="spendEdit.categoryId" :options="categories.map((c) => ({ value: c.id, label: c.name }))" class="mb-3" />
        </Field>
        <!-- Новый раздел в семье из двух — чей план (участник по умолчанию — свой) -->
        <Field v-if="spendEdit.fresh && people.length > 1" label="Чей" name="by">
          <Select v-model="spendEdit.by" :options="people.map((p) => ({ value: p.id, label: p.name }))" class="mb-3" data-spend-by />
        </Field>
        <Field :label="spendEdit.fresh && people.length > 1 ? '₸ в месяц' : `${personName(spendEdit.by)}, ₸ в месяц`">
          <NumField v-model="spendEdit.amount" placeholder="50 000" />
        </Field>
        <Button class="w-full" @click="spendForm.submit(saveSpend)">Готово</Button>
      </template>
    </Sheet>

    <!-- Сумма карточки «закрыть кредит» -->
    <Sheet :open="debtEdit !== null" :title="debtName || 'Закрыть кредит'" @close="debtEdit = null">
      <template v-if="debtEdit !== null">
        <Field label="Сверх графика, ₸ в месяц">
          <NumField v-model="debtEdit" placeholder="50 000" />
        </Field>
        <Button class="w-full" @click="saveDebt">Готово</Button>
      </template>
    </Sheet>

    <!-- «+ Зарплата» без оклада (Р-37) — тот же лист, что «Изменить оклад» -->
    <SalaryDialog v-if="canEdit" :id="salaryEdit" @close="salaryEdit = null" />

    <!--
      «План трат» (Р-36, Figma `19:178`): разделы из «обычно по неделям» — первые 3 и «ещё N ▾» брендом (К-15: видно, что раскрывается) · Σ,
      внизу одна брендовая «Установить» (Р-14 «Figma») (подтверждение в листе — правило 12) → план мне по каждой строке, тост.
    -->
    <Sheet :open="planFactOpen && !!planFact" title="План трат" @close="planFactOpen = false">
      <template v-if="planFact">
        <div class="flex flex-col" data-plan-fact-sheet>
          <div v-for="r in planFactRows" :key="r.categoryId" class="flex items-center gap-2.5 border-t border-line py-2.5 first:border-t-0" :data-plan-fact-row="r.categoryId">
            <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: spendColorOf(r.categoryId) }" aria-hidden="true">{{ r.name.slice(0, 1).toUpperCase() }}</span>
            <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ r.name }}</span>
            <span class="font-num text-[16px] font-bold num text-ink">{{ money(r.amount) }}</span>
          </div>
          <button
            v-if="!planFactAll && planFact.rows.length > PLAN_FACT_TOP"
            type="button"
            class="press flex w-full cursor-pointer items-center justify-between gap-2 border-t border-line py-2.5 text-left text-[14.5px] text-ink-2 num"
            data-plan-fact-more
            @click="planFactAll = true"
          >
            <span class="flex items-center gap-1 font-semibold text-brand">ещё {{ planFact.rows.length - PLAN_FACT_TOP }}<PhCaretDown :size="14" aria-hidden="true" /></span>
            <span>{{ money(planFact.rows.slice(PLAN_FACT_TOP).reduce((s, r) => s + r.amount, 0)) }}</span>
          </button>
          <div class="flex items-center justify-between gap-2 border-t border-line pt-3 text-[13px] text-ink-2 num">
            <span>обычно в месяц</span>
            <b class="font-num text-[16px] font-bold text-ink">{{ money(planFact.total) }}</b>
          </div>
        </div>
        <Button size="lg" class="mt-4 w-full" data-plan-fact-save @click="savePlanFact">Установить</Button>
      </template>
    </Sheet>

    <!-- «Ближе на N дней» (PN-09): тост после «Отложил», в оболочке — над вкладками -->
    <Toast v-if="closerNote"><span data-closer>{{ closerNote }}</span></Toast>
    <Toast v-else-if="planFactNote"><span data-plan-fact-done>{{ planFactNote }}</span></Toast>
  </div>
</template>
