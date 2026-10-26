<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { todayIso } from '@/lib/dates'
import { money, plain, parseMoney, rateField, ratePct } from '@/lib/money'
import { INFLATION, deposit as calcDeposit, fxToTenge, liveAccounts, openGoals, rateOn, realRate, spendOwners } from '@/lib/finance'
import type { Account, PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import { CURRENCY_SIGN } from '@/lib/fx'

import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toggle from '@/components/kit/Toggle.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import { buttonVariants } from '@/components/ui/button'
import Input from '@/components/ui/Input.vue'

/**
 * Окно счёта: название, сумма (у валютного — в валюте и курс), примечание, удаление. У вклада
 * (пивот 3, Р-38: бывший экран вклада) — его условия полями и свёрнутый «Расчёт вклада» из
 * `deposit()`. Viewer видит цифры, но не правит.
 */
const props = defineProps<{ accountId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()

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
/** Курс Нацбанка сегодня из книги (Р-73): есть — тенге счёта по нему, ручной курс в расчёт не идёт и не показывается. */
const nbRate = computed(() => (activeAccount.value?.currency ? rateOn(fx.book, activeAccount.value.currency, todayIso()) : null))
function onAccountRate(text: string) {
  const v = parseFloat(text.replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0) return
  // Новая сумма в тенге — новый якорь сверки: база в валюте пишется видимым остатком (приходы и обмены
  // валютного счёта, B2C-79), иначе якорь отрезал бы их и остаток упал бы до старой базы.
  const foreign = activeAccount.value?.foreignAmount ?? 0
  editAccount({ rate: v, foreignAmount: foreign, amount: fxToTenge(foreign, v), rateAt: new Date().toISOString() })
}

/* ------------------ Вклад ------------------ */
const depositData = computed(() => activeAccount.value?.deposit)
const calcResult = computed(() => {
  const a = activeAccount.value
  const d = depositData.value
  if (!a || !d) return null
  return calcDeposit({ principal: a.amount, annualRate: d.annualRate, months: d.months, monthlyTopUp: d.monthlyTopUp, capitalize: d.capitalize })
})
const realEffective = computed(() => (calcResult.value ? realRate(calcResult.value.effectiveRate, INFLATION) : 0))

function setDeposit(patch: Partial<NonNullable<Account['deposit']>>) {
  if (activeAccount.value) financeStore.setDeposit(activeAccount.value.id, patch)
}
function onDepositRate(text: string) {
  const v = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''))
  if (Number.isFinite(v)) setDeposit({ annualRate: v / 100 })
}

/* ------------------ Траты отсюда (F2-06, Р-5) ------------------ */
const isPrivate = computed(() => liveAccounts(financeStore.privateAccounts).some((a) => a.id === props.accountId))
/** Карта или наличные в тенге, общий счёт — может быть счётом для трат. */
const canSpend = computed(() => {
  const a = activeAccount.value
  return !!a && !isPrivate.value && (a.kind === 'card' || a.kind === 'cash') && (!a.currency || a.currency === 'KZT')
})
const me = computed<PersonId>(() => (authStore.slot as PersonId | undefined) ?? 'a')
const partner = computed(() => financeStore.people.find((p) => p.id !== me.value) ?? null)
/** Кто тратит с открытого счёта — из тех, кто есть в семье. */
const owners = computed(() => {
  const ids = financeStore.people.map((p) => p.id)
  return activeAccount.value ? spendOwners(activeAccount.value, financeStore.householdAccounts).filter((p) => ids.includes(p)) : []
})
const isSpend = computed(() => owners.value.length > 0)
const ownerValue = computed<string>(() => (owners.value.length >= 2 ? 'both' : (owners.value[0] ?? 'both')))
const ownerOptions = computed(() =>
  partner.value
    ? [
        { value: me.value, label: 'Я' },
        { value: partner.value.id, label: partner.value.name },
        { value: 'both', label: 'Оба' },
      ]
    : [],
)
const ownerLabel = computed(() =>
  owners.value.length >= 2 ? 'оба' : (financeStore.people.find((p) => p.id === owners.value[0])?.name ?? ''),
)
function setSpend(owner: string | null) {
  if (activeAccount.value) financeStore.setSpendAccount(activeAccount.value.id, owner as PersonId | 'both' | null)
}

/* ------------------ Удаление ------------------ */
/** Цели, чьи накопления лежат на открытом счёте: при удалении они отвяжутся. */
const accountGoals = computed(() => openGoals(financeStore.goals).filter((g) => g.accountId === props.accountId)) // Сбылось (PN-13): деньги сбывшейся со счёта ушли — она не «на счёте»
const accountRemoveWarning = computed(() => {
  // Личный счёт партнёр не видит (React личных счетов не знал) — «у обоих» только у общего.
  const both = isPrivate.value ? '' : ' у обоих участников'
  if (depositData.value) return `Вклад исчезнет${both} вместе с условиями. Отменить нельзя.`
  const names = accountGoals.value.map((g) => g.name)
  const tail = names.length
    ? ` Накопления по ${names.length === 1 ? 'цели' : 'целям'} «${names.join('», «')}» останутся на месте: они снова будут считаться отдельно, а не лежащими на этом счёте.`
    : ''
  return `Счёт исчезнет${both}. Отменить нельзя.${tail}`
})
</script>

<template>
  <Sheet :open="!!activeAccount" :title="activeAccount?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="accountSaved" />
    </template>
    <template v-if="activeAccount" #default="{ close }">
      <!-- Viewer видит цифры, но не правит (Р-12, матрица §3) -->
      <div v-if="authStore.isViewer" class="mb-3 flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
        <div v-if="activeAccount.currency" class="flex justify-between">
          <span class="text-ink-2">Сумма, {{ CURRENCY_SIGN[activeAccount.currency] }}</span>
          <b class="num text-ink">{{ plain(activeAccount.foreignAmount ?? 0) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">В капитале</span>
          <b class="num text-ink">{{ money(activeAccount.amount) }}</b>
        </div>
        <div v-if="canSpend && isSpend" class="flex justify-between" data-spend-viewer>
          <span class="text-ink-2">Траты отсюда</span>
          <b class="text-ink">{{ ownerLabel }}</b>
        </div>
        <template v-if="depositData">
          <div class="flex justify-between">
            <span class="text-ink-2">Ставка</span>
            <b class="num text-ink">{{ ratePct(depositData.annualRate, 1) }} годовых</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Пополнение в месяц</span>
            <b class="num text-ink">{{ money(depositData.monthlyTopUp) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Срок</span>
            <b class="num text-ink">{{ depositData.months }} мес.</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Капитализация</span>
            <b class="text-ink">{{ depositData.capitalize ? 'ежемесячно' : 'в конце срока' }}</b>
          </div>
        </template>
      </div>

      <template v-else>
        <Field label="Название">
          <Input :default-value="activeAccount.name" @blur="onAccountNameBlur" />
        </Field>

        <template v-if="activeAccount.currency">
          <Field label="Сумма">
            <NumFieldBlur :initial="plain(activeAccount.foreignAmount ?? 0)" :currency="activeAccount.currency" @commit="onForeignAmount" />
          </Field>
          <p v-if="nbRate" class="-mt-2.5 mb-3 text-[12px] text-ink-2 num">
            ≈ {{ money(activeAccount.amount) }} по курсу Нацбанка
          </p>
          <template v-else>
            <Field :label="`Курс, ₸ за 1 ${CURRENCY_SIGN[activeAccount.currency]}`">
              <NumFieldBlur
                :initial="String(activeAccount.rate ?? '').replace('.', ',')"
                kind="rate"
                @commit="onAccountRate"
              />
            </Field>
            <p class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-2">
              В капитале счёт стоит как {{ money(activeAccount.amount) }} — по этому курсу.
            </p>
          </template>
        </template>
        <Field v-else label="Сумма">
          <NumFieldBlur
            :initial="plain(activeAccount.amount)"
            @commit="(text) => financeStore.setAccountAmount(activeAccount!.id, parseMoney(text))"
          />
        </Field>

        <Field label="Примечание">
          <Input :default-value="activeAccount.note" @blur="onAccountNoteBlur" />
        </Field>

        <!-- Траты отсюда (F2-06): переключатель; двое в семье — чей счёт -->
        <template v-if="canSpend">
          <div class="mb-3 flex items-center justify-between gap-3" data-spend-row>
            <span class="flex items-center gap-1.5 text-[14px] text-ink">
              Траты отсюда
              <Hint>Траты и переводы с этого счёта сами уменьшают его остаток.</Hint>
            </span>
            <Toggle
              :model-value="isSpend"
              label="Траты отсюда"
              tone="ok"
              data-spend-toggle
              @update:model-value="(on: boolean) => setSpend(on ? 'both' : null)"
            />
          </div>
          <Segmented
            v-if="isSpend && ownerOptions.length"
            :model-value="ownerValue"
            :options="ownerOptions"
            class="mb-3"
            data-spend-owner
            @update:model-value="setSpend"
          />
        </template>

        <!-- Вклад: условия полями (бывший экран вклада) -->
        <template v-if="depositData">
          <Field label="Ставка, % годовых">
            <NumFieldBlur :initial="rateField(depositData.annualRate)" kind="rate" @commit="onDepositRate" />
          </Field>
          <Field label="Пополнение в месяц">
            <NumFieldBlur :initial="plain(depositData.monthlyTopUp)" @commit="(t) => setDeposit({ monthlyTopUp: parseMoney(t) })" />
          </Field>
          <Field label="Срок, месяцев">
            <NumFieldBlur :initial="String(depositData.months)" kind="int" @commit="(t) => setDeposit({ months: Math.max(1, parseMoney(t)) })" />
          </Field>
          <Field label="Капитализация" group>
            <Segmented
              :model-value="depositData.capitalize ? 'yes' : 'no'"
              :options="[
                { value: 'yes', label: 'Ежемесячно' },
                { value: 'no', label: 'В конце срока' },
              ]"
              class="mb-3"
              @update:model-value="(v: string) => setDeposit({ capitalize: v === 'yes' })"
            />
          </Field>
        </template>
      </template>

      <!-- Расчёт вклада — свёрнут (правило 12): у участника и у viewer -->
      <details v-if="calcResult && depositData" class="mb-3">
        <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Расчёт вклада</summary>
        <div class="mt-2 flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <div class="flex justify-between gap-3">
            <span class="text-ink-2">Будет на счёте через {{ depositData.months }} мес.</span>
            <b class="num text-ink">{{ money(Math.round(calcResult.future)) }}</b>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-ink-2">Начислено процентов</span>
            <b class="num text-ink">{{ money(Math.round(calcResult.interest)) }}</b>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-ink-2">Эффективная ставка</span>
            <b class="num text-ink">{{ ratePct(calcResult.effectiveRate) }}</b>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-ink-2">Ваши взносы</span>
            <b class="num text-ink">{{ money(calcResult.contributed) }}</b>
          </div>
          <div class="flex items-center gap-2 border-t border-line pt-2 text-ink-2">
            Реально ≈ {{ ratePct(realEffective, 1) }} с учётом инфляции
            <Hint>
              При инфляции {{ ratePct(INFLATION, 1) }} эффективная ставка {{ ratePct(calcResult.effectiveRate, 1) }}
              оставляет примерно {{ ratePct(realEffective, 1) }} настоящих. Это не повод не копить — это повод не
              путать номинал с доходом.
            </Hint>
          </div>
        </div>
      </details>

      <Button class="mb-3 w-full" @click="close">Готово</Button>

      <DangerZone
        v-if="!authStore.isViewer"
        :label="depositData ? 'Удалить вклад' : 'Удалить счёт'"
        :warning="accountRemoveWarning"
        @confirm="() => { financeStore.removeAccount(activeAccount!.id); emit('close') }"
      />
    </template>
  </Sheet>
</template>
