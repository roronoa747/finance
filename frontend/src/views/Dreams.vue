<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCamera, PhFileArrowUp, PhShoppingBag } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { readMonthEnd, writeMonthEnd } from '@/lib/storage'
import { pct } from '@/lib/money'
import { monthIn, monthKey, weekKey, weekRangeLabel } from '@/lib/dates'
import {
  allocationFor,
  freeByFact,
  goalDoneMonth,
  goalMonths,
  goalRemaining,
  liveGoals,
  liveWishlist,
  mainGoal,
  nextDecision,
  planForecast,
  untilPayday,
  weekPicture,
  weekTag,
  type Decision,
} from '@/lib/finance'
import { unknownSummary } from '@/lib/statements/model'
import { plural } from '@/lib/utils'
import { GOAL_TEMPLATES, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate, retryTemplatePhotos } from '@/lib/photos/goalPhoto'
import { usePhoto, usePhotos } from '@/lib/photos/usePhoto'
import PhotoPicker from '@/components/goals/PhotoPicker.vue'
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
  const done = goalDoneMonth(goalMonths(goalRemaining(g), g.monthly), key.value, forecast)
  return done ? monthIn(done) : null
})

/** Плитка ряда: треть ширины без зазоров (`flex-grow` растягивает, когда плиток меньше трёх). */
const TILE = 'shrink-0 basis-[calc((100%-20px)/3)] snap-start'
const wishCount = computed(() => liveWishlist(financeStore.wishlist).filter((w) => !w.bought).length)

function openGoal(id: string) {
  void router.push(`/goals/${id}`)
}
function newGoal() {
  void router.push('/goals/new')
}

/* ---------- фото (B2C-17) ---------- */
const heroSrc = usePhoto(() => main.value?.photoId)
const tileSrc = usePhotos(() => others.value.map((g) => g.photoId))
const pickerOpen = ref(false)
const photoNote = ref<string | null>(null)

async function onTemplate(t: GoalTemplate) {
  pickerOpen.value = false
  if (!main.value) return
  const result = await attachTemplate(financeStore, main.value.id, t)
  photoNote.value = result === 'uploaded' ? null : 'Картинка появится при сети.'
}

async function onFile(file: File) {
  pickerOpen.value = false
  if (!main.value) return
  const ok = await attachFile(financeStore, main.value.id, file)
  photoNote.value = ok ? null : 'Фото не загрузилось — попробуйте при сети.'
}

/* ---------- неделя ---------- */
const spendTotals = computed(() => financeStore.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => financeStore.householdDoc.spendCategories ?? [])
const picture = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week.value, ops.uploads))
const hasUploads = computed(() => ops.uploads.length > 0)
const weekTitle = computed(() => `Эта неделя · ${weekRangeLabel(picture.value.range)}`)
const tag = computed(() => weekTag(picture.value, people.value.length))
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
// Без имени: «до зарплаты Ильяса» требует падежа, а «· Ильяс» в конце переносился отдельной строкой
// (смоук владельца). «·» держится за предыдущее слово — строка не начинается с точки.
const paydayNote = computed(() => {
  const p = payday.value
  if (!p) return ''
  return p.inDays === 0 ? 'сегодня зарплата' : `${p.inDays} ${plural(p.inDays, 'день', 'дня', 'дней')} до зарплаты`
})
const freeNote = computed(() => {
  const p = picture.value
  const tail = paydayNote.value ? ` · ${paydayNote.value}` : ''
  if (!hasUploads.value) return 'появится после первой выписки'
  if (!free.value.byFact) return `по плану${tail}`
  if (p.missing.length && p.uploaded.length) return `пока по выписке ${names(p.uploaded)} · уточнится, когда ${names(p.missing)} загрузит`
  return `по факту ${people.value.length > 1 ? 'выписок обоих' : 'выписки'}${tail}`
})

/* ---------- ближайшее решение ---------- */
const answered = ref(readMonthEnd())
// Остаток месяца уже разложен (запись семьи, B2C-21) — вопрос отвечен и на телефоне партнёра.
const restDone = computed(() => !!allocationFor(financeStore.allocations, { source: 'rest', sourceId: key.value, period: key.value }))
// Незнакомые продавцы этой недели — из своих операций (у партнёра свои, в его телефоне).
const weekUnknown = computed(() => unknownSummary(ops.all, week.value))
// Ждущие сопоставления (B2C-15) — первое даёт вопрос карточке, остальные — счётчиком.
const firstMatch = computed(() => {
  const list = ops.pendingMatches
  return list.length ? { count: list.length, question: list[0].question, meta: list[0].meta } : null
})
const decision = computed<Decision | null>(() =>
  canEdit.value
    ? nextDecision(state.value, {
        me: authStore.slot,
        unknown: weekUnknown.value,
        match: firstMatch.value,
        answeredMonthEnd: restDone.value ? key.value : answered.value,
      })
    : null,
)
// «Потом» / «Подумать» — до следующего открытия; ответ «не сейчас» на «остались деньги?» — до конца месяца.
const deferred = ref<string | null>(null)
const decisionKey = (d: Decision) => `${d.kind}:${d.obligation?.id ?? d.salary?.period ?? ''}`
const shown = computed(() => (decision.value && deferred.value !== decisionKey(decision.value) ? decision.value : null))
const cancelling = ref(false)
// Загрузка недели — главное действие экрана, когда брендовой кнопки нет ни у пустого героя, ни у решения.
const uploadQuiet = computed(() => !main.value || !!shown.value)

function answerRest() {
  answered.value = key.value
  writeMonthEnd(key.value)
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
const cardActions = computed<Decision['actions'] | null>(() => {
  const d = shown.value
  if (!d) return null
  if (d.cancel && cancelling.value) return d.cancel.actions
  return d.actions
})

/** Открытие экрана: загрузки выписок; цели с шаблоном без картинки (заведены офлайн) — дозагрузить при сети (Р-28). */
function refresh() {
  void ops.loadUploads()
  // Фото пишет только участник: у viewer загрузка кончилась бы 403, а картинка Unsplash качалась бы зря.
  if (canEdit.value) void retryTemplatePhotos(financeStore, GOAL_TEMPLATES)
}
onMounted(refresh)
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
      :src="heroSrc"
      :author="main.photoCredit?.author"
      role="link"
      tabindex="0"
      class="cursor-pointer"
      @click="openGoal(main.id)"
      @keydown.enter="openGoal(main.id)"
    >
      <template v-if="canEdit && !main.photoId" #actions>
        <Chip quiet @click.stop="pickerOpen = true"><PhCamera /> Добавить фото</Chip>
      </template>
    </DreamHero>
    <DreamHero v-else empty :can-pick="canEdit" @pick="newGoal" />
    <Callout v-if="photoNote" tone="neutral" icon="info">{{ photoNote }}</Callout>

    <!-- Плитки других мечт, «Новая мечта» и «Желания» одним рядом (g1): до трёх делят ширину,
         больше — ряд прокручивается по трети экрана. -->
    <div v-if="main" class="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 [scrollbar-width:none]">
      <DreamTile
        v-for="g in others"
        :key="g.id"
        :name="g.name"
        :percent="pct(g.have, g.need)"
        :src="g.photoId ? tileSrc[g.photoId] : null"
        :class="TILE"
        @click="openGoal(g.id)"
      />
      <DreamTile v-if="canEdit" add :class="TILE" @click="newGoal" />
      <DreamTile link name="Желания" :meta="wishCount ? `${wishCount} в списке` : ''" :class="TILE" @click="router.push('/wishes')">
        <template #icon><PhShoppingBag /></template>
      </DreamTile>
    </div>

    <PhotoPicker
      v-if="main"
      :open="pickerOpen"
      title="Фото мечты"
      :selected="main.template"
      :skippable="false"
      @close="pickerOpen = false"
      @template="onTemplate"
      @file="onFile"
    />

    <!-- Картина недели -->
    <div class="mt-2 px-1 type-section">{{ weekTitle }}</div>
    <WeekCard
      v-if="picture.uploaded.length"
      :total="picture.total"
      :tag="tag"
      :segments="weekSegments"
      :unknown="picture.unknown"
      :unknown-share="picture.unknownShare"
      :link="{ text: 'Неделя →', to: '/week' }"
    >
      <Callout v-if="picture.missing.length" tone="neutral" icon="bell">
        Картина недели дополнится, когда {{ names(picture.missing) }} загрузит выписку.
      </Callout>
    </WeekCard>
    <!-- Брендовая кнопка экрана одна (правило 12): загрузка брендовая, пока нет ни пустого героя, ни карточки решения (g1 «ещё нет выписок»). -->
    <Card v-else>
      <EmptyState
        v-if="!hasUploads"
        title="Картины недели пока нет"
        text="Загрузите первую выписку — картина появится здесь."
      >
        <Button v-if="canEdit" :variant="uploadQuiet ? 'secondary' : 'default'" @click="router.push('/week?upload=1')"><PhFileArrowUp /> Загрузить выписку</Button>
      </EmptyState>
      <EmptyState v-else title="Неделя пока пустая" text="Загрузите выписку — картина недели появится здесь.">
        <Button v-if="canEdit" :variant="uploadQuiet ? 'secondary' : 'default'" @click="router.push('/week?upload=1')"><PhFileArrowUp /> Загрузить выписку</Button>
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
      <template v-if="shown.cancel && cancelling" #inner>{{ shown.cancel.inner }}</template>
      <template v-else-if="shown.inner" #inner>{{ shown.inner }}</template>
      <!-- Пустой герой держит единственную брендовую «Выбрать мечту» (правило 12): ответы решения — тихие. -->
      <template v-if="!main && cardActions" #actions>
        <Button variant="secondary" @click="onPrimary">{{ cardActions.primary }}</Button>
        <Button v-if="cardActions.secondary" variant="secondary" @click="onSecondary">{{ cardActions.secondary }}</Button>
        <Button v-if="cardActions.ghost" variant="ghost" class="px-2.5" @click="onGhost">{{ cardActions.ghost }}</Button>
      </template>
    </DecisionCard>
  </div>
</template>
