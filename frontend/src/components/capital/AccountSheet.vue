<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { fxToTenge, liveAccounts, liveGoals } from '@/lib/finance'
import type { Account } from '@/types/finance'

import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/** Окно счёта Капитала: название, сумма (у валютного — в валюте и курс), примечание, удаление. */
const props = defineProps<{ accountId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

const activeAccount = computed(() => financeStore.accounts.find((a) => a.id === props.accountId))
const accountSaved = useSavedMark(
  () => activeAccount.value?.id,
  () => activeAccount.value?.updatedAt,
)

function editAccount(patch: Partial<Account>) {
  if (activeAccount.value) financeStore.updateAccount(activeAccount.value.id, patch)
}
function onAccountNameBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v && v !== activeAccount.value?.name) editAccount({ name: v })
}
function onAccountNoteBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v !== activeAccount.value?.note) editAccount({ note: v })
}
// Валютный счёт (React `AccountDialog`): сумма в валюте и курс; тенге — по курсу.
// Курс сменили — это новая оценка счёта: сумма в тенге и дата курса.
function onForeignAmount(text: string) {
  const v = parseMoney(text)
  editAccount({ foreignAmount: v, amount: fxToTenge(v, activeAccount.value?.rate ?? 1) })
}
function onAccountRate(text: string) {
  const v = parseFloat(text.replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0) return
  editAccount({ rate: v, amount: fxToTenge(activeAccount.value?.foreignAmount ?? 0, v), rateAt: new Date().toISOString() })
}

/** Цели, чьи накопления лежат на открытом счёте: при удалении они отвяжутся. */
const accountGoals = computed(() => liveGoals(financeStore.goals).filter((g) => g.accountId === props.accountId))
const accountRemoveWarning = computed(() => {
  const names = accountGoals.value.map((g) => g.name)
  const tail = names.length
    ? ` Накопления по ${names.length === 1 ? 'цели' : 'целям'} «${names.join('», «')}» останутся на месте: они снова будут считаться отдельно, а не лежащими на этом счёте.`
    : ''
  // Личный счёт партнёр не видит (React личных счетов не знал) — «у обоих» только у общего.
  const personal = liveAccounts(financeStore.privateAccounts).some((a) => a.id === props.accountId)
  return `Счёт исчезнет${personal ? '' : ' у обоих участников'}. Отменить нельзя.${tail}`
})
</script>

<template>
  <Sheet :open="!!activeAccount" :title="activeAccount?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="accountSaved" />
    </template>
    <!-- Viewer видит цифры, но не правит (Р-12, матрица §3) -->
    <template v-if="activeAccount && authStore.isViewer" #default="{ close }">
      <div class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1.5">
        <div v-if="activeAccount.currency" class="flex justify-between">
          <span class="text-ink-2">Сумма в {{ activeAccount.currency }}</span>
          <b class="num text-ink">{{ plain(activeAccount.foreignAmount ?? 0) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">В капитале</span>
          <b class="num text-ink">{{ money(activeAccount.amount) }}</b>
        </div>
      </div>
      <Button class="w-full" @click="close">Готово</Button>
    </template>
    <template v-else-if="activeAccount" #default="{ close }">
      <Field label="Название">
        <Input :default-value="activeAccount.name" class="mb-3" @blur="onAccountNameBlur" />
      </Field>

      <template v-if="activeAccount.currency">
        <Field :label="`Сумма в ${activeAccount.currency}`">
          <NumFieldBlur :initial="plain(activeAccount.foreignAmount ?? 0)" class="mb-3" @commit="onForeignAmount" />
        </Field>
        <Field :label="`Курс: сколько тенге за 1 ${activeAccount.currency}`">
          <NumFieldBlur
            :initial="String(activeAccount.rate ?? '').replace('.', ',')"
            kind="rate"
            class="mb-3"
            @commit="onAccountRate"
          />
        </Field>
        <p class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-3">
          В капитале счёт стоит как {{ money(activeAccount.amount) }} — по этому курсу.
        </p>
      </template>
      <Field v-else label="Сумма, ₸">
        <NumFieldBlur
          :initial="plain(activeAccount.amount)"
          class="mb-3"
          @commit="(text) => financeStore.setAccountAmount(activeAccount!.id, parseMoney(text))"
        />
      </Field>

      <Field label="Примечание">
        <Input :default-value="activeAccount.note" class="mb-3" @blur="onAccountNoteBlur" />
      </Field>

      <Button class="w-full mb-3" @click="close">
        Готово
      </Button>

      <DangerZone
        label="Удалить счёт"
        :warning="accountRemoveWarning"
        @confirm="() => { financeStore.removeAccount(activeAccount!.id); emit('close') }"
      />
    </template>
  </Sheet>
</template>
