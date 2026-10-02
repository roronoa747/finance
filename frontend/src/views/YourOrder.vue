<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/kit/Card.vue'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import Sheet from '@/components/kit/Sheet.vue'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { addMonths, monthKey } from '@/lib/dates'
import { money, parseMoney, plain } from '@/lib/money'
import { ARTICLE_NAMES, articleFact, liveSpendCategories, orderLine } from '@/lib/finance'
import { plannedElsewhere, spendArticle } from '@/lib/statements/dictionary'
import type { ArticleKey } from '@/types/finance'

/**
 * «Ваш порядок» (B2C-56, Р-51, Р-55; макет `money-breakdown.html`, вопрос 2 «Первый раз · порядок»):
 * статьи разбора сверху вниз — ступени. Перестановка — за ⋮⋮ пальцем (pointer-события) или
 * стрелками у фокуса, пишется сразу; нажатие на статью — лист с её настройками; «Готово» —
 * порядок пройден, назад в разбор с тем же источником. Только member (маршрут).
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const ops = useOperationsStore()

const settings = computed(() => financeStore.moneySettings)
const byId = computed(() => new Map(financeStore.moneyArticles.map((a) => [a.id, a])))

/** Порядок на экране: во время перетаскивания — свой, иначе — из документа. */
const ids = ref<ArticleKey[]>(financeStore.moneyArticles.map((a) => a.id))
const drag = ref<{ id: ArticleKey; startY: number; dy: number; h: number } | null>(null)
watch(
  () => financeStore.moneyArticles.map((a) => a.id).join(','),
  (v) => {
    if (!drag.value) ids.value = v.split(',') as ArticleKey[]
  },
)

function swap(i: number, j: number) {
  const next = ids.value.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  ids.value = next
}

function onDown(e: PointerEvent, id: ArticleKey) {
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture?.(e.pointerId)
  const row = grip.closest('[data-row]') as HTMLElement | null
  drag.value = { id, startY: e.clientY, dy: 0, h: row?.offsetHeight || 60 }
}

/** Строка едет за пальцем; пересекла половину соседней — меняются местами. */
function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  d.dy = e.clientY - d.startY
  const i = ids.value.indexOf(d.id)
  if (d.dy > d.h / 2 && i < ids.value.length - 1) {
    swap(i, i + 1)
    d.startY += d.h
    d.dy -= d.h
  } else if (d.dy < -d.h / 2 && i > 0) {
    swap(i, i - 1)
    d.startY -= d.h
    d.dy += d.h
  }
}

function onUp() {
  if (!drag.value) return
  drag.value = null
  financeStore.reorderArticles(ids.value)
}

const grips = ref<Record<string, HTMLElement | null>>({})
function onKey(e: KeyboardEvent, id: ArticleKey) {
  const i = ids.value.indexOf(id)
  const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
  if (j < 0 || j >= ids.value.length) return
  e.preventDefault()
  swap(i, j)
  financeStore.reorderArticles(ids.value)
  void nextTick(() => grips.value[id]?.focus())
}

/* ---------- лист статьи ---------- */
const open = ref<ArticleKey | null>(null)
const openArticle = computed(() => (open.value ? byId.value.get(open.value) ?? null : null))
const plan = computed(() => financeStore.activePlan)
/** Подушка — шаг плана, только если у плана есть своя подушка (Р-66). */
const byPlan = computed(() => (open.value === 'debts' && !!plan.value) || (open.value === 'cushion' && !!plan.value?.cushionGoalId))

/** «По выпискам прошлого месяца» — подсказка суммы «Жизни» и «Трат». */
const lastKey = computed(() => addMonths(monthKey(), -1))
const lastFact = computed(() =>
  articleFact(financeStore.householdDoc.spendTotals ?? [], financeStore.householdDoc.spendCategories ?? [], lastKey.value, ops.uploads),
)
const suggestion = computed(() => (open.value === 'life' || open.value === 'spend') && lastFact.value ? lastFact.value[open.value] : null)

/** Разделы выписки, которые делятся между «Жизнью» и «Тратами» (учтённые платежами — в «Обязательном»). */
const sections = computed(() => {
  const cats = financeStore.householdDoc.spendCategories ?? []
  return liveSpendCategories(cats).filter((c) => !plannedElsewhere(c.id, cats))
})
const inArticle = (id: string) => spendArticle(id, financeStore.householdDoc.spendCategories ?? [])

function setAmount(text: string) {
  if (open.value) financeStore.setArticle(open.value, { amount: Math.max(0, parseMoney(text)) })
}
/** Порог ступени — целые, в своих пределах (Запас 1–3, Подушка 1–12 месяцев, ставка 0–100 %). */
function setLimit(field: 'reserveMonths' | 'cushionMonths' | 'costlyRate', text: string) {
  const [lo, hi] = field === 'reserveMonths' ? [1, 3] : field === 'cushionMonths' ? [1, 12] : [0, 100]
  financeStore.setMoneySettings({ [field]: Math.min(hi, Math.max(lo, parseMoney(text))) })
}
function moveSection(id: string) {
  if (!open.value || (open.value !== 'life' && open.value !== 'spend')) return
  financeStore.setSpendArticle(id, inArticle(id) === open.value ? (open.value === 'life' ? 'spend' : 'life') : open.value)
}

/** «Готово»: порядок пройден (Р-55) — назад в разбор с тем же источником. */
function done() {
  financeStore.reorderArticles(ids.value)
  financeStore.setMoneySettings({ orderedAt: new Date().toISOString() })
  if (Object.keys(route.query).length) void router.replace({ path: '/week/breakdown', query: route.query })
  else void router.replace('/week')
}
</script>

<template>
  <div class="flex flex-col gap-3 pb-24 pt-1">
    <p class="flex items-center gap-1 px-1 type-meta">
      Сверху — что важнее
      <Hint label="Как работает порядок">
        Зарплата закрывает статьи сверху вниз, пока хватает. Порядок выбирается один раз — дальше каждый месяц
        «как обычно». Нажмите на статью, чтобы поменять сумму или порог.
      </Hint>
    </p>

    <Card flush class="px-3.5">
      <ol class="flex flex-col" aria-label="Статьи по порядку">
        <li
          v-for="(id, i) in ids"
          :key="id"
          data-row
          :data-article="id"
          :class="[
            'relative flex items-center gap-3 border-t border-line py-3 first:border-t-0',
            drag?.id === id ? 'z-10 rounded-[14px] bg-surface-2 shadow-lg' : '',
          ]"
          :style="drag?.id === id ? { transform: `translateY(${drag.dy}px)` } : undefined"
        >
          <span class="grid size-[22px] shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-bold text-ink-2 num">{{ i + 1 }}</span>
          <button type="button" class="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left" @click="open = id">
            <span class="text-[16px] font-semibold text-ink">{{ ARTICLE_NAMES[id] }}</span>
            <span class="truncate text-[12.5px] text-ink-3">{{ orderLine(id, settings) }}</span>
          </button>
          <button
            :ref="(el) => (grips[id] = el as HTMLElement | null)"
            type="button"
            :aria-label="`Переставить «${ARTICLE_NAMES[id]}»: стрелки вверх и вниз`"
            class="grid h-11 w-9 shrink-0 cursor-grab touch-none place-items-center text-[18px] tracking-[-2px] text-ink-3 select-none"
            @pointerdown="onDown($event, id)"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @keydown="onKey($event, id)"
          >
            ⋮⋮
          </button>
        </li>
      </ol>
    </Card>

    <!-- Док (макет `.dock`): «Готово» прижата к низу экрана поверх прокрутки. -->
    <div class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-b from-transparent to-canvas to-30% px-4 pb-[18px] pt-3">
      <Button class="w-full" @click="done">Готово</Button>
    </div>
  </div>

  <Sheet :open="!!openArticle" :title="openArticle ? ARTICLE_NAMES[openArticle.id] : ''" @close="open = null">
    <template v-if="openArticle">
      <p v-if="byPlan" class="type-meta">по плану «Сначала долги»</p>
      <p v-else-if="openArticle.id === 'must'" class="type-meta">из платежей месяца</p>
      <p v-else-if="openArticle.id === 'dreams'" class="type-meta">взносы целей</p>
      <template v-else>
        <Field v-if="openArticle.id === 'reserve'" label="Месяцев трат">
          <NumFieldBlur :initial="settings.reserveMonths" kind="int" aria-label="Запас — месяцев трат" class-name="bg-surface-2" @commit="setLimit('reserveMonths', $event)" />
        </Field>
        <Field v-if="openArticle.id === 'cushion'" label="Месяцев">
          <NumFieldBlur :initial="settings.cushionMonths" kind="int" aria-label="Подушка — месяцев" class-name="bg-surface-2" @commit="setLimit('cushionMonths', $event)" />
        </Field>
        <Field v-if="openArticle.id === 'debts'" label="Дороже, %">
          <NumFieldBlur :initial="settings.costlyRate" kind="int" aria-label="Дорогой долг — дороже, %" class-name="bg-surface-2" @commit="setLimit('costlyRate', $event)" />
        </Field>
        <Field :label="openArticle.id === 'life' || openArticle.id === 'spend' ? 'В месяц' : 'Взнос в месяц'">
          <NumFieldBlur :initial="plain(openArticle.amount ?? 0)" :aria-label="`${ARTICLE_NAMES[openArticle.id]} — в месяц`" class-name="bg-surface-2" @commit="setAmount" />
        </Field>
        <Button
          v-if="suggestion !== null && suggestion !== (openArticle.amount ?? 0)"
          variant="ghost"
          size="sm"
          class="-mt-2 self-start num"
          @click="financeStore.setArticle(openArticle.id, { amount: suggestion })"
        >
          по выпискам прошлого месяца {{ money(suggestion) }}
        </Button>
        <div v-if="openArticle.id === 'life' || openArticle.id === 'spend'" class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Разделы статьи">
          <Chip v-for="c in sections" :key="c.id" :on="inArticle(c.id) === openArticle.id" @click="moveSection(c.id)">{{ c.name }}</Chip>
        </div>
      </template>
    </template>
  </Sheet>
</template>
