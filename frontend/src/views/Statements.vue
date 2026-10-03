<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCheck, PhFileArrowUp } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import WeekTotal from '@/components/kit/WeekTotal.vue'
import StackBar from '@/components/kit/StackBar.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import UnknownBatch from '@/components/UnknownBatch.vue'
import type { MatchCandidate } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { money, moneyIn, parseMoney } from '@/lib/money'
import { plural } from '@/lib/utils'
import { MONTHS_NOM, monthKey, parseMonthKey, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, picture, pictureTotal, unknownGroups, type UnknownGroup } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { ArticleKey, PersonId } from '@/types/finance'
import {
  breakdownAccount,
  breakdownMoves,
  breakdownPath,
  breakdownWith,
  decisionQueue,
  ringShares,
  salaryExchange,
  type Decision,
  type WeekUploadRow,
  liveSpendCategories,
  spendCategoryName,
  spendRows,
  weekPicture,
  weekTag,
  weekUploads,
  weekVersusPrev,
} from '@/lib/finance'
import { readMonthEnd, writeMonthEnd } from '@/lib/storage'
import { ARTICLE_COLORS } from '@/lib/palette'

/**
 * «Неделя» — ритуал (пивот 3, Р-43; макет `pivot-3/dreams-week.html` «А · Ритуал»): итог недели обоих
 * одной карточкой → одно решение за раз из очереди `decisionQueue` → «Загрузить выписку» (брендовая, когда
 * решений нет); «Разделы за месяц» и «Прошлые недели» — свёрнутыми строками с листом. Разбор выписки —
 * сводка, незнакомые продавцы черновика пачкой и «Отправить». Файл разбирается на телефоне и никуда не уходит
 * (Р-4); считает `finance.ts` / `lib/statements`.
 */
const auth = useAuthStore()
const finance = useFinanceStore()
/** Пришедшая валютная зарплата карточки «Пришла зарплата» (B2C-79): сумма в валюте и «Обменял». */
const fxOf = (d: Decision) => (d.salary ? salaryExchange(finance.payments, finance.fxExchanges, d.salary.person.id, d.salary.period) : null)
const store = useOperationsStore()
const route = useRoute()
const router = useRouter()

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadBox = ref<HTMLElement | null>(null)
const openCategory = ref<string | null>(null)
/** Свёрнутые строки «Недели» (правило 12: таблицы — за «подробнее») открывают лист. */
const sheet = ref<'sections' | 'past' | null>(null)

const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const categoryName = (id: string) => spendCategoryName(categories.value, id)
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (slot: string) => people.value.find((p) => p.id === slot)?.name ?? 'Участник'

/* ---------- черновик (предпросмотр) ---------- */
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const dismissedHints = ref<string[]>([])
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules).filter((h) => !dismissedHints.value.includes(h.counterparty)))

/* ---------- неделя и месяц ---------- */
const week = weekKey()
const month = monthKey()
// «Сентябрь» — заголовок колонки листа, «за сентябрь» — строка и лист «Разделы».
const monthName = MONTHS_NOM[parseMonthKey(month).month]
const spendTotals = computed(() => finance.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const pic = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week, store.uploads))
// Даты недели и чьи выписки — в подписи шапки (`AppShell`: `weekRangeLabel`, `weekTag`).
const weekTotalOf = (key: string) => spendRows(spendTotals.value, [], { kind: 'week', period: key }).total
const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
/** «Выписки» (Р-62): кто загрузил выписку за неделю и в какой день; своя «ещё нет» открывает загрузку, viewer — без действий. */
const uploadRows = computed(() => weekUploads(people.value, week, store.uploads))
const mineThisWeek = computed(() => uploadRows.value.some((r) => r.person.id === me.value && r.day !== null))
const uploadsMine = (r: WeekUploadRow) => canUpload.value && r.person.id === me.value && r.day === null
/** Карточка недели: подпись — даты недели, сумма и доли — `weekPicture`, чип — `weekVersusPrev`, «Не разобрано» — сумма недели обоих. */
const weekTotalProps = computed(() => ({
  label: weekRangeLabel(pic.value.range),
  total: pic.value.total,
  delta: weekVersusPrev(spendTotals.value, week, prevWeek)?.delta ?? null,
  segments: pic.value.rows.map((r) => ({ id: r.categoryId, name: r.name, amount: r.amount, share: r.share, color: r.color })),
  unknown: pic.value.unknown,
  unknownShare: pic.value.unknownShare,
}))
// Разделы за неделю и месяц по итогам обоих (B2C-07): раскрытие — свои продавцы раздела и раздел задним числом.
// Таблица — в листе «Разделы за месяц» (правило 12: расчёты свёрнуты), главный поток — итог недели.
const rows = computed(() => picture(spendTotals.value, week, month))
const totals = computed(() => pictureTotal(rows.value))
const monthOps = computed(() => store.all.filter((o) => o.date.startsWith(month)))
const openGroups = computed(() =>
  openCategory.value === null ? [] : unknownGroups(monthOps.value, openCategory.value === UNKNOWN_CATEGORY ? null : openCategory.value),
)
// Прошлые недели — итоги обоих, четыре назад; подпись — чьи выписки (g2 «обе выписки»).
const pastWeeks = computed(() =>
  [1, 2, 3, 4]
    .map((i) => weekKey(new Date(Date.now() - i * 7 * 86_400_000)))
    .map((key) => ({
      key,
      label: weekRangeLabel(weekRange(key)),
      total: weekTotalOf(key),
      meta: weekTag(weekPicture(spendTotals.value, spendCategories.value, people.value, key, store.uploads), people.value.length)?.text ?? '',
    }))
    .filter((w) => w.total > 0),
)
// Загрузка видна, пока своей выписки за неделю нет, и по «+» → «Загрузить выписку» (`?upload=1`); кто ещё
// без выписки — подпись шапки (`weekTag`). Ещё одна выписка при своей — из листа «+».
const showUpload = computed(() => canUpload.value && (!mineThisWeek.value || route.query.upload === '1'))
const foreign = computed(() => (store.draft?.files ?? []).reduce((a, f) => a + (f.parsed.skippedForeign ?? 0), 0))

/* ---------- решения по одному ---------- */
const groupKey = (g: UnknownGroup) => JSON.stringify(g.match)

// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве (раскладку остатка семьи проверяет очередь).
const answeredLocal = ref<string | null>(readMonthEnd())

// Незнакомые продавцы — пачкой (Р-58): в разборе — черновик (ответ — правило до отправки), иначе — месяц (раздел задним числом).
const unknownList = computed(() => unknownGroups(store.draft ? store.draftOps : monthOps.value))

/**
 * Одна очередь (Р-43, `decisionQueue`): сопоставление → продавцы пачкой → подписка → зарплата → «освободится» →
 * «остались деньги?»; на экране — первое неотложенное. В разборе — только пачка продавцов черновика.
 * «Потом» / «Позже» / «Подумать» — до следующего открытия экрана.
 */
const deferred = ref<string[]>([])
const queue = computed(() =>
  decisionQueue(
    { ...finance.householdDoc, credits: finance.credits },
    {
      me: auth.slot,
      canEdit: canUpload.value,
      matches: store.draft ? [] : store.pendingMatches,
      unknown: unknownList.value,
      answeredMonthEnd: answeredLocal.value,
      totals: spendTotals.value,
      spendCategories: spendCategories.value,
      uploads: store.uploads,
    },
  ).filter((d) => !deferred.value.includes(d.key) && (!store.draft || d.kind === 'unknownBatch')),
)
const decision = computed(() => queue.value[0] ?? null)
const defer = (d: Decision) => {
  deferred.value = [...deferred.value, d.key]
  cancelling.value = false
}

// «N из M»: M — все решения, что были в очереди с открытия экрана (или начала разбора), — не тает при
// ответе; новые (например, «Пришла зарплата» после «Да, зарплата») её увеличивают. N — сколько позади + 1.
const seen = ref<string[]>([])
watch(
  [() => queue.value.map((d) => d.key), () => !!store.draft],
  ([keys, draft], prev) => {
    const base = prev && prev[1] !== draft ? [] : seen.value
    seen.value = [...base, ...keys.filter((k) => !base.includes(k))]
  },
  { immediate: true },
)
const progress = computed(() => (seen.value.length > 1 ? { n: seen.value.length - queue.value.length + 1, k: seen.value.length } : null))

/** «Да»: отметка и правило; «Да, зарплата» — следующей карточкой «Пришла зарплата» (B2C-58: разбор одним нажатием). */
function acceptMatch(c: MatchCandidate) {
  void store.acceptMatch(c)
}

/**
 * «Пришла зарплата» (Р-55, B2C-58): «Разложить как обычно» пишет разбор той же дорогой, что «Разложить» на
 * кольце (`layBreakdown`), и карточка коротко показывает «Разложено». Счёт — как у кольца; не выбран, а
 * деньги уходят со счёта — кольцо, там его спросят.
 */
const justLaid = ref<{ total: number; rest: number } | null>(null)
function layUsual(d: Decision) {
  const u = d.usual
  if (!u || !d.salary) return
  const off = u.articles.filter((a) => !a.on).map((a) => a.key)
  const source = { from: 'salary' as const, person: d.salary.person.id, period: d.salary.period }
  const accountId = breakdownAccount(finance.payments, source, auth.slot, finance.accounts)
  if (accountId === undefined && breakdownMoves(u.mode, breakdownWith(u, off).effects)) {
    if (d.to) void router.push(d.to)
    return
  }
  finance.layBreakdown(u, off, { by: auth.slot ?? 'a', accountId, note: 'из зарплаты' })
  void finance.syncHousehold()
  justLaid.value = { total: u.amount, rest: u.fill.rest }
  setTimeout(() => (justLaid.value = null), 2400)
}
/** Полоса статей карточки: что получит каждая статья из этой зарплаты, хвост — остаток дорожкой (`StackBar`, макет). */
const usualSegments = (d: Decision) =>
  d.usual
    ? ringShares<ArticleKey | 'rest'>(
        [...d.usual.articles.map((a) => ({ key: a.key, amount: d.usual!.fill.given[a.key] })), { key: 'rest', amount: d.usual.fill.rest }],
        d.usual.amount,
      )
        .filter((x) => x.share > 0)
        .map((x) => ({ ...x, color: x.key === 'rest' ? 'var(--track)' : ARTICLE_COLORS[x.key] }))
    : []

/** Ответ пачке — всем отмеченным разом: в разборе — до отправки, в неделе — задним числом одной отправкой. */
function answerBatch(matches: MerchantRule['match'][], to: MerchantRule['to']) {
  if (store.draft) store.answerAll(matches, to)
  else void store.recategorizeAll(matches, to)
}

// «Оставить подписку?» (Р-20): «Отписаться» — шаг подтверждения (`keepCard().cancel`).
const cancelling = ref(false)
function onKeep(d: Decision, action: 'keep' | 'cancel') {
  const o = d.obligation
  if (!o) return
  if (action === 'cancel') {
    if (!cancelling.value) {
      cancelling.value = true
      return
    }
    finance.removeObligation(o.id)
  } else finance.keepSubscription(o.id)
  cancelling.value = false
}

const restAmount = ref('')
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (go && amount > 0) void router.push(breakdownPath({ from: 'rest', amount, period: month }))
}

/** Главное действие экрана (правило 12): первое решение, иначе — загрузка своей выписки. */
const uploadLead = computed(() => !decision.value)

// Ответы карточки: у подписки — шаг отмены.
const decisionActions = computed(() => {
  const d = decision.value
  if (!d) return null
  if (d.kind === 'keep' && cancelling.value) return d.cancel?.actions ?? null
  return d.actions
})
function onPrimary(d: Decision) {
  if (d.kind === 'match' && d.match) acceptMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, cancelling.value ? 'cancel' : 'keep')
  else if (d.kind === 'monthEnd') answerRest(true)
  else if (d.kind === 'allocate' && d.usual) layUsual(d)
  else if (d.to) void router.push(d.to)
}
function onSecondary(d: Decision) {
  if (d.kind === 'match' && d.match) void store.declineMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, 'cancel')
}
function onGhost(d: Decision) {
  if (d.kind === 'keep' && cancelling.value) cancelling.value = false
  else if (d.kind === 'monthEnd') answerRest(false)
  else if (d.kind === 'allocate' && d.usual && d.to) void router.push(d.to)
  else defer(d)
}

/** Ответ в «Разделах за месяц» — задним числом, тем же `CategoryChips`, что и карточка (хвост (г) критика Б9). */
function answerLater(g: UnknownGroup, to: MerchantRule['to']) {
  void store.recategorize(g.match, to)
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  try {
    const { ok, errors } = await readStatementFiles(files)
    store.setDraft(ok, errors)
    deferred.value = []
    // Пришли из «+» — после выбора файла адрес обычный: в итоге недели загрузки снова нет.
    if (route.query.upload === '1') void router.replace('/week')
  } finally {
    reading.value = false
    input.value = ''
  }
}

onMounted(() => {
  void store.loadUploads()
  void store.pull()
  // «Загрузить выписку» из листа «+» (`/week?upload=1`, B2C-13): окно выбора файла браузер
  // открывает только по нажатию — подводим к кнопке и ставим на неё фокус.
  if (route.query.upload === '1') uploadBox.value?.querySelector('button')?.focus()
})
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1 text-left">
    <p v-if="auth.isDemo" class="px-1 text-[12px] text-ink-3">демо: только на этом телефоне</p>

    <!-- РАЗБОР (g2 «Разбор — предпросмотр»): сводка → решения по одному → «Отправить». Банк и период — в шапке. -->
    <template v-if="store.draft">
      <Callout v-for="e in store.draft.errors" :key="e.name" tone="warn" role="alert">
        {{ e.name }}: {{ e.message }}
        <span v-if="e.detail" class="mt-1 block break-all text-[11.5px] text-ink-3">{{ e.detail }}</span>
      </Callout>

      <template v-if="store.draftOps.length">
        <Card class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <span class="type-h3 num text-ink">{{ summary.total }} {{ plural(summary.total, 'операция', 'операции', 'операций') }}</span>
            <Tag v-if="summary.already" tone="neutral">{{ summary.already === summary.total ? 'все уже были' : `${summary.already} уже были` }}</Tag>
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-3 py-3 first:pt-0"><span class="flex-1 font-medium text-ink">Списания</span><span class="money text-ink">{{ money(summary.spent) }}</span></div>
            <div class="flex items-center gap-3 border-t border-line py-3"><span class="flex-1 font-medium text-ink">Поступления</span><span class="money text-ok">{{ money(summary.received) }}</span></div>
            <div class="flex items-center gap-3 border-t border-line py-3">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">Между своими</span><span class="block type-meta">переводы между своими счетами — не траты</span></span>
              <span class="money text-ink-3">{{ money(summary.internal) }}</span>
            </div>
            <div v-if="store.draftAutoMatches.length" class="flex items-center gap-3 border-t border-line py-3">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">Отметится по выписке — {{ store.draftAutoMatches.length }}</span><span class="block type-meta">платежи, которые вы уже подтверждали</span></span>
            </div>
            <div v-if="foreign" class="flex items-center gap-3 border-t border-line py-3 last:pb-0">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">В валюте — {{ foreign }}</span><span class="block type-meta">их пока не считаем</span></span>
            </div>
          </div>
        </Card>

        <!-- Подсказка о партнёре (DESIGN.md §6) — тихие кнопки: главная в разборе одна, «Отправить» -->
        <DecisionCard
          v-for="h in hints"
          :key="h.counterparty"
          question="Это перевод партнёру?"
          :meta="`«${h.label}» — похоже, это ${personName(h.person)}. Тогда переводы между вами — не траты.`"
          :actions="{ secondary: `Да, это ${personName(h.person)}`, ghost: 'Нет' }"
          @secondary="store.answer({ counterparty: h.counterparty }, { internal: true })"
          @ghost="dismissedHints = [...dismissedHints, h.counterparty]"
        />
      </template>
    </template>

    <!-- НЕДЕЛЯ (макет «А · Ритуал»): итог недели одной карточкой -->
    <template v-else>
      <Callout v-if="store.pendingCount" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>
      <Callout v-if="store.lastAutoMarked" tone="ok">Отмечено по выписке: {{ store.lastAutoMarked }} — снять можно в «Деньгах».</Callout>
      <!-- «Выписки» (Р-62, макет «А · Пачкой»): галочки обоих; даты недели — уже в шапке, в заголовок не дублируются. -->
      <Card v-if="uploadRows.length > 1" class="flex flex-col">
        <span class="type-label">Выписки</span>
        <component
          :is="uploadsMine(r) ? 'button' : 'div'"
          v-for="(r, i) in uploadRows"
          :key="r.person.id"
          :type="uploadsMine(r) ? 'button' : undefined"
          class="flex w-full items-center gap-2.5 py-2 text-left"
          :class="[i && 'border-t border-line', uploadsMine(r) && 'cursor-pointer']"
          @click="uploadsMine(r) && fileInput?.click()"
        >
          <span class="grid size-6 shrink-0 place-items-center rounded-[8px] border-2" :class="r.day !== null ? 'border-ok bg-ok text-brand-ink' : 'border-line-strong'" aria-hidden="true">
            <PhCheck v-if="r.day !== null" :size="14" weight="bold" />
          </span>
          <Avatar :id="r.person.id" :name="r.person.name" />
          <span class="min-w-0 flex-1 truncate text-ink">{{ r.person.name }}</span>
          <span class="type-meta">{{ r.day ?? 'ещё нет' }}</span>
        </component>
      </Card>
      <!-- За неделю никто не загружал — карточки нет (без «0 ₸»); viewer видит пустое состояние, участник — загрузку ниже. -->
      <WeekTotal v-if="pic.uploaded.length" v-bind="weekTotalProps" />
      <Card v-else-if="!canUpload"><EmptyState title="Картины недели пока нет" /></Card>
    </template>

    <!-- «Разложить как обычно» — коротко «Разложено» на месте карточки -->
    <Card v-if="justLaid" class="fx-in flex flex-col gap-1 border-ok" aria-live="polite">
      <span class="type-label">Разложено</span>
      <span class="type-big-md num text-ink">{{ money(justLaid.total) }}</span>
      <span class="type-meta num">остаётся {{ money(justLaid.rest) }}</span>
    </Card>

    <!-- Одно решение за раз (Р-43): первое из очереди `decisionQueue`; незнакомые продавцы — пачкой (Р-58) -->
    <UnknownBatch v-else-if="decision?.kind === 'unknownBatch'" :groups="decision.groups ?? []" :progress="progress" @answer="answerBatch" @later="defer(decision!)" />
    <DecisionCard
      v-else-if="decision"
      :key="decision.key"
      lead
      :eyebrow="decision.kind === 'allocate'"
      :question="decision.question"
      :meta="decision.kind === 'allocate' ? '' : decision.meta"
      :progress="progress"
      :actions="decisionActions"
      @primary="onPrimary(decision)"
      @secondary="onSecondary(decision)"
      @ghost="onGhost(decision)"
    >
      <template v-if="decision.kind === 'keep'" #inner>{{ cancelling ? decision.cancel?.inner : decision.inner }}</template>
      <template v-else-if="decision.kind === 'monthEnd'" #inner>
        <NumField v-model="restAmount" placeholder="50 000" aria-label="Сколько осталось, ₸" />
      </template>
      <!-- «Пришла зарплата» (макет, вопрос 2): сумма, полоса статей, «как в <месяце> · останется N ₸» -->
      <template v-if="decision.kind === 'allocate'">
        <span v-if="fxOf(decision)" class="-mt-2.5 flex items-baseline gap-2">
          <span class="type-big num text-ink">{{ moneyIn(fxOf(decision)!.came, fxOf(decision)!.currency) }}</span>
          <span class="type-meta num">≈ {{ money(decision.amount ?? 0) }}</span>
        </span>
        <span v-else class="-mt-2.5 type-big num text-ink">{{ money(decision.amount ?? 0) }}</span>
        <StackBar v-if="decision.usual" :segments="usualSegments(decision)" />
        <p class="text-[14px] text-ink-3">
          <template v-if="decision.usual">{{ decision.lead }} · <b :class="['num font-semibold', decision.usual.fill.short > 0 ? 'text-destructive' : 'text-ok']">{{ decision.outcome }}</b></template>
          <template v-else>{{ decision.meta }}</template>
        </p>
        <SalaryExchange v-if="decision.salary" :person-id="decision.salary.person.id" :period="decision.salary.period" />
      </template>
      <template v-if="decision.kind === 'allocate'" #actions>
        <div class="flex w-full flex-col gap-1.5">
          <Button class="w-full" @click="onPrimary(decision!)">{{ decision.actions.primary }}</Button>
          <Button variant="ghost" class="w-full" @click="onGhost(decision!)">{{ decision.actions.ghost }}</Button>
        </div>
      </template>
      <!-- «Пришла» и лист «ещё» — SalaryRow (RP-10) -->
      <SalaryRow v-if="decision.kind === 'salary' && decision.salary" button :person-id="decision.salary.person.id" :period="decision.salary.period" />
    </DecisionCard>

    <!-- Разбор: одна брендовая «Отправить» и тихая «Отмена» (g2: «Дальше» / «Отмена»; «назад» шапки — то же) -->
    <div v-if="store.draft" class="flex flex-col gap-2 pt-1">
      <Button v-if="store.draftOps.length" size="lg" class="w-full" @click="store.send()">Отправить</Button>
      <Button variant="ghost" class="w-full" @click="store.cancelDraft()">Отмена</Button>
    </div>

    <template v-else>
      <!-- Загрузка: брендовая, когда решений нет; при решении — тихая. Механика — в подсказке (правило 12). -->
      <template v-if="canUpload">
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <div v-if="showUpload" ref="uploadBox" class="flex flex-col items-center gap-2">
          <Button size="lg" class="w-full" :variant="uploadLead ? 'default' : 'secondary'" :disabled="reading" @click="fileInput?.click()">
            <PhFileArrowUp :size="18" />
            {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
          </Button>
          <span class="inline-flex items-center gap-1.5 type-meta">PDF из Kaspi или Freedom <Hint>Разбор на телефоне — файл никуда не уходит. На сервер попадают только продавец, дата, сумма и раздел.</Hint></span>
        </div>
      </template>

      <!-- Свёрнутые строки (макет: «Разделы за месяц ›», «Прошлые недели ›») — подробности в листе -->
      <Card v-if="rows.length" flush>
        <Row :title="`Разделы за ${monthName.toLowerCase()}`" clickable @click="sheet = 'sections'" />
      </Card>
      <Card v-if="pastWeeks.length" flush>
        <Row title="Прошлые недели" clickable @click="sheet = 'past'" />
      </Card>
    </template>

    <!-- Разделы за неделю и месяц: раскрытие раздела — свои продавцы и раздел задним числом (CategoryChips) -->
    <Sheet :open="sheet === 'sections'" :title="`Разделы за ${monthName.toLowerCase()}`" @close="sheet = null">
      <div class="-mx-5">
        <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-5 py-2 text-[12px] text-ink-3">
          <span>Раздел</span><span class="w-[86px] text-right">Неделя</span><span class="w-[96px] text-right">{{ monthName }}</span>
        </div>
        <template v-for="r in rows" :key="r.categoryId">
          <button
            type="button"
            class="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 px-5 py-2.5 text-left text-[13.5px] cursor-pointer hover:bg-surface-2"
            @click="openCategory = openCategory === r.categoryId ? null : r.categoryId"
          >
            <span :class="r.categoryId === UNKNOWN_CATEGORY ? 'text-ink-3' : 'text-ink'">{{ categoryName(r.categoryId) }}</span>
            <span class="w-[86px] text-right num text-ink-2">{{ r.week ? money(r.week) : '—' }}</span>
            <span class="w-[96px] text-right num text-ink">{{ money(r.month) }}</span>
          </button>
          <div v-if="openCategory === r.categoryId" class="flex flex-col gap-3 border-y border-line bg-surface-2 px-5 py-3">
            <p v-if="!openGroups.length" class="text-[12.5px] text-ink-3">Здесь только ваши траты — у партнёра они в его телефоне.</p>
            <div v-for="g in openGroups" :key="groupKey(g)" class="flex flex-col gap-2">
              <div class="flex items-baseline justify-between gap-2 text-[13px]">
                <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                <span class="shrink-0 num text-ink-3">{{ money(g.amount) }}</span>
              </div>
              <CategoryChips v-if="canUpload" :counterparty="!!g.match.counterparty" @choose="(to) => answerLater(g, to)" />
            </div>
          </div>
        </template>
        <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-t border-line px-5 pt-2 text-[13.5px] font-semibold">
          <span class="text-ink">Всего</span>
          <span class="w-[86px] text-right num text-ink">{{ money(totals.week) }}</span>
          <span class="w-[96px] text-right num text-ink">{{ money(totals.month) }}</span>
        </div>
      </div>
    </Sheet>

    <!-- Прошлые недели (g2): даты, чьи выписки, сумма -->
    <Sheet :open="sheet === 'past'" title="Прошлые недели" @close="sheet = null">
      <div class="flex flex-col">
        <div v-for="(w, i) in pastWeeks" :key="w.key" class="fx-in flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0" :style="{ '--i': i }">
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-ink">{{ w.label }}</span>
            <span v-if="w.meta" class="block type-meta">{{ w.meta }}</span>
          </span>
          <span class="money whitespace-nowrap text-ink">{{ money(w.total) }}</span>
        </div>
      </div>
    </Sheet>
  </div>
</template>
