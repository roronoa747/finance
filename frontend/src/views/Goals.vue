<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhCheck, PhLink, PhPlus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { addMonths, atLabel, monthKey, monthTitle } from '@/lib/dates'
import type { HueKey } from '@/lib/palette'
import { contributionStreak, liveGoals, liveWishlist } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn, plural } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import Callout from '@/components/kit/Callout.vue'
import Ring from '@/components/Ring.vue'
import HuePicker from '@/components/goals/HuePicker.vue'
import WishSheet from '@/components/goals/WishSheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

type Tab = 'goals' | 'wish'
const tab = ref<Tab>(route.query?.tab === 'wish' ? 'wish' : 'goals')

watch(
  () => route.query?.tab,
  (val) => {
    tab.value = val === 'wish' ? 'wish' : 'goals'
  },
)

watch(tab, (t) => {
  if (t === 'wish') {
    if (route.query?.tab !== 'wish') {
      void router.replace({ query: { ...route.query, tab: 'wish' } })
    }
  } else {
    if (route.query?.tab === 'wish') {
      const q = { ...route.query }
      delete q.tab
      void router.replace({ query: q })
    }
  }
})

const goals = computed(() => liveGoals(financeStore.goals))
// Пауза выводится из активного плана (Р-9): взнос цели при этом не меняется.
const paused = computed(() => financeStore.pausedGoalIds)
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
const editWishId = ref<string | null>(null)
/** Последняя отмеченная покупка и её номер среди купленных — на момент отметки. */
const justBought = ref<{ name: string; n: number } | null>(null)

const activeWish = computed(() => wishlist.value.filter((w) => !w.bought))
const boughtWish = computed(() => wishlist.value.filter((w) => w.bought))
const boughtSum = computed(() => boughtWish.value.reduce((a, w) => a + w.price, 0))

function nameOf(id: PersonId) {
  return people.value.find((p) => p.id === id)?.name || 'Участник'
}

/** Новые даты — ISO («5 сентября»); старые строки из прода (`24.09.2026`) — как есть. */
function wishDate(s: string | null | undefined) {
  if (!s) return ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? atLabel(s) : s
}

function createWish() {
  if (!wishName.value.trim()) return
  financeStore.addWish({
    name: wishName.value.trim(),
    price: parseMoney(wishPrice.value),
    by: wishBy.value,
    url: wishUrl.value.trim() || undefined,
  })
  wishName.value = ''
  wishPrice.value = ''
  wishUrl.value = ''
  openWishModal.value = false
}

// Номер — до отметки: в React `bought.length + 1` считался уже после неё и был на один больше.
function markBought(id: string, itemName: string) {
  justBought.value = { name: itemName, n: boughtWish.value.length + 1 }
  financeStore.toggleBought(id)
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
            <Tag v-if="paused.has(g.id)" class="mt-0.5 inline-block">На паузе ради плана</Tag>
            <span v-else class="block text-[12px] text-ink-3 num">{{ plain(g.monthly) }}/мес</span>
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
          <Tag v-if="streak > 0" tone="gold">{{ streak }} {{ plural(streak, 'месяц', 'месяца', 'месяцев') }}</Tag>
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
      <Callout v-if="justBought" tone="good" :title="`Куплено — ${justBought.name}`">
        Это {{ justBought.n }}-я покупка в дом. Вещь переехала в историю с датой и автором —
        через год будет видно, куда уходили деньги на быт.
      </Callout>

      <Card flush>
        <div
          v-for="w in activeWish"
          :key="w.id"
          class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
        >
          <!-- Viewer видит список, но не правит (Р-12, матрица §3): ни галочки, ни кнопки строки -->
          <button
            v-if="!authStore.isViewer"
            type="button"
            aria-label="Отметить купленным"
            class="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-line-strong text-transparent hover:border-brand hover:text-brand cursor-pointer"
            @click="markBought(w.id, w.name)"
          >
            <PhCheck :size="14" weight="bold" />
          </button>
          <!-- Ссылка вынесена из нажимаемой области: ссылка внутри кнопки — невалидная разметка. -->
          <component
            :is="authStore.isViewer ? 'div' : 'button'"
            :type="authStore.isViewer ? undefined : 'button'"
            :class="cn('min-w-0 flex-1 text-left', !authStore.isViewer && 'cursor-pointer')"
            @click="editWishId = w.id"
          >
            <b class="block truncate text-[14.5px] font-medium text-ink">{{ w.name }}</b>
            <span class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <i class="size-[7px] shrink-0 rounded-full" :style="{ background: `var(--p${w.by})` }" />
              {{ nameOf(w.by) }} · {{ wishDate(w.addedOn) }}
            </span>
          </component>
          <a
            v-if="w.url"
            :href="w.url"
            target="_blank"
            rel="noreferrer noopener"
            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-brand"
          >
            <PhLink :size="10" /> ссылка
          </a>
          <span class="shrink-0 text-[14px] font-semibold num text-ink">{{ plain(w.price) }}</span>
        </div>
        <div v-if="!activeWish.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
          Список пуст
        </div>
      </Card>

      <Button v-if="!authStore.isViewer" variant="outline" class="w-full bg-surface-2" @click="openWishModal = true">
        <PhPlus :size="16" weight="bold" /> Добавить покупку
      </Button>

      <Section title="Уже купили">
        <template v-if="boughtWish.length" #action>
          <span class="text-[13px] text-ink-3 num">{{ money(boughtSum) }}</span>
        </template>
      </Section>
      <Card flush>
        <div
          v-for="w in boughtWish"
          :key="w.id"
          class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
        >
          <button
            v-if="!authStore.isViewer"
            type="button"
            aria-label="Вернуть в список"
            class="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-brand bg-brand text-brand-ink cursor-pointer"
            @click="financeStore.toggleBought(w.id)"
          >
            <PhCheck :size="14" weight="bold" />
          </button>
          <div class="min-w-0 flex-1">
            <b class="block text-[14.5px] font-medium text-ink-3 line-through">{{ w.name }}</b>
            <div class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <i class="size-[7px] shrink-0 rounded-full" :style="{ background: `var(--p${w.by})` }" />
              {{ nameOf(w.by) }} · куплено {{ wishDate(w.boughtOn) }}
            </div>
          </div>
          <span class="shrink-0 text-[14px] font-semibold text-ink-3 num">{{ plain(w.price) }}</span>
        </div>
        <div v-if="!boughtWish.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
          Пока ничего
        </div>
      </Card>

      <WishSheet :wish-id="authStore.isViewer ? null : editWishId" @close="editWishId = null" />
    </template>

    <!-- Окно: Создать цель -->
    <Sheet :open="openGoalModal" title="Новая цель" @close="openGoalModal = false">
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

      <HuePicker v-model="goalHue" />

      <Button :disabled="!canCreateGoal" class="w-full mt-2" @click="createGoal">
        Создать цель
      </Button>
    </Sheet>

    <!-- Окно: Покупка в дом (React `Goals.tsx:284-305`) -->
    <Sheet :open="openWishModal" title="Покупка в дом" @close="openWishModal = false">
      <Field label="Что покупаем">
        <Input v-model="wishName" placeholder="Например, сковорода" class="mb-3" />
      </Field>
      <Field label="Цена, ₸">
        <NumField v-model="wishPrice" placeholder="18 000" class="mb-3" />
      </Field>
      <Field label="Ссылка на товар">
        <Input v-model="wishUrl" inputmode="url" placeholder="можно оставить пустым" class="mb-3" />
      </Field>

      <Field v-if="people.length > 1" label="Кто добавил" group>
        <Segmented
          v-model="wishBy"
          :options="people.map((p) => ({ value: p.id, label: p.name }))"
        />
      </Field>

      <Button :disabled="!wishName.trim()" class="w-full mt-2" @click="createWish">
        Добавить в список
      </Button>
    </Sheet>
  </div>
</template>
