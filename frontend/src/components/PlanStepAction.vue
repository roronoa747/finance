<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { lastAccountFor, payableAccounts, stepDue } from '@/lib/finance'
import { cn } from '@/lib/utils'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'

/**
 * «Внести по плану» — досрочка шага плана одним нажатием (PV-16, Р-4, Р-10): сумма
 * шага в самый дорогой долг, «сократить срок», со счёта прошлой оплаты этого кредита
 * (Р-5 RP). Оплат не было — лист спрашивает счёт один раз, как первая оплата в
 * `PaidRow`. Кнопки нет у viewer (Р-12), у внесённого шага и у шага «подушка».
 */
const props = defineProps<{
  /** Кнопка шире — на экране плана. */
  wide?: boolean
}>()

const finance = useFinanceStore()
const auth = useAuthStore()

const due = computed(() => stepDue(finance.planStepNow()))
const credit = computed(() => finance.credits.find((c) => c.id === due.value?.creditId))
const canPay = computed(() => !auth.isViewer && !!due.value)

const choices = computed(() => payableAccounts(finance.accounts))
const open = ref(false)
// undefined — счёт ещё не выбран; null — «не списывать».
const chosen = ref<string | null | undefined>(undefined)

function tap() {
  const s = due.value
  if (!s) return
  const last = lastAccountFor(finance.payments, s.creditId, finance.accounts)
  if (last === undefined) {
    chosen.value = undefined
    open.value = true
    return
  }
  finance.applyPlanStep(auth.slot ?? 'a', { accountId: last })
}

function confirm() {
  if (chosen.value === undefined) return
  finance.applyPlanStep(auth.slot ?? 'a', { accountId: chosen.value })
  open.value = false
}
</script>

<template>
  <button
    v-if="canPay"
    type="button"
    :class="
      cn(
        'shrink-0 rounded-lg border border-brand bg-brand-soft px-2.5 py-1.5 text-[12.5px] font-medium text-brand active:translate-y-px cursor-pointer',
        props.wide && 'w-full py-2.5 text-[14px]',
      )
    "
    @click="tap"
  >
    Внести по плану
  </button>

  <Sheet :open="open && !!due" title="Досрочка по плану" :z="60" @close="open = false">
    <template v-if="due">
      <p class="mb-3 text-[13px] leading-relaxed text-ink-2">
        <b class="num text-ink">{{ money(due.amount) }}</b> досрочно в «{{ credit?.name }}» — сократим срок,
        платёж останется прежним.
      </p>
      <AccountChoice v-model="chosen" :accounts="choices">
        <p class="text-[12px] leading-relaxed text-ink-3">
          Спрашиваем один раз: дальше шаг плана внесётся одним нажатием с того же счёта.
        </p>
      </AccountChoice>
      <Button class="w-full" :disabled="chosen === undefined" @click="confirm">Внести {{ money(due.amount) }}</Button>
    </template>
  </Sheet>
</template>
