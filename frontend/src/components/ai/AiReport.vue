<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhCaretRight, PhCheck, PhCircleNotch, PhSparkle, PhX } from '@phosphor-icons/vue'
import { aiLimitText, useAiStore } from '@/stores/ai'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { AiAdvice, AiReview, ReviewPayload, ReviewPayloadV3, ReviewReason } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { factsLines, openPath } from '@/lib/aiFacts'
import { findMonth, reviewOutcome, shiftMade, stepCandidates, whereRows, type StepCandidate } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { addMonths, dayLabel, monthBy, monthIn, today } from '@/lib/dates'
import { plural } from '@/lib/utils'
import { holdTips } from '@/components/kit/tips'
import { isTopSheet, popSheet, pushSheet } from '@/components/kit/sheetStack'
import Button from '@/components/ui/Button.vue'
import DoSheet from '@/components/plan/DoSheet.vue'
import WhereBars from './WhereBars.vue'

/**
 * Отчёт разбора месяца (бэклог «Разбор», Р-2, Р-15, Р-17, RZ-07) — на весь экран поверх «Месяца», листаемые карточки
 * (как Stories): «Работа ИИ» (счётчик кода на момент разбора) → «Куда ушло» (полосы кода за месяц находок и строка модели)
 * → советы (до 3, у каждого одна кнопка: «Сделать» → `DoSheet` поверх или «Открыть» — экран предмета) → «Итог прошлого
 * месяца» (только по v3 прошлого месяца, считает `reviewOutcome`). Разбор v1/v2 — одной карточкой «Разбор»; разбора нет —
 * одна карточка состояния («Думаю…», лимит, «Не вышло»). Листается свайпом (`scroll-snap`), нажатием по правой / левой
 * трети и стрелками; ✕, Escape и свайп вниз — закрыть; соседние карточки `inert`, Tab — по кругу внутри. Внизу последней карточки тихо — день, «что ушло» и «Обновить». Viewer — без
 * «Сделать» («Открыть» — чтение, есть). Пример демо — `example`: без дня и «Обновить». Все числа — из `finance.ts` и
 * сохранённого разбора; здесь — показ.
 */
const props = defineProps<{
  open: boolean
  monthKey: string
  /** Разбор месяца; нет — состояние запроса. */
  review: AiReview | null
  /** Заготовка демо (Р-12): пометка «Пример», без дня и «Обновить». */
  example?: boolean
  /** Номер совета 1…3 — отчёт стартует с его карточки (✦ у предмета, Блок 3); нет — с первой. */
  card?: number | null
}>()
const emit = defineEmits<{ close: []; refresh: [] }>()

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

/* ---------- v3: советы ---------- */
const v3 = computed(() => props.review?.v === 3)
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

/** «Работа ИИ» (Р-8): числа кода на момент разбора; «≈ X» — только когда X > 0. */
const work = computed(() => {
  const w = v3.value ? props.review?.work : undefined
  if (!w) return null
  return {
    ops: plain(w.ops),
    opsWord: plural(w.ops, 'операция просмотрена', 'операции просмотрены', 'операций просмотрено'),
    line: [`нашёл ${w.found}`, ...(w.yearly > 0 ? [`≈ ${money(w.yearly)} в год`] : [])].join(' · '),
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
const whereMonth = computed(() => `в ${monthIn(pictureMonth.value, false)}`)
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
type Card = { kind: 'work' } | { kind: 'where' } | { kind: 'advice'; row: AdviceRow } | { kind: 'outcome' } | { kind: 'old' } | { kind: 'state' }
const cards = computed<Card[]>(() => {
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
  if (e.target instanceof Element && e.target.closest('a')) rememberCard()
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
  const i = n ? cards.value.findIndex((c) => c.kind === 'advice' && c.row.i === n - 1) : -1
  return i < 0 ? 0 : i
}
watch(active, (i) => {
  if (cards.value[i]?.kind === 'where') whereSeen.value = true
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
  return 'facts' in s ? [{ title: 'Факты месяца', rows: factsLines(s as ReviewPayload | ReviewPayloadV3) }] : sentLines(s, props.monthKey)
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
          <span class="type-meta"><template v-if="example"><span data-review-example>Пример</span></template></span>
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
            <!-- Работа ИИ (Р-8): одна крупная цифра — операций; «нашёл · ≈ в год» строкой -->
            <template v-if="c.kind === 'work'">
              <h2 class="type-h2-lg text-ink">Работа ИИ</h2>
              <template v-if="work">
                <p class="mt-8 type-big num text-ink" data-review-ops>{{ work.ops }}</p>
                <p class="mt-1.5 text-[15px] text-ink-2">{{ work.opsWord }}</p>
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
                  <!-- Переносом, не обрезкой: единица («— за год») стоит в конце подписи (`/ux`). -->
                  <p class="mt-1.5 text-[14px] leading-snug text-ink-2" data-review-figure-about>{{ c.row.a.figure.about }}</p>
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

            <!-- Разбора нет: запрос идёт или чем кончился — одна карточка; ответ идёт 5–55 с — крутилка -->
            <template v-else-if="c.kind === 'state'">
              <p class="my-auto flex items-center justify-center gap-2 py-6 text-[16px]" :class="ai.reviewState === 'thinking' ? 'text-ink-2' : 'text-ink'" :data-review-state="ai.reviewState">
                <PhCircleNotch v-if="ai.reviewState === 'thinking'" :size="18" class="shrink-0 animate-spin" aria-hidden="true" data-review-spin /><span>{{ stateText }}</span>
              </p>
            </template>

            <!-- Низ последней карточки: откуда текст, «что ушло», «Обновить» (Р-17) -->
            <div v-if="review && ci === cards.length - 1" class="mt-auto flex flex-col gap-1 pt-10" data-review-foot>
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
</template>
