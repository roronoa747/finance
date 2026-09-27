<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { PhArrowLeft, PhCamera, PhPencilSimple, PhPlus, PhMinus, PhShareNetwork } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, pct, plain, parseMoney, ratePct } from '@/lib/money'
import {
  INFLATION,
  contributionStreak,
  goalDoneMonth,
  goalMonths,
  goalMonthly,
  indexedNeed,
  liveGoals,
  mainGoal,
  monthsBetween,
  movementMonth,
  payableAccounts,
  planForecast,
} from '@/lib/finance'
import { addMonths, atLabel, monthIn, monthKey, monthTitle, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import { plural } from '@/lib/utils'
import { templateById, templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate } from '@/lib/photos/goalPhoto'
import { deletePhoto } from '@/lib/photos/store'
import { usePhoto } from '@/lib/photos/usePhoto'
import type { PersonId } from '@/types/finance'

import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Section from '@/components/kit/Section.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import GoalSheet from '@/components/goals/GoalSheet.vue'
import PhotoPicker from '@/components/goals/PhotoPicker.vue'
import StorySheet from '@/components/goals/StorySheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Экран цели (DESIGN.md §2 g4 «Экран цели»; B2C-18): фото-герой с процентом, «Будет вашей в …»
 * со взносом и числом взносов, «Пополнить» / «Поделиться» (B2C-20) / «Сделать главной», взносы
 * с аватарами, правка по карандашу (`GoalSheet`), viewer — без форм. Хвосты: месяц взноса и серия —
 * по Алматы (`movementMonth`), цена «дорожает» — до месяца закрытия (после плана — позже).
 */
const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const goalId = computed(() => route.params.id as string)
// Удалил партнёр — «Цель не найдена», как окно правки (`GoalSheet`): пополнение ушло бы в
// надгробие, а счёт списался бы.
const goal = computed(() => liveGoals(financeStore.goals).find((g) => g.id === goalId.value))
const people = computed(() => financeStore.people)
const canEdit = computed(() => !authStore.isViewer)
const isMain = computed(() => mainGoal(financeStore.goals)?.id === goalId.value)
// Пополнение и снятие двигают тенговую базу счёта: валютный счёт пересчитал бы её по
// курсу при следующей правке и молча потерял сдвиг. Удалённые счета — тоже не сюда.
const accounts = computed(() => payableAccounts(financeStore.accounts))

// План «Сначала долги» (PV-15): пауза выводится из плана, взнос цели не трогается (Р-9).
const plan = computed(() => financeStore.activePlan)
const paused = computed(() => financeStore.pausedGoalIds.has(goalId.value))
const planCushion = computed(() => !!plan.value && plan.value.cushionGoalId === goalId.value)

const remaining = computed(() => (goal.value ? Math.max(0, goal.value.need - goal.value.have) : 0))
const months = computed(() => (goal.value ? goalMonths(remaining.value, goal.value.monthly) : 1))
const progress = computed(() => (goal.value ? pct(goal.value.have, goal.value.need) : 0))

// Цель на паузе стоит, пока план не закроет долги с процентами (Н-8 ревью Блока 3): дата —
// от месяца без процентных долгов по прогнозу плана; не закрываются — месяца нет.
const forecast = computed(() => (paused.value && plan.value ? planForecast(plan.value, financeStore.planState(), monthKey()) : null))
const doneMonth = computed(() => goalDoneMonth(months.value, monthKey(), forecast.value ?? undefined))
const doneTitle = computed(() => (doneMonth.value ? `Будет вашей в ${monthIn(doneMonth.value)}` : paused.value ? 'После плана' : 'Взнос не задан'))
const doneLine = computed(() => {
  if (!goal.value) return ''
  if (remaining.value <= 0) return 'Накоплено — мечта ваша'
  if (!Number.isFinite(months.value)) return 'Задайте взнос — и появится дата'
  return `по ${money(goal.value.monthly)} в месяц · осталось ${months.value} ${plural(months.value, 'взнос', 'взноса', 'взносов')}${paused.value && doneMonth.value ? ' · после плана' : ''}`
})
// Во сколько обойдётся та же цель к сроку (хвост PV: горизонт — до месяца закрытия, у паузы — позже).
const indexed = computed(() => (goal.value && doneMonth.value ? indexedNeed(goal.value.need, monthsBetween(monthKey(), doneMonth.value)) : null))

/* ------------------ Взнос полем (исключение из Р-2, владелец 2026-09-25) ------------------ */
// «Сохранено» — по самому взносу, а не по updatedAt цели: пополнение тоже меняет цель, но
// взнос оно не трогает.
const monthlySaved = useSavedMark(
  () => goal.value?.id,
  () => (goal.value ? String(goal.value.monthly) : undefined),
)
function onMonthly(text: string) {
  const v = parseMoney(text)
  if (goal.value && v > 0 && v !== goal.value.monthly) financeStore.setGoalMonthly(goal.value.id, v)
}

/* ------------------ Ритм (месяцы по Алматы) ------------------ */
const rhythmColor = computed(() => (goal.value ? hueColor(goal.value.hue, isDark.value) : ''))
const streak = computed(() => (goal.value ? contributionStreak(goal.value.movements || []) : 0))
const filled = computed(() => new Set((goal.value?.movements || []).filter((m) => m.amount > 0).map((m) => movementMonth(m.date))))
const last12 = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const k = addMonths(monthKey(), i - 11)
    return { key: k, label: monthTitle(k), filled: filled.value.has(k) }
  }),
)

/* ------------------ Пополнение / Снятие ------------------ */
const openDepositModal = ref(false)
const depositOperation = ref<'deposit' | 'withdraw'>('deposit')
const depositAmount = ref('')
const depositBy = ref<PersonId>(authStore.slot ?? 'a')
const depositAccountId = ref<string>('')
const depositNote = ref('')
// Сумма — сразу под пальцем (React `autoFocus`): лист вставляется после открытия, атрибут не сработал бы.
const depositAmountRef = ref<HTMLElement | null>(null)
watch(openDepositModal, (open) => {
  if (open) void nextTick(() => depositAmountRef.value?.querySelector('input')?.focus())
})

// История — новые сверху по дате: слияние хранит «новые первыми», взнос дописывается в конец.
const history = computed(() => [...(goal.value?.movements ?? [])].sort((a, b) => b.date.localeCompare(a.date)))
const monthOf = (iso: string) => MONTHS_NOM[parseMonthKey(movementMonth(iso)).month]

function applyDeposit() {
  const v = parseMoney(depositAmount.value)
  if (!v || !goal.value) return

  if (depositOperation.value === 'deposit') {
    financeStore.contribute(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    // Сдвиг остатка, а не сверка: отметки оплат до взноса продолжают считаться.
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, -v)
  } else {
    financeStore.withdraw(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, v)
  }

  depositAmount.value = ''
  depositNote.value = ''
  depositAccountId.value = ''
  openDepositModal.value = false
}

/* ------------------ Редактирование цели ------------------ */
// Поля окна пишутся сами по уходу из поля (`GoalSheet`); viewer окна не открывает (Р-12).
const openEditModal = ref(false)

/* ------------------ Фото цели (B2C-17) ------------------ */
const photoSrc = usePhoto(() => goal.value?.photoId)
const pickerOpen = ref(false)
const photoNote = ref<string | null>(null)

async function onTemplate(t: GoalTemplate) {
  pickerOpen.value = false
  if (!goal.value) return
  const result = await attachTemplate(financeStore, goal.value.id, t)
  photoNote.value = result === 'uploaded' ? null : 'Картинка появится при сети.'
}

async function onFile(file: File) {
  pickerOpen.value = false
  if (!goal.value) return
  const ok = await attachFile(financeStore, goal.value.id, file)
  photoNote.value = ok ? null : 'Фото не загрузилось — попробуйте при сети.'
}

/** Убрать фото: сначала из документа (партнёр перестаёт видеть), затем с сервера. */
async function removePhoto() {
  pickerOpen.value = false
  const g = goal.value
  if (!g?.photoId) return
  const id = g.photoId
  financeStore.setGoalPhoto(g.id, null)
  financeStore.updateGoal(g.id, { template: null })
  await deletePhoto(id).catch(() => {})
}

/* ------------------ Карточка для сторис (B2C-20) ------------------ */
// `/share/:goalId` из DESIGN.md §2 — редирект сюда с `?share=1`: лист открывается сразу.
const storyOpen = ref(route.query.share === '1')
// Фото мечты; без загруженного — картинка шаблона с CDN (CORS открыт); без шаблона — фон без фото.
const storySrc = computed(() => {
  if (photoSrc.value) return photoSrc.value
  const t = templateById(goal.value?.template)
  return t ? templateImageUrl(t, 1080) : null
})
const storyData = computed(() => ({ percent: progress.value, goalName: goal.value?.name, doneMonth: doneMonth.value ? monthIn(doneMonth.value) : null }))
function share() {
  storyOpen.value = true
}
</script>

<template>
  <div v-if="!goal" class="pt-6 text-center text-[14px] text-ink-3">
    Цель не найдена.
    <button class="text-brand font-medium cursor-pointer" @click="router.push('/')">
      К списку
    </button>
  </div>

  <div v-else class="flex flex-col gap-3 pt-1 text-left">
    <div class="flex items-center justify-between">
      <button
        type="button"
        class="flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink cursor-pointer"
        @click="router.push('/')"
      >
        <PhArrowLeft :size="15" /> Все мечты
      </button>
      <button
        v-if="canEdit"
        type="button"
        aria-label="Изменить цель"
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
        @click="openEditModal = true"
      >
        <PhPencilSimple :size="18" />
      </button>
    </div>

    <!-- Фото-герой (B2C-17): картинка шаблона или своя; автор — один раз, на фото, ссылкой (Р-28).
         Поверх картинки — только маленькая кнопка смены фото (владелец, 2026-09-27: крупные чипы
         закрывали фото); «Убрать фото» — в окне выбора, «Сделать главной» — в карточке ниже. -->
    <DreamHero
      :title="goal.name"
      :percent="progress"
      :have-amount="goal.have"
      :need-amount="goal.need"
      :done-month="doneMonth ? monthIn(doneMonth) : null"
      :src="photoSrc"
      :author="goal.photoCredit?.author"
      :author-url="goal.photoCredit?.url"
      size="goal"
    >
      <template v-if="canEdit && goal.photoId" #corner>
        <button
          type="button"
          aria-label="Сменить фото"
          class="grid size-[34px] place-items-center rounded-full bg-photo-scrim text-on-photo cursor-pointer"
          @click="pickerOpen = true"
        >
          <PhCamera :size="18" />
        </button>
      </template>
      <template v-if="canEdit && !goal.photoId" #actions>
        <Chip quiet @click="pickerOpen = true"><PhCamera /> Добавить фото</Chip>
      </template>
    </DreamHero>
    <Callout v-if="photoNote" tone="neutral" icon="info">{{ photoNote }}</Callout>
    <PhotoPicker
      :open="pickerOpen"
      title="Фото мечты"
      :selected="goal.template"
      :skippable="false"
      :removable="!!goal.photoId"
      @close="pickerOpen = false"
      @template="onTemplate"
      @file="onFile"
      @remove="removePhoto"
    />

    <Card>
      <div class="flex items-start justify-between gap-3">
        <h2 class="type-h2 text-ink">{{ doneTitle }}</h2>
        <Tag v-if="isMain" tone="brand">главная</Tag>
        <button v-else-if="canEdit" type="button" class="shrink-0 pt-1 text-[12.5px] font-medium text-brand cursor-pointer" @click="financeStore.setMainGoal(goal.id)">
          Сделать главной
        </button>
      </div>
      <p class="mt-1 text-[13.5px] text-ink-2">{{ doneLine }}</p>

      <!-- Взнос вводится числом, а не ползунком (исключение из Р-2, владелец 2026-09-25). Viewer — только сумма. -->
      <div v-if="canEdit" class="mt-4">
        <div class="-mb-3.5 flex justify-end">
          <SavedMark :on="monthlySaved" />
        </div>
        <Field label="Откладывать в месяц, ₸">
          <NumFieldBlur :initial="plain(goal.monthly)" @commit="onMonthly" />
        </Field>
      </div>
      <p v-if="remaining > 0" class="text-[12.5px] text-ink-2">
        Чтобы успеть за год, нужно {{ money(goalMonthly(remaining, 12)) }} в месяц.
      </p>

      <div class="mt-3 flex flex-wrap gap-2">
        <Button
          v-if="canEdit"
          @click="
            depositOperation = 'deposit';
            openDepositModal = true;
          "
        >
          <PhPlus :size="16" weight="bold" /> Пополнить
        </Button>
        <Button variant="secondary" @click="share"><PhShareNetwork :size="16" /> Поделиться</Button>
        <Button
          v-if="canEdit"
          variant="ghost"
          @click="
            depositOperation = 'withdraw';
            openDepositModal = true;
          "
        >
          <PhMinus :size="16" weight="bold" /> Снять
        </Button>
      </div>
    </Card>

    <Callout v-if="paused" title="На паузе ради плана">
      Взнос {{ money(goal.monthly) }} идёт в досрочку самого дорогого долга — так семья отдаст банку
      меньше. Цель возобновится сама, когда долги с процентами закроются, или когда вы отмените план.
      <RouterLink to="/money/plan" class="font-medium text-brand">Открыть план</RouterLink>
    </Callout>
    <Callout v-else-if="planCushion" tone="good" title="Подушка плана: взносы продолжаются">
      Пока в ней меньше месяца обязательных списаний, шаг плана — пополнить её.
      <RouterLink to="/money/plan" class="font-medium text-brand">Открыть план</RouterLink>
    </Callout>

    <Callout v-if="indexed !== null" tone="neutral" title="Цель дорожает вместе с рынком">
      При инфляции {{ ratePct(INFLATION, 1) }} в год к {{ doneMonth ? monthIn(doneMonth) : 'сроку' }}
      такая же покупка будет стоить около {{ money(indexed) }}. Расчёт выше — в сегодняшних деньгах.
    </Callout>

    <!-- Ритм цели -->
    <Section title="Ритм цели" />
    <Card>
      <div class="mb-3 flex items-center gap-2.5">
        <b class="text-[14.5px] font-semibold text-ink">Пополняем без пропусков</b>
        <Hint>
          {{
            streak > 0
              ? 'Считается по взносам именно в эту цель, а не по общему плану.'
              : 'Закрасится, как только появится первый взнос в эту цель.'
          }}
        </Hint>
        <Tag v-if="streak > 0" tone="gold">{{ streak }} мес.</Tag>
      </div>
      <div class="flex gap-1.5">
        <i
          v-for="m in last12"
          :key="m.key"
          :title="m.label"
          class="h-[20px] flex-1 rounded transition-colors"
          :style="{ background: m.filled ? rhythmColor : 'var(--track)' }"
        />
      </div>
    </Card>

    <!-- Взносы -->
    <Section title="Взносы" />
    <Card flush>
      <div
        v-for="m in history"
        :key="m.id"
        class="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
      >
        <Avatar :id="m.by" :name="people.find((p) => p.id === m.by)?.name || 'Участник'" :size="34" />
        <div class="min-w-0 flex-1 text-left">
          <b class="block text-[14.5px] font-medium text-ink">
            {{ m.amount > 0 ? monthOf(m.date) : 'Снятие' }}
          </b>
          <span class="block text-[12.5px] text-ink-3">
            {{ atLabel(m.date) }} · {{ people.find((p) => p.id === m.by)?.name || 'Участник' }}
            <span v-if="m.note">· {{ m.note }}</span>
          </span>
        </div>
        <span
          :class="[
            'shrink-0 text-[14.5px] font-semibold num',
            m.amount > 0 ? 'text-ok' : 'text-ink-2',
          ]"
        >
          {{ m.amount > 0 ? '+' : '−' }}{{ plain(Math.abs(m.amount)) }} ₸
        </span>
      </div>
      <div v-if="!(goal.movements && goal.movements.length)" class="px-4 py-6 text-center text-[13px] text-ink-3">
        Взносов пока нет — история появится после первого пополнения
      </div>
    </Card>

    <!-- Окно: Пополнить / Снять -->
    <Sheet
      :open="openDepositModal"
      :title="depositOperation === 'deposit' ? `Пополнить «${goal.name}»` : 'Снять средства'"
      @close="openDepositModal = false"
    >
      <div ref="depositAmountRef">
        <Field label="Сумма, ₸">
          <NumField
            v-model="depositAmount"
            :placeholder="depositOperation === 'deposit' ? plain(goal.monthly) : '10 000'"
            class="mb-3"
          />
        </Field>
      </div>

      <Field v-if="accounts.length > 0" :label="depositOperation === 'deposit' ? 'Списать со счёта (опционально)' : 'Зачислить на счёт (опционально)'">
        <Select
          v-model="depositAccountId"
          :options="[
            { value: '', label: 'Не списывать со счетов' },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${money(a.amount)})` })),
          ]"
          class="mb-3"
        />
      </Field>

      <Field v-if="people.length > 1" label="Кто вносит" group>
        <Segmented v-model="depositBy" :options="people.map((p) => ({ value: p.id, label: p.name }))" />
      </Field>

      <Field label="Примечание">
        <Input v-model="depositNote" placeholder="Премия, накопления…" class="mb-3" />
      </Field>

      <Button :disabled="parseMoney(depositAmount) <= 0" class="w-full mt-2" @click="applyDeposit">
        {{ depositOperation === 'deposit' ? 'Внести' : 'Снять' }}
      </Button>
    </Sheet>

    <!-- Карточка для сторис (B2C-20): без сумм -->
    <StorySheet :open="storyOpen" kind="goal" :data="storyData" :src="storySrc" @close="storyOpen = false" />

    <!-- Окно: Изменить цель -->
    <GoalSheet
      :goal-id="openEditModal && canEdit ? goal.id : null"
      @close="openEditModal = false"
      @removed="router.push('/')"
    />
  </div>
</template>
