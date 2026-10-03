<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn, plain, parseMoney } from '@/lib/money'
import { todayIso } from '@/lib/dates'
import { fxToTenge, liveExchanges, payableAccounts, rateOn, salaryExchange, salaryTenge } from '@/lib/finance'
import { CURRENCY_SIGN } from '@/lib/fx'
import type { PersonId } from '@/types/finance'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'

/**
 * «Обменял» (B2C-79, Р-73): под пришедшей валютной зарплатой — одна строка «обменяно 800 € из
 * 1 500 €» и тихая кнопка «Обменял» (только своя зарплата, не viewer). Лист: сколько продали
 * (по умолчанию — необменянное), курс — вводит человек (подсказка — курс Нацбанка сегодня),
 * итог «= N ₸» крупно, счёт зачисления; одна брендовая «Записать». Тенговая зарплата — ничего.
 */
const props = defineProps<{ personId: PersonId; period: string }>()

const finance = useFinanceStore()
const auth = useAuthStore()
const fx = useFxStore()

const info = computed(() => salaryExchange(finance.payments, finance.fxExchanges, props.personId, props.period))
const sign = computed(() => (info.value ? CURRENCY_SIGN[info.value.currency] : ''))
/** Тенге зарплаты месяца (B2C-80, Р-74): обменянное по своему курсу + остаток по курсу дня зарплаты. */
const monthTenge = computed(() => {
  const p = finance.people.find((x) => x.id === props.personId)
  return p && info.value ? salaryTenge(p, props.period, { book: fx.book, payments: finance.payments, exchanges: finance.fxExchanges }).tenge : 0
})
const mine = computed(() => !auth.isViewer && auth.slot === props.personId)
const canExchange = computed(() => mine.value && !!info.value && info.value.left > 0 && !!info.value.record.accountId)

const open = ref(false)
const amountText = ref('')
const rateText = ref('')
// undefined — счёт не выбран; null — «не записывать на счёт».
const chosen = ref<string | null | undefined>(undefined)

/** Курс Нацбанка сегодня — подсказка под полем курса. */
const nbRate = computed(() => (info.value ? rateOn(fx.book, info.value.currency, todayIso()) : null))
const foreign = computed(() => parseMoney(amountText.value))
const rate = computed(() => parseFloat(rateText.value.replace(',', '.')))
const valid = computed(() => !!info.value && foreign.value > 0 && Number.isFinite(rate.value) && rate.value > 0)
const tenge = computed(() => (valid.value ? fxToTenge(foreign.value, rate.value) : 0))
const choices = computed(() => payableAccounts(finance.accounts))

watch(open, (v) => {
  if (!v || !info.value) return
  amountText.value = plain(info.value.left)
  rateText.value = ''
  // Счёт зачисления — как в прошлый обмен этого участника; не было — спросить.
  const last = liveExchanges(finance.fxExchanges)
    .filter((x) => x.by === props.personId)
    .sort((a, b) => b.at.localeCompare(a.at))[0]
  chosen.value = last && (last.toAccountId === null || choices.value.some((a) => a.id === last.toAccountId)) ? last.toAccountId : undefined
})

function save() {
  if (!valid.value || chosen.value === undefined || !info.value?.record.accountId) return
  finance.addExchange({
    by: props.personId,
    accountId: info.value.record.accountId,
    toAccountId: chosen.value,
    foreign: foreign.value,
    rate: rate.value,
    period: props.period,
  })
  open.value = false
}
</script>

<template>
  <div v-if="info" class="flex items-center gap-2">
    <span class="min-w-0 flex-1 text-[12.5px] text-ink-3 num">
      обменяно {{ moneyIn(info.exchanged, info.currency) }} из {{ moneyIn(info.came, info.currency) }} · ≈ {{ money(monthTenge) }}
    </span>
    <Button v-if="canExchange" variant="secondary" size="sm" @click="open = true">Обменял</Button>
  </div>

  <Sheet :open="open" title="Обменял" :z="60" @close="open = false">
    <Field :label="`Сколько, ${sign}`">
      <NumField v-model="amountText" />
    </Field>
    <Field :label="`Курс, ₸ за 1 ${sign}`">
      <NumField v-model="rateText" kind="rate" :placeholder="nbRate ? String(nbRate).replace('.', ',') : '505'" />
    </Field>
    <p v-if="nbRate" class="-mt-2.5 mb-3 text-[12px] text-ink-3 num">Нацбанк сегодня — {{ String(nbRate).replace('.', ',') }} ₸</p>

    <div class="mb-3.5 flex items-baseline gap-2">
      <span class="type-big num text-ink">= {{ money(tenge) }}</span>
    </div>

    <AccountChoice v-model="chosen" :accounts="choices" label="Куда зачислить" none="Не записывать на счёт" />

    <Button class="w-full" :disabled="!valid || chosen === undefined" @click="save">Записать</Button>
  </Sheet>
</template>
