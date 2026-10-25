<script setup lang="ts">
import { computed, useId } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn } from '@/lib/money'
import { MONTHS_PRE } from '@/lib/dates'
import { amountAt, amountIn, creditDueAmount, nextChange, payerOf } from '@/lib/finance'
import type { Credit, Obligation } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'

/**
 * Строка справочника «Платежи» в «Деньгах» (Р-91, Р-94): кредит или обязательство — название, «<день>-го», кружок
 * плательщика и сумма; у валютного — сумма в валюте (Р-75), «≈ оценка», «сумма изменится», годовое — «раз в год · в
 * <месяце>». В «Капитале» (`slot`, Блок 5 «Фидбек», Р-34, Figma `19:73`) кружок плательщика стоит в слоте 32 слева, а
 * сумма — одной колонкой, с «₸» (Р-12 бэклога «Figma»); в «Долгах» и листе группы — как было. Отметок месяца и «Оплатил» здесь нет: ✓ ставит
 * выписка или нажатие платежа в «Месяце». Нажатие — лист платежа (изменить).
 */
const props = defineProps<{
  item: { kind: 'credit'; credit: Credit } | { kind: 'obligation'; obligation: Obligation }
  /** Месяц, на который берётся сумма (версия суммы, курс). */
  period: string
  dense?: boolean
  /** Номер совета ИИ про этот платёж (`ai.markFor`, бэклог «Разбор», RZ-10) — ✦ после названия; нет — ничего. */
  mark?: number | null
  /**
   * Вид «Капитала» (Р-34): слот плательщика 32 слева, сумма с «₸» (Р-12 «Figma»). Без него — как было («Долги», лист группы): кружок
   * плательщика 24 у суммы, сумма с «₸».
   */
  slot?: boolean
}>()
const emit = defineEmits<{ (e: 'open'): void }>()

const financeStore = useFinanceStore()
const fx = useFxStore()

const target = computed(() => (props.item.kind === 'credit' ? props.item.credit : props.item.obligation))
const amount = computed(() => (props.item.kind === 'credit' ? creditDueAmount(props.item.credit) : amountAt(props.item.obligation, props.period, fx.book)))
const payer = computed(() => payerOf(target.value, financeStore.people.filter((p) => !p.deletedAt)))
const payerName = computed(() => financeStore.people.find((p) => p.id === payer.value)?.name ?? '')

const note = computed(() => {
  const it = props.item
  if (it.kind === 'credit') return [`${it.credit.day}-го`, it.credit.rateUnknown ? 'ставку уточните' : ''].filter(Boolean).join(' · ')
  const o = it.obligation
  const own = amountIn(o, props.period)
  const fxText = own.currency === 'KZT' ? '' : moneyIn(own.amount, own.currency)
  const when = o.every === 'year' ? `раз в год · в ${MONTHS_PRE[(o.month ?? 1) - 1]}` : `${o.day}-го`
  return [when, fxText, o.estimate ? '≈ оценка' : '', nextChange(o, props.period) ? 'сумма изменится' : ''].filter(Boolean).join(' · ')
})
/** Кнопка строки — только название; подпись и сумму читалка слышит описанием (`aria-describedby`, `/ux` «Разбор» 3). */
const uid = useId()
</script>

<template>
  <!-- Вид строки `Row`; кнопка строки — название, растянутое на строку (`row-open`), ✦ совета ИИ — рядом своей кнопкой (RZ-10). -->
  <div class="border-b border-line last:border-b-0" data-payment>
    <div
      class="press relative flex w-full cursor-pointer items-center gap-3 text-left hover:bg-surface-2 active:bg-surface-3"
      :class="dense ? 'py-2.5' : 'px-4 py-3'"
      @click="emit('open')"
    >
      <!-- Слот плательщика 32 слева (Р-34): кружок — чей платёж; суммы остаются в одной колонке. -->
      <span v-if="slot" class="grid size-8 shrink-0 place-items-center rounded-[10px]" :class="!payer && 'bg-surface-3'" data-payment-slot>
        <Avatar v-if="payer" :id="payer" :name="payerName" :size="30" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center">
          <button
            type="button"
            class="row-open min-w-0 truncate text-left text-[14.5px] font-medium text-ink"
            :aria-describedby="note ? `${uid}-n ${uid}-a` : `${uid}-a`"
          >{{ target.name }}</button>
          <AdviceMark :n="mark ?? null" />
        </span>
        <span v-if="note" :id="`${uid}-n`" class="block text-[12.5px] text-ink-2">{{ note }}</span>
      </span>
      <span v-if="slot" :id="`${uid}-a`" class="block shrink-0 text-[14.5px] font-semibold num text-ink">{{ money(amount) }}</span>
      <span v-else class="flex shrink-0 items-center gap-2">
        <Avatar v-if="payer" :id="payer" :name="payerName" :size="24" />
        <span :id="`${uid}-a`" class="block text-[14.5px] font-semibold num text-ink">{{ money(amount) }}</span>
      </span>
      <svg width="6" height="11" viewBox="0 0 8 14" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ml-0.5 shrink-0 text-ink-3">
        <path d="M1 1l5.5 6L1 13" />
      </svg>
    </div>
  </div>
</template>
