<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhCheck, PhLink, PhPlus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney } from '@/lib/money'
import { addMonths, monthKey, monthTitle } from '@/lib/dates'
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import { contributionStreak, liveGoals, liveWishlist } from '@/lib/finance'
import type { PersonId, WishItem } from '@/types/finance'
import { cn } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Tag from '@/components/kit/Tag.vue'
import Callout from '@/components/kit/Callout.vue'
import Ring from '@/components/Ring.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { PhX } from '@phosphor-icons/vue'

type Tab = 'goals' | 'wish'
const tab = ref<Tab>('goals')

const router = useRouter()
const financeStore = useFinanceStore()

const goals = computed(() => liveGoals(financeStore.goals))
const wishlist = computed(() => liveWishlist(financeStore.wishlist))
const people = computed(() => financeStore.people)

const allMovements = computed(() => goals.value.flatMap((g) => g.movements || []))
const streak = computed(() => contributionStreak(allMovements.value))
const filledMonths = computed(
  () => new Set(allMovements.value.filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7))),
)
const last12 = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const k = addMonths(monthKey(), i - 11)
    return { key: k, label: monthTitle(k), filled: filledMonths.value.has(k) }
  }),
)

function monthWord(n: number) {
  const t = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return 'месяцев'
  if (t === 1) return 'месяц'
  if (t >= 2 && t <= 4) return 'месяца'
  return 'месяцев'
}

/* ------------------ Создание цели ------------------ */
const openGoalModal = ref(false)
const goalName = ref('')
const goalNeed = ref('')
const goalHave = ref('0')
const goalMonthly = ref('')
const goalHue = ref<HueKey>('blue')

const parsedNeed = computed(() => parseMoney(goalNeed.value))
const canCreateGoal = computed(() => goalName.value.trim().length > 0 && parsedNeed.value > 0)

function createGoal() {
  if (!canCreateGoal.value) return
  const need = parsedNeed.value
  const have = parseMoney(goalHave.value)
  const monthly = parseMoney(goalMonthly.value) || Math.ceil(need / 24)

  financeStore.addGoal({
    name: goalName.value.trim(),
    need,
    have,
    monthly,
    hue: goalHue.value,
  })

  goalName.value = ''
  goalNeed.value = ''
  goalHave.value = '0'
  goalMonthly.value = ''
  goalHue.value = 'blue'
  openGoalModal.value = false
}

/* ------------------ Покупки (Wishlist) ------------------ */
const openWishModal = ref(false)
const wishName = ref('')
const wishPrice = ref('')
const wishUrl = ref('')
const wishBy = ref<PersonId>('a')
const justBought = ref<string | null>(null)

const activeWish = computed(() => wishlist.value.filter((w) => !w.bought))
const boughtWish = computed(() => wishlist.value.filter((w) => w.bought))

function nameOf(id: PersonId) {
  return people.value.find((p) => p.id === id)?.name || 'Участник'
}

function createWish() {
  if (!wishName.value.trim()) return
  const id = Math.random().toString(36).slice(2, 10)
  const t = new Date().toISOString()
  const item: WishItem = {
    id,
    name: wishName.value.trim(),
    price: parseMoney(wishPrice.value),
    by: wishBy.value,
    url: wishUrl.value.trim() || undefined,
    bought: false,
    addedOn: new Date().toLocaleDateString('ru-RU'),
    updatedAt: t,
  }

  financeStore.mutateHouseholdDoc((doc) => {
    if (!doc.wishlist) doc.wishlist = []
    doc.wishlist.push(item)
  })

  wishName.value = ''
  wishPrice.value = ''
  wishUrl.value = ''
  openWishModal.value = false
}

function toggleWishBought(id: string, itemName: string) {
  financeStore.mutateHouseholdDoc((doc) => {
    const item = (doc.wishlist || []).find((w) => w.id === id)
    if (item) {
      item.bought = !item.bought
      item.boughtOn = item.bought ? new Date().toISOString() : undefined
      item.updatedAt = new Date().toISOString()
      if (item.bought) {
        justBought.value = itemName
      }
    }
  })
}
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1">
    <Segmented
      v-model="tab"
      :options="[
        { value: 'goals', label: 'Цели' },
        { value: 'wish', label: 'Покупки' },
      ]"
    />

    <!-- Вкладка ЦЕЛИ -->
    <template v-if="tab === 'goals'">
      <Card flush>
        <div
          v-for="g in goals"
          :key="g.id"
          class="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors"
          @click="router.push(`/goals/${g.id}`)"
        >
          <Ring
            :progress="g.need > 0 ? g.have / g.need : 0"
            :plan="g.planPct"
            :hue="g.hue"
            :size="40"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[14.5px] font-medium text-ink">{{ g.name }}</span>
            <span class="block text-[12.5px] text-ink-3 num">
              {{ plain(g.have) }} из {{ plain(g.need) }} ₸
            </span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block text-[14.5px] font-semibold num text-ink">
              {{ Math.round((g.need > 0 ? g.have / g.need : 0) * 100) }}%
            </span>
            <span class="block text-[12px] text-ink-3 num">{{ plain(g.monthly) }}/мес</span>
          </span>
        </div>

        <div v-if="!goals.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
          Целей пока нет
        </div>
      </Card>

      <Button variant="outline" class="w-full bg-surface-2" @click="openGoalModal = true">
        <PhPlus :size="16" weight="bold" /> Новая цель
      </Button>

      <Section title="Ритм" />
      <Card>
        <div class="mb-3 flex items-center gap-2.5">
          <b class="text-[14.5px] font-semibold text-ink">Откладываем без пропусков</b>
          <Hint>
            {{
              streak > 0
                ? 'Закрашен месяц, в котором был хотя бы один взнос в любую цель. Серия считается назад от текущего месяца.'
                : 'Пока ни одного взноса. Полоски закрасятся сами, как только начнёте пополнять цели — считается по фактическим взносам, а не по плану.'
            }}
          </Hint>
          <Tag v-if="streak > 0" tone="gold">{{ streak }} {{ monthWord(streak) }}</Tag>
        </div>
        <div class="flex gap-1.5">
          <i
            v-for="m in last12"
            :key="m.key"
            :title="m.label"
            class="h-[22px] flex-1 rounded-md transition-colors"
            :style="{ background: m.filled ? 'var(--brand)' : 'var(--track)' }"
          />
        </div>
      </Card>
    </template>

    <!-- Вкладка ПОКУПКИ (Wishlist) -->
    <template v-else>
      <Callout v-if="justBought" tone="good" :title="`Куплено — ${justBought}`">
        Вещь переехала в историю с датой и автором — видно, куда уходят деньги на быт.
      </Callout>

      <Card flush>
        <div
          v-for="w in activeWish"
          :key="w.id"
          class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
        >
          <button
            type="button"
            aria-label="Отметить купленным"
            class="grid size-[26px] shrink-0 place-items-center rounded-lg border border-line-strong text-transparent hover:border-brand hover:text-brand cursor-pointer"
            @click="toggleWishBought(w.id, w.name)"
          >
            <PhCheck :size="14" weight="bold" />
          </button>
          <div class="min-w-0 flex-1 text-left">
            <b class="block truncate text-[14.5px] font-medium text-ink">{{ w.name }}</b>
            <span class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <i class="size-[7px] shrink-0 rounded-full" :style="{ background: `var(--p${w.by})` }" />
              {{ nameOf(w.by) }} · {{ w.addedOn }}
            </span>
          </div>
          <a
            v-if="w.url"
            :href="w.url"
            target="_blank"
            rel="noreferrer noopener"
            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-brand"
          >
            <PhLink :size="10" /> ссылка
          </a>
          <span class="shrink-0 text-[14px] font-semibold num text-ink">{{ money(w.price) }}</span>
        </div>
        <div v-if="!activeWish.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
          Список пуст
        </div>
      </Card>

      <Button variant="outline" class="w-full bg-surface-2" @click="openWishModal = true">
        <PhPlus :size="16" weight="bold" /> Записать покупку
      </Button>

      <template v-if="boughtWish.length > 0">
        <Section title="Куплено" />
        <Card flush>
          <div
            v-for="w in boughtWish"
            :key="w.id"
            class="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0 opacity-70"
          >
            <div class="min-w-0 flex-1 text-left">
              <span class="block truncate text-[14px] text-ink line-through">{{ w.name }}</span>
              <span class="text-[12px] text-ink-3">{{ nameOf(w.by) }}</span>
            </div>
            <span class="shrink-0 text-[13.5px] num text-ink-3">{{ money(w.price) }}</span>
          </div>
        </Card>
      </template>
    </template>

    <!-- МОДАЛКА: Создать цель -->
    <div
      v-if="openGoalModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="openGoalModal = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Новая цель</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="openGoalModal = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Название">
          <Input v-model="goalName" placeholder="Например, машина, отпуск" class="mb-3" />
        </Field>
        <Field label="Сколько нужно, ₸">
          <NumField v-model="goalNeed" placeholder="3 000 000" class="mb-3" />
        </Field>
        <Field label="Уже есть, ₸">
          <NumField v-model="goalHave" class="mb-3" />
        </Field>
        <Field label="Откладывать в месяц, ₸">
          <NumField v-model="goalMonthly" placeholder="по умолчанию — за 24 месяца" class="mb-3" />
        </Field>

        <Field label="Цвет">
          <div class="flex flex-wrap gap-2 mb-3">
            <button
              v-for="h in HUE_KEYS"
              :key="h"
              type="button"
              :aria-label="HUES[h].label"
              :class="cn('size-[28px] rounded-[9px] border-2 cursor-pointer transition-transform', goalHue === h ? 'border-ink scale-110' : 'border-transparent')"
              :style="{ background: HUES[h].light }"
              @click="goalHue = h"
            />
          </div>
        </Field>

        <Button :disabled="!canCreateGoal" class="w-full mt-2" @click="createGoal">
          Создать цель
        </Button>
      </div>
    </div>

    <!-- МОДАЛКА: Записать покупку -->
    <div
      v-if="openWishModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="openWishModal = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Покупка в дом</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="openWishModal = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Что купить">
          <Input v-model="wishName" placeholder="Например, кофемашина" class="mb-3" />
        </Field>
        <Field label="Примерная цена, ₸">
          <NumField v-model="wishPrice" placeholder="150 000" class="mb-3" />
        </Field>
        <Field label="Ссылка (если есть)">
          <Input v-model="wishUrl" placeholder="https://..." class="mb-3" />
        </Field>

        <Field v-if="people.length > 1" label="Кто добавил">
          <div class="flex gap-2 mb-3">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              :class="cn('rounded-xl border px-3 py-2 text-[13px] flex-1 cursor-pointer', wishBy === p.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
              @click="wishBy = p.id"
            >
              {{ p.name }}
            </button>
          </div>
        </Field>

        <Button :disabled="!wishName.trim()" class="w-full mt-2" @click="createWish">
          Записать
        </Button>
      </div>
    </div>
  </div>
</template>
