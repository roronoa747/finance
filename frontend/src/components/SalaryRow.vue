<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import { useSalaryTap } from '@/components/useSalaryTap'
import type { PersonId } from '@/types/finance'

/**
 * «Пришла зарплата» (RP-10, Р-18) — зеркало «Оплатил» для зачисления. Отмечает свою
 * зарплату только сам участник (`member.slot`), viewer не отмечает (Р-13); партнёр видит
 * отметку после синка. Одно нажатие — оклад месяца на счёт, куда зарплата пришла в
 * прошлый раз (Р-5); лист (`MarkSheet`, B2C-15) — только для исключений: первая отметка
 * (счёт спросить один раз), премия, правка и снятие. После отметки — разбор этой зарплаты.
 * Сама отметка — `useSalaryTap` (PN-02): одна на строку «Месяца»/«Капитала» и лист зарплаты.
 *
 * Два режима (хвост FG-Х6, пачка 2 «Figma», FG-25: строка `Row` без экрана снята): `button small` — маленькая «Пришла» у своей
 * строки зарплаты в «Месяце»; `button` — «Пришла зарплата» и «Другая сумма или счёт» в листе зарплаты. Строку обменов валютной
 * зарплаты рисуют сами экраны (`SalaryExchange` в «Месяце» и листе зарплаты).
 */
const props = defineProps<{
  personId: PersonId
  /** Месяц зарплаты — месяц её дня. */
  period: string
  /** Режим кнопки (оба вызова в приложении — с ним). */
  button: boolean
  /** Кнопка тихая: на экране уже есть главное действие (правило 12 — одна брендовая). */
  quiet?: boolean
  /**
   * Маленькая «Пришла» у своей строки зарплаты в «Месяце» (PN-02, правило 12 — действие у предмета), без «Другая сумма или
   * счёт» (он — в листе, который открывает сама строка). Ничего не рендерит, пока отметить нельзя.
   */
  small?: boolean
}>()

const { target, canMark, arrival, title, sheet, markAmount, markAccount, markNote, firstTime, tap, openMore, onMarked, toAllocation } = useSalaryTap(
  () => props.personId,
  () => props.period,
)
</script>

<template>
  <template v-if="small">
    <!-- Точка — пришло пушем банка (Блок 2 «Apple Pay», Р-22: звать точкой, сумма — в листе зарплаты). -->
    <span v-if="canMark" class="relative inline-flex">
      <Button variant="soft" size="xs" data-salary-came-btn @click="tap">Пришла</Button>
      <template v-if="arrival">
        <span class="pointer-events-none absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand" data-arrival-dot aria-hidden="true" />
        <span class="sr-only">, пришло на карту</span>
      </template>
    </span>
  </template>
  <template v-else>
    <Button v-if="canMark" :variant="quiet ? 'secondary' : 'default'" class="mt-3 w-full" @click="tap">
      Пришла зарплата
    </Button>
    <!-- Тихая компактная, как «Другая сумма или снять» и «Изменить оклад» в том же листе (FG-19: один размер на уровень). -->
    <Button v-if="canMark" variant="outline" size="md" class="mt-2 mx-auto flex w-fit" @click="openMore">
      Другая сумма или счёт
    </Button>
  </template>

  <MarkSheet
    :open="sheet"
    kind="salary"
    :target-id="personId"
    :period="target"
    :title="title"
    :amount="markAmount"
    :account="markAccount"
    :first-time="firstTime"
    :amount-note="markNote"
    @close="sheet = null"
    @marked="onMarked"
    @allocate="toAllocation"
  />
</template>
