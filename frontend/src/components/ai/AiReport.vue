<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhCaretRight, PhCheck, PhCircleNotch, PhSparkle, PhX } from '@phosphor-icons/vue'
import { aiLimitText, useAiStore } from '@/stores/ai'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { AiAdvice, AiReview, ReviewPayload, ReviewPayloadV3, ReviewPayloadV4, ReviewReason } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { factsLines, openPath } from '@/lib/aiFacts'
import { findMonth, reviewCardOrder, reviewOutcome, reviewWorkMonthly, shiftMade, spendCategoryName, stepCandidates, whereRows, whereSplit, type ReviewCard, type StepCandidate } from '@/lib/finance'
import { weekendShare } from '@/lib/statements/finds'
import { shortMerchant } from '@/lib/statements/model'
import { useOperationsStore } from '@/stores/operations'
import { money, plain } from '@/lib/money'
import { MONTHS_NOM, addMonths, dayLabel, monthBy, monthIn, parseMonthKey, today } from '@/lib/dates'
import { plural } from '@/lib/utils'
import { holdTips } from '@/components/kit/tips'
import { isTopSheet, popSheet, pushSheet } from '@/components/kit/sheetStack'
import Toast from '@/components/kit/Toast.vue'
import { useFlash } from '@/components/kit/useFlash'
import Button from '@/components/ui/Button.vue'
import DoSheet from '@/components/plan/DoSheet.vue'
import WhereBars from './WhereBars.vue'
import WhereSplit from './WhereSplit.vue'

/**
 * Отчёт разбора месяца (бэклог «Разбор», Р-2, Р-15, Р-17, RZ-07) — на весь экран поверх «Месяца», листаемые карточки
 * (как Stories): «Работа ИИ» (счётчик кода на момент разбора) → «Куда ушло» (полосы кода за месяц находок и строка модели)
 * → советы (до 3, у каждого одна кнопка: «Сделать» → `DoSheet` поверх или «Открыть» — экран предмета) → «Итог прошлого
 * месяца» (только по v3 прошлого месяца, считает `reviewOutcome`). Разбор v1/v2 — одной карточкой «Разбор»; разбора нет —
 * одна карточка состояния («Думаю…», лимит, «Не вышло»). Листается свайпом (`scroll-snap`), нажатием по правой / левой
 * трети и стрелками; ✕, Escape и свайп вниз — закрыть; соседние карточки `inert`, Tab — по кругу внутри. Внизу последней карточки тихо — день, «что ушло» и «Обновить». Viewer — без
 * «Сделать» («Открыть» — чтение, есть). Пример демо — `example`: без дня и «Обновить». Все числа — из `finance.ts` и
 * сохранённого разбора; здесь — показ.
 *
 * v4 (бэклог «Фидбек», Р-23…Р-25, Р-27, FB-17) — свой отчёт участника, когда родитель передал `cards` (карточки кода
 * `reviewCards` по своим операциям, свежие на открытие): «Работа ИИ» (у своего v4) → мысль модели (`lead`; без ИИ, брак
 * или нет разбора — нет) → карточка `next` → остальные карточки → «Куда ушло» на всю сумму. У карточки кода — заголовок,
 * одна крупная цифра, одна строка и одна кнопка: «Сделать» — `DoSheet` здесь, «Обновить сумму» — экран платежа, прочие —
 * событие `act`, лист открывает «Месяц» поверх отчёта. ✓ у цифры — после нажатия карточка в свежих изменилась или ушла.
 */
const props = defineProps<{
  open: boolean
  monthKey: string
  /** Разбор месяца; нет — состояние запроса. */
  review: AiReview | null
  /** Заготовка демо (Р-12): пометка «Пример», без дня и «Обновить». */
  example?: boolean
  /** Номер совета 1…3 (v4 — карточки кода по порядку отчёта) — отчёт стартует с его карточки (✦ у предмета); нет — с первой. */
  card?: number | null
  /** Карточки кода v4 (свежие); нет — отчёт v1–v3 как был (viewer, старые разборы). */
  cards?: ReviewCard[] | null
}>()
const emit = defineEmits<{ close: []; refresh: []; act: [card: ReviewCard] }>()

const ai = useAiStore()
const auth = useAuthStore()
const finance = useFinanceStore()
const route = useRoute()

const DAY_MS = 86_400_000
/** «Обновить» — не чаще раза в день (Р-4): только участнику с ИИ без «Не надо» (Р-9) и разбору старше суток. */
const canRefresh = computed(
  () =>
    !props.example &&
    !!props.review &&
    auth.isMember &&
    ai.available &&
    ai.consent !== 'off' &&
    ai.reviewState !== 'thinking' &&
    Date.now() - Date.parse(props.review.at) >= DAY_MS,
)

/**
 * Число не рвётся строкой (стенд: «95 / 000 ₸»): модель пишет разряды обычным пробелом — на показе он неразрывный,
 * как у `money()`; так же пробел перед «₸», «%» и словом «тенге». Разряды, которых модель не поставила («499641»), — как
 * `plain`; годы не задевает. Текст в документе не меняется.
 */
const NBSP = ' '
const keep = (t: string) =>
  t
    .replace(/(?<![\d,.])\d{5,}(?![\d,.])/g, (d) => plain(Number(d)))
    .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
    .replace(/(\d) (?=[₸%]|тенге)/g, `$1${NBSP}`)

/** Слова состояний запроса. Лимит — с месяцем: «1-го» заставляло думать, какого (владелец). */
const stateText = computed(() =>
  ai.reviewState === 'thinking'
    ? 'Думаю…'
    : ai.reviewState === 'limit'
      ? aiLimitText()
      : ai.reviewState === 'failed'
        ? 'Не вышло. Попробуйте позже'
        : 'Разбора пока нет',
)

const input = computed(() => finance.planInput(props.monthKey))
const made = (c: StepCandidate, period = props.monthKey) => shiftMade(finance.householdDoc.planShifts ?? [], { ...c.shift, period })
/** Свежие кандидаты кода — «Сделать» ещё применим (тот же id), цифры листа — свежие, не из сохранённого разбора. */
const live = computed(() => (auth.isViewer ? [] : stepCandidates(input.value.state, input.value.ctx)))

/* ---------- v4: свой отчёт — мысль модели и карточки кода (бэклог «Фидбек», Р-23…Р-25, Р-27) ---------- */
/**
 * Отчёт v4 — участнику (родитель дал карточки), когда разбор месяца свой v4 или его нет. Разбор v1–v3 общего документа
 * (сборка до v4) показывается как был, пока не придёт свой v4 (`aiReviewOf` берёт его первым).
 */
const v4 = computed(() => !!props.cards && (!props.review || props.review.v === 4))
/** Свой разбор v4 месяца — мысль, следующая карточка, счётчик. */
const mine = computed(() => (v4.value && props.review?.v === 4 ? props.review : null))
const ordered = computed(() => (props.cards ? reviewCardOrder(props.cards, mine.value?.next) : []))
/**
 * Снимок карточек на открытие: порядок не прыгает, пока человек действует; ✓ — когда после своей кнопки карточка в
 * свежих изменилась или ушла (разовая отмечена, платёж заведён, план поставлен), у «Сделать» — сдвиг месяца сделан.
 */
const frozen = ref<ReviewCard[]>([])
const acted = ref(new Set<string>())
function freeze() {
  frozen.value = ordered.value
  acted.value = new Set()
}
// Карточки пришли позже открытия (операции подтянулись) — снимок берёт их.
watch(ordered, (list) => {
  if (!frozen.value.length && list.length) frozen.value = list
})
// Мысль пришла при открытом отчёте («Думаю…» → ответ, «Обновить») — её `next` встаёт следом, пока человек не нажимал
// кнопок (Р-23; номер ✦ `card=n` считается тем же порядком — критик 4б).
watch(
  () => mine.value?.id,
  () => {
    if (!acted.value.size && ordered.value.length) frozen.value = ordered.value
  },
)
/** Карточки-списки: разобрал одну трату из многих — кнопка остаётся, ✓ — когда карточка ушла (критик 4б). */
const LIST_CARDS: ReviewCard['kind'][] = ['unknown', 'people', 'cash']
function isDone(c: ReviewCard): boolean {
  if (c.target.kind === 'do') return made(c.target.candidate)
  if (!acted.value.has(c.id)) return false
  const now = props.cards?.find((x) => x.id === c.id)
  if (LIST_CARDS.includes(c.kind)) return !now
  return !now || JSON.stringify(now) !== JSON.stringify(c)
}
/**
 * «Отметить разовой» («Похоже на разовую», «Дорогая неделя») — одним нажатием, без листа: раздел траты не меняется
 * (владелец 2026-10-22, Х-16); строка карточки — «<продавец> · <раздел> · разовая», её нажатие — лист операции; тост с
 * «Отменить».
 */
const ONE_OFF_CARDS: ReviewCard['kind'][] = ['oneoff', 'week']
const ops = useOperationsStore()
const { note: oneOffNote, flash: oneOffFlash, clear: oneOffClear } = useFlash(6000)
const undoOp = ref<string | null>(null)
function markOneOff(opId: string) {
  ops.editOp(opId, { oneOff: true })
  undoOp.value = opId
  oneOffFlash('Отметили разовой')
}
function undoOneOff() {
  if (undoOp.value) ops.editOp(undoOp.value, { oneOff: null })
  undoOp.value = null
  oneOffClear()
}
/** Строка отмеченной разовой: продавец, раздел (как был), «разовая». */
function oneOffLine(c: ReviewCard): string | null {
  if (!ONE_OFF_CARDS.includes(c.kind) || c.target.kind !== 'op' || !isDone(c)) return null
  const op = ops.all.find((o) => o.id === (c.target as { opId: string }).opId)
  if (!op?.oneOff) return null
  return [shortMerchant(op.merchant), op.categoryId ? spendCategoryName(input.value.ctx.spendCategories, op.categoryId) : null, 'разовая'].filter(Boolean).join(' · ')
}
function press(c: ReviewCard) {
  acted.value = new Set([...acted.value, c.id])
  if (c.target.kind === 'do') doCandidate.value = c.target.candidate
  else if (ONE_OFF_CARDS.includes(c.kind) && c.target.kind === 'op') markOneOff(c.target.opId)
  else if (c.target.kind !== 'obligation') emit('act', c)
}
// «Дорогая неделя» — на сколько дороже обычной: «+45 %», а не «45 %» неизвестно чего (`/ux` 4б).
const figureOf = (c: ReviewCard) => (c.figure.unit === 'pct' ? `${c.kind === 'week' ? '+' : ''}${c.figure.value} %` : money(c.figure.value))
/**
 * Крупная цифра мысли — нет, если ту же цифру показывает карточка `next` следом: два экрана подряд одно число
 * (владелец 2026-10-22, Х-15); текст мысли остаётся.
 */
const flat = (s: string) => s.replace(/\s/g, '')
const leadFigure = computed(() => {
  const f = mine.value?.lead?.figure
  if (!f) return null
  const next = frozen.value.find((c) => c.id === mine.value?.next)
  return next && flat(figureOf(next)) === flat(f.value) ? null : f
})
const by = computed(() => ai.me)
/** Месяц карточек v4 — по своим выпискам (`findMonth(…, by)`, как `reviewCards`); в первые дни — прошлый. */
const cardMonth = computed(() => findMonth(input.value.ctx, by.value))
/** Карточки не за открытый месяц (первые дни) — его имя в шапке отчёта: «Выше плана» иначе читается про этот (`/ux` 4б). */
// Карточек нет («Нужна выписка») — месяца в шапке тоже нет: он ни к чему не относится.
const pastMonth = computed(() => (v4.value && !props.example && props.cards?.length && cardMonth.value !== props.monthKey ? MONTHS_NOM[parseMonthKey(cardMonth.value).month] : ''))
/** «Куда ушло» v4: на всю сумму (`whereSplit`), выходные — по своим операциям, разделы продавцов — свои (`whereRows`). */
const split = computed(() => (v4.value ? whereSplit(input.value.state, input.value.ctx, by.value) : null))
const weekend = computed(() => (split.value ? weekendShare(ops.all, split.value.month, input.value.ctx.spendCategories) : null))
const rowsV4 = computed(() => (v4.value ? whereRows(input.value.state, input.value.ctx, 5, by.value) : []))

/* ---------- v3: советы ---------- */
const v3 = computed(() => !v4.value && props.review?.v === 3)
/** Месяц картинки «Куда ушло» — месяц находок; строки и «Открыть» раздела ведут в лист этого месяца (Х-9, RZ-13). */
const pictureMonth = computed(() => findMonth(input.value.ctx))
type AdviceRow = { i: number; a: AiAdvice; made: boolean; fresh: StepCandidate | null; path: string | null }
/**
 * Кнопка совета (Р-6): «Открыть» — экран предмета; «Сделать» — участнику, кандидат ещё применим; сделан — «✓ Сделано».
 * «Сделать», чей кандидат устарел (остаток месяца потрачен, план раздела переписан), — «Открыть» той же цели (мечта,
 * подушка) или «Долгов»: голого текста без кнопки нет (клинап Блока 1, ревью frontend Н-5; решение исполнителя RZ-07 —
 * `/ux` посмотреть). Viewer у «Сделать» — без кнопки (Р-12).
 */
const advices = computed<AdviceRow[]>(() =>
  (v3.value ? props.review?.advices ?? [] : []).map((a, i) => {
    // Раздел — лист того месяца, что на картинке «Куда ушло» (Х-9, RZ-13).
    if (a.action.kind === 'open') return { i, a, made: false, fresh: null, path: openPath(a.action.target, pictureMonth.value) }
    const c = a.action.candidate
    const isMade = made(c)
    const fresh = isMade || auth.isViewer ? null : live.value.find((x) => x.id === c.id) ?? null
    const to = c.shift.to
    const stale = !isMade && !fresh && !auth.isViewer ? (to === 'debt' ? '/money/debts' : `/goals/${encodeURIComponent(to.goalId)}`) : null
    return { i, a, made: isMade, fresh, path: stale }
  }),
)
/**
 * Подпись крупной цифры (RZ-15: «в месяц · Магазин у дома»; у разборов до «Фидбек» Р-19 — «за год · …», как сохранены);
 * имя после « · », которое уже есть в заголовке совета, второй раз не пишем — «Магазин у дома» над «в месяц» (`/ux`
 * Блока 3: шумная подпись). Разбор до RZ-15 — `about`.
 */
function figureLabel(a: AiAdvice): string {
  const label = a.figure?.label
  if (!label) return a.figure?.about ?? ''
  const cut = label.lastIndexOf(' · ')
  const name = cut > 0 ? label.slice(cut + 3).toLowerCase() : ''
  return name && a.title.toLowerCase().includes(name) ? label.slice(0, cut) : label
}

/**
 * «Работа ИИ» (Р-8; вид — владелец 2026-10-19, RZ-14; месяц — «Фидбек» Р-19): числа кода на момент разбора. Есть деньги
 * находок советов (X > 0) — крупно «≈ X ₸», подпись «в месяц уходит на найденное», строкой «K находок из N операций»;
 * X = 0 — крупно N операций, «нашёл K». Разбор до Р-19 хранит ₸ в год — показываем его месяцем (`reviewWorkMonthly`).
 */
const work = computed(() => {
  const w = v3.value || mine.value ? props.review?.work : undefined
  if (!w) return null
  const monthly = reviewWorkMonthly(w)
  if (monthly > 0)
    return {
      big: `≈ ${money(monthly)}`,
      word: 'в месяц уходит на найденное',
      line: `${w.found} ${plural(w.found, 'находка', 'находки', 'находок')} из ${plain(w.ops)} ${plural(w.ops, 'операции', 'операций', 'операций')}`,
    }
  return {
    big: plain(w.ops),
    word: plural(w.ops, 'операция просмотрена', 'операции просмотрены', 'операций просмотрено'),
    line: `нашёл ${w.found}`,
  }
})

/** День разбора по Алматы — «17 октября» (Х-18): текст хранит цифры своего дня. У «Примера» демо дня нет. */
const reviewDay = computed(() => {
  if (props.example || !props.review) return null
  const d = today(new Date(props.review.at))
  return dayLabel(d.day, d.key)
})
const REASON: Record<ReviewReason, string> = { month: 'начался месяц', salary: 'после зарплаты', refresh: 'обновили' }
/** Повод и день — тихо под счётчиком: «1 октября · начался месяц». У «Примера» демо — ни дня, ни повода. */
const whenLine = computed(() =>
  props.example ? '' : [reviewDay.value, props.review?.reason ? REASON[props.review.reason] : null].filter(Boolean).join(' · '),
)

/* ---------- «Куда ушло» (Р-4): полосы считает код за месяц находок ---------- */
const whereMonth = computed(() => `в ${monthIn(v4.value ? cardMonth.value : pictureMonth.value, false)}`)
const rows = computed(() => (v3.value ? whereRows(input.value.state, input.value.ctx) : []))
/** Полосы растут, когда карточку «Куда ушло» впервые видно: карточки монтируются сразу, рост шёл за кадром (`/ux`). */
const whereSeen = ref(false)

/* ---------- «Итог прошлого месяца» (Р-10, Р-20): только по v3 прошлого месяца ---------- */
const outcome = computed(() => {
  if (!v3.value || props.example) return null
  const o = reviewOutcome(input.value.state, input.value.ctx, finance.aiReviewOf(addMonths(props.monthKey, -1)))
  return o && (o.done.length || o.sections.length || o.dream) ? o : null
})
const dreamLine = computed(() => {
  const d = outcome.value?.dream
  if (!d) return null
  if (!d.now) return { now: 'срока нет', was: `было ${d.was}` }
  if (d.now === d.was) return { now: d.now, was: 'срок тот же' }
  return { now: d.now, was: `было ${d.was}` }
})

/* ---------- v1/v2: одна карточка «Разбор» (Р-15) ---------- */
const v2 = computed(() => props.review?.v === 2)
const v2Saved = computed(() => (v2.value ? props.review?.step?.candidate ?? null : null))
const v2Done = computed(() => !!v2Saved.value && made(v2Saved.value))
const v2Fresh = computed(() => {
  const c = v2Saved.value
  if (!c || v2Done.value) return null
  return live.value.find((x) => x.id === c.id) ?? null
})
/** Шаг v1 на экран, где отчёт открыт (`/month`), — не ссылка: она только закрывала окно (Х-13). */
const linkOf = (screen: string | null) => (screen && screen !== route.path ? screen : null)

/* ---------- карточки по порядку (Р-2) ---------- */
type Card =
  | { kind: 'work' }
  | { kind: 'where' }
  | { kind: 'advice'; row: AdviceRow }
  | { kind: 'outcome' }
  | { kind: 'old' }
  | { kind: 'state' }
  | { kind: 'lead' }
  | { kind: 'code'; card: ReviewCard; n: number }
  | { kind: 'where4' }
  | { kind: 'empty' }
const cards = computed<Card[]>(() => {
  if (v4.value) {
    const out: Card[] = []
    if (mine.value?.work) out.push({ kind: 'work' })
    // Мысль модели — первой; её нет, а запрос идёт или кончился лимитом / сбоем — состояние на её месте.
    if (mine.value?.lead) out.push({ kind: 'lead' })
    else if (!mine.value && ai.reviewState !== 'idle') out.push({ kind: 'state' })
    out.push(...frozen.value.map((card, i) => ({ kind: 'code' as const, card, n: i + 1 })))
    if (split.value?.total) out.push({ kind: 'where4' }) // трат месяца нет — пустой полосы нет (критик 4б)
    // Своих трат нет — первый шаг: «Нужна выписка» с одной кнопкой (владелец 2026-10-22, Х-11).
    return out.length ? out : [{ kind: 'empty' }]
  }
  if (!props.review) return [{ kind: 'state' }]
  if (!v3.value) return [{ kind: 'old' }]
  return [
    { kind: 'work' },
    { kind: 'where' },
    ...advices.value.map((row) => ({ kind: 'advice' as const, row })),
    ...(outcome.value ? [{ kind: 'outcome' as const }] : []),
  ]
})

/* ---------- листание: лента со scroll-snap, активная — по прокрутке ---------- */
const ribbon = ref<HTMLElement | null>(null)
const active = ref(0)
function go(i: number, smooth = true) {
  const n = Math.max(0, Math.min(cards.value.length - 1, i))
  active.value = n
  const el = ribbon.value
  if (el?.clientWidth) el.scrollTo?.({ left: n * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
}
function onScroll() {
  const el = ribbon.value
  if (el?.clientWidth) active.value = Math.max(0, Math.min(cards.value.length - 1, Math.round(el.scrollLeft / el.clientWidth)))
}
/** Нажатие по правой трети — следующая, по левой — предыдущая; по кнопкам и ссылкам — их действие. */
function onTap(e: MouseEvent) {
  if (e.target instanceof Element && e.target.closest('a, button, [data-no-tap]')) return
  const w = ribbon.value?.clientWidth || window.innerWidth
  if (e.clientX > (w * 2) / 3) go(active.value + 1)
  else if (e.clientX < w / 3) go(active.value - 1)
}
/*
 * Х-10 (`/ux` Блока 2, RZ-13): ушли из отчёта по ссылке («Открыть», строка «Куда ушло») — номер карточки остаётся в
 * записи истории отчёта; «Назад» возвращает на ту же карточку, а не на первую. Только своя запись веб-истории роутера
 * (`history.state.current` — этот адрес); прочитали — стёрли: следующее открытие той же записи — как обычно.
 */
const CARD_KEY = 'reportCard'
const ownEntry = () => typeof history !== 'undefined' && history.state?.current === route.fullPath
function rememberCard() {
  if (ownEntry()) history.replaceState({ ...history.state, [CARD_KEY]: active.value }, '')
}
/**
 * Нажатие ссылки — в перехвате, до `RouterLink`: настоящее касание выполняет микрозадачи между обработчиками, и переход
 * успевал записать новую запись истории раньше всплытия (стенд). Нативный слушатель, не `@click.capture` (как у `Tip`).
 */
function onLinkCapture(e: MouseEvent) {
  if (e.target instanceof Element && e.target.closest('a')) rememberCard()
}
watch(ribbon, (el, old) => {
  old?.removeEventListener('click', onLinkCapture, true)
  el?.addEventListener('click', onLinkCapture, true)
})
function takeRemembered(): number | null {
  if (!ownEntry()) return null
  const { [CARD_KEY]: i, ...rest } = history.state as Record<string, unknown>
  if (typeof i !== 'number') return null
  history.replaceState(rest, '')
  return Math.max(0, Math.min(cards.value.length - 1, i))
}
/** Старт: с карточки совета `card`, иначе с первой. */
const startIndex = () => {
  const n = props.card
  const i = n ? cards.value.findIndex((c) => (c.kind === 'advice' && c.row.i === n - 1) || (c.kind === 'code' && c.n === n)) : -1
  return i < 0 ? 0 : i
}
watch(active, (i) => {
  const kind = cards.value[i]?.kind
  if (kind === 'where' || kind === 'where4') whereSeen.value = true
})
// Разбор сменился («Обновить») — карточек стало меньше: активная не выходит за ленту.
watch(
  () => cards.value.length,
  (n) => {
    if (active.value > n - 1) go(n - 1, false)
  },
)

/* ---------- закрыть: свайп вниз от верха карточки ---------- */
const PULL_PX = 80
let y0: number | null = null
let x0 = 0
function onTouchStart(e: TouchEvent) {
  const card = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-report-card]') : null
  y0 = e.touches.length === 1 && (!card || card.scrollTop <= 0) ? e.touches[0].clientY : null
  x0 = e.touches[0]?.clientX ?? 0
}
function onTouchEnd(e: TouchEvent) {
  if (y0 === null) return
  const t = e.changedTouches[0]
  const dy = t ? t.clientY - y0 : 0
  const dx = t ? Math.abs(t.clientX - x0) : 0
  y0 = null
  if (dy > PULL_PX && dy > dx) emit('close')
}

/* ---------- «что ушло» ---------- */
const sentOpen = ref(false)
const doCandidate = ref<StepCandidate | null>(null)
/** «Что ушло» читаемым списком, не JSON: v2/v3 — факты и действия кода, v1 — разделы сводки с суммами. */
const sentRows = computed(() => {
  const s = props.review?.sent
  if (!s) return []
  return 'facts' in s ? [{ title: 'Факты месяца', rows: factsLines(s as ReviewPayload | ReviewPayloadV3 | ReviewPayloadV4) }] : sentLines(s, props.monthKey)
})

function sentLines(s: MonthSummaryAI, key: string): { title: string; rows: string[] }[] {
  const by = (m: string | null) => (m ? monthBy(m, key) : 'не закроем')
  const out: { title: string; rows: string[] }[] = [
    { title: `Доход · ${money(s.income.total)}`, rows: s.income.byPerson.map((x) => `${x.who} — ${money(x.amount)}`) },
    { title: `Платежи · ${money(s.dues.total)}`, rows: s.dues.items.map((x) => `${x.name} — ${money(x.amount)}`) },
    {
      title: `Траты · план ${money(s.spend.total)}`,
      rows: [...(s.spend.fact !== null ? [`потрачено — ${money(s.spend.fact)}`] : []), ...s.spend.byCategory.map((x) => `${x.name} — ${money(x.amount)}`)],
    },
    {
      title: s.short > 0 ? `Не хватает · ${money(s.short)}` : `Остаётся · ${money(s.rest)}`,
      rows: [
        `свободно до целей — ${money(s.free)}`,
        `отложено — ${money(s.saved)}`,
        ...(s.daysToPayday !== null ? [`до зарплаты — ${s.daysToPayday} ${plural(s.daysToPayday, 'день', 'дня', 'дней')}`] : []),
      ],
    },
  ]
  if (s.debts.items.length)
    out.push({
      title: `Долги · ${money(s.debts.total)}`,
      rows: [
        ...s.debts.items.map(
          (d) => `${d.name} — ${money(d.left)}, ${money(d.payment)} в месяц, ${d.ratePercent === null ? 'ставку уточните' : `${String(d.ratePercent).replace('.', ',')} %`}, ${by(d.endMonth)}`,
        ),
        ...(s.prepay ? [`досрочно — ${s.prepay.name}, ${money(s.prepay.monthlyPut)} в месяц, ${by(s.prepay.doneMonth)}`] : []),
      ],
    })
  if (s.goals.length)
    out.push({
      title: 'Цели',
      rows: s.goals.map(
        (g) =>
          `${g.name} — ${money(g.have)} из ${money(g.want)}${g.paused ? `, на паузе${g.afterPlan ? ' ради плана' : ''}${g.doneMonth ? `, ${by(g.doneMonth)}` : ''}` : `, ${money(g.monthlyPut)} в месяц, ${by(g.doneMonth)}`}`,
      ),
    })
  return out
}

/* ---------- открыт / закрыт: стек окон (тост поверх, Escape), фокус ---------- */
const inline = typeof document === 'undefined'
const me = Symbol('report')
const root = ref<HTMLElement | null>(null)
let back: HTMLElement | null = null
let releaseTips: (() => void) | null = null
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
/**
 * Клавиатура (`/ux` Блока 2): Escape — закрыть; стрелки — листать (соседние карточки `inert`, Tab до них не доходит);
 * Tab не уводит фокус под отчёт — по кругу внутри, как у `Sheet`.
 */
function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || !isTopSheet(me)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    go(active.value + (e.key === 'ArrowRight' ? 1 : -1))
    return
  }
  if (e.key !== 'Tab' || !root.value) return
  const items = [...root.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'))
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const at = document.activeElement
  const inside = at instanceof HTMLElement && root.value.contains(at) && !at.closest('[inert]')
  if (e.shiftKey && (!inside || at === first || at === root.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (!inside || at === last)) {
    e.preventDefault()
    first.focus()
  }
}
function show() {
  pushSheet(me)
  releaseTips = holdTips()
  back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('keydown', onKeydown)
  freeze()
  active.value = takeRemembered() ?? startIndex()
  void nextTick(() => {
    go(active.value, false)
    root.value?.focus()
  })
}
function hide() {
  sentOpen.value = false
  doCandidate.value = null
  whereSeen.value = false
  if (!popSheet(me)) return
  releaseTips?.()
  releaseTips = null
  document.removeEventListener('keydown', onKeydown)
  if (back?.isConnected) back.focus()
  back = null
}
watch(
  () => props.open,
  (v) => {
    if (inline) {
      if (v) freeze()
      if (v) active.value = startIndex()
      return
    }
    if (v) show()
    else hide()
  },
  { immediate: true },
)
// Открыт, и пришёл другой номер совета (✦ другого предмета) — на его карточку.
watch(
  () => props.card,
  () => {
    if (props.open) go(startIndex(), false)
  },
)
onUnmounted(() => {
  if (!inline) hide()
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div
      v-if="open"
      ref="root"
      role="dialog"
      aria-modal="true"
      aria-label="Разбор месяца"
      tabindex="-1"
      class="fx-fade fixed inset-0 z-50 flex flex-col bg-canvas text-left outline-none"
      data-report
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <!-- Полоски-прогресс по карточкам (как Stories) и ✕ -->
      <div class="mx-auto flex w-full max-w-[480px] flex-col gap-2.5 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <div v-if="cards.length > 1" class="flex gap-1" aria-hidden="true" data-report-progress>
          <span v-for="(_, i) in cards" :key="i" class="h-[3px] flex-1 rounded-pill transition-colors" :class="i <= active ? 'bg-brand' : 'bg-line-strong'" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <!-- Пометка заготовки демо (Р-12): не ответ ИИ, а пример. -->
          <span class="type-meta"><template v-if="example"><span data-review-example>Пример</span></template><template v-else-if="pastMonth"><span data-review-month>{{ pastMonth }}</span></template></span>
          <button
            type="button"
            aria-label="Закрыть"
            class="press grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink"
            data-report-close
            @click="emit('close')"
          >
            <PhX :size="18" />
          </button>
        </div>
      </div>

      <!-- Лента карточек: свайп вбок — scroll-snap; нажатие по правой / левой трети — следующая / предыдущая -->
      <div
        ref="ribbon"
        class="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none]"
        data-report-ribbon
        @scroll.passive="onScroll"
        @click="onTap"
      >
        <section
          v-for="(c, ci) in cards"
          :key="ci"
          class="h-full w-full shrink-0 snap-center overflow-y-auto"
          :data-report-card="c.kind"
          :data-active="ci === active || undefined"
          :inert="ci !== active"
        >
          <div class="mx-auto flex min-h-full w-full max-w-[480px] flex-col px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-6">
            <!-- Работа ИИ (Р-8, RZ-14): одна крупная цифра — «≈ X ₸» в месяц (без денег — операций); остальное строкой -->
            <template v-if="c.kind === 'work'">
              <h2 class="type-h2-lg text-ink">Работа ИИ</h2>
              <template v-if="work">
                <p class="mt-8 whitespace-nowrap type-big num text-ink" data-review-big>{{ work.big }}</p>
                <p class="mt-1.5 text-[15px] text-ink-2" data-review-work-word>{{ work.word }}</p>
                <p class="mt-5 text-[17px] font-semibold text-ink num" data-review-work>{{ work.line }}</p>
              </template>
              <p v-if="whenLine" class="mt-auto pt-8 text-[13px] text-ink-2" data-review-when>{{ whenLine }}</p>
            </template>

            <!-- Куда ушло (Р-4): разделы месяца находок; строка модели — под ними -->
            <template v-else-if="c.kind === 'where'">
              <h2 class="type-h2-lg text-ink">Куда ушло</h2>
              <p class="mt-1 text-[15px] text-ink-2" data-review-where-month>{{ whereMonth }}</p>
              <WhereBars v-if="rows.length" class="mt-5" :rows="rows" :play="whereSeen" :month="pictureMonth" />
              <p v-else class="mt-6 text-[15px] text-ink-2" data-review-where-empty>Выписок за месяц ещё нет</p>
              <p v-if="review?.where" class="mt-6 text-[17px] leading-snug text-ink num" data-review-where>{{ keep(review.where) }}</p>
            </template>

            <!-- Совет: заголовок, крупная цифра факта, одна строка текста, одна кнопка (Р-6) -->
            <template v-else-if="c.kind === 'advice'">
              <article class="flex flex-col" data-review-advice>
                <p class="flex items-center gap-1.5 type-section"><PhSparkle :size="14" class="text-brand" aria-hidden="true" />Совет</p>
                <h2 class="mt-2 type-h2-lg text-ink" data-review-advice-title>{{ c.row.a.title }}</h2>
                <template v-if="c.row.a.figure">
                  <p class="mt-6 type-big num text-ink" data-review-figure>{{ c.row.a.figure.value }}</p>
                  <!-- Короткая подпись кода (RZ-15: «в месяц · Магазин у дома»); разбор до неё — `about`, переносом, не обрезкой (`/ux`). -->
                  <p class="mt-1.5 text-[14px] leading-snug text-ink-2" data-review-figure-about>{{ figureLabel(c.row.a) }}</p>
                </template>
                <p class="mt-5 text-[17px] leading-snug text-ink num" data-review-advice-text>{{ keep(c.row.a.text) }}</p>
                <div class="mt-6">
                  <span v-if="c.row.made" class="flex items-center gap-1.5 text-[15px] font-semibold text-ok" data-review-done><PhCheck :size="17" weight="bold" aria-hidden="true" />Сделано</span>
                  <Button v-else-if="c.row.fresh" size="md" data-review-do @click="doCandidate = c.row.fresh">Сделать</Button>
                  <Button v-else-if="c.row.path" size="md" as-child>
                    <RouterLink :to="c.row.path" data-review-link>Открыть</RouterLink>
                  </Button>
                </div>
              </article>
            </template>

            <!-- v4: мысль модели — заголовок, крупная цифра факта, текст (Р-23); кнопки нет — кнопки у карточек кода -->
            <template v-else-if="c.kind === 'lead' && mine?.lead">
              <article class="flex flex-col" data-review-lead>
                <p class="flex items-center gap-1.5 type-section"><PhSparkle :size="14" class="text-brand" aria-hidden="true" />Главное</p>
                <h2 class="mt-2 type-h2-lg text-ink" data-review-lead-title>{{ mine.lead.title }}</h2>
                <template v-if="leadFigure">
                  <p class="mt-6 type-big num text-ink" data-review-figure>{{ leadFigure.value }}</p>
                  <p class="mt-1.5 text-[14px] leading-snug text-ink-2" data-review-figure-about>{{ leadFigure.label ?? leadFigure.about }}</p>
                </template>
                <p class="mt-5 text-[17px] leading-snug text-ink num" data-review-lead-text>{{ keep(mine.lead.text) }}</p>
              </article>
            </template>

            <!-- v4: карточка кода (Р-24) — заголовок, одна крупная цифра, одна строка, одна кнопка; сделано — ✓ у цифры -->
            <template v-else-if="c.kind === 'code'">
              <article class="flex flex-col" :data-review-card="c.card.kind">
                <h2 class="type-h2-lg text-ink" data-review-card-title>{{ c.card.title }}</h2>
                <p class="mt-6 flex items-center gap-2 type-big num text-ink" data-review-figure>
                  {{ figureOf(c.card) }}<PhCheck v-if="isDone(c.card)" :size="26" weight="bold" class="shrink-0 text-ok" aria-label="Сделано" data-review-card-done />
                </p>
                <!-- Отмеченная разовая: продавец · раздел · разовая; нажатие — лист операции (сменить раздел, Х-16). -->
                <button
                  v-if="oneOffLine(c.card)"
                  type="button"
                  class="press mt-2 flex cursor-pointer items-center gap-1 text-left text-[15px] leading-snug text-ink-2"
                  data-review-card-line
                  data-review-card-op
                  @click="emit('act', c.card)"
                >
                  <span class="min-w-0">{{ oneOffLine(c.card) }}</span><PhCaretRight :size="14" class="shrink-0 text-ink-3" aria-hidden="true" />
                </button>
                <p v-else class="mt-2 text-[15px] leading-snug text-ink-2" data-review-card-line>{{ c.card.line }}</p>
                <div v-if="!isDone(c.card) && !auth.isViewer" class="mt-6">
                  <Button v-if="c.card.target.kind === 'obligation'" size="md" as-child>
                    <RouterLink :to="openPath({ kind: 'obligation', id: c.card.target.obligationId, name: c.card.subject ?? '' })" data-review-card-button @click="press(c.card)">{{ c.card.button }}</RouterLink>
                  </Button>
                  <Button v-else size="md" data-review-card-button @click="press(c.card)">{{ c.card.button }}</Button>
                </div>
              </article>
            </template>

            <!-- v4: «Куда ушло» на всю сумму (Р-25) — полоса из четырёх частей, выходные, ниже — свои разделы продавцов -->
            <template v-else-if="c.kind === 'where4' && split">
              <h2 class="type-h2-lg text-ink">Куда ушло</h2>
              <p class="mt-1 text-[15px] text-ink-2" data-review-where-month>{{ whereMonth }}</p>
              <WhereSplit class="mt-5" :parts="split.parts" :weekend="weekend" :play="whereSeen" />
              <WhereBars v-if="rowsV4.length" class="mt-6" :rows="rowsV4" :play="whereSeen" :month="cardMonth" />
            </template>

            <!-- Итог прошлого месяца (Р-20): советы — сделан / нет, разделы к «обычно», срок главной мечты -->
            <template v-else-if="c.kind === 'outcome' && outcome">
              <h2 class="type-h2-lg text-ink">Итог прошлого месяца</h2>
              <ul class="mt-6 flex flex-col" data-review-outcome>
                <li v-for="d in outcome.done" :key="d.title" class="flex items-center justify-between gap-3 border-t border-line py-3 text-[15px] first:border-t-0" data-outcome-done>
                  <span class="min-w-0 text-ink">{{ d.title }}</span>
                  <span v-if="d.done" class="flex shrink-0 items-center gap-1 font-semibold text-ok"><PhCheck :size="15" weight="bold" aria-hidden="true" />Сделано</span>
                  <span v-else class="shrink-0 text-ink-2">не сделано</span>
                </li>
                <li v-for="s in outcome.sections" :key="s.categoryId" class="flex items-center justify-between gap-3 border-t border-line py-3 text-[15px] first:border-t-0" data-outcome-section>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-ink">{{ s.name }}</span>
                    <span v-if="s.usual !== null" class="text-[12.5px] text-ink-2 num">обычно {{ plain(s.usual) }}</span>
                  </span>
                  <b class="whitespace-nowrap font-semibold text-ink num">{{ plain(s.amount) }}</b>
                </li>
                <li v-if="outcome.dream && dreamLine" class="flex items-center justify-between gap-3 border-t border-line py-3 text-[15px] first:border-t-0" data-outcome-dream>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-ink">{{ outcome.dream.name }}</span>
                    <span class="text-[12.5px] text-ink-2 num">{{ dreamLine.was }}</span>
                  </span>
                  <b class="whitespace-nowrap font-semibold text-ink num">{{ dreamLine.now }}</b>
                </li>
              </ul>
            </template>

            <!-- Разбор v1/v2 (Р-15): одна карточка — Хорошо · Риск · Шаг(и) -->
            <template v-else-if="c.kind === 'old' && review">
              <h2 class="type-h2-lg text-ink">Разбор</h2>
              <div class="mt-6 flex flex-col gap-5" data-review>
                <section>
                  <h3 class="type-section text-ok">Хорошо</h3>
                  <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-good>{{ keep(review.good) }}</p>
                </section>
                <section>
                  <h3 class="type-section text-warn">Риск</h3>
                  <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-risk>{{ keep(review.risk) }}</p>
                </section>
                <section v-if="v2 && review.step">
                  <h3 class="type-section text-ink">Шаг</h3>
                  <div class="mt-1 flex items-center gap-3" data-review-step-v2>
                    <p class="min-w-0 flex-1 text-[15px] leading-snug text-ink num" data-review-step-text>{{ keep(review.step.text) }}</p>
                    <span v-if="v2Done" class="flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ok" data-review-done><PhCheck :size="15" weight="bold" aria-hidden="true" />Сделано</span>
                    <Button v-else-if="v2Fresh" variant="secondary" size="sm" class="shrink-0" data-review-do @click="doCandidate = v2Fresh">Сделать</Button>
                  </div>
                </section>
                <section v-else-if="review.steps.length">
                  <h3 class="type-section text-ink">Шаги</h3>
                  <ol class="mt-1 flex flex-col" data-review-steps>
                    <li v-for="(s, i) in review.steps" :key="i" class="border-t border-line first:border-t-0">
                      <RouterLink
                        v-if="linkOf(s.screen)"
                        :to="linkOf(s.screen)!"
                        class="press flex items-center gap-2.5 py-2.5 text-[15px] leading-snug text-ink num"
                        data-review-step-link
                      >
                        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12.5px] font-bold text-ink-2">{{ i + 1 }}</span>
                        <span class="min-w-0 flex-1">{{ keep(s.text) }}</span>
                        <PhCaretRight :size="15" class="shrink-0 text-ink-3" />
                      </RouterLink>
                      <p v-else class="flex items-center gap-2.5 py-2.5 text-[15px] leading-snug text-ink num" data-review-step>
                        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12.5px] font-bold text-ink-2">{{ i + 1 }}</span>
                        <span class="min-w-0 flex-1">{{ keep(s.text) }}</span>
                      </p>
                    </li>
                  </ol>
                </section>
              </div>
            </template>

            <!-- v4 без своих трат — пустой экран, первый шаг: одна кнопка во всю ширину (правило 12, Х-11) -->
            <template v-else-if="c.kind === 'empty'">
              <div class="my-auto flex flex-col py-6" data-review-empty>
                <h2 class="type-h2-lg text-ink">Нужна выписка</h2>
                <p class="mt-1.5 text-[15px] leading-snug text-ink-2">Разбор считается по вашим тратам</p>
                <Button size="lg" class="mt-6 w-full" as-child>
                  <RouterLink to="/week?upload=1" data-review-upload>Загрузить выписку</RouterLink>
                </Button>
              </div>
            </template>

            <!-- Разбора нет: запрос идёт или чем кончился — одна карточка; ответ идёт 5–55 с — крутилка -->
            <template v-else-if="c.kind === 'state'">
              <p class="my-auto flex items-center justify-center gap-2 py-6 text-[16px]" :class="ai.reviewState === 'thinking' ? 'text-ink-2' : 'text-ink'" :data-review-state="ai.reviewState">
                <PhCircleNotch v-if="ai.reviewState === 'thinking'" :size="18" class="shrink-0 animate-spin" aria-hidden="true" data-review-spin /><span>{{ stateText }}</span>
              </p>
            </template>

            <!-- Низ последней карточки: откуда текст, «что ушло», «Обновить» (Р-17) -->
            <div v-if="(v4 ? mine : review) && ci === cards.length - 1" class="mt-auto flex flex-col gap-1 pt-10" data-review-foot>
              <p class="text-[12.5px] text-ink-2">
                Подсказка ИИ ·
                <template v-if="reviewDay"><span data-review-day>{{ reviewDay }}</span> · </template>
                <button type="button" class="cursor-pointer font-semibold text-ink-2 underline underline-offset-2" :aria-expanded="sentOpen" data-review-sent-open @click="sentOpen = !sentOpen">что ушло</button>
              </p>
              <!-- Что ушло в модель (Р-9): без имён, заметок и операций — то же, что видит человек. -->
              <div v-if="sentOpen" class="mt-2 flex flex-col gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2.5" data-review-sent data-no-tap>
                <div v-for="b in sentRows" :key="b.title">
                  <p class="text-[13px] font-semibold text-ink num">{{ b.title }}</p>
                  <p v-for="r in b.rows" :key="r" class="text-[12.5px] text-ink-2 num">{{ r }}</p>
                </div>
              </div>
              <div v-if="canRefresh" class="mt-1">
                <Button variant="ghost" size="sm" class="-ml-3" data-review-refresh @click="emit('refresh')">Обновить</Button>
              </div>
              <!-- «Обновить» идёт или не вышло — под прежним разбором, он остаётся. -->
              <p v-if="ai.reviewState !== 'idle'" class="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-2" data-review-refresh-state>
                <PhCircleNotch v-if="ai.reviewState === 'thinking'" :size="13" class="shrink-0 animate-spin" aria-hidden="true" data-review-spin /><span>{{ stateText }}</span>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
  <!-- Лист «Сделать» поверх отчёта (z 60); отчёт под ним остаётся, тост — поверх обоих (`sheetStack`). -->
  <DoSheet :candidate="open ? doCandidate : null" :z="60" @close="doCandidate = null" />
  <Toast v-if="open && oneOffNote" action="Отменить" @action="undoOneOff"><span data-review-oneoff-toast>{{ oneOffNote }}</span></Toast>
</template>
