<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { PhCheck, PhCircleNotch } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import { amountTotal, liveSpendCategories } from '@/lib/finance'
import { reducedMotion } from '@/lib/motion'
import { money } from '@/lib/money'
import { spendColor } from '@/lib/palette'
import { plural } from '@/lib/utils'
import { aiLimitText, useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import type { UnknownGroup } from '@/lib/statements/model'
import type { MerchantRule } from '@/lib/statements/types'

/**
 * Незнакомые продавцы пачкой (Р-58, макет `money-breakdown.html` вопрос 3 «А · Пачкой»): «Без раздела · N»,
 * строки с отметкой (первые шесть, хвост — «Ещё K · сумма ›»), «Выбрать все»; отмечено ≥ 1 — внизу «Выбрано N ·
 * сумма» и «куда?» (`CategoryChips` с «Не помню»). Ответ — всем отмеченным разом; что с ним делать (черновик или
 * задним числом), решает родитель. Отвеченные уходят из списка сами — группы приходят заново.
 *
 * ИИ (бэклог «ИИ», AI-12, Р-5): открыли пачку — `suggestSellers` спрашивает раздел продавцам без предложения; у
 * продавца с предложением под подписью — чип раздела, справа ✓ — тот же ответ, что чипами, одному продавцу. Само
 * ничего не применяется; «Принять все» нет. В шапке — «ИИ предлагает · N» строкой, ошибки — тихо, той же строкой.
 * Продавцы с предложением — первыми (AI-17, владелец после `/ux` Блока 3): иначе на настоящих выписках они уходили в
 * «Ещё» под переводы людям и «ИП + фамилия», которых ИИ не спрашивает. Меняется только вид — очередь «Недели» прежняя.
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

const ai = useAiStore()
const finance = useFinanceStore()
onMounted(() => void ai.suggestSellers(props.groups))
const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
/** Предложенный раздел продавца — если он ещё есть у семьи; переводы людям ИИ не спрашиваются. */
const hints = computed(() => {
  const out = new Map<string, (typeof categories.value)[number]>()
  for (const g of props.groups) {
    const id = ai.sellerHint(g.match)
    const c = id ? categories.value.find((x) => x.id === id) : undefined
    if (c) out.set(keyOf(g), c)
  }
  return out
})
const hintOf = (g: UnknownGroup) => hints.value.get(keyOf(g)) ?? null
/** С предложением — первыми, остальные — после; внутри обеих частей — как пришли (по сумме). Без предложений — как было. */
const ordered = computed(() => {
  if (!hints.value.size) return props.groups
  const has = (g: UnknownGroup) => hints.value.has(keyOf(g))
  return [...props.groups.filter(has), ...props.groups.filter((g) => !has(g))]
})
const shown = computed(() => (open.value ? ordered.value : ordered.value.slice(0, SHOWN)))
const tail = computed(() => (open.value ? [] : ordered.value.slice(SHOWN)))
// Место ✓ держится и пока ответ идёт: иначе через 3–6 с все суммы съезжают влево на ширину ✓ (`/ux` Блока 3).
const aiColumn = computed(() => hints.value.size > 0 || ai.sellersState === 'thinking')
/** Строка шапки: идёт запрос, лимит, не пришли — или сколько предложений. */
const aiLine = computed(() =>
  ai.sellersState === 'thinking'
    ? 'ИИ думает…'
    : ai.sellersState === 'limit'
      ? aiLimitText()
      : ai.sellersState === 'failed'
        ? 'Подсказки не пришли'
        : hints.value.size
          ? `ИИ предлагает · ${hints.value.size}`
          : '',
)
/** ✓ — тот же ответ, что выбор раздела чипами, одному продавцу: то же правило «продавец → раздел». */
function accept(g: UnknownGroup, categoryId: string) {
  picked.value = picked.value.filter((k) => k !== keyOf(g))
  emit('answer', [g.match], { categoryId })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <section ref="card" class="fx-in flex scroll-mt-2 flex-col gap-3 text-left" :class="!bare && 'rounded-card border border-brand bg-surface p-5'" aria-live="polite">
      <div v-if="progress" class="type-meta flex items-center gap-2.5">
        <ProgressBar :value="progress.k ? progress.n / progress.k : 0" :height="4" class="flex-1" />
        <span class="num shrink-0">{{ progress.n }} из {{ progress.k }}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="type-h2 text-ink">Без раздела · <span class="num">{{ groups.length }}</span></h2>
          <button type="button" class="shrink-0 text-[14px] font-medium text-ink-2 hover:text-ink cursor-pointer" @click="toggleAll">
            {{ allPicked ? 'Снять все' : 'Выбрать все' }}
          </button>
        </div>
        <p v-if="aiLine" class="type-meta num flex items-center gap-1.5" data-ai-sellers>
          <PhCircleNotch v-if="ai.sellersState === 'thinking'" :size="13" class="shrink-0 animate-spin" aria-hidden="true" data-ai-spin />
          <i v-else-if="hints.size && ai.sellersState === 'idle'" class="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />{{ aiLine }}
        </p>
      </div>
      <!-- Перестановка (ответ ИИ, ✓) — плавно: соседи едут (`move`), ушедшая гаснет вне потока. Блок, не flex: в flex
           `absolute` встал бы к верху списка. Граница — по индексу, не `first:`: гаснущая строка ещё первая в DOM.
           Появление `fx-in` — классом входа, не постоянным: с анимацией на строке Vue считает её «анимацией» и `move`
           не включает (320 мс `fx-in` длиннее 150 мс перехода). -->
      <TransitionGroup
        tag="div"
        class="relative"
        appear
        enter-active-class="fx-in"
        move-class="transition-transform duration-(--motion-fast) ease-(--ease-out)"
        leave-active-class="absolute inset-x-0 transition-opacity duration-150"
        leave-to-class="opacity-0"
      >
        <div
          v-for="(g, i) in shown"
          :key="keyOf(g)"
          class="flex w-full items-center gap-3 pb-2.5"
          :class="i > 0 && 'border-t border-line pt-2.5'"
          :style="{ '--i': i }"
          data-unknown-row
        >
          <button type="button" :aria-pressed="isOn(g)" class="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" @click="toggle(g)">
            <span
              class="grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors"
              :class="isOn(g) ? 'border-ink bg-ink text-canvas' : 'border-line-strong'"
              aria-hidden="true"
            >
              <PhCheck v-if="isOn(g)" :size="13" weight="bold" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold text-ink">{{ g.label }}</span>
              <span class="flex min-w-0 items-center gap-1.5 type-meta num">
                <span class="shrink-0">{{ g.count }} {{ plural(g.count, 'раз', 'раза', 'раз') }}</span>
                <span
                  v-if="hintOf(g)"
                  class="-my-px inline-flex min-w-0 items-center gap-1 rounded-pill bg-surface-3 px-2 py-px text-[12.5px] font-medium text-ink"
                  data-ai-hint
                >
                  <i class="size-2 shrink-0 rounded-full" :style="{ background: spendColor(hintOf(g)) }" aria-hidden="true" />
                  <span class="truncate">{{ hintOf(g)!.name }}</span>
                </span>
              </span>
            </span>
            <span class="money shrink-0 text-ink">{{ money(g.amount) }}</span>
          </button>
          <Button
            v-if="hintOf(g)"
            variant="soft"
            size="sm"
            class="w-8 shrink-0 px-0"
            :aria-label="`Принять: ${hintOf(g)!.name}`"
            data-ai-accept
            @click="accept(g, hintOf(g)!.id)"
          >
            <PhCheck :size="16" weight="bold" />
          </Button>
          <span v-else-if="aiColumn" class="w-8 shrink-0" aria-hidden="true" />
        </div>
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
