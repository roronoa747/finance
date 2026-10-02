<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'
import BreakdownRing from '@/components/kit/BreakdownRing.vue'
import Card from '@/components/kit/Card.vue'
import CountUp from '@/components/kit/CountUp.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toggle from '@/components/kit/Toggle.vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { atLabel, monthKey } from '@/lib/dates'
import { money } from '@/lib/money'
import { ARTICLE_COLORS } from '@/lib/palette'
import {
  ARTICLE_NAMES,
  breakdownEffects,
  breakdownFill,
  lastAccountFor,
  monthBreakdown,
  paidFor,
  payableAccounts,
  recordedBreakdown,
  ringShares,
  type BreakdownSource,
} from '@/lib/finance'
import type { ArticleKey, PersonId } from '@/types/finance'

/**
 * Разбор зарплаты кольцом (B2C-57, Р-53…Р-55, Р-65; макет `money-breakdown.html` «Б · Кольцо»): сумма —
 * кольцом, статьи — чипами; первое нажатие выбирает статью (карточка ниже), второе — выключает или
 * включает её на этот разбор; одна брендовая «Разложить». Все суммы — `monthBreakdown` /
 * `breakdownFill` (`finance.ts`), исполнение — `applyBreakdown` стора. Записанный разбор — то же
 * кольцо без кнопки. Viewer видит кольцо и статусы, без кнопки и переключателей.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()
const member = computed(() => !authStore.isViewer)

const q = (name: string) => {
  const v = route.query[name]
  return typeof v === 'string' ? v : ''
}

/** Источник — параметры адреса прежней раскладки; без `from` — освободившийся платёж, как было. */
const source = computed<BreakdownSource>(() => {
  const from = q('from')
  if (from === 'salary') return { from, person: q('person') as PersonId, period: q('period') || monthKey() }
  if (from === 'rest') return { from, amount: Number(q('amount')) || 0, period: q('period') || monthKey() }
  if (from === 'credit') return { from, creditId: q('credit') }
  return { from: 'freed' }
})

const mb = computed(() => {
  const doc = financeStore.householdDoc
  return monthBreakdown(
    { ...doc, credits: financeStore.credits },
    { key: monthKey(), totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: ops.uploads, rawCredits: doc.credits },
    source.value,
  )
})
const recorded = computed(() => mb.value?.recorded ?? null)

// Первый разбор начинается с «Ваш порядок» (Р-55): порядок не пройден — сначала он, с тем же источником.
watchEffect(() => {
  if (member.value && mb.value && !recorded.value && !financeStore.moneySettings.orderedAt) {
    void router.replace({ path: '/week/order', query: route.query })
  }
})

/** Статьи, выключенные на этот разбор; сначала — выключенные в плане. */
const off = ref<ArticleKey[]>(mb.value?.articles.filter((a) => !a.on).map((a) => a.key) ?? [])
const articles = computed(() => (mb.value?.articles ?? []).map((a) => ({ ...a, on: !off.value.includes(a.key) })))
const fill = computed(() => (mb.value ? breakdownFill(articles.value, mb.value.amount, mb.value.covered, mb.value.expected) : null))
const segments = computed(() =>
  mb.value && fill.value
    ? ringShares(articles.value.map((a) => ({ key: a.key, amount: fill.value!.given[a.key] })), mb.value.amount).map((s) => ({
        ...s,
        color: ARTICLE_COLORS[s.key],
      }))
    : [],
)

const picked = ref<ArticleKey | null>(null)
const selected = computed(() => articles.value.find((a) => a.key === picked.value) ?? articles.value[0] ?? null)
/** Первое нажатие выбирает статью, второе — выключает или включает (Р-53); viewer — только выбирает. */
function tap(key: ArticleKey) {
  if (selected.value?.key === key && member.value) toggle(key)
  else picked.value = key
}
function toggle(key: ArticleKey) {
  off.value = off.value.includes(key) ? off.value.filter((k) => k !== key) : [...off.value, key]
}

const nameOf = (id: string) => financeStore.people.find((p) => p.id === id)?.name ?? 'участника'
const waitingNames = computed(() => (mb.value?.waitingFor ?? []).map(nameOf).join(' и '))
const selectedStatus = computed(() =>
  selected.value && fill.value?.waiting.includes(selected.value.key) ? `ждёт зарплату ${waitingNames.value}` : (selected.value?.status ?? ''),
)

/* ---------- счёт и «Разложить» ---------- */
const effects = computed(() => (mb.value && fill.value ? breakdownEffects(fill.value.given, articles.value, mb.value.mode) : null))
/** Деньги уходят со счёта: взносы и досрочка разового разбора. */
const moves = computed(() => mb.value?.mode === 'once' && !!effects.value && (effects.value.contributions.length > 0 || !!effects.value.prepay))
const chosen = ref<string | null | undefined>(undefined)
const account = computed<string | null | undefined>(() => {
  if (chosen.value !== undefined) return chosen.value
  const s = source.value
  if (s.from === 'salary') {
    const rec = paidFor(financeStore.payments, 'salary', s.person, s.period)
    if (rec && rec.accountId !== undefined) return rec.accountId
  }
  return authStore.slot ? lastAccountFor(financeStore.payments, authStore.slot, financeStore.accounts) : undefined
})
const accountName = computed(() =>
  account.value === null ? 'не двигать счёт' : (financeStore.accounts.find((a) => a.id === account.value)?.name ?? 'выбрать счёт'),
)
const accountOpen = ref(false)

function lay() {
  const m = mb.value
  if (!m || !effects.value || recorded.value) return
  if (moves.value && account.value === undefined) {
    accountOpen.value = true
    return
  }
  financeStore.applyBreakdown({
    record: m.record,
    total: m.amount,
    mode: m.mode,
    effects: effects.value,
    off: off.value.filter((k) => articles.value.some((a) => a.key === k)),
    by: authStore.slot ?? 'a',
    accountId: account.value,
    note: source.value.from === 'rest' ? 'из остатка месяца' : 'из зарплаты',
  })
  void financeStore.syncHousehold()
}

/* ---------- записанный разбор ---------- */
const done = computed(() => (recorded.value?.kind === 'breakdown' ? recordedBreakdown(recorded.value, financeStore.moneyArticles.map((a) => a.id)) : null))
const doneSegments = computed(() =>
  done.value && recorded.value
    ? ringShares(done.value.parts, recorded.value.total).map((s) => ({ ...s, color: ARTICLE_COLORS[s.key] }))
    : [],
)

/** Пусто: разбирать нечего — по источнику. */
const emptyText = computed(() => {
  const s = source.value
  if (s.from === 'salary') return mb.value ? 'Разбирать нечего.' : 'Эта зарплата ещё не отмечена.'
  if (s.from === 'credit') return mb.value ? 'Платёж этого долга уже идёт в следующий долг по плану.' : 'Этот долг ещё не закрыт.'
  return 'Разбирать нечего.'
})
</script>

<template>
  <!-- ЗАПИСАНО: то же кольцо, без кнопки (второй раз те же деньги не раскладываются). -->
  <div v-if="recorded" class="flex flex-col gap-3 pt-1">
    <template v-if="done">
      <BreakdownRing :segments="doneSegments" still :label="`Разложено ${money(recorded.total)}`">
        <span class="type-label">Разложено</span>
        <span class="type-big-md num text-ink">{{ money(recorded.total) }}</span>
        <span class="type-meta num">остаётся {{ money(done.rest) }}</span>
      </BreakdownRing>
      <Card tight class="flex flex-col">
        <div v-for="p in done.parts" :key="p.key" class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0">
          <i class="size-2.5 shrink-0 rounded-full" :style="{ background: ARTICLE_COLORS[p.key] }" aria-hidden="true" />
          <span class="flex-1 text-[15px] text-ink">{{ ARTICLE_NAMES[p.key] }}</span>
          <b class="num text-[15px] text-ink">{{ money(p.amount) }}</b>
        </div>
      </Card>
    </template>
    <Card v-else>
      <div class="type-label">Уже разложено</div>
      <div class="mt-1 type-big-md num text-ink">{{ money(recorded.total) }}</div>
    </Card>
    <p class="px-1 type-meta">{{ nameOf(recorded.by) }} · {{ atLabel(recorded.at) }}</p>
    <Button variant="secondary" class="w-full" @click="router.replace('/week')">К неделе</Button>
  </div>

  <!-- РАЗБИРАТЬ НЕЧЕГО -->
  <div v-else-if="!mb || mb.amount <= 0 || !fill" class="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
    <p class="text-[14px] text-ink-2">{{ emptyText }}</p>
    <Button variant="secondary" @click="router.replace('/week')">К неделе</Button>
  </div>

  <!-- РАЗБОР -->
  <div v-else :class="['flex flex-col gap-3 pt-1', member ? 'pb-28' : '']">
    <BreakdownRing :segments="segments" :label="`Остаётся ${money(fill.rest)} из ${money(mb.amount)}`">
      <span class="type-label">Остаётся</span>
      <span class="type-big-md num text-ink"><CountUp :value="fill.rest" :from="mb.amount" :format="money" /></span>
      <span class="type-meta num">из <b class="font-semibold text-ink-2">{{ money(mb.amount) }}</b></span>
    </BreakdownRing>

    <p v-if="fill.short > 0" class="px-1 text-center text-[13.5px] font-semibold text-destructive num">не хватает {{ money(fill.short) }}</p>

    <div class="flex flex-wrap gap-2" role="group" aria-label="Статьи">
      <button
        v-for="a in articles"
        :key="a.key"
        type="button"
        :aria-pressed="a.on"
        :data-chip="a.key"
        :class="[
          'press flex cursor-pointer items-center gap-[7px] rounded-pill border-[1.5px] px-3 py-2 text-[14px] font-semibold',
          !a.on ? 'border-dashed border-line bg-transparent text-ink-3' : selected?.key === a.key ? 'border-ink bg-surface-2 text-ink' : 'border-line bg-surface text-ink',
        ]"
        @click="tap(a.key)"
      >
        <i class="size-[9px] rounded-full" :style="{ background: a.on ? ARTICLE_COLORS[a.key] : 'var(--track)' }" aria-hidden="true" />
        {{ a.name }}
      </button>
    </div>

    <Card v-if="selected" tight class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between gap-3">
        <b class="text-[17px] text-ink">{{ selected.name }}</b>
        <Toggle v-if="member" :model-value="selected.on" :label="selected.name" tone="ok" @update:model-value="toggle(selected.key)" />
      </div>
      <span :class="['type-big-md num', selected.on ? 'text-ink' : 'text-ink-3 line-through']">{{ money(selected.on ? fill.given[selected.key] : (selected.left ?? 0)) }}</span>
      <span class="type-meta">{{ selectedStatus }}</span>
    </Card>

    <Button v-if="member" variant="ghost" size="sm" class="self-center" @click="router.push({ path: '/week/order', query: route.query })">Изменить порядок</Button>

    <!-- Док (макет `.dock`): главная кнопка прижата к низу экрана поверх прокрутки. -->
    <div v-if="member" class="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 bg-gradient-to-b from-transparent to-canvas to-30% px-4 pb-[18px] pt-3">
      <button v-if="moves" type="button" class="cursor-pointer self-center type-meta" @click="accountOpen = true">со счёта · {{ accountName }}</button>
      <Button class="w-full" @click="lay">Разложить</Button>
    </div>
  </div>

  <Sheet v-if="member" :open="accountOpen" title="Со счёта" @close="accountOpen = false">
    <AccountChoice
      :model-value="account"
      :accounts="payableAccounts(financeStore.accounts)"
      label="Откуда отложить и внести"
      none="Не двигать остаток счёта"
      @update:model-value="(v) => { chosen = v; accountOpen = false }"
    />
  </Sheet>
</template>
