<script setup lang="ts">
import { computed, ref } from 'vue'
import { earlierLabel, liveSpendCategories, monthsLabel, spendCategoryName, type StepCandidate } from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { money, plain } from '@/lib/money'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Sheet from '@/components/kit/Sheet.vue'
import Toast from '@/components/kit/Toast.vue'
import { useFlash } from '@/components/kit/useFlash'
import Button from '@/components/ui/Button.vue'

/**
 * Лист «Сделать» (Р-3, AU-06) — один для любого кандидата `stepCandidates` / `returnTermShift` (его же откроет шаг
 * разбора в Блоке 3): крупно — сумма, строками — откуда → куда, эффект, «Только этот месяц»; одна брендовая
 * подтверждения во всю ширину, под ней тихая «Не сейчас». Подтвердил — сдвиг месяца в документ (`addPlanShift`), лист
 * закрыт, тост с «Отменить» (`undoPlanShift`). Viewer лист не открывает. Все числа — из кандидата (`finance.ts`).
 */
const props = defineProps<{
  candidate: StepCandidate | null
  /** Открыт из «Вернуть срок» у мечты: заголовок «Вернуть срок», кнопка «Вернуть». */
  returning?: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done', id: string): void }>()

const finance = useFinanceStore()
const auth = useAuthStore()
const open = computed(() => !!props.candidate && !auth.isViewer)

const goalName = (id: string) => finance.goals.find((g) => g.id === id)?.name ?? ''
const debtName = computed(() => finance.monthPlanOf(monthKey()).queue.find((q) => q.kind === 'debt')?.name ?? 'долг')

const TITLES = { move: 'Перенести в мечту', prepay: 'Внести досрочно', cushion: 'Отложить в подушку' } as const
const CONFIRM = { move: 'Перенести', prepay: 'Внести', cushion: 'Отложить' } as const

const view = computed(() => {
  const c = props.candidate
  if (!c) return null
  const { from, to } = c.shift
  const fromText =
    from === 'rest'
      ? 'из остатка месяца'
      : `из плана «${spendCategoryName(liveSpendCategories(finance.householdDoc.spendCategories ?? []), from.categoryId)}» · ${finance.people.find((p) => p.id === from.spend)?.name ?? ''}`
  const toText = to === 'debt' ? `в «${debtName.value}»` : `в «${goalName(to.goalId)}»`
  let effect = ''
  if (c.kind === 'move' && c.effect.days) effect = `на ${earlierLabel(c.effect.days)} раньше`
  if (c.kind === 'prepay') effect = [c.effect.months > 0 ? `на ${c.effect.months} мес. раньше` : '', c.effect.saved > 0 ? `−${plain(c.effect.saved)} процентов` : ''].filter(Boolean).join(' · ')
  if (c.kind === 'cushion' && c.effect.months !== null) effect = `подушки хватит на ${monthsLabel(c.effect.months)}`
  return {
    title: props.returning ? 'Вернуть срок' : TITLES[c.kind],
    confirm: props.returning ? 'Вернуть' : CONFIRM[c.kind],
    amount: money(c.shift.amount),
    fromText,
    toText,
    effect,
  }
})

/** Тост после подтверждения: «<Мечта> ближе на …» / «В плане месяца» — с «Отменить». */
const { note, flash, clear } = useFlash(6000)
const lastId = ref<string | null>(null)

function confirm() {
  const c = props.candidate
  if (!c) return
  const shift = finance.addPlanShift(c.shift)
  emit('close')
  if (!shift) return
  lastId.value = shift.id
  const to = c.shift.to
  flash(c.kind === 'move' && to !== 'debt' && c.effect.days ? `«${goalName(to.goalId)}» ближе на ${earlierLabel(c.effect.days)}` : 'В плане месяца')
  emit('done', shift.id)
}

function undo() {
  if (lastId.value) finance.undoPlanShift(lastId.value)
  lastId.value = null
  clear()
}
</script>

<template>
  <Sheet :open="open" :title="view?.title ?? ''" @close="emit('close')">
    <template v-if="view">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-do-amount>{{ view.amount }}</p>
      <div class="mt-1 flex flex-col gap-0.5 text-[14px] text-ink-2">
        <span data-do-from>{{ view.fromText }} → {{ view.toText }}</span>
        <span v-if="view.effect" class="font-semibold text-ink num" data-do-effect>{{ view.effect }}</span>
        <span data-do-month>Только этот месяц</span>
      </div>
      <Button class="mt-5 w-full" data-do-confirm @click="confirm">{{ view.confirm }}</Button>
      <Button variant="ghost" class="mt-1.5 w-full" data-do-cancel @click="emit('close')">Не сейчас</Button>
    </template>
  </Sheet>
  <Toast v-if="note" action="Отменить" @action="undo"><span data-do-toast>{{ note }}</span></Toast>
</template>
