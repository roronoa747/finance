<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretDown, PhFileArrowUp } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Select from '@/components/kit/Select.vue'
import Tag from '@/components/kit/Tag.vue'
import WeekCard from '@/components/kit/WeekCard.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import type { MatchCandidate } from '@/lib/statements/matching'
import { matchKey } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney } from '@/lib/money'
import { plural } from '@/lib/utils'
import { dayLabel, monthKey, monthTitle, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, picture, pictureTotal, ruleMatchOf, unknownGroups, type UnknownGroup } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  allocateCard,
  allocationFor,
  keepCard,
  monthEndCard,
  salaryCard,
  keepQuestions,
  monthEndAsk,
  salaryAllocationPath,
  salaryAsk,
  salaryToAllocate,
  liveSpendCategories,
  spendCategoryName,
  spendRows,
  weekPicture,
  weekTag,
  weekVersusPrev,
} from '@/lib/finance'
import { readMonthEnd, writeMonthEnd } from '@/lib/storage'

/**
 * «Неделя» (DESIGN.md §2 g2, §3; B2C-07 → B2C-21): что за неделя и кто загрузил, загрузка и
 * предпросмотр, решения по одному (сопоставления Р-6, незнакомые продавцы, «оставить подписку?»,
 * «остались деньги?», «пришла зарплата?», «разложить?» → `/week/salary`), итог недели по выпискам
 * обоих, «без выписки <имя>», разделы за неделю и месяц, прошлые недели, загрузки семьи. Файл
 * разбирается на телефоне и никуда не уходит (Р-4); считает `finance.ts` / `lib/statements`.
 */
const auth = useAuthStore()
const finance = useFinanceStore()
const store = useOperationsStore()
const route = useRoute()
const router = useRouter()

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom' }
const INTERNAL = '__internal'
const PERSON = '__person'

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadBox = ref<HTMLElement | null>(null)
const openCategory = ref<string | null>(null)
const personFor = ref<string | null>(null)
const personText = ref('')

const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const categoryName = (id: string) => spendCategoryName(categories.value, id)
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (slot: string) => people.value.find((p) => p.id === slot)?.name ?? 'Участник'

/* ---------- черновик (предпросмотр) ---------- */
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const unknown = computed(() => unknownGroups(store.draftOps))
const dismissedHints = ref<string[]>([])
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules).filter((h) => !dismissedHints.value.includes(h.counterparty)))

/* ---------- неделя и месяц ---------- */
const week = weekKey()
const month = monthKey()
const spendTotals = computed(() => finance.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const pic = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week, store.uploads))
// Даты недели и чьи выписки — в подписи шапки (`AppShell`, как на главном: `weekRangeLabel`, `weekTag`).
const weekSegments = computed(() => pic.value.rows.map((r) => ({ id: r.categoryId, name: r.name, amount: r.amount, share: r.share, color: r.color })))
// Итог недели против прошлой (§6): «на N % меньше прошлой» / «больше».
const weekTotalOf = (key: string) => spendRows(spendTotals.value, [], { kind: 'week', period: key }).total
const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
const versusPrev = computed<{ text: string; tone: 'ok' | 'warn' | 'neutral' } | null>(() => {
  const vs = weekVersusPrev(spendTotals.value, week, prevWeek)
  if (!vs) return null
  const { delta } = vs
  if (delta === 0) return { text: 'как на прошлой', tone: 'neutral' }
  return delta < 0 ? { text: `на ${-delta} % меньше прошлой`, tone: 'ok' } : { text: `на ${delta} % больше прошлой`, tone: 'warn' }
})
const mineThisWeek = computed(() => {
  const { from, to } = pic.value.range
  return store.uploads.some((u) => u.slot === me.value && u.period_to >= from && u.period_from <= to)
})
// Разделы за неделю и месяц по итогам обоих (B2C-07): раскрытие — свои продавцы раздела и раздел задним числом.
// Таблица — за «Подробнее» (правило 12: расчёты свёрнуты, `<details>` как у цели), главный поток — итог недели.
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
// Загрузки этой недели — карточка «<имя> · банк · период · N операций» в состоянии «до загрузки» (g2).
const weekUploads = computed(() => {
  const { from, to } = pic.value.range
  return store.uploads.filter((u) => u.period_to >= from && u.period_from <= to)
})
// Загрузка видна, пока своей выписки за неделю нет, и по «+» → «Загрузить выписку» (`?upload=1`);
// в итоге недели её нет (g2 «Неделя — итог»): ещё одна выписка — из листа «+».
const showUpload = computed(() => canUpload.value && (!mineThisWeek.value || route.query.upload === '1'))
const foreign = computed(() => (store.draft?.files ?? []).reduce((a, f) => a + (f.parsed.skippedForeign ?? 0), 0))

/* ---------- решения по одному ---------- */
const groupKey = (g: UnknownGroup) => JSON.stringify(g.match)

// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве; раскладка остатка месяца
// в общем документе (её ключ — на семью) — тоже ответ: партнёр второй раз не спрашивается.
const answeredLocal = ref<string | null>(readMonthEnd())
const answeredMonthEnd = computed(() =>
  allocationFor(finance.allocations, { source: 'rest', sourceId: month, period: month }) ? month : answeredLocal.value,
)
// «Разложить» с главного (`/week?rest=1`) — карточка остатка первой; после ответа — обычная очередь.
const restFirst = computed(() => route.query.rest === '1' && canUpload.value && monthEndAsk(answeredMonthEnd.value))

// 1. Сопоставления с отметками (Р-6, B2C-15).
const deferredMatches = ref<string[]>([])
const matchQueue = computed(() => store.pendingMatches.filter((c) => !deferredMatches.value.includes(matchKey(c))))
const match = computed<MatchCandidate | null>(() => (canUpload.value && !restFirst.value ? (matchQueue.value[0] ?? null) : null))
const matchActions = computed(() =>
  match.value?.kind === 'salary'
    ? { primary: 'Да, зарплата', secondary: 'Нет', ghost: 'Потом' }
    : { primary: 'Да, отметить', secondary: 'Нет, это другое', ghost: 'Потом' },
)
function deferMatch(c: MatchCandidate) {
  deferredMatches.value = [...deferredMatches.value, matchKey(c)]
}
/** «Да»: отметка и правило; «Да, зарплата» — сразу раскладка, как после ручного «Пришла» (B2C-21 п. 1). */
function acceptMatch(c: MatchCandidate) {
  void store.acceptMatch(c)
  if (c.kind === 'salary') void router.push(salaryAllocationPath(c.targetId as PersonId, c.period))
}

// 2. Незнакомые продавцы — по одному; чипы разделов, «Ещё N», «Кому → что», «Между своими». В разборе —
// продавцы черновика (ответ — правило до отправки, g2 «Решение — незнакомый продавец»), иначе — месяца
// (раздел задним числом).
const deferredUnknown = ref<string[]>([])
const skipUnknown = ref(false)
const unknownList = computed(() => (store.draft ? unknown.value : unknownGroups(monthOps.value)))
const unknownQueue = computed(() => (canUpload.value && !skipUnknown.value ? unknownList.value.filter((g) => !deferredUnknown.value.includes(groupKey(g))) : []))
const unknownCard = computed(() => (!store.draft && (match.value || restFirst.value) ? null : (unknownQueue.value[0] ?? null)))
const unknownTotal = computed(() => unknownList.value.length)
/** Карточка итога недели: все разделы (g2), «Не разобрано» строкой со своими продавцами месяца — «разобрать». */
const weekCardProps = computed(() => ({
  total: pic.value.total,
  tag: versusPrev.value,
  segments: weekSegments.value,
  unknown: pic.value.unknown,
  unknownShare: pic.value.unknownShare,
  rows: weekSegments.value.length,
  unknownRow:
    canUpload.value && unknownTotal.value
      ? { meta: `${unknownTotal.value} ${plural(unknownTotal.value, 'продавец', 'продавца', 'продавцов')} · разобрать`, action: true }
      : {},
}))
/** «Не разобрано · разобрать» в карточке недели: снова показать отложенные — карточка решения вверху экрана. */
function reviewUnknown() {
  skipUnknown.value = false
  deferredUnknown.value = []
  document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
}
const lastDate = (g: UnknownGroup) => {
  const last = monthOps.value
    .filter((o) => {
      const m = ruleMatchOf(o)
      return m.merchant === g.match.merchant && m.counterparty === g.match.counterparty
    })
    .map((o) => o.date)
    .sort()
    .at(-1)
  return last ? dayLabel(Number(last.slice(8, 10)), last.slice(0, 7)) : ''
}
const unknownMeta = (g: UnknownGroup) => `${g.count} раз · ${money(g.amount)}${lastDate(g) ? ` · последний — ${lastDate(g)}` : ''}`
function deferUnknown(g: UnknownGroup) {
  deferredUnknown.value = [...deferredUnknown.value, groupKey(g)]
  personFor.value = null
}

// 3. Зарплата пришла по выписке (автоотметка по правилу, «Да» без перехода) и не разложена —
// «разложить?» (возврат приёмки п. 2); «Позже» — до следующего открытия.
const allocateLater = ref(false)
const allocate = computed(() =>
  canUpload.value && !match.value && !unknownCard.value && !restFirst.value && !allocateLater.value
    ? salaryToAllocate({ ...finance.householdDoc, credits: finance.credits }, auth.slot)
    : null,
)

// 4. «Оставить подписку?» (Р-20) — по правилам keepQuestions; «Подумать» — до следующего открытия.
// Тексты и «за год» — `keepCard`, как на главном: у годовой — цена продления, «N % пути до мечты».
const deferredKeep = ref<string[]>([])
const keep = computed(() =>
  canUpload.value && !ahead.value && !restFirst.value
    ? (keepQuestions(finance.obligations).find((o) => !deferredKeep.value.includes(o.id)) ?? null)
    : null,
)
const keepText = computed(() => (keep.value ? keepCard(keep.value, finance.goals, finance.payments) : null))
const cancelling = ref(false)
function onKeep(action: 'keep' | 'cancel' | 'later') {
  const o = keep.value
  if (!o) return
  if (action === 'later') {
    deferredKeep.value = [...deferredKeep.value, o.id]
    cancelling.value = false
    return
  }
  if (action === 'cancel') {
    if (!cancelling.value) {
      cancelling.value = true
      return
    }
    finance.removeObligation(o.id)
  } else finance.keepSubscription(o.id)
  cancelling.value = false
}

// 5. «Остались деньги?» — последние дни месяца (ответ — `answeredMonthEnd` выше).
const monthEnd = computed(
  () =>
    restFirst.value || (canUpload.value && !ahead.value && !keep.value && monthEndAsk(answeredMonthEnd.value)),
)
const restAmount = ref('')
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (go && amount > 0) void router.push(`/week/salary?from=rest&amount=${amount}&period=${month}`)
}

// «Пришла зарплата <имя>?» (RP-10): ближайшая зарплата — своя, её день настал или близко (`salaryAsk`,
// как на главном). Не вместе с «разложить?»: одна карточка о зарплате за раз (возврат приёмки 2 п. 3).
// Порядок — как у `nextDecision`: после «разложить?», раньше подписки и «Остались деньги?» (они ждут
// отметки); сопоставление и разбор — раньше неё, при них кнопка тихая (правило 12: одна брендовая).
const salaryHere = computed(() =>
  auth.isViewer || allocate.value || restFirst.value
    ? null
    : salaryAsk({ people: finance.people, obligations: finance.obligations, credits: finance.credits, payments: finance.payments }, auth.slot),
)

/**
 * Решения раньше подписки и «Остались деньги?» — те ждут, пока эти не решены (порядок главного).
 */
const ahead = computed(() => !!(match.value || unknownCard.value || allocate.value || salaryHere.value))
/**
 * Главное на экране (правило 12, ревью Блока 3 Н-22) — первое по порядку экрана: сопоставление →
 * незнакомый продавец → «разложить?» → «Пришла зарплата?» → подписка → «Остались деньги?» →
 * загрузка своей выписки. Брендовая кнопка и брендовая рамка — только у него; у разбора продавца
 * ответ — чипы, брендовой кнопки на экране нет. Новое решение дописывается сюда, а не в условия.
 */
const lead = computed<'match' | 'unknown' | 'allocate' | 'salary' | 'keep' | 'monthEnd' | 'upload' | null>(() => {
  if (match.value) return 'match'
  if (unknownCard.value) return 'unknown'
  if (allocate.value) return 'allocate'
  if (salaryHere.value) return 'salary'
  if (keep.value) return 'keep'
  if (monthEnd.value) return 'monthEnd'
  return canUpload.value && !mineThisWeek.value ? 'upload' : null
})
const salaryQuiet = computed(() => lead.value !== 'salary')

/* ---------- ответы разбора ---------- */
const options = (g: UnknownGroup) => [
  { value: '', label: 'Раздел…' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
  { value: INTERNAL, label: 'Внутренний перевод — не трата' },
  ...(g.match.counterparty ? [{ value: PERSON, label: 'Кому → что…' }] : []),
]

function ruleTarget(value: string): MerchantRule['to'] | null {
  if (!value) return null
  if (value === INTERNAL) return { internal: true }
  return { categoryId: value }
}

function choose(g: UnknownGroup, value: string, retro = false) {
  if (value === PERSON) {
    personFor.value = groupKey(g)
    personText.value = ''
    return
  }
  const to = ruleTarget(value)
  if (!to) return
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
}

/** Ответ карточки незнакомого продавца: в разборе — до отправки, в неделе — задним числом. */
function answerUnknown(g: UnknownGroup, to: MerchantRule['to']) {
  if (store.draft) store.answer(g.match, to)
  else void store.recategorize(g.match, to)
}

function savePerson(g: UnknownGroup, retro = false) {
  const what = personText.value.trim()
  if (!what) return
  const to = { person: what }
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
  personFor.value = null
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  try {
    const { ok, errors } = await readStatementFiles(files)
    store.setDraft(ok, errors)
    deferredUnknown.value = []
    skipUnknown.value = false
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

    <!-- НЕДЕЛЯ -->
    <template v-else>
      <!-- Загрузка (g2 «Неделя — до загрузки»): своей выписки за неделю ещё нет или пришли из «+» -->
      <template v-if="canUpload">
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <div v-if="showUpload" ref="uploadBox">
          <Card :class="lead === 'upload' ? 'border-brand' : undefined">
            <EmptyState :title="mineThisWeek ? 'Ещё одна выписка' : 'Ваша выписка ещё не загружена'" text="PDF из приложения Kaspi или Freedom. Разбор на телефоне, файл никуда не уходит.">
              <!-- Ниже карточка решения — загрузка тихая: брендовое только у главного (`lead`) -->
              <Button :variant="lead === 'upload' || (mineThisWeek && !lead) ? 'default' : 'secondary'" :disabled="reading" @click="fileInput?.click()">
                <PhFileArrowUp :size="16" />
                {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
              </Button>
            </EmptyState>
          </Card>
        </div>
      </template>
      <Callout v-if="store.pendingCount" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>
      <Callout v-if="store.lastAutoMarked" tone="ok">Отмечено по выписке: {{ store.lastAutoMarked }} — снять можно в «Деньгах».</Callout>

      <!-- Решения по одному (DESIGN.md §5): сопоставление → незнакомый продавец → подписка → остаток месяца -->
      <DecisionCard
        v-if="match"
        :question="match.question"
        :meta="match.meta"
        :progress="matchQueue.length > 1 ? { n: 1, k: matchQueue.length } : null"
        :actions="matchActions"
        @primary="acceptMatch(match)"
        @secondary="store.declineMatch(match)"
        @ghost="deferMatch(match)"
      />
    </template>

    <!-- Незнакомый продавец — одна карточка за раз (g2 «Решение — незнакомый продавец»): в разборе — до отправки, в неделе — задним числом -->
    <DecisionCard
      v-if="unknownCard"
      :question="`${unknownCard.label} — куда отнести?`"
      :meta="unknownMeta(unknownCard)"
      :progress="unknownTotal > 1 ? { n: unknownTotal - unknownQueue.length + 1, k: unknownTotal } : null"
      :actions="{ ghost: 'Потом', secondary: unknownQueue.length > 1 ? 'Пропустить все' : undefined }"
      @ghost="deferUnknown(unknownCard)"
      @secondary="skipUnknown = true"
    >
      <CategoryChips :key="groupKey(unknownCard)" :counterparty="!!unknownCard.match.counterparty" @choose="(to) => answerUnknown(unknownCard!, to)" />
      <p class="text-[12px] text-ink-3">Ответ запомним — следующие выписки разложатся сами. Снять можно в настройках.</p>
    </DecisionCard>

    <!-- Разбор: одна брендовая «Отправить» и тихая «Отмена» (g2: «Дальше» / «Отмена») -->
    <div v-if="store.draft" class="flex flex-col gap-2 pt-1">
      <Button v-if="store.draftOps.length" size="lg" class="w-full" @click="store.send()">Отправить</Button>
      <Button variant="ghost" class="w-full" @click="store.cancelDraft()">Отмена</Button>
    </div>

    <template v-else>
      <DecisionCard
        v-if="!unknownCard && allocate"
        v-bind="allocateCard(allocate)"
        :actions="{ primary: 'Разложить', ghost: 'Позже' }"
        @primary="router.push(salaryAllocationPath(allocate.person.id, allocate.period))"
        @ghost="allocateLater = true"
      />

      <DecisionCard
        v-else-if="keep && keepText"
        :question="keepText.question"
        :meta="keepText.meta"
        :actions="cancelling ? keepText.cancel.actions : keepText.actions"
        @primary="onKeep(cancelling ? 'cancel' : 'keep')"
        @secondary="onKeep('cancel')"
        @ghost="cancelling ? (cancelling = false) : onKeep('later')"
      >
        <template #inner>{{ cancelling ? keepText.cancel.inner : keepText.inner }}</template>
      </DecisionCard>

      <DecisionCard
        v-else-if="monthEnd"
        v-bind="monthEndCard(month)"
        @primary="answerRest(true)"
        @ghost="answerRest(false)"
      >
        <template #inner>
          <NumField v-model="restAmount" placeholder="50 000" aria-label="Сколько осталось, ₸" />
        </template>
      </DecisionCard>

      <!-- Пришла зарплата? (RP-10) — вопрос о приходе, тексты решения «salary» главного; кнопка и лист «ещё» — в SalaryRow -->
      <DecisionCard v-if="salaryHere" v-bind="salaryCard(salaryHere)">
        <SalaryRow button :quiet="salaryQuiet" :person-id="salaryHere.who.id" :period="salaryHere.key" />
      </DecisionCard>

      <!-- Итог недели -->
      <!-- Итог недели (g2 «Неделя — итог»): все разделы и «Не разобрано» строкой; разделы за месяц с продавцами —
           свёрнуты внутри той же карточки (правило 12). За неделю никто не загружал — карточки итога нет (без «0 ₸»). -->
      <component
        :is="pic.uploaded.length ? WeekCard : Card"
        v-if="pic.uploaded.length || rows.length"
        v-bind="pic.uploaded.length ? weekCardProps : {}"
        @unknown="reviewUnknown"
      >
        <details v-if="rows.length" :class="pic.uploaded.length ? 'border-t border-line pt-3' : ''">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
            Разделы за {{ monthTitle(month).split(' ')[0].toLowerCase() }}
            <PhCaretDown :size="16" class="shrink-0 text-ink-3" />
          </summary>
          <div class="-mx-5 mt-2">
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-5 py-2 text-[12px] text-ink-3">
            <span>Раздел</span><span class="w-[86px] text-right">Неделя</span><span class="w-[96px] text-right">{{ monthTitle(month).split(' ')[0] }}</span>
          </div>
          <template v-for="r in rows" :key="r.categoryId">
            <button
              type="button"
              class="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 px-5 py-2 text-left text-[13.5px] cursor-pointer hover:bg-surface-2"
              @click="openCategory = openCategory === r.categoryId ? null : r.categoryId"
            >
              <span :class="r.categoryId === UNKNOWN_CATEGORY ? 'text-ink-3' : 'text-ink'">{{ categoryName(r.categoryId) }}</span>
              <span class="w-[86px] text-right num text-ink-2">{{ r.week ? money(r.week) : '—' }}</span>
              <span class="w-[96px] text-right num text-ink">{{ money(r.month) }}</span>
            </button>
            <div v-if="openCategory === r.categoryId" class="flex flex-col gap-2 border-y border-line bg-surface-2 px-5 py-3">
              <p v-if="!openGroups.length" class="text-[12.5px] text-ink-3">Здесь только ваши траты — у партнёра они в его телефоне.</p>
              <div v-for="g in openGroups" :key="groupKey(g)">
                <div class="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                  <span class="shrink-0 num text-ink-3">{{ money(g.amount) }}</span>
                </div>
                <Select v-if="canUpload" model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v, true)" />
                <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
                  <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
                  <Button size="sm" @click="savePerson(g, true)">Запомнить</Button>
                </div>
              </div>
            </div>
          </template>
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-t border-line px-5 pt-2 text-[13.5px] font-semibold">
            <span class="text-ink">Всего</span>
            <span class="w-[86px] text-right num text-ink">{{ money(totals.week) }}</span>
            <span class="w-[96px] text-right num text-ink">{{ money(totals.month) }}</span>
          </div>
          </div>
        </details>
      </component>
      <!-- Viewer, пока за неделю никто не загружал, — пустое состояние; участник видит карточку загрузки выше. -->
      <Card v-if="!pic.uploaded.length && !canUpload"><EmptyState title="Картины недели пока нет" /></Card>

      <!-- Кто уже загрузил за эту неделю (g2 «Неделя — до загрузки»: «Дана · Freedom · 1–21 сентября · 212 операций») -->
      <Card v-if="!mineThisWeek && weekUploads.length" tight>
        <div v-for="u in weekUploads" :key="u.id" class="flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
          <Avatar :id="u.slot || 'c'" :name="personName(u.slot)" :size="34" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-ink">{{ personName(u.slot) }}</span>
            <span class="block truncate type-meta">{{ BANKS[u.bank] ?? u.bank }} · {{ weekRangeLabel({ from: u.period_from, to: u.period_to }) }} · {{ u.ops_count }} {{ plural(u.ops_count, 'операция', 'операции', 'операций') }}</span>
          </span>
          <Tag tone="ok">готово</Tag>
        </div>
      </Card>

      <!-- Прошлые недели (g2): даты, чьи выписки, сумма -->
      <template v-if="pastWeeks.length">
        <Section title="Прошлые недели" />
        <Card tight>
          <div v-for="w in pastWeeks" :key="w.key" class="flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-ink">{{ w.label }}</span>
              <span v-if="w.meta" class="block type-meta">{{ w.meta }}</span>
            </span>
            <span class="money whitespace-nowrap text-ink">{{ money(w.total) }}</span>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
