<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { SPEND_SLOTS, spendSlot } from '@/lib/palette'
import { DEFAULT_SPEND_CATEGORIES } from '@/lib/statements/dictionary'
import type { MerchantRule } from '@/lib/statements/types'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Hint from '@/components/kit/Hint.vue'
import { cn } from '@/lib/utils'

/**
 * «Разбор выписок» в настройках (B2C-21 п. 3): имена и цвета разделов трат (`spendCategories`,
 * цвет — один из 12 слотов палитры, токен `--sN`) и память семьи — правила «продавец → раздел»,
 * «кому → что», «между своими», «платёж по …» (`merchantRules`, личный документ) с «Убрать».
 */
const finance = useFinanceStore()
const ops = useOperationsStore()

const categories = computed(() =>
  [...(finance.householdDoc.spendCategories?.length ? finance.householdDoc.spendCategories : DEFAULT_SPEND_CATEGORIES.map((c) => ({ ...c, updatedAt: '' })))]
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.order - b.order),
)
const slots = Array.from({ length: SPEND_SLOTS }, (_, i) => i + 1)
const seeded = computed(() => !!finance.householdDoc.spendCategories?.length)

function rename(id: string, e: Event) {
  const name = (e.target as HTMLInputElement).value.trim()
  if (name) finance.updateSpendCategory(id, { name })
}

const rules = computed(() => finance.merchantRules.filter((r) => !r.deletedAt))
const categoryName = (id: string | null | undefined) => categories.value.find((c) => c.id === id)?.name ?? 'по словарю'
function ruleMatch(r: MerchantRule) {
  return r.match.counterparty ? `«${r.match.counterparty}»` : `«${r.match.merchant ?? ''}»`
}
function ruleTarget(r: MerchantRule) {
  const to = r.to
  if ('internal' in to) return 'между своими'
  if ('person' in to) return `кому → ${to.person}`
  if ('payment' in to) {
    const p = to.payment
    const name =
      p.kind === 'salary'
        ? `зарплата ${finance.people.find((x) => x.id === p.targetId)?.name ?? ''}`
        : p.kind === 'credit'
          ? `«${finance.credits.find((c) => c.id === p.targetId)?.name ?? 'долг'}»`
          : `«${finance.obligations.find((o) => o.id === p.targetId)?.name ?? 'платёж'}»`
    return `платёж по ${name}`
  }
  return categoryName(to.categoryId)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <div class="type-section text-ink-3">Разделы трат</div>
      <p v-if="!seeded" class="mt-1 text-[13px] text-ink-2">Появятся после первой выписки — пока разделы по словарю.</p>
      <div v-else class="mt-2 flex flex-col">
        <div v-for="c in categories" :key="c.id" class="flex flex-col gap-2 border-t border-line py-2.5 first:border-t-0 first:pt-0">
          <div class="flex items-center gap-2.5">
            <i class="size-3 shrink-0 rounded-full" :style="{ background: `var(--s${spendSlot(c)})` }" aria-hidden="true" />
            <Input :model-value="c.name" :aria-label="`Название раздела ${c.name}`" class="flex-1" @change="rename(c.id, $event)" />
          </div>
          <div class="flex flex-wrap gap-1.5 pl-[22px]" role="group" :aria-label="`Цвет раздела ${c.name}`">
            <button
              v-for="n in slots"
              :key="n"
              type="button"
              :aria-label="`Цвет ${n}`"
              :aria-pressed="spendSlot(c) === n"
              :class="cn('size-6 rounded-full border-2 cursor-pointer', spendSlot(c) === n ? 'border-ink' : 'border-transparent')"
              :style="{ background: `var(--s${n})` }"
              @click="finance.updateSpendCategory(c.id, { slot: n })"
            />
          </div>
        </div>
      </div>
    </div>

    <div>
      <!-- Пояснение — в подсказке, не абзацем (правило интерфейса, критик Блока 3). -->
      <div class="flex items-center gap-1.5 type-section text-ink-3">
        Память разбора
        <Hint>Ответы на вопросы разбора — только ваши, партнёр их не видит. «Убрать» — следующие выписки спросят снова, свои операции пересчитаются.</Hint>
      </div>
      <div v-if="rules.length" class="mt-2 flex flex-col">
        <div v-for="r in rules" :key="r.id" class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
          <div class="min-w-0 flex-1">
            <div class="truncate text-[14px] text-ink">{{ ruleMatch(r) }}</div>
            <div class="type-meta">{{ ruleTarget(r) }}</div>
          </div>
          <Button variant="ghost" size="sm" :aria-label="`Убрать правило ${ruleMatch(r)}`" @click="ops.forgetRule(r)">Убрать</Button>
        </div>
      </div>
      <p v-else class="mt-2 text-[13px] text-ink-3">Правил пока нет.</p>
    </div>
  </div>
</template>
