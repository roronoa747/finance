<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PhCamera } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { useFxStore } from '@/stores/fx'
import { money, pct } from '@/lib/money'
import { monthKey, monthTitle } from '@/lib/dates'
import { freeByFact, goalDoneMonth, goalMonths, goalRemaining, monthPlan, planForecast, untilPayday, wishQueue } from '@/lib/finance'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import { plural } from '@/lib/utils'
import { GOAL_TEMPLATES, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate, retryTemplatePhotos } from '@/lib/photos/goalPhoto'
import { usePhoto, usePhotos } from '@/lib/photos/usePhoto'
import PhotoPicker from '@/components/goals/PhotoPicker.vue'
import WishSheet from '@/components/goals/WishSheet.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import CountUp from '@/components/kit/CountUp.vue'
import DreamCenter from '@/components/kit/DreamCenter.vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import SortableList from '@/components/kit/SortableList.vue'
import ThumbRow from '@/components/kit/ThumbRow.vue'

/**
 * «Мечты» (пивот 3, Р-42; макет dreams-week.html «А · Строки»): мечта по центру, одна строка
 * «Свободно N ₸ · до зарплаты N дней», списки «Цели» и «Желания» строками. Недельного здесь нет —
 * картина недели и решения живут на «Неделе» (Р-43). Ничего не считается здесь — `finance.ts`
 * (`freeByFact`, `untilPayday`, сроки целей — `monthPlan`). Фото — B2C-17, создание мечты — B2C-18.
 * Цели — в порядке очереди денег (Р-84, Блок 14): герой — первая цель, остальные переставляются ⋮⋮ среди
 * целей; фонды и «закрыть кредит» — только в плане месяца («Деньги»). Желания — в своём порядке.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()

const NBSP = ' '
const key = computed(() => monthKey())
const canEdit = computed(() => !authStore.isViewer)
const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))

// Состояние для расчётов: кредиты — производные (остатки из отметок), как везде.
const fx = useFxStore()
const state = computed(() => ({ ...financeStore.householdDoc, credits: financeStore.credits, book: fx.book }))

/* ---------- мечта по центру и цели ---------- */
const main = computed(() => financeStore.heroGoal)
const others = computed(() => financeStore.queue.flatMap((x) => (x.kind === 'goal' && x.goal.id !== main.value?.id ? [x.goal] : [])))
const otherIds = computed(() => others.value.map((g) => g.id))
const othersById = computed(() => new Map(others.value.map((g) => [g.id, g])))
const nameOf = (id: string) => `Переставить: ${othersById.value.get(id)?.name ?? ''}`
// Место в списке под героем — второе и ниже среди целей.
const moveOther = (id: string, index: number) => financeStore.moveGoal(id, index + 1)

// Сроки — прогон очереди плана месяца (Р-83): выключил цель — она «на паузе», сроки остальных сдвинулись.
const plan = computed(() =>
  monthPlan(state.value, {
    key: key.value,
    totals: financeStore.householdDoc.spendTotals ?? [],
    spendCategories: financeStore.householdDoc.spendCategories ?? [],
    uploads: ops.uploads,
  }),
)
const planItem = (id: string) => plan.value.queue.find((x) => x.goalId === id)
/** Подпись срока цели: «на паузе» или «к <месяц>»; собрана или срока нет — пусто. */
function whenOf(id: string): string {
  const item = planItem(id)
  if (item?.paused === 'off') return 'на паузе'
  return item?.doneMonth && item.paused === false ? `к${NBSP}${monthTitle(item.doneMonth).toLowerCase()}` : ''
}

const heroPercent = computed(() => (main.value ? pct(main.value.have, main.value.need) : 0))
// Месяц, когда мечта будет вашей, по очереди плана; выключенная — «на паузе»; на паузе ради плана долгов — после плана.
const heroMonth = computed(() => {
  const g = main.value
  if (!g) return null
  const item = planItem(g.id)
  if (item?.paused === 'off') return 'на паузе'
  if (item && item.paused === false && item.doneMonth) return monthTitle(item.doneMonth).toLowerCase()
  const paused = financeStore.pausedGoalIds.has(g.id)
  const forecast = paused && financeStore.activePlan ? planForecast(financeStore.activePlan, financeStore.planState(), key.value) : undefined
  const done = goalDoneMonth(goalMonths(goalRemaining(g), g.monthly), key.value, forecast)
  return done ? monthTitle(done).toLowerCase() : null
})

/* ---------- фото (B2C-17) ---------- */
const heroSrc = usePhoto(() => main.value?.photoId)
const goalSrc = usePhotos(() => others.value.map((g) => g.photoId))
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

/* ---------- «Свободно · до зарплаты» (Р-42, Р-47: одно число — по факту выписок) ---------- */
const free = computed(() =>
  freeByFact(state.value, financeStore.householdDoc.spendTotals ?? [], financeStore.householdDoc.spendCategories ?? [], key.value, ops.uploads),
)
// Выписки за этот месяц нет (в начале месяца — только прошлые) — `freeByFact` отдаёт остаток по плану: это
// число «Дохода», под словом «Свободно» его не показываем (Р-47).
const hasUploads = computed(() => free.value.byFact)
const payday = computed(() =>
  untilPayday({
    people: financeStore.people,
    obligations: financeStore.obligations,
    credits: financeStore.credits,
    accounts: financeStore.householdAccounts,
    payments: financeStore.payments,
    fxExchanges: financeStore.fxExchanges,
    book: fx.book,
  }),
)
// До выписки за месяц числа «Свободно» нет — строка держит только «До зарплаты N дней».
const paydayText = computed(() => {
  const p = payday.value
  if (!p) return ''
  const text = p.inDays === 0 ? 'сегодня зарплата' : `до зарплаты ${p.inDays}${NBSP}${plural(p.inDays, 'день', 'дня', 'дней')}`
  return hasUploads.value ? `${NBSP}· ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
})

/* ---------- желания ---------- */
const openWishes = computed(() => wishQueue({ wishlist: financeStore.wishlist, wishOrder: financeStore.wishOrder }).filter((w) => !w.bought))
const firstWishes = computed(() => openWishes.value.slice(0, 3))
const wishSrc = usePhotos(() => firstWishes.value.map((w) => w.photoId))
const editWishId = ref<string | null>(null)
/** Чьё желание: список участника по имени, общий — «общие» (записи до Блока 3 — список добавившего). */
function wishOwner(w: { list?: string; by: string }) {
  const list = w.list ?? w.by
  return list === 'all' ? 'общие' : (people.value.find((p) => p.id === list)?.name ?? '')
}
function wishMeta(w: { price: number; list?: string; by: string }) {
  return [w.price > 0 ? money(w.price) : '', wishOwner(w)].filter(Boolean).join(`${NBSP}· `)
}
// Участник открывает лист желания здесь; viewer листа правки не видит — список желаний.
function openWish(id: string) {
  if (canEdit.value) editWishId.value = id
  else void router.push('/wishes')
}

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
    <!-- Мечта по центру -->
    <DreamCenter
      v-if="main"
      :title="main.name"
      :percent="heroPercent"
      :month="heroMonth"
      :src="heroSrc"
      :author="main.photoCredit?.author"
      @open="router.push(`/goals/${main.id}`)"
    >
      <template v-if="canEdit && !main.photoId" #actions>
        <Chip quiet @click="pickerOpen = true"><PhCamera /> Добавить фото</Chip>
      </template>
    </DreamCenter>
    <DreamCenter v-else empty :can-pick="canEdit" @pick="router.push('/goals/new')" />
    <Callout v-if="photoNote" tone="neutral" icon="info">{{ photoNote }}</Callout>

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

    <!-- Одна строка: свободно по факту выписок и дни до зарплаты -->
    <p v-if="hasUploads || paydayText" class="fx-in text-center text-[13px] text-ink-2">
      <!-- prettier-ignore -->
      <template v-if="hasUploads">Свободно <b class="font-semibold num" :class="free.amount < 0 ? 'text-destructive' : 'text-ok'"><CountUp :value="free.amount" :format="money" /></b></template>{{ paydayText }}
    </p>

    <!-- Цели: остальные мечты строками -->
    <template v-if="main">
      <div class="flex items-baseline justify-between px-1 pt-1.5">
        <h2 class="text-[20px] font-bold tracking-[-0.01em] text-ink">Цели</h2>
        <RouterLink v-if="canEdit" to="/goals/new" class="text-[14px] font-semibold text-brand">+ Новая</RouterLink>
      </div>
      <Card v-if="others.length" flush class="px-3.5 py-1">
        <SortableList :ids="otherIds" :label="nameOf" :disabled="!canEdit" @move="moveOther">
          <template #default="{ id, index }">
            <ThumbRow
              v-if="othersById.get(id)"
              :title="othersById.get(id)!.name"
              :src="othersById.get(id)!.photoId ? goalSrc[othersById.get(id)!.photoId!] : null"
              :tone="hueColor(othersById.get(id)!.hue, isDark)"
              :index="index + 1"
              :divided="false"
              :class="othersById.get(id)!.pausedAt && 'opacity-60'"
              clickable
              @click="router.push(`/goals/${id}`)"
            >
              <span v-if="whenOf(id)" class="truncate type-meta">{{ whenOf(id) }}</span>
              <ProgressBar :value="othersById.get(id)!.need ? othersById.get(id)!.have / othersById.get(id)!.need : 0" tone="ink" :height="5" />
              <template #end>
                <span class="font-num text-[15px] font-bold num text-ink">{{ pct(othersById.get(id)!.have, othersById.get(id)!.need) }}{{ NBSP }}%</span>
              </template>
            </ThumbRow>
          </template>
        </SortableList>
      </Card>
    </template>

    <!-- Желания: первые три, «Все N» — путь к списку есть всегда -->
    <div class="flex items-baseline justify-between px-1 pt-1.5">
      <h2 class="text-[20px] font-bold tracking-[-0.01em] text-ink">Желания</h2>
      <RouterLink to="/wishes" class="text-[14px] font-semibold text-brand">{{ openWishes.length ? `Все ${openWishes.length}` : 'Все' }}</RouterLink>
    </div>
    <Card v-if="firstWishes.length" flush class="px-3.5 py-1">
      <ThumbRow v-for="(w, i) in firstWishes" :key="w.id" :title="w.name" :src="w.photoId ? wishSrc[w.photoId] : null" :index="i + 1" fit>
        <span v-if="wishMeta(w)" class="truncate type-meta">{{ wishMeta(w) }}</span>
        <template #end>
          <button
            type="button"
            class="press shrink-0 rounded-pill bg-brand-soft px-[11px] py-1.5 text-[13px] font-semibold text-brand cursor-pointer"
            @click="openWish(w.id)"
          >
            Открыть
          </button>
        </template>
      </ThumbRow>
    </Card>
    <Card v-else-if="canEdit" flush class="px-3.5 py-1">
      <ThumbRow title="+ Желание" clickable @click="router.push('/wishes')" />
    </Card>

    <WishSheet v-if="canEdit" :wish-id="editWishId" @close="editWishId = null" />
  </div>
</template>
