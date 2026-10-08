<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn, moneySigned, plain, parseMoney, signTone } from '@/lib/money'
import { atLabel, todayIso } from '@/lib/dates'
import { fxToTenge, fxYearDelta, liveExchanges, monthExchanges, payableAccounts, rateOn, salaryCtxOf, salaryExchange, salaryTenge } from '@/lib/finance'
import { CURRENCY_SIGN, CURRENCY_WORD } from '@/lib/fx'
import type { PersonId } from '@/types/finance'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'
import FxRateSheet from '@/components/money/FxRateSheet.vue'

/**
 * «Обменял» (B2C-79, Р-73): под пришедшей валютной зарплатой — одна строка «обменяно 800 € из
 * 1 500 €» и тихая кнопка «Обменял» (только своя зарплата, не viewer). Лист: сколько продали
 * (по умолчанию — необменянное), курс — вводит человек (подсказка — курс Нацбанка сегодня),
 * итог «= N ₸» крупно, счёт зачисления; одна брендовая «Записать». Тенговая зарплата — ничего.
 * Нажатие на строку — лист обменов месяца (B2C-79-а): по строке на обмен, у своей — тихая
 * «Отменить» с подтверждением (надгробие); viewer и партнёр — только смотрят. Отметку сняли, а
 * обмены живы (ревью frontend Н-6) — строка и лист остаются, без «Обменял». «Евро за год: −134 ₸» — тихой строкой
 * внизу обоих листов (ворота B2C-91: из карточки зарплат ушла сюда), нажатие — лист курса (`FxRateSheet`, Р-76).
 */
/**
 * Части (Б17, Р-116): `button` — только «Обменял» (в строке зарплаты, у своего предмета), `line` — только «обменяно … из …»
 * (в листе зарплаты); без `part` — обе рядом. Листы обмена и списка — при любой части.
 */
const props = defineProps<{ personId: PersonId; period: string; part?: 'button' | 'line' }>()

const finance = useFinanceStore()
const auth = useAuthStore()
const fx = useFxStore()

const info = computed(() => salaryExchange(finance.payments, finance.fxExchanges, props.personId, props.period))
const xs = computed(() => monthExchanges(finance.fxExchanges, props.personId, props.period))
const currency = computed(() => info.value?.currency ?? xs.value[0]?.currency)
const sign = computed(() => (currency.value ? CURRENCY_SIGN[currency.value] : ''))
const exchanged = computed(() => xs.value.reduce((s, x) => s + x.foreign, 0))
/** Тенге зарплаты месяца (B2C-80, Р-74): обменянное по своему курсу + остаток по курсу дня зарплаты. */
const monthTenge = computed(() => {
  const p = finance.people.find((x) => x.id === props.personId)
  return p && currency.value ? salaryTenge(p, props.period, salaryCtxOf({ book: fx.book, payments: finance.payments, fxExchanges: finance.fxExchanges })).tenge : 0
})
const mine = computed(() => !auth.isViewer && auth.slot === props.personId)
/** Курс за год (Р-76): сколько тенге на единицу валюты курс добавил или отнял — строка внизу листов. */
const year = computed(() => {
  const p = finance.people.find((x) => x.id === props.personId && !x.deletedAt)
  return p ? fxYearDelta(p, props.period, fx.book) : null
})
const rateOpen = ref(false)
function openRate() {
  list.value = false
  open.value = false
  rateOpen.value = true
}
const canExchange = computed(() => mine.value && !!info.value && info.value.left > 0 && !!info.value.record.accountId)

/** Лист обменов месяца; `confirming` — id обмена, отмену которого подтверждают. */
const list = ref(false)
const confirming = ref<string | null>(null)
watch(list, () => (confirming.value = null))

function toName(id: string | null) {
  if (id === null) return 'не на счёт'
  // Личный счёт партнёра на этом телефоне не виден.
  return finance.accounts.find((a) => a.id === id)?.name ?? 'личный счёт'
}

function undo(id: string) {
  finance.undoExchange(id)
  confirming.value = null
  if (!xs.value.length) list.value = false
}

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
const form = useFormCheck(() => [
  ['amount', foreign.value <= 0 && 'Введите сумму'],
  ['rate', !(Number.isFinite(rate.value) && rate.value > 0) && 'Введите курс'],
  ['account', chosen.value === undefined && 'Выберите счёт'],
])

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
  <div v-if="currency && !(part === 'button' && !canExchange)" class="flex items-center gap-2">
    <button
      v-if="part !== 'button'"
      type="button"
      :disabled="!xs.length"
      class="min-w-0 flex-1 text-left text-[12.5px] text-ink-2 num enabled:cursor-pointer"
      @click="list = true"
    >
      обменяно {{ moneyIn(exchanged, currency) }}<template v-if="info"> из {{ moneyIn(info.came, currency) }}</template> · ≈ {{ money(monthTenge) }}
    </button>
    <Button v-if="canExchange && part !== 'line'" variant="secondary" size="sm" data-exchange @click="open = true">Обменял</Button>
  </div>

  <Sheet :open="list" title="Обмены" :z="60" @close="list = false">
    <div v-for="x in xs" :key="x.id" class="border-b border-line py-2.5 last:border-b-0">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 text-[13.5px] text-ink num">
          {{ moneyIn(x.foreign, x.currency) }} по {{ String(x.rate).replace('.', ',') }} → {{ money(x.tenge) }}
          <span class="block text-[12px] text-ink-2">{{ toName(x.toAccountId) }} · {{ atLabel(x.at) }}</span>
        </span>
        <Button v-if="mine && confirming !== x.id" variant="ghost" size="sm" @click="confirming = x.id">Отменить</Button>
      </div>
      <div v-if="mine && confirming === x.id" class="mt-2 flex items-center gap-2">
        <span class="min-w-0 flex-1 text-[13px] text-ink">Отменить обмен {{ moneyIn(x.foreign, x.currency) }}?</span>
        <Button variant="secondary" size="sm" @click="undo(x.id)">Отменить</Button>
        <Button variant="ghost" size="sm" @click="confirming = null">Нет</Button>
      </div>
    </div>
    <button v-if="year" type="button" class="press mt-2 w-full cursor-pointer text-center text-[12.5px] num" :class="signTone(year.tenge, 'text-ink-2')" data-fx-year @click="openRate">
      {{ CURRENCY_WORD[year.currency].nom }} за год: {{ moneySigned(year.perUnit) }}
    </button>
  </Sheet>

  <Sheet :open="open" title="Обменял" :z="60" @close="open = false">
    <Field :label="`Сколько, ${sign}`" name="amount">
      <NumField v-model="amountText" :currency="currency ?? null" />
    </Field>
    <Field :label="`Курс, ₸ за 1 ${sign}`" name="rate">
      <NumField v-model="rateText" kind="rate" :placeholder="nbRate ? String(nbRate).replace('.', ',') : '505'" />
    </Field>
    <p v-if="nbRate" class="-mt-2.5 mb-3 text-[12px] text-ink-2 num">Нацбанк сегодня — {{ String(nbRate).replace('.', ',') }} ₸</p>

    <div class="mb-3.5 flex items-baseline gap-2">
      <span class="type-big num text-ink">= {{ money(tenge) }}</span>
    </div>

    <AccountChoice v-model="chosen" :accounts="choices" label="Куда зачислить" none="Не записывать на счёт" name="account" />

    <Button class="w-full" @click="form.submit(save)">Записать</Button>
    <button v-if="year" type="button" class="press mt-2 w-full cursor-pointer text-center text-[12.5px] num" :class="signTone(year.tenge, 'text-ink-2')" data-fx-year @click="openRate">
      {{ CURRENCY_WORD[year.currency].nom }} за год: {{ moneySigned(year.perUnit) }}
    </button>
  </Sheet>
  <FxRateSheet :person-id="rateOpen ? personId : null" @close="rateOpen = false" />
</template>
