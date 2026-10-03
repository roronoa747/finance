<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhBank, PhCaretRight, PhCoins, PhCreditCard, PhFolderSimple, PhPlus, PhWallet } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn, rateField } from '@/lib/money'
import { monthIn, monthKey } from '@/lib/dates'
import {
  amountTotal,
  duesTag,
  duesTotals,
  groupChildren,
  groupTotal,
  liveAccounts,
  liveCredits,
  liveGroups,
  liveObligations,
  monthDues,
} from '@/lib/finance'
import type { Account, Credit, Obligation } from '@/types/finance'

import Card from '@/components/kit/Card.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import Button from '@/components/ui/Button.vue'
import AccountSheet from '@/components/capital/AccountSheet.vue'
import CreditSheet from '@/components/capital/CreditSheet.vue'
import ObligationSheet from '@/components/capital/ObligationSheet.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'
import NewAccountSheet from '@/components/capital/NewAccountSheet.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'
import NewObligationSheet from '@/components/capital/NewObligationSheet.vue'
import GroupSheets from '@/components/capital/GroupSheets.vue'
import ExtraIncomeSheet from '@/components/capital/ExtraIncomeSheet.vue'
import PaymentLine from '@/components/money/PaymentLine.vue'

/**
 * Списки Капитала (пивот 3, Р-32; макет `pivot-3/index.html`, «Капитал» под виджетами): «Счета» с
 * итогом и «Платежи» — один список по дню с «Оплатил», тег «N из M оплачено» (`duesTag`, B2C-59), первой
 * строкой — «Осталось в <месяце>» и «из <всего>» (`duesTotals`, B2C-70). Всё остальное — в листах: счёт
 * (и вклад), кредит, обязательство, группа подписок, формы добавления.
 * Листы открываются и по адресу (`?account=`, `?credit=`, `?obligation=`, `?payoff=`, `?add=`,
 * `?income=1`) — «+» оболочки и старые ссылки; формы добавления — только участнику.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()

const key = computed(() => monthKey())
const accounts = computed(() => liveAccounts(financeStore.accounts))
const privateIds = computed(() => new Set(liveAccounts(financeStore.privateAccounts).map((a) => a.id)))
const credits = computed(() => liveCredits(financeStore.credits))
const obligations = computed(() => liveObligations(financeStore.obligations))
const groups = computed(() => liveGroups(financeStore.obligations))

/* ------------------ Счета ------------------ */
// Сумма счёта всегда в тенге (валютный — по своему курсу), итог — их сумма.
const accountsTotal = computed(() => amountTotal(accounts.value))
const KIND_LABEL: Record<Account['kind'], string> = { card: 'карта', cash: 'наличные', envelope: 'конверт', deposit: 'вклад' }

function accountMeta(a: Account): string {
  const what = a.deposit ? `${rateField(a.deposit.annualRate)} %` : KIND_LABEL[a.kind]
  const fx = a.currency ? moneyIn(a.foreignAmount ?? 0, a.currency) : ''
  return [what, fx, privateIds.value.has(a.id) ? 'личный' : 'общий'].filter(Boolean).join(' · ')
}

/* ------------------ Платежи ------------------ */
// Платежи месяца — одно правило (`monthDues`): на нём тег, суммы и кредиты списка.
const dues = computed(() => monthDues({ obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments, book: fx.book }, key.value))
// Строка-статус (B2C-59, Р-59): «N из M оплачено» за месяц.
const duesStatus = computed(() => duesTag(dues.value))
// Первая строка «Платежей» (B2C-70, владелец): «Осталось в <месяце>» крупно и «из <всего>»; всё оплачено — «Всё оплачено» и итог.
const totals = computed(() => duesTotals(dues.value))
const monthPre = computed(() => monthIn(key.value, false))

type Line = { id: string; day: number; item: { kind: 'credit'; credit: Credit } | { kind: 'obligation'; obligation: Obligation } }
// Один список по дню: кредиты, ждущие платежа в этом месяце (как `monthDues`), и обязательства вне
// групп (годовое — и не в свой месяц, без «Оплатил»); оплаченное остаётся на месте. Группы — ниже.
const lines = computed<Line[]>(() => {
  const own = obligations.value.filter((o) => !o.parentId || !groups.value.some((g) => g.id === o.parentId))
  return [
    ...credits.value
      .filter((c) => dues.value.some((d) => d.kind === 'credit' && d.targetId === c.id))
      .map((c): Line => ({ id: c.id, day: c.day, item: { kind: 'credit', credit: c } })),
    ...own.map((o): Line => ({ id: o.id, day: o.day, item: { kind: 'obligation', obligation: o } })),
  ].sort((a, b) => a.day - b.day)
})

// Закрытые кредиты (остаток 0, платежа в этом месяце нет) — тихой строкой внизу «Платежей» → лист
// списком → лист кредита: история, график, удаление (решение владельца 2026-10-02, хвост критика Б9).
const closed = computed(() => credits.value.filter((c) => c.principal <= 0 && !lines.value.some((l) => l.id === c.id)))
const closedOpen = ref(false)
function openClosedCredit(id: string) {
  closedOpen.value = false
  selectedCreditId.value = id
}

/* ------------------ Листы ------------------ */
const selectedAccountId = ref<string | null>(null)
const selectedCreditId = ref<string | null>(null)
const selectedObligationId = ref<string | null>(null)
const selectedGroupId = ref<string | null>(null)
const payoffCreditId = ref<string | null>(null)
const accountOpen = ref(false)
const addOpen = ref(false)
const addDebtOpen = ref(false)
const addObligationOpen = ref(false)
const addGroupOpen = ref(false)
const extraIncomeOpen = ref(false)

/** «+ Добавить» в «Платежах» — выбор из трёх, дальше — форма. */
function addKind(kind: 'payment' | 'debt' | 'group') {
  addOpen.value = false
  ;({ payment: addObligationOpen, debt: addDebtOpen, group: addGroupOpen })[kind].value = true
}

// Окна открываются и по адресу: «+» в шапке, сводка, старые закладки. Формы добавления —
// только участнику: у viewer старая закладка ?add=… / ?income=1 формы не открывает (запись
// ушла бы в локальный документ, а сервер её не примет).
watch(
  () => route.query,
  (q) => {
    if (!authStore.isViewer) {
      if (q.add === 'debt') addDebtOpen.value = true
      if (q.add === 'payment') addObligationOpen.value = true
      if (q.income === '1') extraIncomeOpen.value = true
    }
    if (typeof q.credit === 'string') selectedCreditId.value = q.credit
    if (typeof q.obligation === 'string') selectedObligationId.value = q.obligation
    // Счёт и вклад — лист счёта (старый адрес `/money/capital/:id` → `/money?account=:id`).
    if (typeof q.account === 'string') selectedAccountId.value = q.account
    if (typeof q.payoff === 'string') payoffCreditId.value = q.payoff
  },
  { immediate: true },
)

/** Параметры адреса, которыми открываются окна. */
const QUERY_KEYS = ['add', 'income', 'credit', 'obligation', 'payoff', 'account']
const queryModalOpen = computed(
  () =>
    addDebtOpen.value ||
    addObligationOpen.value ||
    extraIncomeOpen.value ||
    // Окно показано, а не только id в ref: удалённая синком запись закрывает лист,
    // но id остаётся — адрес тогда не очистился бы никогда.
    credits.value.some((c) => c.id === selectedCreditId.value || c.id === payoffCreditId.value) ||
    obligations.value.some((o) => o.id === selectedObligationId.value) ||
    accounts.value.some((a) => a.id === selectedAccountId.value),
)
// Все такие окна закрылись — адрес очищается, каким бы путём их ни закрыли: крестик, фон,
// Escape, «Готово», запись формы. Иначе тот же «+» ведёт на тот же адрес, перехода нет — и
// окно больше не открывается.
watch(queryModalOpen, (open) => {
  if (open || !QUERY_KEYS.some((k) => k in route.query)) return
  const q = { ...route.query }
  for (const k of QUERY_KEYS) delete q[k]
  void router.replace({ query: q })
})
</script>

<template>
  <!-- Счета -->
  <Section title="Счета">
    <template #action>
      <span class="text-[13px] font-semibold text-ink-3 num">{{ money(accountsTotal) }}</span>
    </template>
  </Section>
  <Card flush>
    <Row
      v-for="a in accounts"
      :key="a.id"
      :title="a.name"
      :note="accountMeta(a)"
      :value="money(a.amount)"
      clickable
      @click="selectedAccountId = a.id"
    >
      <template #icon>
        <PhBank v-if="a.kind === 'deposit'" :size="17" />
        <PhCoins v-else-if="a.kind === 'cash'" :size="17" />
        <PhWallet v-else-if="a.kind === 'envelope'" :size="17" />
        <PhCreditCard v-else :size="17" />
      </template>
    </Row>
    <div v-if="!accounts.length" class="px-4 py-6 text-center text-[13px] text-ink-3">Счетов пока нет</div>
    <div v-if="!authStore.isViewer" class="border-t border-line px-2 py-1.5">
      <Button variant="ghost" class="px-2.5" @click="accountOpen = true">
        <PhPlus :size="16" weight="bold" /> Добавить счёт
      </Button>
    </div>
  </Card>

  <!-- Платежи: один список по дню, «Оплатил» — здесь -->
  <Section title="Платежи">
    <template #action>
      <Tag v-if="duesStatus" :tone="duesStatus.tone">{{ duesStatus.text }}</Tag>
    </template>
  </Section>
  <Card flush>
    <!-- Суммы месяца (B2C-70): одна подпись, одна цифра; без подсказок и кнопок (правило 12) -->
    <div v-if="totals" class="flex flex-col gap-0.5 border-b border-line px-4 pb-3 pt-3.5" data-dues-total>
      <span class="type-label">{{ totals.left ? `Осталось в ${monthPre}` : 'Всё оплачено' }}</span>
      <span class="type-num num text-ink">{{ money(totals.left || totals.total) }}</span>
      <span v-if="totals.left" class="type-meta num">из {{ money(totals.total) }}</span>
    </div>
    <PaymentLine
      v-for="l in lines"
      :key="l.id"
      :item="l.item"
      :period="key"
      @open="l.item.kind === 'credit' ? (selectedCreditId = l.id) : (selectedObligationId = l.id)"
    />
    <Row
      v-for="g in groups"
      :key="g.id"
      :title="g.name"
      :note="`${groupChildren(g, financeStore.obligations).length}${g.noAsk ? ' · рабочие' : ''}`"
      :value="money(groupTotal(g, financeStore.obligations, key, fx.book))"
      clickable
      @click="selectedGroupId = g.id"
    />
    <div v-if="!lines.length && !groups.length" class="px-4 py-6 text-center text-[13px] text-ink-3">Платежей пока нет</div>
    <button
      v-if="closed.length"
      type="button"
      class="flex w-full cursor-pointer items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-left text-[13px] text-ink-3 hover:bg-surface-2"
      @click="closedOpen = true"
    >
      <span>Закрытые · {{ closed.length }}</span>
      <PhCaretRight :size="14" class="shrink-0" />
    </button>
    <div v-if="!authStore.isViewer" class="border-t border-line px-2 py-1.5">
      <Button variant="ghost" class="px-2.5" @click="addOpen = true">
        <PhPlus :size="16" weight="bold" /> Добавить
      </Button>
    </div>
  </Card>

  <!-- Что добавить: три вида платежа -->
  <Sheet :open="addOpen" title="Добавить" @close="addOpen = false">
    <div class="flex flex-col gap-2">
      <Button variant="secondary" class="w-full justify-start" @click="addKind('payment')">
        <PhPlus :size="16" weight="bold" /> Подписка или услуга
      </Button>
      <Button variant="secondary" class="w-full justify-start" @click="addKind('debt')">
        <PhPlus :size="16" weight="bold" /> Долг или рассрочка
      </Button>
      <Button variant="secondary" class="w-full justify-start" @click="addKind('group')">
        <PhFolderSimple :size="16" /> Группа подписок
      </Button>
    </div>
  </Sheet>

  <!-- Закрытые кредиты: строка → лист кредита (viewer — только чтение, как сам лист кредита) -->
  <Sheet :open="closedOpen" title="Закрытые" @close="closedOpen = false">
    <Card flush>
      <Row v-for="c in closed" :key="c.id" :title="c.name" note="долг закрыт" clickable @click="openClosedCredit(c.id)" />
    </Card>
  </Sheet>

  <AccountSheet :account-id="selectedAccountId" @close="selectedAccountId = null" />
  <NewAccountSheet :open="accountOpen" @close="accountOpen = false" />
  <CreditSheet
    :credit-id="selectedCreditId"
    @close="selectedCreditId = null"
    @payoff="(id) => { payoffCreditId = id; selectedCreditId = null }"
  />
  <PayoffSheet :credit-id="payoffCreditId" :plan="null" @close="payoffCreditId = null" />
  <ObligationSheet :obligation-id="selectedObligationId" @close="selectedObligationId = null" />
  <GroupSheets
    :group-id="selectedGroupId"
    :create-open="addGroupOpen"
    @close="selectedGroupId = null"
    @close-create="addGroupOpen = false"
    @open-obligation="(id) => { selectedGroupId = null; selectedObligationId = id }"
  />
  <NewDebtSheet :open="addDebtOpen" @close="addDebtOpen = false" />
  <NewObligationSheet :open="addObligationOpen" @close="addObligationOpen = false" />
  <ExtraIncomeSheet :open="extraIncomeOpen" @close="extraIncomeOpen = false" />
</template>
