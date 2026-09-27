<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCamera, PhFileArrowUp } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { pct } from '@/lib/money'
import { MONTHS_GEN, monthIn, monthKey, weekKey } from '@/lib/dates'
import {
  freeByFact,
  goalDoneMonth,
  goalMonths,
  liveGoals,
  mainGoal,
  nextDecision,
  planForecast,
  untilPayday,
  weekPicture,
  type Decision,
} from '@/lib/finance'
import { unknownGroups } from '@/lib/statements/model'
import { plural } from '@/lib/utils'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import DreamTile from '@/components/kit/DreamTile.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import FreeCard from '@/components/kit/FreeCard.vue'
import WeekCard from '@/components/kit/WeekCard.vue'

/**
 * Главный «Мечты» (Р-8, DESIGN.md §2 g1; B2C-14): герой — главная мечта с фото и «До мечты N %»,
 * плитки других мечт, картина недели по выпискам обоих, «Свободно до конца месяца» по факту и
 * одна карточка ближайшего решения. Ничего не считается здесь — `finance.ts` (`mainGoal`,
 * `weekPicture`, `freeByFact`, `nextDecision`). Фото героя — B2C-17, создание мечты — B2C-18.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()

const key = computed(() => monthKey())
const week = computed(() => weekKey())
const canEdit = computed(() => !authStore.isViewer)
const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const names = (list: { name: string }[]) => list.map((p) => p.name).join(' и ')

// Состояние для расчётов: кредиты — производные (остатки из отметок), как везде.
const state = computed(() => ({ ...financeStore.householdDoc, credits: financeStore.credits }))

/* ---------- герой и плитки ---------- */
const goals = computed(() => liveGoals(financeStore.goals))
const main = computed(() => mainGoal(financeStore.goals))
const others = computed(() => goals.value.filter((g) => g.id !== main.value?.id))

const heroPercent = computed(() => (main.value ? pct(main.value.have, main.value.need) : 0))
// «Будет вашей в …»: месяц закрытия при текущем взносе; цель на паузе ради плана — после плана.
const heroMonth = computed(() => {
  const g = main.value
  if (!g) return null
  const paused = financeStore.pausedGoalIds.has(g.id)
  const forecast = paused && financeStore.activePlan ? planForecast(financeStore.activePlan, financeStore.planState(), key.value) : undefined
  const done = goalDoneMonth(goalMonths(Math.max(0, g.need - g.have), g.monthly), key.value, forecast)
  return done ? monthIn(done) : null
})

function openGoal(id: string) {
  void router.push(`/goals/${id}`)
}
function newGoal() {
  void router.push('/goals/new')
}

/* ---------- неделя ---------- */
const spendTotals = computed(() => financeStore.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => financeStore.householdDoc.spendCategories ?? [])
const picture = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week.value, ops.uploads))
const hasUploads = computed(() => ops.uploads.length > 0)
const weekTitle = computed(() => {
  const { from, to } = picture.value.range
  const day = (iso: string) => Number(iso.slice(8, 10))
  const gen = (iso: string) => MONTHS_GEN[Number(iso.slice(5, 7)) - 1]
  const range = gen(from) === gen(to) ? `${day(from)}–${day(to)} ${gen(to)}` : `${day(from)} ${gen(from)} – ${day(to)} ${gen(to)}`
  return `Эта неделя · ${range}`
})
const weekTag = computed<{ text: string; tone: 'ok' | 'warn' } | null>(() => {
  const p = picture.value
  if (p.missing.length && p.uploaded.length) return { text: `без выписки ${names(p.missing)}`, tone: 'warn' }
  if (p.uploaded.length) return { text: people.value.length > 1 ? 'по выпискам обоих' : 'по выписке', tone: 'ok' }
  return null
})
const weekSegments = computed(() => picture.value.rows.map((r) => ({ id: r.categoryId, name: r.name, amount: r.amount, share: r.share, color: r.color })))

/* ---------- свободно ---------- */
const free = computed(() => freeByFact(state.value, spendTotals.value, spendCategories.value, key.value, ops.uploads))
const payday = computed(() =>
  untilPayday({
    people: financeStore.people,
    obligations: financeStore.obligations,
    credits: financeStore.credits,
    accounts: financeStore.householdAccounts,
    payments: financeStore.payments,
  }),
)
const paydayNote = computed(() => {
  const p = payday.value
  if (!p) return ''
  const who = people.value.length > 1 ? ` · ${p.who.name}` : ''
  return p.inDays === 0 ? `сегодня зарплата${who}` : `${p.inDays} ${plural(p.inDays, 'день', 'дня', 'дней')} до зарплаты${who}`
})
const freeNote = computed(() => {
  const p = picture.value
  const tail = paydayNote.value ? ` · ${paydayNote.value}` : ''
  if (!hasUploads.value) return 'появится после первой выписки'
  if (!free.value.byFact) return `по плану${tail}`
  if (p.missing.length && p.uploaded.length) return `пока по выписке ${names(p.uploaded)} · уточнится, когда ${names(p.missing)} загрузит`
  return `по факту ${people.value.length > 1 ? 'выписок обоих' : 'выписки'}${tail}`
})

/* ---------- ближайшее решение ---------- */
const MONTH_END_KEY = 'ff_month_end'
function readAnswered(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(MONTH_END_KEY)
  } catch {
    return null
  }
}
const answered = ref(readAnswered())
// Незнакомые продавцы этой недели — из своих операций (у партнёра свои, в его телефоне).
const weekUnknown = computed(() => {
  const groups = unknownGroups(ops.all.filter((o) => weekKey(o.date) === week.value))
  return { count: groups.length, amount: groups.reduce((a, g) => a + g.amount, 0) }
})
const decision = computed<Decision | null>(() =>
  canEdit.value
    ? nextDecision(state.value, { me: authStore.slot, unknown: weekUnknown.value, answeredMonthEnd: answered.value })
    : null,
)
// «Потом» / «Подумать» — до следующего открытия; ответ «не сейчас» на «остались деньги?» — до конца месяца.
const deferred = ref<string | null>(null)
const decisionKey = (d: Decision) => `${d.kind}:${d.obligation?.id ?? d.salary?.period ?? ''}`
const shown = computed(() => (decision.value && deferred.value !== decisionKey(decision.value) ? decision.value : null))
const cancelling = ref(false)

function answerRest() {
  answered.value = key.value
  try {
    localStorage.setItem(MONTH_END_KEY, key.value)
  } catch {
    // Хранилище недоступно — спросим ещё раз, это не страшно.
  }
}

function onPrimary() {
  const d = shown.value
  if (!d) return
  if (d.kind === 'keep' && d.obligation) {
    if (cancelling.value) financeStore.removeObligation(d.obligation.id)
    else financeStore.keepSubscription(d.obligation.id)
    cancelling.value = false
    return
  }
  if (d.to) void router.push(d.to)
}
function onSecondary() {
  if (shown.value?.kind === 'keep') cancelling.value = true
}
function onGhost() {
  const d = shown.value
  if (!d) return
  if (cancelling.value) {
    cancelling.value = false
    return
  }
  if (d.kind === 'monthEnd') answerRest()
  else deferred.value = decisionKey(d)
}
const cardActions = computed(() => {
  const d = shown.value
  if (!d) return null
  if (d.kind === 'keep' && cancelling.value) return { primary: 'Отменить подписку', ghost: 'Не сейчас' }
  return d.actions
})

onMounted(() => {
  void ops.loadUploads()
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Герой: главная мечта -->
    <DreamHero
      v-if="main"
      :title="main.name"
      :percent="heroPercent"
      :have-amount="main.have"
      :need-amount="main.need"
      :done-month="heroMonth"
      role="link"
      tabindex="0"
      class="cursor-pointer"
      @click="openGoal(main.id)"
      @keydown.enter="openGoal(main.id)"
    >
      <template v-if="canEdit" #actions>
        <Chip quiet @click.stop="openGoal(main.id)"><PhCamera /> Добавить фото</Chip>
      </template>
    </DreamHero>
    <DreamHero v-else empty :can-pick="canEdit" @pick="newGoal" />

    <!-- Плитки других мечт -->
    <div v-if="others.length || (main && canEdit)" class="grid grid-cols-3 gap-2.5">
      <DreamTile v-for="g in others" :key="g.id" :name="g.name" :percent="pct(g.have, g.need)" @click="openGoal(g.id)" />
      <DreamTile v-if="canEdit" add @click="newGoal" />
    </div>

    <!-- Картина недели -->
    <div class="mt-2 px-1 type-section">{{ weekTitle }}</div>
    <WeekCard
      v-if="picture.uploaded.length"
      :total="picture.total"
      :tag="weekTag"
      :segments="weekSegments"
      :unknown="picture.unknown"
      :unknown-share="picture.unknownShare"
      :link="{ text: 'Неделя →', to: '/week' }"
    >
      <Callout v-if="picture.missing.length" tone="neutral" icon="bell">
        Картина недели дополнится, когда {{ names(picture.missing) }} загрузит выписку.
      </Callout>
    </WeekCard>
    <Card v-else>
      <EmptyState
        v-if="!hasUploads"
        title="Картины недели пока нет"
        text="Загрузите первую выписку из Kaspi или Freedom — разбор займёт пару секунд, файл останется на телефоне."
      >
        <Button v-if="canEdit" @click="router.push('/week?upload=1')"><PhFileArrowUp /> Загрузить выписку</Button>
      </EmptyState>
      <EmptyState v-else title="Выписки за эту неделю ещё нет" text="Загрузите её — картина недели появится здесь.">
        <Button v-if="canEdit" variant="secondary" @click="router.push('/week?upload=1')"><PhFileArrowUp /> Загрузить выписку</Button>
      </EmptyState>
    </Card>

    <!-- Свободно до конца месяца -->
    <FreeCard :amount="hasUploads ? free.amount : null" :note="freeNote" :share="hasUploads ? free.share : null" />

    <!-- Ближайшее решение -->
    <DecisionCard
      v-if="shown"
      :question="shown.question"
      :meta="shown.meta"
      :actions="cardActions"
      @primary="onPrimary"
      @secondary="onSecondary"
      @ghost="onGhost"
    >
      <template v-if="shown.kind === 'keep' && cancelling" #inner>
        Подписка уйдёт из бюджета и планов у вас обоих. Отключить её в самом сервисе нужно отдельно.
      </template>
      <template v-else-if="shown.inner" #inner>{{ shown.inner }}</template>
    </DecisionCard>
  </div>
</template>
