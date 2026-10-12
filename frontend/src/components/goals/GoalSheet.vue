<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney } from '@/lib/money'
import { keepTermMonthly, liveGoals } from '@/lib/finance'
import { templateById } from '@/lib/goalTemplates'
import { deletePhoto } from '@/lib/photos/store'
import type { HueKey } from '@/lib/palette'
import type { Goal } from '@/types/finance'

import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import HuePicker from '@/components/goals/HuePicker.vue'
import TripFields, { tripDatesError } from '@/components/goals/TripFields.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Правка цели (React `EditGoalDialog`, `src/screens/GoalDetail.tsx:230-319`): каждое поле
 * пишется по уходу из него, цвет — сразу; закрыть окно фоном, крестиком или «Готово» —
 * ничего не потерять. «Уже накоплено» правит seed (`updateGoal`): история взносов остаётся.
 * «Откладывать в месяц» — на экране цели, как React (в окне его нет).
 * Сумма и «уже накоплено» (хотфикс 2026-10-12): срок прежний — взнос пересчитывается той же записью (`keepTermMonthly`),
 * экран цели тостом предлагает «Оставить взнос» (тогда сдвигается срок). Взносов — сколько показывает экран (`termMonths`);
 * его нет (фонд, пауза, на паузе ради плана — взнос идёт в долг) — взнос не трогаем.
 * Поездка (PN-31): у «Путешествия» и у любой цели с датами — даты (пишутся, когда пара верна) и бюджет (по уходу).
 */
const props = defineProps<{ goalId: string | null; termMonths?: number | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'removed'): void; (e: 'term', change: { prev: number; next: number }): void }>()

const financeStore = useFinanceStore()

const goal = computed(() => liveGoals(financeStore.goals).find((g) => g.id === props.goalId)) // Сбылось (PN-13): все живые — сбывшуюся можно править и удалить
const saved = useSavedMark(
  () => goal.value?.id,
  () => goal.value?.updatedAt,
)

/* ---------- поездка (PN-31) ---------- */
const isTrip = computed(() => !!goal.value && (templateById(goal.value.template)?.type === 'travel' || !!goal.value.from || !!goal.value.to))
const tripFrom = ref('')
const tripTo = ref('')
const tripBudget = ref('')
watch(
  () => goal.value?.id,
  () => {
    tripFrom.value = goal.value?.from ?? ''
    tripTo.value = goal.value?.to ?? ''
    tripBudget.value = goal.value?.budget ? plain(goal.value.budget) : ''
  },
  { immediate: true },
)
const tripError = computed(() => tripDatesError(tripFrom.value, tripTo.value))
watch([tripFrom, tripTo], ([from, to]) => {
  if (goal.value && !tripError.value && (from !== (goal.value.from ?? '') || to !== (goal.value.to ?? ''))) financeStore.setTripDates(goal.value.id, { from, to })
})
function onTripBudget() {
  const v = parseMoney(tripBudget.value)
  if (goal.value && v !== (goal.value.budget ?? 0)) financeStore.setTripDates(goal.value.id, { budget: v })
}

function edit(patch: Partial<Goal>) {
  if (goal.value) financeStore.updateGoal(goal.value.id, patch)
}
function onName(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v && v !== goal.value?.name) edit({ name: v })
}
/** Сумма или накопленное — срок прежний: новый взнос в той же записи, экрану — что был (для «Оставить взнос»). */
function editKeepTerm(patch: { need?: number; have?: number }) {
  const g = goal.value
  if (!g) return
  const remaining = (need: number, have: number) => Math.max(0, need - Math.max(0, have))
  const monthly = g.fund || props.termMonths == null ? g.monthly : keepTermMonthly(props.termMonths, g.monthly, remaining(patch.need ?? g.need, patch.have ?? g.have))
  const prev = g.monthly // до записи: цель в сторе меняется на месте
  if (monthly === prev) return edit(patch)
  edit({ ...patch, monthly })
  emit('term', { prev, next: monthly })
}
function onNeed(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== goal.value?.need) editKeepTerm({ need: v })
}
function onHave(text: string) {
  const v = parseMoney(text)
  if (v >= 0 && v !== goal.value?.have) editKeepTerm({ have: v })
}
function onHue(hue: HueKey) {
  edit({ hue })
}
function remove() {
  const g = goal.value
  if (g) {
    // Фото мечты на сервере — вместе с целью (критик Блока 3; своё фото или картинка шаблона).
    if (g.photoId) void deletePhoto(g.photoId).catch(() => {})
    financeStore.removeGoal(g.id)
  }
  emit('removed')
}
</script>

<template>
  <Sheet :open="!!goal" title="Изменить цель" @close="emit('close')">
    <template #mark>
      <SavedMark :on="saved" />
    </template>
    <template v-if="goal" #default="{ close }">
      <Field label="Название">
        <Input :default-value="goal.name" @blur="onName" />
      </Field>
      <Field label="Сколько нужно, ₸">
        <NumFieldBlur :initial="plain(goal.need)" @commit="onNeed" />
      </Field>
      <Field label="Уже накоплено, ₸">
        <NumFieldBlur :initial="plain(goal.have)" @commit="onHave" />
      </Field>
      <p v-if="goal.movements?.length" class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-2">
        Взносы ({{ goal.movements.length }}) останутся в истории: правится только та часть,
        с которой цель завели.
      </p>

      <TripFields v-if="isTrip" v-model:from="tripFrom" v-model:to="tripTo" v-model:budget="tripBudget" :error="tripError" @budget-blur="onTripBudget" />

      <HuePicker :model-value="goal.hue" @update:model-value="onHue" />

      <Button class="mb-3 w-full" @click="close">Готово</Button>

      <DangerZone
        label="Удалить цель"
        warning="Цель и её история взносов исчезнут у обоих участников. Отменить нельзя."
        @confirm="remove"
      />
    </template>
  </Sheet>
</template>
