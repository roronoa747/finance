<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhArrowsClockwise, PhBank, PhCaretRight, PhCoins, PhCreditCard, PhFolderSimple, PhPlus, PhWallet } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn, rateField } from '@/lib/money'
import { monthFromAfter, monthKey } from '@/lib/dates'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import {
  amountTotal,
  capitalGoals,
  creditOutlook,
  duesTotal,
  groupChildren,
  groupTotal,
  isSubscription,
  liveAccounts,
  liveCredits,
  liveGroups,
  liveObligations,
  monthDues,
  monthlyAmount,
  openDebt,
  subscriptionGroup,
} from '@/lib/finance'
import type { Account, Credit, Obligation } from '@/types/finance'

import Card from '@/components/kit/Card.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import AccountSheet from '@/components/capital/AccountSheet.vue'
import CreditSheet from '@/components/capital/CreditSheet.vue'
import ObligationSheet from '@/components/capital/ObligationSheet.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'
import NewAccountSheet from '@/components/capital/NewAccountSheet.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'
import NewObligationSheet from '@/components/capital/NewObligationSheet.vue'
import GroupSheets from '@/components/capital/GroupSheets.vue'
import PaymentLine from '@/components/money/PaymentLine.vue'

/**
 * Списки Капитала (Блок 15, Р-91, Р-93; макет week-month.html «Деньги · Капитал»): «Счета» с итогом, «Кредиты» —
 * остаток, ставка и срок, «Платежи» с суммой месяца —
 * справочник: один список по дню, без «Оплатил» и отметок месяца (✓ и «Оплатил» — в «Месяце», Р-94); подписки —
 * одной строкой «Подписки · N», раскрытие — список с ручными группами. Всё остальное — в листах: счёт (и вклад),
 * кредит, обязательство, группа подписок, формы добавления.
 * Листы открываются и по адресу (`?account=`, `?credit=`, `?obligation=`, `?payoff=`, `?add=`) — «+» оболочки,
 * «Изменить платёж» из «Месяца» и старые ссылки; формы добавления — только участнику.
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
// Сумма счёта всегда в тенге (валютный — по своему курсу); итог — счета и цели вне счетов (Р-109): «Счета» − «Кредиты» = «Капитал».
const goals = computed(() => capitalGoals(financeStore.goals, financeStore.accounts))
const accountsTotal = computed(() => amountTotal(accounts.value) + goals.value.total)
const goalsOpen = ref(false)
const goalHue = (id: string) => {
  const hue = financeStore.goals.find((g) => g.id === id)?.hue
  return hue ? hueColor(hue, isDark.value) : undefined
}
const KIND_LABEL: Record<Account['kind'], string> = { card: 'карта', cash: 'наличные', envelope: 'конверт', deposit: 'вклад' }

function accountMeta(a: Account): string {
  const what = a.deposit ? `${rateField(a.deposit.annualRate)} %` : KIND_LABEL[a.kind]
  const fx = a.currency ? moneyIn(a.foreignAmount ?? 0, a.currency) : ''
  return [what, fx, privateIds.value.has(a.id) ? 'личный' : 'общий'].filter(Boolean).join(' · ')
}

/* ------------------ Кредиты ------------------ */
// Открытые кредиты: остаток, ставка и месяц последнего платежа при нынешнем платеже (`creditOutlook`).
const openCredits = computed(() => credits.value.filter((c) => c.principal > 0))
const debtsTotal = computed(() => openDebt(financeStore.credits))
function creditMeta(c: Credit): string {
  const out = creditOutlook(c)
  const rate = c.rateUnknown ? 'ставку уточните' : `${rateField(c.annualRate)} %`
  return [rate, out.closes ? `до ${monthFromAfter(out.months)}` : ''].filter(Boolean).join(' · ')
}

/* ------------------ Платежи — справочник ------------------ */
// Сумма платежей этого месяца (`monthDues` — те же строки, что в «Месяце»).
const duesMonth = computed(() => duesTotal(monthDues({ obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments, book: fx.book }, key.value)))
// Подписки — одной группой (`subscriptionGroup`, та же функция, что в «Месяце»): сумма — в месяц (годовая — долей).
const subs = computed(() =>
  subscriptionGroup(
    obligations.value.filter(isSubscription).map((o) => ({ obligation: o, amount: monthlyAmount(o, key.value, fx.book), paid: false, day: o.day })),
    financeStore.obligations,
  ),
)
const subsOpen = ref(false)
const inSubs = (o: Obligation) => !!subs.value && isSubscription(o)

type Line = { id: string; day: number; item: { kind: 'credit'; credit: Credit } | { kind: 'obligation'; obligation: Obligation } }
// Один список по дню: открытые кредиты и обязательства (годовое — тоже: «раз в год · в <месяце>»); подписки —
// в своей группе, остальное из ручных групп — в строке группы ниже.
const lines = computed<Line[]>(() => {
  const own = obligations.value.filter((o) => !inSubs(o) && (!o.parentId || !groups.value.some((g) => g.id === o.parentId)))
  return [
    ...openCredits.value.map((c): Line => ({ id: c.id, day: c.day, item: { kind: 'credit', credit: c } })),
    ...own.map((o): Line => ({ id: o.id, day: o.day, item: { kind: 'obligation', obligation: o } })),
  ].sort((a, b) => a.day - b.day)
})
// Ручная группа — строкой, пока она пуста или в ней есть не-подписки (её подписки — подзаголовком в «Подписки · N»).
const groupRows = computed(() =>
  groups.value.filter((g) => {
    const kids = groupChildren(g, financeStore.obligations)
    return !kids.length || kids.some((o) => !inSubs(o))
  }),
)

// Закрытые кредиты (остаток 0) — тихой строкой внизу «Платежей» → лист
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

/** «+ Добавить» в «Платежах» — выбор из трёх, дальше — форма. */
function addKind(kind: 'payment' | 'debt' | 'group') {
  addOpen.value = false
  ;({ payment: addObligationOpen, debt: addDebtOpen, group: addGroupOpen })[kind].value = true
}

// Окна открываются и по адресу: «+» в шапке, сводка, старые закладки. Формы добавления —
// только участнику: у viewer старая закладка ?add=… формы не открывает (запись
// ушла бы в локальный документ, а сервер её не примет).
watch(
  () => route.query,
  (q) => {
    if (!authStore.isViewer) {
      if (q.add === 'debt') addDebtOpen.value = true
      if (q.add === 'payment') addObligationOpen.value = true
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
const QUERY_KEYS = ['add', 'credit', 'obligation', 'payoff', 'account']
const queryModalOpen = computed(
  () =>
    addDebtOpen.value ||
    addObligationOpen.value ||
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
      <span class="text-[13px] font-semibold text-ink-3 num" data-accounts-total>{{ money(accountsTotal) }}</span>
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
    <!-- Цели · N: деньги в целях — тоже капитал; на счёте — видна, но второй раз не считается (Р-109) -->
    <div v-if="goals.items.length" class="border-b border-line last:border-b-0" data-goals>
      <button type="button" class="press flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" :aria-expanded="goalsOpen" @click="goalsOpen = !goalsOpen">
        <span class="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">Цели · {{ goals.count }}</span>
        <span class="shrink-0 text-[14.5px] font-semibold num text-ink" data-goals-total>{{ money(goals.total) }}</span>
        <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="goalsOpen && 'rotate-90'" />
      </button>
      <div v-if="goalsOpen" class="mb-2 ml-4 border-l-2 border-line pl-1">
        <Row
          v-for="g in goals.items"
          :key="g.goalId"
          :title="g.name"
          :note="g.accountName ? `на ${g.accountName} — уже в счёте` : undefined"
          clickable
          :data-goal="g.goalId"
          @click="router.push(`/goals/${g.goalId}`)"
        >
          <template #icon>
            <span class="grid size-full place-items-center rounded-[10px] text-[13px] font-bold text-dot-ink" :style="{ background: goalHue(g.goalId) }">{{ g.name.slice(0, 1).toUpperCase() }}</span>
          </template>
          <template #value>
            <span class="block text-[14.5px] font-semibold num" :class="g.accountName ? 'text-ink-3' : 'text-ink'">{{ money(g.amount) }}</span>
          </template>
        </Row>
      </div>
    </div>
    <div v-if="!accounts.length" class="px-4 py-6 text-center text-[13px] text-ink-3">Счетов пока нет</div>
    <div v-if="!authStore.isViewer" class="border-t border-line px-2 py-1.5">
      <Button variant="ghost" class="px-2.5" @click="accountOpen = true">
        <PhPlus :size="16" weight="bold" /> Добавить счёт
      </Button>
    </div>
  </Card>

  <!-- Кредиты: остаток, ставка и срок; нажатие — лист кредита -->
  <template v-if="openCredits.length">
    <Section title="Кредиты">
      <template #action>
        <span class="text-[13px] font-semibold text-ink-3 num" data-credits-total>{{ money(debtsTotal) }}</span>
      </template>
    </Section>
    <Card flush data-credits>
      <Row v-for="c in openCredits" :key="c.id" :title="c.name" :note="creditMeta(c)" :value="money(c.principal)" clickable @click="selectedCreditId = c.id" />
    </Card>
  </template>

  <!-- Платежи — справочник: один список по дню, без отметок месяца; подписки — одной строкой -->
  <Section title="Платежи">
    <template v-if="duesMonth > 0" #action>
      <span class="text-[13px] font-semibold text-ink-3 num">{{ money(duesMonth) }} / мес</span>
    </template>
  </Section>
  <Card flush data-payments>
    <PaymentLine
      v-for="l in lines"
      :key="l.id"
      :item="l.item"
      :period="key"
      @open="l.item.kind === 'credit' ? (selectedCreditId = l.id) : (selectedObligationId = l.id)"
    />
    <div v-if="subs" class="border-b border-line last:border-b-0" data-subs>
      <button type="button" class="press flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" :aria-expanded="subsOpen" @click="subsOpen = !subsOpen">
        <span class="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-3 text-ink-2"><PhArrowsClockwise :size="17" /></span>
        <span class="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">Подписки · {{ subs.count }}</span>
        <span class="shrink-0 text-[14.5px] font-semibold num text-ink">{{ money(subs.total) }}</span>
        <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="subsOpen && 'rotate-90'" />
      </button>
      <div v-if="subsOpen" class="mb-2 ml-[33px] border-l-2 border-line pl-3">
        <template v-for="g in subs.parts" :key="g.groupId ?? ''">
          <button
            v-if="g.groupId"
            type="button"
            class="press block cursor-pointer pb-0.5 pt-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-3"
            :aria-label="`Группа «${g.name}»`"
            @click="selectedGroupId = g.groupId"
          >
            {{ g.name }} ›
          </button>
          <PaymentLine v-for="x in g.rows" :key="x.obligation.id" dense :item="{ kind: 'obligation', obligation: x.obligation }" :period="key" @open="selectedObligationId = x.obligation.id" />
        </template>
      </div>
    </div>
    <Row
      v-for="g in groupRows"
      :key="g.id"
      :title="g.name"
      :note="`${groupChildren(g, financeStore.obligations).length}${g.noAsk ? ' · рабочие' : ''}`"
      :value="money(groupTotal(g, financeStore.obligations, key, fx.book))"
      clickable
      @click="selectedGroupId = g.id"
    />
    <div v-if="!lines.length && !groupRows.length && !subs" class="px-4 py-6 text-center text-[13px] text-ink-3">Платежей пока нет</div>
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
  <PayoffSheet :credit-id="payoffCreditId" @close="payoffCreditId = null" />
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
</template>
