<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhCaretRight, PhCheck, PhCircleNotch } from '@phosphor-icons/vue'
import { aiLimitText, useAiStore } from '@/stores/ai'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { AiReview, ReviewPayload, ReviewPayloadV3 } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { factsLines, openPath } from '@/lib/aiFacts'
import { shiftMade, stepCandidates, type StepCandidate } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { dayLabel, monthBy, today } from '@/lib/dates'
import { plural } from '@/lib/utils'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import DoSheet from '@/components/plan/DoSheet.vue'

/**
 * Лист разбора месяца (бэклог «ИИ», Р-4, AI-09; v2 — «ИИ-польза», Р-2, Р-3, AU-13): «Хорошо», «Риск», «Шаг». У шага v2
 * справа — небольшая «Сделать» (участник, кандидат ещё применим: сумма и эффект пересчитаны `stepCandidates` при
 * открытии) → лист `DoSheet` с готовыми цифрами; подтвердил — лист разбора остаётся, у шага «✓ Сделано» (сдвиг месяца в
 * ту же цель). Разбор v1 — прежние шаги-ссылки; ссылка на экран, где лист открыт, — текст без стрелки (Х-13). Внизу
 * тихо — откуда текст и «что ушло» (v2 — факты кода, v1 — сводка; Р-9) и «Обновить» (участник с ИИ, разбору больше
 * суток). Пока идёт запрос — «Думаю…»; лимит — «ИИ вернётся 1 ноября». Viewer — только чтение. Пример демо — `example`:
 * без «Обновить», с пометкой.
 */
const props = defineProps<{
  open: boolean
  monthKey: string
  /** Разбор месяца; нет — состояние запроса. */
  review: AiReview | null
  /** Заготовка демо (Р-10): пометка «Пример», без «Обновить». */
  example?: boolean
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
    ai.available &&
    ai.consent !== 'off' &&
    ai.reviewState !== 'thinking' &&
    Date.now() - Date.parse(props.review.at) >= DAY_MS,
)

/**
 * Число не рвётся строкой (стенд: «95 / 000 ₸»): модель пишет разряды обычным пробелом — на показе он неразрывный,
 * как у `money()`; так же пробел перед «₸», «%» и словом «тенге» (живые ответы пишут и так — «627 000 / тенге», `/ux`).
 * Текст в документе не меняется.
 */
const NBSP = ' '
/** Разряды, которых модель не поставила («499641» — живой ответ, критик Блока 2): 5+ цифр — как `plain`; годы не задевает. */
const keep = (t: string) =>
  t
    .replace(/(?<![\d,.])\d{5,}(?![\d,.])/g, (d) => plain(Number(d)))
    .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
    .replace(/(\d) (?=[₸%]|тенге)/g, `$1${NBSP}`)

/** Слова состояний запроса. Лимит — с месяцем: «1-го» заставляло думать, какого (владелец, `/ux` п. 3). */
const stateText = computed(() =>
  ai.reviewState === 'thinking'
    ? 'Думаю…'
    : ai.reviewState === 'limit'
      ? aiLimitText()
      : 'Не вышло. Попробуйте позже',
)

/* ---------- шаг v2: «Сделать» у шага (Р-3) ---------- */
const v2 = computed(() => props.review?.v === 2)
const saved = computed(() => (v2.value ? props.review?.step?.candidate ?? null : null))
/** Сделано: в этом месяце уже есть сдвиг в ту же цель (или карточку долга) из того же источника. */
const done = computed(() => {
  const c = saved.value
  return !!c && shiftMade(finance.householdDoc.planShifts ?? [], { ...c.shift, period: props.monthKey })
})
/** Кандидат ещё применим — тот же id в свежих кандидатах кода; цифры — свежие (не из сохранённого разбора). */
const fresh = computed(() => {
  const c = saved.value
  if (!c || auth.isViewer || done.value) return null
  const { state, ctx } = finance.planInput(props.monthKey)
  return stepCandidates(state, ctx).find((x) => x.id === c.id) ?? null
})
const doOpen = ref(false)

/*
 * ---------- v3 — RZ-05 временно, снимает RZ-07 (экран-отчёт Блока 2, лист уходит) ----------
 * «Куда ушло» строкой модели, советы списком: у совета справа — «Сделать» (участник, кандидат ещё применим) / «✓ Сделано»
 * или «Открыть» (экран предмета, лист закрывается; viewer тоже — это чтение); внизу — счётчик работы.
 */
const v3 = computed(() => props.review?.v === 3)
const madeOf = (c: StepCandidate) => shiftMade(finance.householdDoc.planShifts ?? [], { ...c.shift, period: props.monthKey })
const v3Rows = computed(() => {
  if (!v3.value) return []
  const live = auth.isViewer ? [] : (() => {
    const { state, ctx } = finance.planInput(props.monthKey)
    return stepCandidates(state, ctx)
  })()
  return (props.review?.advices ?? []).map((a, i) => {
    const c = a.action.kind === 'do' ? a.action.candidate : null
    const made = !!c && madeOf(c)
    return {
      i,
      a,
      made,
      fresh: c && !made ? live.find((x) => x.id === c.id) ?? null : null,
      path: a.action.kind === 'open' ? openPath(a.action.target) : null,
    }
  })
})
const v3Candidate = ref<StepCandidate | null>(null)
function openDo(c: StepCandidate) {
  v3Candidate.value = c
  doOpen.value = true
}
/** «Просмотрел N операций · нашёл K · ≈ X ₸ в год» — числа кода на момент разбора (Р-8); без X, когда он 0. */
const workLine = computed(() => {
  const w = props.review?.work
  if (!v3.value || !w) return ''
  const parts = [`Просмотрел ${plain(w.ops)} ${plural(w.ops, 'операцию', 'операции', 'операций')}`, `нашёл ${w.found}`]
  if (w.yearly > 0) parts.push(`≈ ${money(w.yearly)} в год`)
  return parts.join(' · ')
})

/** Шаг v1 на экран, где лист открыт (`/month` с «Месяца»), — не ссылка: она только закрывала лист (Х-13). */
const linkOf = (screen: string | null) => (screen && screen !== route.path ? screen : null)

/** День разбора по Алматы — «17 октября» (Х-18): текст хранит цифры своего дня. У «Примера» демо дня нет. */
const reviewDay = computed(() => {
  if (props.example || !props.review) return null
  const d = today(new Date(props.review.at))
  return dayLabel(d.day, d.key)
})

const sentOpen = ref(false)
watch(
  () => props.open,
  (v) => {
    if (!v) {
      sentOpen.value = false
      doOpen.value = false
    }
  },
)

/** «Что ушло» читаемым списком, не JSON: v2 — факты и шаги кода, v1 — разделы сводки с суммами. */
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
      rows: [
        ...(s.spend.fact !== null ? [`потрачено — ${money(s.spend.fact)}`] : []),
        ...s.spend.byCategory.map((x) => `${x.name} — ${money(x.amount)}`),
      ],
    },
    {
      title: s.short > 0 ? `Не хватает · ${money(s.short)}` : `Остаётся · ${money(s.rest)}`,
      rows: [
        // Как в инструкции модели и в тексте разбора («свободно до целей»), а не «до целей» — читалось сроком (`/ux`).
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
          // Ставка 0 и «не знаем» тоже ушли в модель (ревью frontend Блока 2, Н-2): «0 %», «ставку уточните» — как «Долги».
          (d) => `${d.name} — ${money(d.left)}, ${money(d.payment)} в месяц, ${d.ratePercent === null ? 'ставку уточните' : `${String(d.ratePercent).replace('.', ',')} %`}, ${by(d.endMonth)}`,
        ),
        // Досрочка очереди месяца (ревью frontend Блока 2, Н-1); сводки до неё её не знают.
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
</script>

<template>
  <Sheet :open="open" title="Разбор месяца" @close="emit('close')">
    <!-- Пометка заготовки демо (Р-10): не ответ ИИ, а пример. -->
    <p v-if="example" class="-mt-1 mb-2 type-meta" data-review-example>Пример</p>

    <div v-if="review" class="flex flex-col gap-4" data-review>
      <!-- v3 — RZ-05 временно, снимает RZ-07: «Куда ушло» и советы, у каждого кнопка (Р-6). -->
      <template v-if="v3">
        <section v-if="review.where">
          <h3 class="type-section text-ink">Куда ушло</h3>
          <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-where>{{ keep(review.where) }}</p>
        </section>
        <section v-for="r in v3Rows" :key="r.i" class="flex items-center gap-3" data-review-advice>
          <div class="min-w-0 flex-1">
            <h3 class="type-section text-ink" data-review-advice-title>{{ r.a.title }}</h3>
            <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-advice-text>{{ keep(r.a.text) }}</p>
          </div>
          <span v-if="r.made" class="flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ok" data-review-done><PhCheck :size="15" weight="bold" aria-hidden="true" />Сделано</span>
          <Button v-else-if="r.fresh" variant="secondary" size="sm" class="shrink-0" data-review-do @click="openDo(r.fresh)">Сделать</Button>
          <Button v-else-if="r.path" variant="secondary" size="sm" class="shrink-0" as-child>
            <RouterLink :to="r.path" data-review-link @click="emit('close')">Открыть</RouterLink>
          </Button>
        </section>
        <p v-if="workLine" class="text-[12.5px] text-ink-2 num" data-review-work>{{ workLine }}</p>
      </template>
      <template v-else>
      <section>
        <h3 class="type-section text-ok">Хорошо</h3>
        <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-good>{{ keep(review.good) }}</p>
      </section>
      <section>
        <h3 class="type-section text-warn">Риск</h3>
        <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-risk>{{ keep(review.risk) }}</p>
      </section>
      </template>
      <!-- v2: шаг один, действие — у него (правило 12: «Сделать» живёт у своего предмета). -->
      <section v-if="v2 && review.step">
        <h3 class="type-section text-ink">Шаг</h3>
        <div class="mt-1 flex items-center gap-3" data-review-step-v2>
          <p class="min-w-0 flex-1 text-[15px] leading-snug text-ink num" data-review-step-text>{{ keep(review.step.text) }}</p>
          <span v-if="done" class="flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ok" data-review-done><PhCheck :size="15" weight="bold" aria-hidden="true" />Сделано</span>
          <Button v-else-if="fresh" variant="secondary" size="sm" class="shrink-0" data-review-do @click="doOpen = true">Сделать</Button>
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
              @click="emit('close')"
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

      <div class="flex flex-col gap-1 border-t border-line pt-3">
        <p class="text-[12.5px] text-ink-2">
          Подсказка ИИ ·
          <template v-if="reviewDay"><span data-review-day>{{ reviewDay }}</span> · </template>
          <button type="button" class="cursor-pointer font-semibold text-ink-2 underline underline-offset-2" :aria-expanded="sentOpen" data-review-sent-open @click="sentOpen = !sentOpen">что ушло</button>
        </p>
        <!-- Что ушло в модель (Р-9): без имён, заметок и операций — то же, что видит человек. -->
        <div v-if="sentOpen" class="mt-2 flex flex-col gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2.5" data-review-sent>
          <div v-for="b in sentRows" :key="b.title">
            <p class="text-[13px] font-semibold text-ink num">{{ b.title }}</p>
            <p v-for="r in b.rows" :key="r" class="text-[12.5px] text-ink-2 num">{{ r }}</p>
          </div>
        </div>
        <div v-if="canRefresh && auth.isMember" class="mt-1">
          <Button variant="ghost" size="sm" class="-ml-3" data-review-refresh @click="emit('refresh')">Обновить</Button>
        </div>
        <!-- «Обновить» идёт или не вышло — под прежним разбором, он остаётся. -->
        <p v-if="ai.reviewState !== 'idle'" class="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-2" data-review-refresh-state><PhCircleNotch v-if="ai.reviewState === 'thinking'" :size="13" class="shrink-0 animate-spin" aria-hidden="true" data-review-spin /><span>{{ stateText }}</span></p>
      </div>
    </div>

    <!-- Запрос и его исход — на месте разбора; ответ идёт 4–12 с — крутилка, чтобы «Думаю…» не читалось зависшим (`/ux`). -->
    <p v-else class="flex items-center justify-center gap-2 py-6 text-[15px]" :class="ai.reviewState === 'thinking' ? 'text-ink-2' : 'text-ink'" :data-review-state="ai.reviewState"><PhCircleNotch v-if="ai.reviewState === 'thinking'" :size="17" class="shrink-0 animate-spin" aria-hidden="true" data-review-spin /><span>{{ stateText }}</span></p>
  </Sheet>
  <!-- Лист «Сделать» поверх разбора (z 60, как вложенные листы); разбор под ним остаётся. -->
  <DoSheet :candidate="open && doOpen ? (v3 ? v3Candidate : fresh) : null" :z="60" @close="doOpen = false" />
</template>
