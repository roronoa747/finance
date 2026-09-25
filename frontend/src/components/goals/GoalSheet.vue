<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney } from '@/lib/money'
import { liveGoals } from '@/lib/finance'
import type { HueKey } from '@/lib/palette'
import type { Goal } from '@/types/finance'

import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import HuePicker from '@/components/goals/HuePicker.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Правка цели (React `EditGoalDialog`, `src/screens/GoalDetail.tsx:230-319`): каждое поле
 * пишется по уходу из него, цвет — сразу; закрыть окно фоном или крестиком — ничего не
 * потерять. «Уже накоплено» правит seed (`updateGoal`): история взносов остаётся.
 */
const props = defineProps<{ goalId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'removed'): void }>()

const financeStore = useFinanceStore()

const goal = computed(() => liveGoals(financeStore.goals).find((g) => g.id === props.goalId))
const saved = useSavedMark(
  () => goal.value?.id,
  () => goal.value?.updatedAt,
)

function edit(patch: Partial<Goal>) {
  if (goal.value) financeStore.updateGoal(goal.value.id, patch)
}
function onName(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v && v !== goal.value?.name) edit({ name: v })
}
function onNeed(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== goal.value?.need) edit({ need: v })
}
function onHave(text: string) {
  const v = parseMoney(text)
  if (v >= 0 && v !== goal.value?.have) edit({ have: v })
}
function onMonthly(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== goal.value?.monthly) edit({ monthly: v })
}
function onHue(hue: HueKey) {
  edit({ hue })
}
function remove() {
  if (goal.value) financeStore.removeGoal(goal.value.id)
  emit('removed')
}
</script>

<template>
  <Sheet :open="!!goal" title="Изменить цель" @close="emit('close')">
    <template #mark>
      <SavedMark :on="saved" />
    </template>
    <template v-if="goal">
      <Field label="Название">
        <Input :default-value="goal.name" class="mb-3" @blur="onName" />
      </Field>
      <Field label="Сколько нужно, ₸">
        <NumFieldBlur :initial="plain(goal.need)" class="mb-3" @commit="onNeed" />
      </Field>
      <Field label="Уже накоплено, ₸">
        <NumFieldBlur :initial="plain(goal.have)" class="mb-3" @commit="onHave" />
      </Field>
      <p v-if="goal.movements?.length" class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
        Взносы ({{ goal.movements.length }}) останутся в истории: правится только та часть,
        с которой цель завели.
      </p>
      <Field label="Откладывать в месяц, ₸">
        <NumFieldBlur :initial="plain(goal.monthly)" class="mb-3" @commit="onMonthly" />
      </Field>

      <HuePicker :model-value="goal.hue" @update:model-value="onHue" />

      <Button class="mb-3 w-full" @click="emit('close')">Готово</Button>

      <DangerZone
        label="Удалить цель"
        warning="Цель и её история взносов исчезнут у обоих участников. Отменить нельзя."
        @confirm="remove"
      />
    </template>
  </Sheet>
</template>
