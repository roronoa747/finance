<script setup lang="ts">
import { useId } from 'vue'
import { money } from '@/lib/money'
import type { PlanDue } from '@/lib/finance'
import Avatar from '@/components/kit/Avatar.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Строка платежа «Месяца» (Р-94; макет week-month.html «Платежи»): день, название, кружок плательщика, сумма — ✓ у
 * оплаченного. Одна на общий список и на раскрытые «Подписки · N». «Оплатил» («Отдал» — долг человеку) — небольшой
 * кнопкой в самой строке, между названием и кружком (F2-Х2, Р-8 «Figma», как на «Долгах»); нажатие строки — лист платежа
 * («Не оплачено», «Изменить платёж»), кружка — смена плательщика (Р-80); viewer — только смотрит. Кнопка строки —
 * название, растянутое на строку; «Оплатил» и кружок — отдельные кнопки поверх (кнопка в кнопке недопустима — ревью
 * frontend Б15, Н-7).
 */
defineProps<{
  due: PlanDue
  /** Ключ строки — `kind:targetId`. */
  id: string
  /** Месяц коротко под днём — «окт». */
  mon: string
  payerName: string
  note?: string
  canEdit: boolean
  /** Номер совета ИИ про этот платёж (`ai.markFor`, бэклог «Разбор», RZ-10) — ✦ после названия; нет — ничего. */
  mark?: number | null
  /** Кнопка «Оплатил» в строке (участник, платёж не оплачен, сумма есть) — решает родитель. */
  canPay?: boolean
  /** Долг человеку — «Отдал» вместо «Оплатил». */
  given?: boolean
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'payer'): void; (e: 'pay'): void }>()
/** Кнопка строки — только название; подпись и сумму читалка слышит описанием (`aria-describedby`, `/ux` «Разбор» 3). */
const uid = useId()
</script>

<template>
  <div
    class="relative flex items-center gap-2.5 border-t border-line py-[11px] first:border-t-0"
    :class="canEdit && 'press cursor-pointer'"
    data-due
    :data-due-id="id"
    @click="canEdit && emit('open')"
  >
    <span class="flex w-[38px] shrink-0 flex-col items-center leading-[1.05]" :class="due.paid ? 'text-ink-3' : 'text-ink-2'">
      <b class="font-num text-[18px] num">{{ due.day }}</b><span class="text-[11px] text-ink-2">{{ mon }}</span>
    </span>
    <!-- Кнопка строки — название (растянута на строку `row-open`); ✦ совета ИИ — рядом, своей кнопкой поверх. -->
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center">
        <component
          :is="canEdit ? 'button' : 'span'"
          :type="canEdit ? 'button' : undefined"
          class="min-w-0 truncate text-left text-[15.5px] font-semibold text-ink"
          :class="canEdit && 'row-open'"
          :data-row-open="canEdit || undefined"
          :aria-describedby="canEdit ? (note ? `${uid}-n ${uid}-a` : `${uid}-a`) : undefined"
        >
          {{ due.name }}
        </component>
        <AdviceMark :n="mark ?? null" />
      </span>
      <span v-if="note" :id="`${uid}-n`" class="text-[12.5px] text-ink-2">{{ note }}</span>
    </span>
    <Button v-if="canPay" variant="soft" size="xs" class="relative z-10 ml-auto shrink-0" data-due-pay @click.stop="emit('pay')">
      {{ given ? 'Отдал' : 'Оплатил' }}
    </Button>
    <button
      v-if="canEdit && due.payer"
      type="button"
      class="press relative z-10 shrink-0 cursor-pointer rounded-full"
      :aria-label="`Платит ${payerName}. Сменить`"
      @click.stop="emit('payer')"
    >
      <Avatar :id="due.payer" :name="payerName" :size="24" />
    </button>
    <Avatar v-else-if="due.payer" :id="due.payer" :name="payerName" :size="24" />
    <span :id="`${uid}-a`" class="font-num text-[15px] font-bold num whitespace-nowrap" :class="due.paid ? 'font-semibold text-ink-2' : 'text-ink'">
      <span v-if="due.paid" class="font-extrabold text-ok">✓ </span>{{ money(due.amount) }}
    </span>
  </div>
</template>
