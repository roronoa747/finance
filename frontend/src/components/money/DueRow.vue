<script setup lang="ts">
import { plain } from '@/lib/money'
import type { PlanDue } from '@/lib/finance'
import Avatar from '@/components/kit/Avatar.vue'

/**
 * Строка платежа «Месяца» (Р-94; макет week-month.html «Платежи»): день, название, кружок плательщика, сумма — ✓ у
 * оплаченного. Одна на общий список и на раскрытые «Подписки · N». Нажатие строки — лист платежа («Оплатил»),
 * кружка — смена плательщика (Р-80); viewer — только смотрит. Кнопка строки — название, растянутое на строку; кружок —
 * отдельная кнопка поверх (кнопка в кнопке недопустима — ревью frontend Б15, Н-7).
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
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'payer'): void }>()
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
    <component
      :is="canEdit ? 'button' : 'span'"
      :type="canEdit ? 'button' : undefined"
      class="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      :class="canEdit && 'row-open'"
      :data-row-open="canEdit || undefined"
    >
      <span class="truncate text-[15.5px] font-semibold text-ink">{{ due.name }}</span>
      <span v-if="note" class="text-[12.5px] text-ink-2">{{ note }}</span>
    </component>
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
    <span class="font-num text-[15px] font-bold num whitespace-nowrap" :class="due.paid ? 'font-semibold text-ink-2' : 'text-ink'">
      <span v-if="due.paid" class="font-extrabold text-ok">✓ </span>{{ plain(due.amount) }}
    </span>
  </div>
</template>
