<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight, PhCheck, PhListBullets, PhPlus, PhSquaresFour } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toast from '@/components/kit/Toast.vue'
import UnknownBatch from '@/components/UnknownBatch.vue'
import PlanSwitch from '@/components/plan/PlanSwitch.vue'
import SectionSheet from '@/components/week/SectionSheet.vue'
import UploadsSheet from '@/components/week/UploadsSheet.vue'
import { recentOperations, type MatchCandidate } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore, type Draft } from '@/stores/operations'
import { money, parseMoney, plain } from '@/lib/money'
import { plural } from '@/lib/utils'
import { MONTHS_NOM, addDaysIso, monthKey, parseMonthKey, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { unknownGroups } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  firstWeek,
  myWeek,
  planFromSource,
  prevWeekKey,
  decisionQueue,
  startWeek,
  weekTrend,
  weekUploads,
  type Decision,
  type MyWeekRow,
} from '@/lib/finance'
import { readMonthEnd, readWeekView, writeMonthEnd, writePlanView, writeWeekView, type WeekView } from '@/lib/storage'

/**
 * «План · Неделя» (Блок 15, Р-95…Р-102; макет week-month.html «Неделя — мои траты»): только свои цифры. Верх —
 * одна строка: кружки участников с ✓ «загрузил за неделю» (свой — лист «Мои выписки»), «⊕» загрузки, «! N»
 * вопросов (лист, по одному), вид ☰ / ▦. Ниже — моя сумма недели крупно со сравнением и ‹ › по неделям, разделы — потрачено за
 * неделю и остаток до конца месяца от своей суммы плана (список полосами или плитки с кольцом), нажатие раздела —
 * лист с продавцами и операциями; тренд 8 недель — свёрнут. Цифр партнёра нет: его траты — в «Месяце». Главное
 * действие — «+ Загрузить», пока своей выписки за неделю нет; потом главной кнопки нет (правило 12). Считает
 * `finance.ts` (`myWeek`, `sectionWeek`, `weekTrend`); файл выписки разбирается на телефоне и никуда не уходит (Р-4).
 *
 * Загрузка — «сразу готово» (Р-97): выбрал файл — неделя показывает выписку сразу, тост «Загружено N · Отменить»;
 * запись и отправка — когда тост уйдёт (`store.upload`), «Отменить» возвращает как было. Вопросы — только в листе
 * за «! N» (`decisionQueue`); зарплата и «освободится» — дела «Месяца».
 */
const auth = useAuthStore()
const finance = useFinanceStore()
const store = useOperationsStore()
const route = useRoute()
const router = useRouter()

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadButton = ref<HTMLElement | null>(null)

const people = computed(() => finance.people.filter((p) => !p.deletedAt))
/** Месяц, где «Месяц» ждёт действия, — точка на сегменте (Р-97); не этот месяц — сегмент откроет его. */
const planCall = computed(() => finance.planCall())

/* ---------- неделя: моя, листается ‹ › (Р-102) ---------- */
const month = monthKey()
const nowWeek = weekKey()
// Итоги, операции и загрузки — вместе с выпиской, которая ещё ждёт тост (`store.shown*`): «сразу готово».
const spendTotals = computed(() => store.shownTotals)
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const week = ref(startWeek(spendTotals.value, store.shownUploads, me.value, nowWeek))
// Загрузки приходят с сервера после открытия: пока неделю не листали — открываем ту, за которую есть выписка.
const turned = ref(false)
watch(
  () => store.uploads.length,
  () => {
    if (!turned.value) week.value = startWeek(spendTotals.value, store.shownUploads, me.value, nowWeek)
  },
)
const first = computed(() => firstWeek(spendTotals.value, me.value))
const canBack = computed(() => first.value !== null && week.value > first.value)
const canForward = computed(() => week.value < nowWeek)
function turn(step: -1 | 1) {
  turned.value = true
  week.value = step < 0 ? prevWeekKey(week.value) : weekKey(addDaysIso(weekRange(week.value).from, 7))
}

/** Мои траты недели — всё из `myWeek`: сумма, сравнение, разделы с остатком (одна дорога с «Месяцем»). */
const mine = computed(() => {
  const { state, ctx } = finance.planInput(month)
  return myWeek(state, { ...ctx, totals: spendTotals.value, uploads: store.shownUploads, by: me.value, week: week.value, ops: store.shown })
})
const restMonth = computed(() => MONTHS_NOM[parseMonthKey(mine.value.month).month].toLowerCase())
const hasPlan = computed(() => mine.value.rows.some((r) => r.plan !== null))
const barShare = (r: MyWeekRow) => (r.plan && r.spent !== null ? Math.max(0, Math.min(100, Math.round((r.spent / r.plan) * 100))) : 0)
const RING = 2 * Math.PI * 17
const letter = (r: MyWeekRow) => (r.categoryId === UNKNOWN_CATEGORY ? '?' : r.name.slice(0, 1).toUpperCase())

/** Строка загрузки (Р-96): кто загрузил выписку за неделю — только ✓, цифр партнёра нет. */
const uploadRows = computed(() => weekUploads(people.value, week.value, store.shownUploads))
const mineIn = computed(() => uploadRows.value.some((r) => r.person.id === me.value && r.day !== null))

/** Вид — список или плитки (Р-100), на устройстве. */
const view = ref<WeekView>(readWeekView())
function toggleView() {
  view.value = view.value === 'list' ? 'tiles' : 'list'
  writeWeekView(view.value)
}

/** Тренд 8 недель (Р-98) — свёрнут (правило 12). */
const trend = computed(() => weekTrend(spendTotals.value, spendCategories.value, me.value, week.value))
const trendMax = computed(() => Math.max(...trend.value.map((t) => t.amount)))
const trendOpen = ref(false)
const trendDay = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`

/* ---------- листы: раздел (Р-101) и «Мои выписки» (Р-102) ---------- */
const sectionFor = ref<string | null>(null)
const sectionRow = computed(() => mine.value.rows.find((r) => r.categoryId === sectionFor.value) ?? null)
const uploadsOpen = ref(false)
function pickFile() {
  uploadsOpen.value = false
  fileInput.value?.click()
}
function toMonth() {
  writePlanView('month')
  void router.replace('/month')
}

/* ---------- тост: одна фраза, у загрузки — «Отменить» (Р-97) ---------- */
const note = ref<string | null>(null)
let noteTimer: ReturnType<typeof setTimeout> | null = null
function flash(text: string, ms = 2400) {
  if (noteTimer) clearTimeout(noteTimer)
  note.value = text
  noteTimer = setTimeout(() => (note.value = null), ms)
}
const heldText = computed(() => {
  const n = store.draftOps.length
  const known = store.draftOps.filter((o) => o.id in store.ops).length
  const what = `${n} ${plural(n, 'операция', 'операции', 'операций')}`
  return n > 0 && known === n ? `Эти ${what} уже были` : `Загружено ${what}`
})
function undo() {
  store.undoUpload()
  flash('Отменено', 1600)
}
// Платежи, которые выписка отметила сама (Р-6, Р-94), — коротким тостом после отправки.
watch(
  () => store.lastAutoMarked,
  (n) => {
    if (n > 0) flash(`Отмечено по выписке: ${n}`)
  },
)

/* ---------- загрузка: «сразу готово» ---------- */
/** Файлы, которые не удалось прочитать, — тихим листом, без главной кнопки. */
const readErrors = ref<Draft['errors']>([])
async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  try {
    const { ok, errors } = await readStatementFiles(files)
    readErrors.value = errors
    if (ok.length) {
      note.value = null
      await store.upload(ok)
      // Показать неделю, которой кончается выписка (не дальше текущей).
      const last = weekKey(ok.map((f) => f.parsed.to).sort().at(-1)!)
      turned.value = true
      week.value = last < nowWeek ? last : nowWeek
    }
    // Пришли из «+» — после выбора файла адрес обычный.
    if (route.query.upload === '1') void router.replace('/week')
  } finally {
    reading.value = false
    input.value = ''
  }
}
// Ушли с экрана или скрыли вкладку — ждать тост некому: выписка отправляется сразу.
const onHide = () => {
  if (document.visibilityState === 'hidden') void store.commitUpload()
}

/* ---------- вопросы — в листе за «! N» (Р-97), по одному ---------- */
// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве (раскладку остатка семьи проверяет очередь).
const answeredLocal = ref<string | null>(readMonthEnd())

// Незнакомые продавцы — пачкой (Р-58) по своим операциям этого и прошлого месяца: раздел — задним числом.
const unknownList = computed(() => unknownGroups(recentOperations(store.all)))

/**
 * Очередь вопросов (`decisionQueue`): сопоставление → продавцы пачкой → подписка → «остались деньги?»; в листе —
 * первое неотложенное. «Потом» / «Позже» / «Подумать» — до следующего открытия экрана.
 */
const deferred = ref<string[]>([])
const queue = computed(() =>
  decisionQueue(finance.planInput(month).state, {
    canEdit: canUpload.value,
    matches: store.pendingMatches,
    unknown: unknownList.value,
    answeredMonthEnd: answeredLocal.value,
  }).filter((d) => !deferred.value.includes(d.key)),
)
const decision = computed(() => queue.value[0] ?? null)
const defer = (d: Decision) => {
  deferred.value = [...deferred.value, d.key]
  cancelling.value = false
}
/** Вопросы кончились — лист закрывается сам. */
const questionsOpen = ref(false)
watch(
  () => queue.value.length,
  (n) => {
    if (!n) questionsOpen.value = false
  },
)

// «N из M»: M — все вопросы, что были в очереди с открытия экрана, — не тает при ответе; новые её увеличивают.
// N — сколько позади + 1.
const seen = ref<string[]>([])
watch(
  () => queue.value.map((d) => d.key),
  (keys) => (seen.value = [...seen.value, ...keys.filter((k) => !seen.value.includes(k))]),
  { immediate: true },
)
const progress = computed(() => (seen.value.length > 1 ? { n: seen.value.length - queue.value.length + 1, k: seen.value.length } : null))

/** «Да»: отметка и правило «это платёж по …». */
function acceptMatch(c: MatchCandidate) {
  void store.acceptMatch(c)
}

/** Ответ пачке — всем отмеченным разом, задним числом одной отправкой. */
function answerBatch(matches: MerchantRule['match'][], to: MerchantRule['to']) {
  void store.recategorizeAll(matches, to)
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

/**
 * «Остались деньги?» (Р-86): сумма — разово по очереди целей сверху вниз (`planFromSource`), запись своим
 * источником (`rest`); отдельного экрана нет. Класть некуда — ответ просто записан.
 */
const restAmount = ref('')
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (!go || amount <= 0 || !auth.slot) return
  const { state, ctx } = finance.planInput(month)
  const src = planFromSource(state, { ...ctx, rawCredits: finance.householdDoc.credits }, { from: 'rest', amount, period: month })
  // Остаток месяца уже отложен (партнёр ответил раньше) — второй раз не пишется и «Отложено» не показывается.
  if (!src || src.mode !== 'once' || src.recorded) return
  finance.applyPlan(src, { by: auth.slot, note: 'остаток месяца' })
  flash(`Отложено ${money(src.put)}`)
}

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
}
function onSecondary(d: Decision) {
  if (d.kind === 'match' && d.match) void store.declineMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, 'cancel')
}
function onGhost(d: Decision) {
  if (d.kind === 'keep' && cancelling.value) cancelling.value = false
  else if (d.kind === 'monthEnd') answerRest(false)
  else defer(d)
}

onMounted(() => {
  void store.loadUploads()
  void store.pull()
  document.addEventListener('visibilitychange', onHide)
  // «Загрузить выписку» из листа «+» (`/week?upload=1`, B2C-13): окно выбора файла браузер
  // открывает только по нажатию — ставим фокус на «⊕».
  if (route.query.upload === '1') uploadButton.value?.focus()
})
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide)
  if (noteTimer) clearTimeout(noteTimer)
  void store.commitUpload()
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <PlanSwitch view="week" :dot="planCall !== null" :month="planCall !== month ? planCall : null" />
    <p v-if="auth.isDemo" class="px-1 text-[12px] text-ink-3">демо: только на этом телефоне</p>
    <input v-if="canUpload" ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
    <Callout v-if="store.pendingCount && !store.held" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>

    <!-- Строка загрузки (Р-96): кружки с ✓ · ⊕ · «! N» · вид -->
    <div class="flex items-center gap-2.5" data-week-strip>
      <template v-for="r in uploadRows" :key="r.person.id">
        <button
          v-if="r.person.id === me"
          type="button"
          class="press relative shrink-0 cursor-pointer rounded-full"
          aria-label="Мои выписки"
          :data-uploaded="r.day !== null"
          data-my-uploads
          @click="uploadsOpen = true"
        >
          <Avatar :id="r.person.id" :name="r.person.name" :size="34" :class="r.day === null && 'opacity-35'" />
          <span v-if="r.day !== null" class="absolute -bottom-[3px] -right-[3px] grid size-4 place-items-center rounded-full border-2 border-canvas bg-ok text-surface" aria-hidden="true">
            <PhCheck :size="9" weight="bold" />
          </span>
        </button>
        <span v-else class="relative shrink-0" :title="r.person.name" :data-uploaded="r.day !== null" :data-partner="r.person.id">
          <Avatar :id="r.person.id" :name="r.person.name" :size="34" :class="r.day === null && 'opacity-35'" />
          <span v-if="r.day !== null" class="absolute -bottom-[3px] -right-[3px] grid size-4 place-items-center rounded-full border-2 border-canvas bg-ok text-surface" aria-hidden="true">
            <PhCheck :size="9" weight="bold" />
          </span>
        </span>
      </template>
      <template v-if="canUpload">
        <button
          v-if="!mineIn"
          ref="uploadButton"
          type="button"
          class="press flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill bg-brand text-brand-ink px-4 text-[15px] font-bold disabled:opacity-50"
          :disabled="reading"
          data-upload="lead"
          @click="fileInput?.click()"
        >
          <PhPlus :size="16" weight="bold" />{{ reading ? 'Читаем…' : 'Загрузить' }}
        </button>
        <button
          v-else
          ref="uploadButton"
          type="button"
          class="press grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full border-2 border-dashed border-ink-3 text-ink-2 disabled:opacity-50"
          aria-label="Загрузить выписку"
          :disabled="reading"
          data-upload="quiet"
          @click="fileInput?.click()"
        >
          <PhPlus :size="16" weight="bold" />
        </button>
      </template>
      <button
        v-if="queue.length"
        type="button"
        class="press ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-pill bg-ok-soft px-[11px] py-1.5 text-[14px] font-bold text-ok num"
        :aria-label="`Вопросы: ${queue.length}`"
        data-bang
        @click="questionsOpen = true"
      >
        <span class="grid size-[18px] place-items-center rounded-full bg-ok text-[12px] text-surface" aria-hidden="true">!</span>{{ queue.length }}
      </button>
      <span v-else class="ml-auto" />
      <button
        type="button"
        class="press grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-[10px] bg-surface-2 text-ink-2"
        :aria-label="view === 'list' ? 'Плитками' : 'Списком'"
        data-view-toggle
        @click="toggleView"
      >
        <PhSquaresFour v-if="view === 'list'" :size="18" />
        <PhListBullets v-else :size="18" />
      </button>
    </div>

    <!-- Сумма недели: моя, крупно; сравнение с прошлой; ‹ › — недели -->
    <component :is="view === 'list' ? Card : 'div'" :tight="view === 'list' ? true : undefined" class="flex flex-col gap-1" :class="view === 'tiles' && 'px-1 pb-0.5 pt-1'" data-week-sum>
      <div class="flex items-center gap-1.5">
        <button type="button" class="press -ml-1.5 grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canBack" aria-label="Прошлая неделя" @click="turn(-1)">
          <PhCaretLeft :size="16" />
        </button>
        <span class="type-section" data-week-label>{{ weekRangeLabel(mine.range) }}</span>
        <button type="button" class="press grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canForward" aria-label="Следующая неделя" @click="turn(1)">
          <PhCaretRight :size="16" />
        </button>
      </div>
      <div class="flex flex-wrap items-baseline gap-2.5">
        <span class="font-num text-[40px] font-bold leading-none num" :class="mine.total ? 'text-ink' : 'text-ink-3'" data-week-total>{{ money(mine.total) }}</span>
        <span
          v-if="mine.total && mine.pct !== null && mine.delta !== 0"
          class="whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[12.5px] font-bold num"
          :class="mine.delta > 0 ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'"
          data-week-delta
        >
          {{ mine.delta > 0 ? '↑' : '↓' }} {{ mine.pct }}%
        </span>
      </div>
      <span v-if="view === 'list' && mine.prev > 0" class="type-meta num" data-week-prev>прошлая неделя — {{ money(mine.prev) }}</span>
      <div v-if="!hasPlan && mine.rows.length" class="pt-1">
        <Button variant="secondary" size="sm" data-to-plan @click="toMonth">План трат — в «Месяце» ›</Button>
      </div>
    </component>

    <!-- Разделы списком: потрачено за неделю, полоса и остаток до конца месяца -->
    <Card v-if="view === 'list' && mine.rows.length" flush class="px-3.5 py-0.5" data-week-list>
      <button
        v-for="r in mine.rows"
        :key="r.categoryId"
        type="button"
        class="press flex w-full cursor-pointer flex-col gap-1.5 border-t border-line py-3 text-left first:border-t-0"
        :data-row="r.categoryId"
        @click="sectionFor = r.categoryId"
      >
        <span class="flex items-center gap-2.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">{{ letter(r) }}</span>
          <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ r.name }}</span>
          <span class="w-4 text-center text-[12px] font-extrabold" :class="r.arrow === 'up' ? 'text-warn' : 'text-ok'" :data-arrow="r.arrow ?? ''" aria-hidden="true">
            {{ r.arrow === 'up' ? '↑' : r.arrow === 'down' ? '↓' : '' }}
          </span>
          <span class="font-num text-[16px] font-bold num text-ink" data-amount>{{ plain(r.amount) }}</span>
        </span>
        <template v-if="r.plan !== null && r.rest !== null">
          <span class="ml-[42px] block h-1.5 overflow-hidden rounded-pill bg-track">
            <i class="block h-full rounded-pill" :style="{ width: `${barShare(r)}%`, background: r.low ? 'var(--warn)' : r.color }" />
          </span>
          <span class="ml-[42px] text-[12.5px] text-ink-3 num" data-rest>
            <template v-if="r.rest >= 0">на {{ restMonth }} осталось <b class="font-semibold" :class="r.low ? 'text-warn' : 'text-ink-2'">{{ plain(r.rest) }}</b> из {{ plain(r.plan) }}</template>
            <template v-else>на {{ restMonth }} сверх плана <b class="font-semibold text-warn">{{ plain(-r.rest) }}</b></template>
          </span>
        </template>
        <span v-else-if="hasPlan && r.categoryId !== UNKNOWN_CATEGORY" class="ml-[42px] text-[12.5px] text-ink-3" data-rest>вне плана</span>
      </button>
    </Card>

    <!-- Разделы плитками: кольцо — сколько потрачено от плана месяца -->
    <div v-else-if="view === 'tiles' && mine.rows.length" class="grid grid-cols-2 gap-2.5" data-week-tiles>
      <button
        v-for="r in mine.rows"
        :key="r.categoryId"
        type="button"
        class="press flex min-w-0 cursor-pointer flex-col gap-2 rounded-[22px] border border-card-border bg-surface p-3.5 text-left"
        :data-row="r.categoryId"
        @click="sectionFor = r.categoryId"
      >
        <span class="flex h-11 w-full items-center justify-between">
          <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">{{ letter(r) }}</span>
          <svg v-if="r.plan !== null" class="size-11" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="17" fill="none" stroke="var(--track)" stroke-width="6" />
            <circle
              cx="22"
              cy="22"
              r="17"
              fill="none"
              :stroke="r.low ? 'var(--warn)' : r.color"
              stroke-width="6"
              stroke-linecap="round"
              :stroke-dasharray="`${((RING * barShare(r)) / 100).toFixed(1)} ${RING.toFixed(1)}`"
              transform="rotate(-90 22 22)"
            />
          </svg>
        </span>
        <span class="font-num text-[22px] font-bold leading-none num text-ink" data-amount>{{ plain(r.amount) }}</span>
        <span class="text-[12px] text-ink-3 num">
          {{ r.name }}<span v-if="r.arrow === 'up' || r.arrow === 'down'" :class="r.arrow === 'up' ? 'text-warn' : 'text-ok'"> · {{ r.arrow === 'up' ? '↑' : '↓' }}</span>
          <span v-if="r.plan !== null && r.rest !== null" :class="r.low && 'text-warn'" data-rest> · {{ r.rest >= 0 ? `ост. ${plain(r.rest)}` : `сверх ${plain(-r.rest)}` }}</span>
          <span v-else-if="hasPlan && r.categoryId !== UNKNOWN_CATEGORY" data-rest> · вне плана</span>
        </span>
      </button>
    </div>

    <!-- Тренд 8 недель — свёрнут -->
    <div v-if="trendMax > 0" data-week-trend>
      <button
        type="button"
        class="press flex w-full cursor-pointer items-center justify-between bg-surface px-4 py-3.5 text-left text-[15px] font-semibold text-ink-2"
        :class="trendOpen ? 'rounded-t-[20px]' : 'rounded-[20px]'"
        :aria-expanded="trendOpen"
        @click="trendOpen = !trendOpen"
      >
        <span>8 недель</span>
        <PhCaretRight :size="15" class="text-ink-3 transition-transform" :class="trendOpen && 'rotate-90'" />
      </button>
      <div v-if="trendOpen" class="flex h-[110px] items-end gap-[7px] rounded-b-[20px] bg-surface px-4 pb-3.5 pt-1" data-trend-bars>
        <div v-for="(t, i) in trend" :key="t.week" class="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <em v-if="t.amount > 0 && (i === trend.length - 1 || t.amount === trendMax)" class="text-[10px] not-italic text-ink-3 num">{{ Math.round(t.amount / 1000) }}к</em>
          <i class="block w-full rounded-b-[3px] rounded-t-[6px]" :class="i === trend.length - 1 ? 'bg-brand' : 'bg-surface-3'" :style="{ height: `${Math.round((t.amount / trendMax) * 70)}%` }" />
          <span class="text-[10.5px] text-ink-3 num">{{ trendDay(t.from) }}</span>
        </div>
      </div>
    </div>

    <!-- Вопросы — за «! N» (Р-97): по одному, «N из M», «Потом» откладывает -->
    <Sheet :open="questionsOpen && !!decision" title="Вопросы" @close="questionsOpen = false">
      <!-- незнакомые продавцы — пачкой (Р-58) -->
      <UnknownBatch v-if="decision?.kind === 'unknownBatch'" bare :groups="decision.groups ?? []" :progress="progress" @answer="answerBatch" @later="defer(decision!)" />
      <DecisionCard
        v-else-if="decision"
        :key="decision.key"
        bare
        :question="decision.question"
        :meta="decision.meta"
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
      </DecisionCard>
    </Sheet>

    <!-- Не прочитанные файлы — тихо, без главной кнопки -->
    <Sheet :open="readErrors.length > 0" title="Не прочитано" @close="readErrors = []">
      <div v-for="e in readErrors" :key="e.name" class="border-t border-line py-2.5 first:border-t-0 first:pt-0" role="alert" data-read-error>
        <p class="truncate text-[15px] font-semibold text-ink">{{ e.name }}</p>
        <p class="text-[13.5px] text-ink-2">{{ e.message }}</p>
        <p v-if="e.detail" class="mt-1 break-all text-[11.5px] text-ink-3">{{ e.detail }}</p>
      </div>
    </Sheet>

    <SectionSheet :row="sectionRow" :week="week" :month-name="restMonth" @close="sectionFor = null" />
    <UploadsSheet :open="uploadsOpen" :me="me" :busy="reading" @close="uploadsOpen = false" @upload="pickFile" />

    <!-- «Сразу готово» (Р-97): тост с «Отменить», пока выписка не отправлена; иначе — короткая фраза -->
    <Toast v-if="store.held" action="Отменить" @action="undo">{{ heldText }}</Toast>
    <Toast v-else-if="note">{{ note }}</Toast>
  </div>
</template>
