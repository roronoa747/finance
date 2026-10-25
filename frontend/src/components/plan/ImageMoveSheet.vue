<script setup lang="ts">
import { computed, ref } from 'vue'
import { imageMoveFrom, liveSpendCategories, shiftSpan, spendCategoryName, type ImageAction } from '@/lib/finance'
import { money } from '@/lib/money'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Sheet from '@/components/kit/Sheet.vue'
import Toast from '@/components/kit/Toast.vue'
import { useFlash } from '@/components/kit/useFlash'
import Button from '@/components/ui/Button.vue'
import type { PersonId } from '@/types/finance'

type Move = Extract<ImageAction, { kind: 'move' }>

/**
 * Лист «Перенести в мечту» у образа (Р-27, AU-29): **каждый месяц**, в отличие от «Сделать» (этот месяц, `DoSheet`) —
 * постоянный план раздела участника с бо́льшим планом −N (`setSpendPlan`; плана нет — только взнос) и взнос мечты +N
 * (`setGoalMonthly`). Крупно — сумма, строками — откуда → куда и эффект; одна брендовая подтверждения во всю ширину.
 * Перенос записывается (`imageMoves`, Х-9) — у образа вместо кнопки «✓ N в мечту». Тост «Отменить» возвращает оба
 * прежних значения и снимает запись. Viewer лист не открывает. Числа — из образа и `imageMoveFrom`.
 */
const props = withDefaults(defineProps<{ action: Move | null; z?: number }>(), { z: 50 })
const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()
const auth = useAuthStore()
const open = computed(() => !!props.action && !auth.isViewer)

const from = computed(() => (props.action ? imageMoveFrom(finance.householdDoc, props.action.categoryId, props.action.amount) : null))

const view = computed(() => {
  const a = props.action
  if (!a) return null
  const cat = spendCategoryName(liveSpendCategories(finance.householdDoc.spendCategories ?? []), a.categoryId)
  const who = from.value ? finance.people.find((p) => p.id === from.value!.by)?.name ?? '' : ''
  return {
    amount: money(a.amount),
    fromText: from.value ? `−${money(a.amount)} из плана «${cat}» · ${who}` : `плана «${cat}» нет — только взнос`,
    toText: `+${money(a.amount)} в мечту «${a.goalName}»`,
    effect: a.days ? `на ${shiftSpan(a.days)} раньше` : '',
  }
})

/** Что вернуть «Отменить»: план участника и взнос мечты до переноса, запись переноса (Х-9). */
const undoTo = ref<{ plan: { by: PersonId; categoryId: string; amount: number } | null; goalId: string; monthly: number; moveId: string | null } | null>(null)
const { note, flash, clear } = useFlash(6000)

function confirm() {
  const a = props.action
  const goal = a ? finance.goals.find((g) => g.id === a.goalId) : null
  if (!a || !goal) return
  const f = from.value
  const plan = f ? { by: f.by, categoryId: a.categoryId, amount: f.plan } : null
  const monthly = goal.monthly
  if (f) finance.setSpendPlan(f.by, a.categoryId, f.next)
  finance.setGoalMonthly(goal.id, monthly + a.amount)
  // Перенос запомнен (Х-9): у образа вместо кнопки «✓ N в мечту» — второй раз план не урежется.
  const moveId = finance.addImageMove({ categoryId: a.categoryId, goalId: goal.id, amount: a.amount })
  undoTo.value = { plan, goalId: goal.id, monthly, moveId }
  emit('close')
  flash(a.days ? `«${a.goalName}» ближе на ${shiftSpan(a.days)}` : `+${money(a.amount)} в «${a.goalName}» каждый месяц`)
}

function undo() {
  const u = undoTo.value
  if (u) {
    if (u.plan) finance.setSpendPlan(u.plan.by, u.plan.categoryId, u.plan.amount)
    finance.setGoalMonthly(u.goalId, u.monthly)
    if (u.moveId) finance.undoImageMove(u.moveId)
  }
  undoTo.value = null
  clear()
}
</script>

<template>
  <Sheet :open="open" title="Перенести в мечту" :z="z" @close="emit('close')">
    <template v-if="view">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-move-amount>{{ view.amount }}</p>
      <div class="mt-1 flex flex-col gap-0.5 text-[14px] text-ink-2 num">
        <span data-move-from>{{ view.fromText }}</span>
        <span data-move-to>{{ view.toText }}</span>
        <span v-if="view.effect" class="font-semibold text-ink" data-move-effect>{{ view.effect }}</span>
        <span data-move-every>Каждый месяц</span>
      </div>
      <Button class="mt-5 w-full" data-move-confirm @click="confirm">Перенести</Button>
      <Button variant="ghost" class="mt-1.5 w-full" data-move-cancel @click="emit('close')">Не сейчас</Button>
    </template>
  </Sheet>
  <Toast v-if="note" action="Отменить" @action="undo"><span data-move-toast>{{ note }}</span></Toast>
</template>
