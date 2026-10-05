<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney, plain } from '@/lib/money'
import { MONTHS_NOM, monthKey, parseMonthKey } from '@/lib/dates'
import { ARTICLE_NAMES, liveSpendCategories, livingPlanFact, planSpendTotal, spendCategoryName, spendNorms, spendShares, spendStatus } from '@/lib/finance'
import { STAT_NORMS_LABEL } from '@/lib/statements/norms'
import { spendColor } from '@/lib/palette'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'

/**
 * Виджет «Траты» (пивот 3, Р-33; B2C-59, Р-57, Р-59; макет `money-breakdown.html`, вопрос 5): факт — траты по
 * выпискам обоих за месяц без разделов, учтённых планом (\`monthSpentByFact\`), «из N» — план статей «Жизнь» +
 * «Траты» (\`livingPlan\`); тег — одна строка: раздел, сильнее всех выше ориентира, или «в норме» (без выписок —
 * нет тега). Нажатие — лист «Траты за <месяц>»: доли разделов с чертой ориентира (статистика РК или своё
 * среднее за 3 месяца) и правка сумм «Жизни» и «Трат» (viewer — без правки; заведены траты плана месяца — план из них,
 * правка — там, полей нет). Всё считает \`finance.ts\`.
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()
const open = ref(false)

const key = computed(() => monthKey())
const monthName = computed(() => MONTHS_NOM[parseMonthKey(key.value).month].toLowerCase())
const totals = computed(() => financeStore.householdDoc.spendTotals ?? [])
const docCategories = computed(() => financeStore.householdDoc.spendCategories ?? [])

/** Траты заведены в плане месяца (Р-81) — «из N» считается по ним, статьи здесь не правятся. */
const fromPlan = computed(() => planSpendTotal(financeStore.householdDoc) !== null)
const living = computed(() => livingPlanFact(financeStore.householdDoc, totals.value, docCategories.value, key.value, ops.uploads))
const shares = computed(() => spendShares(totals.value, docCategories.value, key.value, ops.uploads))
const norms = computed(() => spendNorms(totals.value, docCategories.value, ops.uploads, key.value))
const status = computed(() => spendStatus(shares.value, norms.value.norms, liveSpendCategories(docCategories.value)))

/**
 * Строки листа (доля 0 % — без строки): цвет — токен раздела, ширина полосы и черта — в одной шкале (макет:
 * половина дорожки ≈ 25 %; самая длинная — с запасом, черта не упирается в край).
 */
const rows = computed(() => {
  const cats = liveSpendCategories(docCategories.value)
  const list = (shares.value ?? []).filter((r) => r.share > 0)
  const scale = Math.max(50, ...list.map((r) => Math.max(r.share, norms.value.norms[r.categoryId] ?? 0) * 1.1))
  return list.map((r) => ({
    ...r,
    name: spendCategoryName(cats, r.categoryId),
    color: spendColor(cats.find((c) => c.id === r.categoryId) ?? null),
    width: (r.share / scale) * 100,
    mark: r.categoryId in norms.value.norms ? (norms.value.norms[r.categoryId] / scale) * 100 : null,
  }))
})

const articleAmount = (id: 'life' | 'spend') => financeStore.moneyArticles.find((a) => a.id === id)?.amount ?? 0
function commit(id: 'life' | 'spend', text: string) {
  financeStore.setArticle(id, { amount: parseMoney(text) })
}
</script>

<template>
  <Card tight class="p-0">
    <button type="button" class="press flex w-full cursor-pointer flex-col gap-2 p-4 text-left" aria-label="Траты за месяц" @click="open = true">
      <span class="flex w-full items-center justify-between gap-3">
        <span class="flex items-center gap-1.5 type-label">Траты <PhCaretRight :size="14" class="text-ink-3" /></span>
        <Tag v-if="status" :tone="status.tone">{{ status.text }}</Tag>
      </span>
      <span class="type-num text-[24px] num text-ink">{{ living.spent === null ? '—' : money(living.spent) }}</span>
      <span class="type-meta num">из {{ plain(living.plan) }}<template v-if="status?.worst"> · {{ status.worst.name }} {{ status.worst.share }} %, обычно ~{{ status.worst.norm }} %</template></span>
    </button>
  </Card>

  <Sheet :open="open" :title="`Траты за ${monthName}`" @close="open = false">
    <div class="flex flex-col gap-3.5">
      <p v-if="!rows.length" class="text-[14px] text-ink-3">Выписок за {{ monthName }} пока нет.</p>
      <div v-for="r in rows" :key="r.categoryId" class="flex flex-col gap-1.5" :data-share="r.categoryId">
        <div class="flex items-baseline justify-between gap-3 text-[14px]">
          <span class="text-ink">{{ r.name }}</span>
          <span class="num text-ink-3">{{ money(r.amount) }} · <b class="font-semibold text-ink">{{ r.share }} %</b></span>
        </div>
        <div class="relative h-2 rounded-[4px] bg-track">
          <i class="block h-full rounded-[4px]" :style="{ width: `${r.width}%`, background: r.color }" />
          <b v-if="r.mark !== null" class="absolute -top-1 h-4 w-0.5 rounded-[1px] bg-ink" :style="{ left: `${r.mark}%` }" aria-hidden="true" data-mark />
        </div>
      </div>
      <span v-if="rows.length" class="inline-flex items-center gap-1.5 type-meta">
        Черта — обычная доля
        <Hint>{{ norms.from === 'own' ? 'Ваше среднее за 3 месяца.' : `Средние доли семей ${STAT_NORMS_LABEL}.` }}</Hint>
      </span>

      <template v-if="!authStore.isViewer && !fromPlan">
        <Field :label="ARTICLE_NAMES.life">
          <NumFieldBlur :initial="plain(articleAmount('life'))" :aria-label="`${ARTICLE_NAMES.life} — в месяц`" class-name="bg-surface-2" @commit="(t) => commit('life', t)" />
        </Field>
        <Field :label="ARTICLE_NAMES.spend">
          <NumFieldBlur :initial="plain(articleAmount('spend'))" :aria-label="`${ARTICLE_NAMES.spend} — в месяц`" class-name="bg-surface-2" @commit="(t) => commit('spend', t)" />
        </Field>
      </template>
    </div>
  </Sheet>
</template>
