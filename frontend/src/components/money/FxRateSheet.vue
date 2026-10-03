<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, plain } from '@/lib/money'
import { MONTHS_NOM, addMonths, monthIn, monthKey } from '@/lib/dates'
import { fxYearDelta, paydayIso, paydayRates, rateSeries, salaryOf } from '@/lib/finance'
import { CURRENCY_SIGN, CURRENCY_WORD } from '@/lib/fx'
import type { PersonId } from '@/types/finance'
import Chip from '@/components/kit/Chip.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * Лист «Курс евро» (B2C-82, Р-76): крупно — сколько курс отнял или добавил за год, график курса за
 * 12 месяцев (линия по книге, точки — дни зарплаты) и лента месяцев — «в марте по 590 ₸ · было бы
 * +126 000 ₸». Таблиц и абзацев нет, прогноза нет; всё считает `finance.ts`.
 */
const props = defineProps<{ personId: PersonId | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()
const fx = useFxStore()
const key = computed(() => monthKey())

const person = computed(() => finance.people.find((p) => p.id === props.personId && !p.deletedAt) ?? null)
const currency = computed(() => (person.value ? salaryOf(person.value, key.value).currency : 'KZT'))
const year = computed(() => (person.value ? fxYearDelta(person.value, key.value, fx.book) : null))
const months = computed(() => (person.value ? paydayRates(person.value, key.value, fx.book) : []))
const series = computed(() =>
  person.value ? rateSeries(fx.book, currency.value, paydayIso(person.value, addMonths(key.value, -12)), paydayIso(person.value, key.value)) : [],
)

/** Выбранный месяц ленты; по умолчанию — тот же месяц год назад. */
const picked = ref<string | null>(null)
watch(
  () => props.personId,
  () => (picked.value = null),
)
const chosen = computed(() => months.value.find((m) => m.key === picked.value) ?? months.value[0] ?? null)

const signed = (v: number) => (v > 0 ? `+${money(v)}` : money(v))
const tone = (v: number) => (v < 0 ? 'text-destructive' : v > 0 ? 'text-ok' : 'text-ink')

/* ---------- график: SVG по токенам, без библиотек ---------- */
const W = 320
const H = 120
const PAD = 6
const chart = computed(() => {
  const pts = series.value
  if (pts.length < 2) return null
  const t0 = Date.parse(pts[0].day)
  const span = Math.max(1, Date.parse(pts[pts.length - 1].day) - t0)
  const rates = pts.map((p) => p.rate)
  const lo = Math.min(...rates)
  const hi = Math.max(...rates)
  const x = (day: string) => PAD + ((Date.parse(day) - t0) / span) * (W - 2 * PAD)
  const y = (rate: number) => PAD + (hi === lo ? 0.5 : (hi - rate) / (hi - lo)) * (H - 2 * PAD)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
  const marks = months.value
    .filter((m) => m.day >= pts[0].day)
    .map((m) => ({ key: m.key, cx: x(m.day), cy: y(m.rate) }))
  return { line, marks, lo, hi }
})
</script>

<template>
  <Sheet :open="!!person && !!year" :title="`Курс ${CURRENCY_WORD[currency].gen}`" @close="emit('close')">
    <template v-if="year">
      <div class="mb-3 flex flex-col gap-0.5">
        <span :class="['type-big num', tone(year.tenge)]">{{ signed(year.tenge) }}</span>
        <span class="type-meta num">за год · {{ signed(year.perUnit) }} за 1 {{ CURRENCY_SIGN[currency] }}</span>
      </div>

      <figure v-if="chart" class="mb-3" :aria-label="`График курса ${CURRENCY_WORD[currency].gen} за год`">
        <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img">
          <path :d="chart.line" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round" />
          <circle
            v-for="m in chart.marks"
            :key="m.key"
            :cx="m.cx"
            :cy="m.cy"
            :r="m.key === chosen?.key ? 4.5 : 2.5"
            :fill="m.key === chosen?.key ? 'var(--brand)' : 'var(--ink-3)'"
          />
        </svg>
        <figcaption class="mt-1 flex justify-between text-[11.5px] text-ink-3 num">
          <span>{{ plain(chart.lo) }}–{{ plain(chart.hi) }} ₸</span>
          <span>{{ CURRENCY_SIGN[currency] }} · Нацбанк</span>
        </figcaption>
      </figure>

      <div class="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Месяц">
        <Chip v-for="m in months" :key="m.key" :on="m.key === chosen?.key" @click="picked = m.key">
          {{ MONTHS_NOM[Number(m.key.slice(5)) - 1].slice(0, 3).toLowerCase() }}
        </Chip>
      </div>
      <p v-if="chosen" class="mb-1 text-[14px] text-ink-2 num" data-month-line>
        в {{ monthIn(chosen.key, false) }} по {{ plain(chosen.rate) }} ₸ ·
        было бы <b :class="tone(chosen.tenge)">{{ signed(chosen.tenge) }}</b>
      </p>
    </template>
  </Sheet>
</template>
