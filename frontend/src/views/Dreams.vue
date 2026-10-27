<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PhCamera, PhCaretRight, PhCheck, PhPlus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { useAiStore } from '@/stores/ai'
import { money, pct } from '@/lib/money'
import { monthKey, monthShort } from '@/lib/dates'
import { doneGoals, doneTerm, dreamShift, goalTerm, planForecast, shiftShort, wishQueue } from '@/lib/finance'
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
import DreamHero from '@/components/kit/DreamHero.vue'
import Sheet from '@/components/kit/Sheet.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'
import ShellPeople from '@/components/ShellPeople.vue'
import { useShellHero } from '@/components/shellHero'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import SortableList from '@/components/kit/SortableList.vue'
import ThumbRow from '@/components/kit/ThumbRow.vue'
import Tip from '@/components/kit/Tip.vue'

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
/** ✦ совета ИИ у мечты (бэклог «Разбор», RZ-11): герой и строки целей; у желаний — нет. */
const ai = useAiStore()

const NBSP = ' '
const key = computed(() => monthKey())
const canEdit = computed(() => !authStore.isViewer)
/** Подсказка у главной мечты (бэклог «первый» Р-7; слова — владелец на `/ux`, Р-9: «Нажмите на…, чтобы…»); viewer — без призыва. */
const tipText = computed(() => (canEdit.value ? 'Нажмите на мечту, чтобы посмотреть подробнее' : 'Главная мечта семьи'))

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
/**
 * Метка «мечта сдвинулась» (AU-06, Р-6): сдвиг срока к снимку начала месяца и причина — `dreamShift`; снимка нет или
 * сдвиг меньше недели — ничего. Тот же расчёт, что у экрана цели. У главной мечты на обложке метки нет (пачка 2 «Figma»,
 * FG-21, поверх FG-12): срок и причина — в карточке цели; у строк целей — как была.
 */
const snap = computed(() => financeStore.termSnapFor(key.value))
function shiftOf(g: Goal) {
  const { state, ctx } = financeStore.planInput(key.value)
  // Раздел причины — только свой (Х-8, Р-29); viewer — семейная причина, как было.
  const s = dreamShift(state, ctx, snap.value, g.id, authStore.isViewer ? undefined : authStore.slot ?? undefined)
  return s ? { text: shiftShort(s), tone: s.days > 0 ? ('warn' as const) : ('ok' as const) } : null
}
/**
 * Подпись цели в строке — «на паузе» или метка сдвига с точкой тона, как у героя; срок цели — на её экране (Р-116).
 * Один расчёт на отрисовку (`dreamShift` гоняет план месяца).
 */
const rowNotes = computed(
  () => new Map(others.value.map((g) => [g.id, termOf(g).off ? { text: 'на паузе', tone: null } : shiftOf(g)] as const)),
)

const heroPercent = computed(() => (main.value ? pct(main.value.have, main.value.need) : 0))
// Обложка с шапкой на фото (FG-21): пока есть главная мечта, шапки оболочки нет.
useShellHero(() => !!main.value)
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

/* ---------- «Сбылось» (PN-14; пачка 2 «Figma», FG-21): тихая ссылка у «Целей» → лист со сбывшимися ---------- */
const done = computed(() => doneGoals(financeStore.goals))
const doneOpen = ref(false)
function openDone(id: string) {
  doneOpen.value = false
  void router.push(`/goals/${id}`)
}
const doneSrc = usePhotos(() => done.value.map((g) => g.photoId))
const doneSrcOf = (g: Goal) => (g.photoId ? doneSrc.value[g.photoId] : null)
const doneMeta = (g: Goal) => `${monthShort(monthKey(new Date(g.doneAt!)))} · за ${doneTerm(g)} мес.`

/* ---------- желания ---------- */
const openWishes = computed(() => wishQueue({ wishlist: financeStore.wishlist, wishOrder: financeStore.wishOrder }).filter((w) => !w.bought))
const firstWishes = computed(() => openWishes.value.slice(0, 3))
const wishSrc = usePhotos(() => firstWishes.value.map((w) => w.photoId))
// Строки желаний — без подписи «чьё» (FG-21): кто добавил — в листе желания.
const editWishId = ref<string | null>(null)
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
    <!--
      Обложка-журнал (пачка 2 «Figma», 47:2): главная мечта во всю ширину, 480; сверху на фото — «Мечты» и шапка оболочки
      (`ShellPeople`), снизу — процент, название, полоса. Нажатие — экран цели: кнопка — название, растянутое на обложку
      (`row-open`); ✦ совета, шапка и «Добавить фото» — над ней своими кнопками. Подсказка — под обложкой.
    -->
    <Tip v-if="main" id="tab-dreams" :text="tipText">
      <DreamHero
        size="cover"
        class="-mx-4 -mt-1"
        :percent="heroPercent"
        :src="heroSrc"
        :author="main.photoCredit?.author"
        data-dreams-cover
      >
        <template #top="{ onPhoto }">
          <!-- Шапка экрана — здесь, на фото: оболочка свою не рисует (`useShellHero`). -->
          <header class="flex items-center justify-between gap-3">
            <h1 class="truncate text-[25px] font-semibold tracking-[-0.01em]" :class="onPhoto ? 'text-on-photo' : 'text-ink'">Мечты</h1>
            <ShellPeople />
          </header>
        </template>
        <template #title>
          <button type="button" class="row-open min-w-0 truncate text-left" :aria-label="`${main.name}: ${heroPercent} %`" data-hero-line @click="router.push(`/goals/${main.id}`)">
            {{ main.name }}
          </button>
          <AdviceMark :n="ai.markFor('goal', main.id)" />
        </template>
        <template v-if="canEdit && !main.photoId" #actions>
          <Chip quiet class="relative z-10" @click="pickerOpen = true"><PhCamera /> Добавить фото</Chip>
        </template>
      </DreamHero>
    </Tip>
    <DreamCenter v-else :can-pick="canEdit" @pick="router.push('/goals/new')" />
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

    <!-- Цели: остальные мечты строками; «Сбылось · N ›» — тихой ссылкой у «+», сбывшиеся — листом (FG-21) -->
    <div v-if="main || done.length" class="flex items-center justify-between gap-3 px-1 pt-1.5">
      <h2 class="text-[20px] font-bold tracking-[-0.01em] text-ink">Цели</h2>
      <div class="flex items-center gap-3">
        <button v-if="done.length" type="button" class="press flex cursor-pointer items-center gap-0.5 text-[13px] text-ink-2" data-done-link @click="doneOpen = true">
          Сбылось · {{ done.length }}<PhCaretRight :size="13" class="text-ink-3" />
        </button>
        <!-- Новая цель — круглым «+» у заголовка, без слова (владелец, 2026-10-15, FR-09). -->
        <RouterLink v-if="main && canEdit" to="/goals/new" class="press grid size-8 place-items-center rounded-full bg-brand-soft text-brand" aria-label="Новая цель" data-new-goal>
          <PhPlus :size="16" weight="bold" />
        </RouterLink>
      </div>
    </div>
    <template v-if="main">
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
              :mark="ai.markFor('goal', id)"
              clickable
              @click="router.push(`/goals/${id}`)"
            >
              <span v-if="rowNotes.get(id)" class="flex min-w-0 items-center gap-1.5 type-meta" data-row-note>
                <i v-if="rowNotes.get(id)!.tone" class="size-1.5 shrink-0 rounded-full" :class="rowNotes.get(id)!.tone === 'ok' ? 'bg-ok' : 'bg-warn'" aria-hidden="true" />
                <span class="truncate">{{ rowNotes.get(id)!.text }}</span>
              </span>
              <ProgressBar :value="othersById.get(id)!.need ? othersById.get(id)!.have / othersById.get(id)!.need : 0" tone="ink" :height="5" />
              <template #end>
                <span class="font-num text-[15px] font-bold num text-ink">{{ pct(othersById.get(id)!.have, othersById.get(id)!.need) }}{{ NBSP }}%</span>
              </template>
            </ThumbRow>
          </template>
        </SortableList>
      </Card>
    </template>

    <Sheet :open="doneOpen" :title="`Сбылось · ${done.length}`" @close="doneOpen = false">
      <div class="flex flex-col" data-done-sheet>
        <ThumbRow
          v-for="(g, i) in done"
          :key="g.id"
          :title="g.name"
          :src="doneSrcOf(g)"
          :tone="hueColor(g.hue, isDark)"
          :index="i + 1"
          clickable
          data-done-row
          @click="openDone(g.id)"
        >
          <span class="truncate type-meta num">{{ doneMeta(g) }}</span>
          <template #end>
            <PhCheck :size="16" weight="bold" class="text-ok" />
          </template>
        </ThumbRow>
      </div>
    </Sheet>

    <!-- Желания: первые три, «›» — путь к списку есть всегда -->
    <div class="flex items-center justify-between px-1 pt-1.5">
      <!-- Сколько желаний — серой «таблеткой» у заголовка; ко всему списку — круглым «›», как «+» у «Целей» (FR-09). -->
      <h2 class="flex items-center gap-2 text-[20px] font-bold tracking-[-0.01em] text-ink">
        Желания<span v-if="openWishes.length" class="rounded-pill bg-surface-3 px-2 py-px text-[13px] font-semibold tracking-normal text-ink-2 num" data-wish-count>{{ openWishes.length }}</span>
      </h2>
      <RouterLink to="/wishes" class="press grid size-8 place-items-center rounded-full bg-surface-3 text-ink-2" aria-label="Все желания" data-all-wishes>
        <PhCaretRight :size="16" weight="bold" />
      </RouterLink>
    </div>
    <Card v-if="firstWishes.length" flush class="px-3.5 py-1">
      <!-- Желание — нажатием на всю строку (без «Открыть»), фото 56, цена — справа; подписи «чьё» нет (FG-21). -->
      <ThumbRow
        v-for="(w, i) in firstWishes"
        :key="w.id"
        :title="w.name"
        :src="w.photoId ? wishSrc[w.photoId] : null"
        :index="i + 1"
        :photo="56"
        fit
        clickable
        @click="openWish(w.id)"
      >
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
