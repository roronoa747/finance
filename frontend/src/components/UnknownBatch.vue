<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhCheck } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import { amountTotal } from '@/lib/finance'
import { reducedMotion } from '@/lib/motion'
import { money } from '@/lib/money'
import { plural } from '@/lib/utils'
import type { UnknownGroup } from '@/lib/statements/model'
import type { MerchantRule } from '@/lib/statements/types'

/**
 * Незнакомые продавцы пачкой (Р-58, макет `money-breakdown.html` вопрос 3 «А · Пачкой»): «Без раздела · N»,
 * строки с отметкой (первые шесть, хвост — «Ещё K · сумма ›»), «Выбрать все»; отмечено ≥ 1 — внизу «Выбрано N ·
 * сумма» и «куда?» (`CategoryChips` с «Не помню»). Ответ — всем отмеченным разом; что с ним делать (черновик или
 * задним числом), решает родитель. Отвеченные уходят из списка сами — группы приходят заново.
 */
const SHOWN = 6

// `bare` — внутри листа вопросов «Недели» (Р-97): без своей рамки и отступов, «куда?» — обычным блоком под списком.
const props = withDefaults(defineProps<{ groups: UnknownGroup[]; progress?: { n: number; k: number } | null; bare?: boolean }>(), { progress: null, bare: false })
const emit = defineEmits<{
  (e: 'answer', matches: MerchantRule['match'][], to: MerchantRule['to']): void
  (e: 'later'): void
}>()

const keyOf = (g: UnknownGroup) => JSON.stringify(g.match)
const picked = ref<string[]>([])
const open = ref(false)
// Отвеченные группы ушли — отметки остаются только у тех, что ещё в списке.
watch(
  () => props.groups.map(keyOf),
  (keys) => (picked.value = picked.value.filter((k) => keys.includes(k))),
)

const shown = computed(() => (open.value ? props.groups : props.groups.slice(0, SHOWN)))
const tail = computed(() => (open.value ? [] : props.groups.slice(SHOWN)))
const chosen = computed(() => props.groups.filter((g) => picked.value.includes(keyOf(g))))
const allPicked = computed(() => chosen.value.length === props.groups.length)
// «Кому → что» — только когда все отмеченные — переводы людям.
const people = computed(() => chosen.value.every((g) => !!g.match.counterparty))

// Первая отметка — док «куда?» встаёт снизу: пачка поднимается к верху экрана, чтобы строки не ушли под него.
const card = ref<HTMLElement | null>(null)
watch(
  () => chosen.value.length > 0,
  async (on) => {
    if (!on || props.bare) return
    await nextTick()
    card.value?.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  },
)

const isOn = (g: UnknownGroup) => picked.value.includes(keyOf(g))
function toggle(g: UnknownGroup) {
  const k = keyOf(g)
  picked.value = isOn(g) ? picked.value.filter((x) => x !== k) : [...picked.value, k]
}
function toggleAll() {
  picked.value = allPicked.value ? [] : props.groups.map(keyOf)
}
function choose(to: MerchantRule['to']) {
  emit(
    'answer',
    chosen.value.map((g) => g.match),
    to,
  )
  picked.value = []
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <section ref="card" class="fx-in flex scroll-mt-2 flex-col gap-3 text-left" :class="!bare && 'rounded-card border border-brand bg-surface p-5'" aria-live="polite">
      <div v-if="progress" class="type-meta flex items-center gap-2.5">
        <ProgressBar :value="progress.k ? progress.n / progress.k : 0" :height="4" class="flex-1" />
        <span class="num shrink-0">{{ progress.n }} из {{ progress.k }}</span>
      </div>
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="type-h2 text-ink">Без раздела · <span class="num">{{ groups.length }}</span></h2>
        <button type="button" class="shrink-0 text-[14px] font-medium text-ink-2 hover:text-ink cursor-pointer" @click="toggleAll">
          {{ allPicked ? 'Снять все' : 'Выбрать все' }}
        </button>
      </div>
      <TransitionGroup tag="div" class="flex flex-col" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
        <button
          v-for="(g, i) in shown"
          :key="keyOf(g)"
          type="button"
          :aria-pressed="isOn(g)"
          class="fx-in flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0 cursor-pointer"
          :style="{ '--i': i }"
          @click="toggle(g)"
        >
          <span
            class="grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors"
            :class="isOn(g) ? 'border-ink bg-ink text-canvas' : 'border-line-strong'"
            aria-hidden="true"
          >
            <PhCheck v-if="isOn(g)" :size="13" weight="bold" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-ink">{{ g.label }}</span>
            <span class="block type-meta num">{{ g.count }} {{ plural(g.count, 'раз', 'раза', 'раз') }}</span>
          </span>
          <span class="money shrink-0 text-ink">{{ money(g.amount) }}</span>
        </button>
        <button
          v-if="tail.length"
          key="tail"
          type="button"
          class="flex w-full items-center border-t border-line pt-2.5 text-left type-meta num hover:text-ink cursor-pointer"
          @click="open = true"
        >
          Ещё {{ tail.length }} · {{ money(amountTotal(tail)) }} ›
        </button>
      </TransitionGroup>
      <Button variant="ghost" class="self-start px-2.5" @click="emit('later')">Потом</Button>
    </section>

    <!-- Отмечено ≥ 1 — «куда?» прилипает над капсулой вкладок, пока пачка на экране (макет `.dock`); отступ под капсулу — `pb-24` у `main`. -->
    <div
      v-if="chosen.length"
      class="fx-in flex flex-col gap-2"
      :class="!bare && 'sticky -bottom-6 z-[5] -mx-4 px-4 pb-8 pt-7'"
      :style="bare ? undefined : { background: 'linear-gradient(to bottom, transparent, var(--canvas) 24px)' }"
    >
      <span class="text-center type-meta num">Выбрано {{ chosen.length }} · {{ money(amountTotal(chosen)) }}</span>
      <CategoryChips forgot :top="3" :counterparty="people" @choose="choose" />
    </div>
  </div>
</template>
