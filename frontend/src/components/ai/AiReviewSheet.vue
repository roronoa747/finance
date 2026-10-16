<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { PhCaretRight, PhCircleNotch } from '@phosphor-icons/vue'
import { useAiStore } from '@/stores/ai'
import { useAuthStore } from '@/stores/auth'
import type { AiReview } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { money, plain } from '@/lib/money'
import { MONTHS_GEN, addMonths, monthBy, monthKey, parseMonthKey } from '@/lib/dates'
import { plural } from '@/lib/utils'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Лист разбора месяца (бэклог «ИИ», Р-4, AI-09): три блока — «Хорошо», «Риск», «Шаги» (шаг с экраном — ссылка,
 * лист закрывается). Внизу тихо — откуда текст и «что ушло» (сводка, ушедшая в модель, списком — Р-9) и «Обновить»
 * (участник с ИИ, разбору больше суток). Пока идёт запрос — «Думаю…»; лимит — «ИИ вернётся 1 ноября» (следующий месяц
 * по Алматы — лимит семьи сбрасывается 1-го, Р-8). Viewer — только чтение. Пример демо (AI-10) — `example`: без
 * «Обновить», с пометкой. Слова утвердил владелец (артефакт `/ux`, 2026-10-16).
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
const NBSP = '\u00a0'
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
      ? `ИИ вернётся 1 ${MONTHS_GEN[parseMonthKey(addMonths(monthKey(), 1)).month]}`
      : 'Не вышло. Попробуйте позже',
)

const sentOpen = ref(false)
watch(
  () => props.open,
  (v) => {
    if (!v) sentOpen.value = false
  },
)

/** «Что ушло» читаемым списком, не JSON: разделы сводки с суммами. */
const sentRows = computed(() => (props.review?.sent ? sentLines(props.review.sent, props.monthKey) : []))

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
      <section>
        <h3 class="type-section text-ok">Хорошо</h3>
        <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-good>{{ keep(review.good) }}</p>
      </section>
      <section>
        <h3 class="type-section text-warn">Риск</h3>
        <p class="mt-1 text-[15px] leading-snug text-ink num" data-review-risk>{{ keep(review.risk) }}</p>
      </section>
      <section>
        <h3 class="type-section text-ink">Шаги</h3>
        <ol class="mt-1 flex flex-col" data-review-steps>
          <li v-for="(s, i) in review.steps" :key="i" class="border-t border-line first:border-t-0">
            <RouterLink
              v-if="s.screen"
              :to="s.screen"
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
          <button type="button" class="cursor-pointer font-semibold text-ink-2 underline underline-offset-2" :aria-expanded="sentOpen" data-review-sent-open @click="sentOpen = !sentOpen">что ушло</button>
        </p>
        <!-- Сводка, ушедшая в модель (Р-9): без имён, заметок и операций — та же, что видит человек. -->
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
</template>
