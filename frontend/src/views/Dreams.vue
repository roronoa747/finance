<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PhCamera } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money, pct } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { goalTerm, planForecast, wishQueue } from '@/lib/finance'
import type { Goal } from '@/types/finance'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import { GOAL_TEMPLATES, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate, retryTemplatePhotos } from '@/lib/photos/goalPhoto'
import { usePhoto, usePhotos } from '@/lib/photos/usePhoto'
import PhotoPicker from '@/components/goals/PhotoPicker.vue'
import WishSheet from '@/components/goals/WishSheet.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import DreamCenter from '@/components/kit/DreamCenter.vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import SortableList from '@/components/kit/SortableList.vue'
import ThumbRow from '@/components/kit/ThumbRow.vue'

/**
 * «Мечты» (пивот 3, Р-42; макет dreams-week.html «А · Строки»; тишина Б17 — Р-116): мечта по центру,
 * списки «Цели» и «Желания» строками («Свободно · до зарплаты» — в «Месяце» и листе зарплаты). Недельного нет —
 * картина недели и решения живут на «Неделе» (Р-43). Ничего не считается здесь — `finance.ts`
 * (пауза целей — `monthPlan`; сроки — на экране цели). Фото — B2C-17, создание мечты — B2C-18.
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

/* ---------- мечта по центру и цели ---------- */
const main = computed(() => financeStore.heroGoal)
const others = computed(() => financeStore.queue.flatMap((x) => (x.kind === 'goal' && x.goal.id !== main.value?.id ? [x.goal] : [])))
const otherIds = computed(() => others.value.map((g) => g.id))
const othersById = computed(() => new Map(others.value.map((g) => [g.id, g])))
const nameOf = (id: string) => `Переставить: ${othersById.value.get(id)?.name ?? ''}`
// Место в списке под героем — второе и ниже среди целей.
const moveOther = (id: string, index: number) => financeStore.moveGoal(id, index + 1)

// Сроки — прогон очереди плана месяца (Р-83): выключил цель — она «на паузе», сроки остальных сдвинулись.
const plan = computed(() => financeStore.monthPlanOf(key.value))
// Прогноз плана «Сначала долги» — только для целей на его паузе (срок — после плана).
const forecast = computed(() => (financeStore.activePlan ? planForecast(financeStore.activePlan, financeStore.planState(), key.value) : undefined))
/**
 * Срок цели — одна функция для строки и героя (`goalTerm`, ревью frontend Б14 Н-2), та же, что у экрана цели:
 * выключенная — «на паузе», на паузе плана долгов — после плана, иначе — месяц прогона очереди.
 */
function termOf(g: Goal) {
  const item = plan.value.queue.find((x) => x.goalId === g.id)
  return goalTerm(item, g, key.value, item?.paused === 'plan' ? forecast.value : undefined)
}
/** Подпись цели в строке — только «на паузе»; срок цели — на её экране (Р-116). */
function whenOf(g: Goal): string {
  return termOf(g).off ? 'на паузе' : ''
}

const heroPercent = computed(() => (main.value ? pct(main.value.have, main.value.need) : 0))
// Под героем — название; месяц, когда мечта будет вашей, — на экране цели (Р-116). На паузе — так и сказано.
const heroMonth = computed(() => (main.value && termOf(main.value).off ? 'на паузе' : null))

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
              <span v-if="whenOf(othersById.get(id)!)" class="truncate type-meta">{{ whenOf(othersById.get(id)!) }}</span>
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
      <!-- Желание — нажатием на всю строку (без «Открыть»), цена — справа, чьё — подписью (Б17). -->
      <ThumbRow
        v-for="(w, i) in firstWishes"
        :key="w.id"
        :title="w.name"
        :src="w.photoId ? wishSrc[w.photoId] : null"
        :index="i + 1"
        fit
        clickable
        @click="openWish(w.id)"
      >
        <span v-if="wishOwner(w)" class="truncate type-meta">{{ wishOwner(w) }}</span>
        <template v-if="w.price > 0" #end>
          <span class="font-num text-[15px] font-bold num whitespace-nowrap text-ink">{{ money(w.price) }}</span>
        </template>
      </ThumbRow>
    </Card>
    <Card v-else-if="canEdit" flush class="px-3.5 py-1">
      <ThumbRow title="+ Желание" clickable @click="router.push('/wishes')" />
    </Card>

    <WishSheet v-if="canEdit" :wish-id="editWishId" @close="editWishId = null" />
  </div>
</template>
