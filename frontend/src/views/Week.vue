<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight, PhCheck, PhClock, PhPlus } from '@phosphor-icons/vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toast from '@/components/kit/Toast.vue'
import Tip from '@/components/kit/Tip.vue'
import { useFlash } from '@/components/kit/useFlash'
import UnknownBatch from '@/components/UnknownBatch.vue'
import PlanSwitch from '@/components/plan/PlanSwitch.vue'
import SectionSheet from '@/components/week/SectionSheet.vue'
import UploadsSheet from '@/components/week/UploadsSheet.vue'
import HandSpendSheet from '@/components/week/HandSpendSheet.vue'
import NoteSheet from '@/components/week/NoteSheet.vue'
import { useQuerySheet } from '@/components/useQuerySheet'
import WeekFeedSheet from '@/components/week/WeekFeedSheet.vue'
import OpSheet from '@/components/OpSheet.vue'
import ApplePayWeekLine from '@/components/applepay/ApplePayWeekLine.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import { arrivalNote } from '@/components/useSalaryTap'
import type { MatchCandidate } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore, type Draft } from '@/stores/operations'
import { money, parseMoney, plain } from '@/lib/money'
import { plural } from '@/lib/utils'
import { MONTHS_NOM, addDaysIso, dayLabel, monthKey, parseMonthKey, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { unknownGroups } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  firstWeek,
  lastAccountFor,
  myWeek,
  periodMonth,
  planFromSource,
  prevWeekKey,
  decisionQueue,
  salaryOf,
  startWeek,
  weekTrend,
  weekFeed,
  weekUploads,
  type Decision,
  type MyWeekRow,
} from '@/lib/finance'
import { START_ANSWERED_KEY, readDeferred, readMonthEnd, readStorage, writeDeferred, writeMonthEnd, writeStorage } from '@/lib/storage'
import { detectIncome } from '@/lib/statements/firstRun'
import { useIncomeAnswer } from '@/components/useIncomeAnswer'

/**
 * «План · Неделя» (Блок 15, Р-95…Р-102; вид — Блок 5 «Фидбек», Р-30…Р-31, Figma «Неделя · Б» `18:3`): только свои цифры.
 * Шапка в два яруса: слева ‹неделя› и моя сумма крупно, справа кружки выписок 26 px (загрузил за неделю — полный цвет;
 * свой — лист «Мои выписки») и загрузка — маленькая брендовая «Загрузить», пока своей выписки за неделю нет, потом «+».
 * Под шапкой — полоса плана недели (план месяца × 7 / дней, Р-31) с одной подписью «осталось N / M»; без плана трат —
 * ни полосы, ни призыва (призыв к плану — точка на «Месяце», FB-21). Разделы — значок, имя, сумма за неделю, без полос
 * (остаток раздела на месяц — в листе раздела); строка «Не разобрано» с вопросами — сама кнопка в лист «Вопросы» (по
 * одному). Между полосой и разделами — карточки заметок себе на эту неделю (Р-33, FB-20: личный документ, ✓ — сделано,
 * нажатие — правка; из «+ → Заметка», `/week?note=1`). Лента «Траты недели» и тренд 8 недель — свёрнуты. Цифр партнёра
 * нет: его траты — в «Месяце». Считает
 * `finance.ts` (`myWeek`, `sectionWeek`, `weekTrend`); файл выписки разбирается на телефоне и никуда не уходит (Р-4).
 *
 * Загрузка — «сразу готово» (Р-97): выбрал файл — неделя показывает выписку сразу, тост «Загружено N · Отменить»;
 * запись и отправка — когда тост уйдёт (`store.upload`), «Отменить» возвращает как было. Вопросы — только в листе
 * за «! N» (`decisionQueue`); зарплата и «освободится» — дела «Месяца».
 */
const auth = useAuthStore()
const ai = useAiStore()
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
/** «Поставить план» ждёт в «Месяце» (Р-36) — точка на сегменте. */
const planFactCall = computed(() => finance.planFactCall())

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
/** Заполнение полосы плана недели (Р-31): доля потраченного от плана недели, не больше 100. */
const planShare = computed(() => (mine.value.plan ? Math.max(0, Math.min(100, Math.round((mine.value.total / mine.value.plan) * 100))) : 0))
// Строка «Не разобрано» есть — она и ведёт в «Вопросы»; нет — у вопросов своя строка.
const hasUnknownRow = computed(() => mine.value.rows.some((r) => r.categoryId === UNKNOWN_CATEGORY))
const letter = (r: MyWeekRow) => (r.categoryId === UNKNOWN_CATEGORY ? '?' : r.name.slice(0, 1).toUpperCase())

/** Строка загрузки (Р-96): кто загрузил выписку за неделю — только ✓, цифр партнёра нет. */
const uploadRows = computed(() => weekUploads(people.value, week.value, store.shownUploads))
const mineIn = computed(() => uploadRows.value.some((r) => r.person.id === me.value && r.day !== null))
/**
 * Подсказка у суммы недели (бэклог «первый» Р-7; слова — владелец на `/ux`, Р-9) — когда есть разделы с тратами: пустую неделю
 * ведёт брендовое «Загрузить» (FR-06 п. 2), и «Понятно» на ней не должно съесть подсказку про разделы. Viewer «Неделю»
 * не видит (гард → «Месяц»).
 */
const TIP_WEEK = 'Нажмите на раздел, чтобы посмотреть, на что ушли деньги'

/** Тренд 8 недель (Р-98) — свёрнут (правило 12). */
const trend = computed(() => weekTrend(spendTotals.value, spendCategories.value, me.value, week.value))
const trendMax = computed(() => Math.max(...trend.value.map((t) => t.amount)))
const trendOpen = ref(false)
const trendDay = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`

/**
 * Лента трат недели (бэклог «Лента недели», Р-1): тихая строка «Траты недели · N» под разделами → лист по дням. Отбор —
 * тот же, что у суммы недели (`weekFeed`: отмеченные платежи — не траты).
 */
const feed = computed(() => {
  const { marked, categories } = store.totalMarks(store.shown)
  return weekFeed(store.shown, { week: week.value, marked, categories })
})
const feedOpen = ref(false)

/* ---------- листы: раздел (Р-101) и «Мои выписки» (Р-102) ---------- */
const sectionFor = ref<string | null>(null)
/** Операция из листа раздела — лист операции поверх (FB-04). */
const sectionOp = ref<string | null>(null)
const sectionRow = computed(() => mine.value.rows.find((r) => r.categoryId === sectionFor.value) ?? null)
const uploadsOpen = ref(false)

/*
 * «Трата» руками (бэклог «Ручная трата», Р-1): из «+» — `/week?spend=1`; правка — нажатие своей ручной траты в листе
 * раздела или в ленте «Траты недели» (лист уступает место). Сохранили — неделя этой траты на экране.
 */
const { open: spendOpen, close: closeSpend } = useQuerySheet('spend')
const handEdit = ref<string | null>(null)
function editHand(id: string) {
  sectionFor.value = null
  feedOpen.value = false
  handEdit.value = id
}
function closeHand() {
  handEdit.value = null
  closeSpend()
}
function onHandSaved(date: string) {
  turned.value = true
  week.value = weekKey(date)
}
function pickFile() {
  uploadsOpen.value = false
  fileInput.value?.click()
}

/*
 * Заметка себе с датой (Блок 5 «Фидбек», Р-33, Figma `18:36`): из «+» — `/week?note=1`; карточки — свои заметки с датой
 * на этой неделе (сделанные — до конца недели, приглушённо), по дате и времени правки; ✓ — сделано, нажатие — правка.
 * Личный документ: партнёр и viewer не видят. Сохранили — неделя даты на экране.
 */
const { open: noteOpen, close: closeNote } = useQuerySheet('note')
const noteEdit = ref<string | null>(null)
const weekNotes = computed(() =>
  canUpload.value
    ? finance.notes
        .filter((n) => weekKey(n.date) === week.value)
        .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt))
    : [],
)
const noteMeta = (n: { date: string; amount?: number | null }) => {
  const day = dayLabel(Number(n.date.slice(8, 10)), n.date.slice(0, 7))
  return n.amount ? `${day} · ${plain(n.amount)}` : day
}
function closeNoteSheet() {
  noteEdit.value = null
  closeNote()
}

/* ---------- тост: одна фраза, у загрузки — «Отменить» (Р-97) ---------- */
const { note, flash } = useFlash(2400)
const heldText = computed(() => {
  const n = store.draftOps.length
  const known = store.draftOps.filter((o) => o.id in store.ops).length
  const what = `${n} ${plural(n, 'операция', 'операции', 'операций')}`
  return n > 0 && known === n ? `Эти ${what} уже были` : `Загружено ${what}`
})
/** Неделя до загрузки — «Отменить» возвращает и её (ревью frontend Б15, Н-6). */
let beforeUpload: { week: string; turned: boolean } | null = null
function undo() {
  const held = store.held
  store.undoUpload()
  if (held && beforeUpload) {
    week.value = beforeUpload.week
    turned.value = beforeUpload.turned
    beforeUpload = null
  }
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
      beforeUpload = { week: week.value, turned: turned.value }
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

/**
 * Незнакомые продавцы — пачкой (Р-58), раздел задним числом — только по своим операциям выбранной недели (бэклог «Лента
 * недели», Р-2): «Не разобрано · N вопросов», сумма пачки и «Разобрать» сходятся со строкой «Не разобрано» этой недели.
 * Старые — в своих неделях (‹) и в «Месяце». Выписка, что ждёт тост, — в строке сразу, а вопросы о ней — после отправки
 * (Р-97), поэтому `store.all`, а не `store.shown`.
 */
const unknownList = computed(() => unknownGroups(store.all.filter((o) => weekKey(o.date) === week.value)))

/**
 * Очередь вопросов (`decisionQueue`): сопоставление → продавцы пачкой → подписка → «остались деньги?»; в листе —
 * первое неотложенное. «Потом» / «Позже» / «Подумать» — сутки на этом устройстве (FB-01, Р-15 а: раньше — до следующего
 * открытия экрана, и тот же вопрос вставал при каждом заходе). Пачка недели отложена вместе со своими продавцами: новый
 * продавец в ней возвращает пачку раньше суток.
 */
const deferred = ref<Record<string, string>>(readDeferred())
const groupKey = (g: { match: MerchantRule['match'] }) => `unknownGroup:${week.value}:${JSON.stringify(g.match)}`
const isDeferred = (d: Decision) => d.key in deferred.value && (d.kind !== 'unknownBatch' || (d.groups ?? []).every((g) => groupKey(g) in deferred.value))

/*
 * «Это ваш доход?» (Блок 5 «Фидбек», Р-35; раньше — вопрос первого запуска): пока у меня оклад 0 и в своих операциях есть
 * кандидат (`detectIncome`), ключ не отвечен («Нет» — на устройстве, `START_ANSWERED_KEY`, как было) и не отложен —
 * первым в очереди. «Да» делает то же, что делал первый запуск (`useIncomeAnswer`): оклад, день / ритм, правило
 * зарплаты, отметки месяцев; оклад поставлен — вопрос исчезает, «Месяц» получает доход.
 */
const answered = ref<string[]>(readStorage<string[]>(START_ANSWERED_KEY, []))
function markAnswered(key: string) {
  if (!answered.value.includes(key)) answered.value = [...answered.value, key]
  writeStorage(START_ANSWERED_KEY, answered.value)
}
const incomeCandidate = computed(() => {
  if (!canUpload.value || (finance.people.find((p) => p.id === me.value)?.salary ?? 0) > 0) return null
  const c = detectIncome(store.all)[0] ?? null
  return c && !answered.value.includes(`income:${c.key}`) ? c : null
})
const income = useIncomeAnswer()
const queue = computed(() =>
  decisionQueue(finance.planInput(month).state, {
    canEdit: canUpload.value,
    matches: store.pendingMatches,
    unknown: unknownList.value,
    answeredMonthEnd: answeredLocal.value,
    week: week.value,
    income: incomeCandidate.value,
  }).filter((d) => !isDeferred(d)),
)
const decision = computed(() => queue.value[0] ?? null)
// Поля «Это ваш доход?» — от кандидата при смене вопроса (не при каждом пересборе очереди).
watch(
  () => (decision.value?.kind === 'income' ? decision.value.key : null),
  () => income.setCandidate(decision.value?.income),
  { immediate: true },
)
const defer = (d: Decision) => {
  deferred.value = writeDeferred([d.key, ...(d.groups ?? []).map(groupKey)])
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

/**
 * Первая зарплата пушем (владелец 2026-10-19, хвост критика возврата): «Да, зарплата» по приходу из пуша, а прошлой
 * отметки зарплаты нет — лист отметки с суммой прихода, как первая «Пришла» (`useSalaryTap`): счёт спросить один раз,
 * дальше — на счёт прошлой зарплаты. Иначе «Да» молча «не зачисляла», и каждая следующая «Пришла» тоже. Тенговая
 * только, как точка «Пришла»: валютная приходит на валютный счёт (Р-73).
 */
const firstSalary = ref<{ c: MatchCandidate; amount: number; note: string; title: string } | null>(null)

/** «Да»: отметка и правило «это платёж по …». */
function acceptMatch(c: MatchCandidate) {
  const op = store.ops[c.opId]
  const person = c.kind === 'salary' && op?.source === 'push' ? people.value.find((p) => p.id === c.targetId) : undefined
  if (op && person && salaryOf(person, periodMonth(c.period)).currency === 'KZT' && lastAccountFor(finance.payments, c.targetId, finance.accounts) === undefined) {
    firstSalary.value = { c, amount: Math.abs(op.amount), note: arrivalNote(op), title: `Зарплата · ${person.name}` }
    return
  }
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
  if (d.kind === 'income' && d.income) {
    if (income.answer(d.income)) markAnswered(d.key)
  } else if (d.kind === 'match' && d.match) acceptMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, cancelling.value ? 'cancel' : 'keep')
  else if (d.kind === 'monthEnd') answerRest(true)
}
function onSecondary(d: Decision) {
  if (d.kind === 'income') markAnswered(d.key)
  else if (d.kind === 'match' && d.match) void store.declineMatch(d.match)
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
  void store.commitUpload()
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!--
      Точка на «Месяце»: новый разбор (ведёт в его месяц, где ✦ — приёмка Блока 3 «ИИ-польза»; открыл — снова `planCall`)
      или «Поставить план» по неделям ждёт в строке «Траты» (Блок 5 «Фидбек», Р-36).
    -->
    <PlanSwitch view="week" :month="planCall !== null && planCall !== month && !ai.reviewUnseen ? planCall : null" :dot="ai.reviewUnseen || planFactCall !== null" />
    <input v-if="canUpload" ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
    <Callout v-if="store.pendingCount && !store.held" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>

    <!--
      Шапка в два яруса (FB-19, Р-30, Figma `18:11`): слева ‹неделя› и моя сумма крупно, справа кружки выписок 26 px
      (загрузил за неделю — полный цвет, нет — бледный; свой — лист «Мои выписки») и загрузка: своей выписки за неделю
      нет — маленькая брендовая «Загрузить» (главное действие), есть — кружок «+». Сравнение с прошлой — в «8 недель».
    -->
    <Card tight class="flex items-start justify-between gap-3" data-week-head>
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <button type="button" class="press -ml-1.5 grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canBack" aria-label="Прошлая неделя" @click="turn(-1)">
            <PhCaretLeft :size="16" />
          </button>
          <span class="type-section" data-week-label>{{ weekRangeLabel(mine.range) }}</span>
          <button type="button" class="press grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canForward" aria-label="Следующая неделя" @click="turn(1)">
            <PhCaretRight :size="16" />
          </button>
        </div>
        <span class="font-num text-[34px] font-bold leading-none num" :class="mine.total ? 'text-ink' : 'text-ink-2'" data-week-total>{{ money(mine.total) }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-2 pt-1" data-week-strip>
        <div class="flex items-center">
          <template v-for="(r, i) in uploadRows" :key="r.person.id">
            <button
              v-if="r.person.id === me"
              type="button"
              class="press relative shrink-0 cursor-pointer rounded-full"
              :class="i > 0 && '-ml-2'"
              aria-label="Мои выписки"
              :data-uploaded="r.day !== null"
              data-my-uploads
              @click="uploadsOpen = true"
            >
              <Avatar :id="r.person.id" :name="r.person.name" :size="26" :class="r.day === null && 'opacity-35'" />
            </button>
            <span v-else class="relative shrink-0 rounded-full" :class="i > 0 && '-ml-2'" :title="r.person.name" :data-uploaded="r.day !== null" :data-partner="r.person.id">
              <Avatar :id="r.person.id" :name="r.person.name" :size="26" :class="r.day === null && 'opacity-35'" />
            </span>
          </template>
        </div>
        <template v-if="canUpload">
          <!-- Кнопка `xs` (26/12.5) своим элементом: фокус из «+» (`?upload=1`) ставится на DOM-узел. -->
          <button
            v-if="!mineIn"
            ref="uploadButton"
            type="button"
            class="press flex h-[26px] shrink-0 cursor-pointer items-center rounded-pill bg-brand text-brand-ink px-2.5 text-[12.5px] font-semibold disabled:opacity-50"
            :disabled="reading"
            data-upload="lead"
            @click="fileInput?.click()"
          >
            {{ reading ? 'Читаем…' : 'Загрузить' }}
          </button>
          <button
            v-else
            ref="uploadButton"
            type="button"
            class="press grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-full border-2 border-dashed border-ink-3 text-ink-2 disabled:opacity-50"
            aria-label="Загрузить выписку"
            :disabled="reading"
            data-upload="quiet"
            @click="fileInput?.click()"
          >
            <PhPlus :size="14" weight="bold" />
          </button>
        </template>
      </div>
    </Card>
    <!-- Apple Pay (AP-06, Р-6): тихая строка под шапкой — iPhone, пока не подключено. -->
    <ApplePayWeekLine />

    <!--
      Полоса плана недели (Р-31, Figma `18:29`) — только при плане трат: заполнение — доля потраченного, брендовая;
      сверх плана — `--warn`; одна подпись «осталось N / M». Без плана — ничего (призыв к плану — точка на «Месяце», FB-21).
    -->
    <div v-if="mine.plan !== null && mine.rest !== null" class="flex flex-col gap-1 px-1" data-week-plan>
      <span class="block h-2 overflow-hidden rounded-pill bg-track">
        <i class="block h-full rounded-pill" :class="mine.rest < 0 ? 'bg-warn' : 'bg-brand'" :style="{ width: `${planShare}%` }" />
      </span>
      <span class="self-end text-[12.5px] num" :class="mine.rest < 0 ? 'text-warn' : 'text-ink-2'" data-week-rest>
        <template v-if="mine.rest >= 0">осталось <b class="font-semibold text-ink">{{ plain(mine.rest) }}</b> / {{ plain(mine.plan) }}</template>
        <template v-else>сверх плана <b class="font-semibold">{{ plain(-mine.rest) }}</b> / {{ plain(mine.plan) }}</template>
      </span>
    </div>

    <!-- Заметки себе на этой неделе (Р-33): карточка — текст, «12 ноября · 60 000», ✓ справа; нажатие строки — правка -->
    <Card v-for="n in weekNotes" :key="n.id" tight class="flex items-center gap-2.5" :data-note="n.id" :data-done="n.doneAt ? 'true' : undefined">
      <span class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink-2" aria-hidden="true"><PhClock :size="16" /></span>
      <button type="button" class="press min-w-0 flex-1 cursor-pointer text-left" data-note-open @click="noteEdit = n.id">
        <span class="block truncate text-[15.5px] font-semibold" :class="n.doneAt ? 'text-ink-2' : 'text-ink'">{{ n.text }}</span>
        <span class="block type-meta num">{{ noteMeta(n) }}</span>
      </button>
      <button
        type="button"
        class="press grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-full border-[1.5px]"
        :class="n.doneAt ? 'border-ok bg-ok text-surface' : 'border-line-strong text-ink-3'"
        :aria-label="n.doneAt ? 'Сделано, снять' : 'Сделано'"
        :aria-pressed="!!n.doneAt"
        data-note-done
        @click="finance.setNoteDone(n.id, !n.doneAt)"
      >
        <PhCheck :size="14" weight="bold" />
      </button>
    </Card>

    <!--
      Разделы списком (Figma `18:47`): значок, имя, сумма за неделю — без полос: остаток раздела на месяц — в листе раздела.
      Вопросы разбора — строка «Не разобрано» сама кнопка к листу «Вопросы» (владелец 2026-10-23: действие у своего
      предмета, чипа нет); нет такой строки — своя строка «Вопросы», тоже кнопка. Подсказка — над разделами: нажатие
      строки её закрывает (приёмка, возврат); своих трат нет — ждёт.
    -->
    <Tip v-if="mine.rows.length || queue.length" id="tab-week" :text="TIP_WEEK" above :wait="!mine.rows.length">
      <Card flush class="px-3.5 py-0.5" data-week-list>
        <button v-if="queue.length && !hasUnknownRow" type="button" class="press flex w-full cursor-pointer items-center gap-2.5 py-3 text-left" data-questions-row data-bang @click="questionsOpen = true">
          <span class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-[13px] font-bold text-ink-2" aria-hidden="true">?</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15.5px] font-semibold text-ink">Вопросы</span>
            <span class="block type-meta num">{{ queue.length }} {{ plural(queue.length, 'вопрос', 'вопроса', 'вопросов') }}</span>
          </span>
          <PhCaretRight :size="15" class="shrink-0 text-ink-3" aria-hidden="true" />
        </button>
        <template v-for="r in mine.rows" :key="r.categoryId">
          <!-- «Не разобрано» с вопросами — вся строка ведёт в «Вопросы»; раздел — в лист раздела. -->
          <button
            v-if="r.categoryId === UNKNOWN_CATEGORY && queue.length"
            type="button"
            class="press flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-3 text-left first:border-t-0"
            :data-row="r.categoryId"
            data-bang
            @click="questionsOpen = true"
          >
            <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">?</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15.5px] font-semibold text-ink">{{ r.name }}</span>
              <span class="block type-meta num">{{ queue.length }} {{ plural(queue.length, 'вопрос', 'вопроса', 'вопросов') }}</span>
            </span>
            <span class="font-num text-[16px] font-bold num text-ink" data-amount>{{ plain(r.amount) }}</span>
          </button>
          <div v-else class="relative flex w-full items-center gap-2.5 border-t border-line py-3 text-left first:border-t-0" :data-row="r.categoryId">
            <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">{{ letter(r) }}</span>
            <span class="min-w-0 flex-1">
              <button type="button" class="row-open block w-full truncate text-left text-[15.5px] font-semibold text-ink" @click="sectionFor = r.categoryId">{{ r.name }}</button>
            </span>
            <span class="font-num text-[16px] font-bold num text-ink" data-amount>{{ plain(r.amount) }}</span>
          </div>
        </template>
      </Card>
    </Tip>

    <!-- Лента трат недели (Р-1): тихая строка под разделами, лист — по дням -->
    <button
      v-if="feed.count"
      type="button"
      class="press flex w-full cursor-pointer items-center justify-between rounded-[20px] bg-surface px-4 py-3.5 text-left text-[15px] font-semibold text-ink-2"
      data-week-feed
      @click="feedOpen = true"
    >
      <span class="num">Траты недели · {{ feed.count }}</span>
      <PhCaretRight :size="15" class="text-ink-3" />
    </button>

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
          <em v-if="t.amount > 0 && (i === trend.length - 1 || t.amount === trendMax)" class="text-[10px] not-italic text-ink-2 num">{{ Math.round(t.amount / 1000) }}к</em>
          <i class="block w-full rounded-b-[3px] rounded-t-[6px]" :class="i === trend.length - 1 ? 'bg-brand' : 'bg-surface-3'" :style="{ height: `${Math.round((t.amount / trendMax) * 70)}%` }" />
          <span class="text-[10.5px] text-ink-2 num">{{ trendDay(t.from) }}</span>
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
        <!-- «Это ваш доход?»: сумма и день правятся (как было в первом запуске); недельный ритм — только сумма за неделю. -->
        <template v-else-if="decision.kind === 'income'" #inner>
          <div class="flex gap-3" data-income-fields>
            <Field :label="decision.income?.rhythm === 'week' ? 'За неделю, ₸' : 'Оклад, ₸'" class="flex-1"><NumField v-model="income.salary.value" placeholder="450 000" data-income-salary /></Field>
            <Field v-if="decision.income?.rhythm !== 'week'" label="День" class="w-24"><NumField v-model="income.payday.value" kind="int" placeholder="10" data-income-day /></Field>
          </div>
        </template>
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
        <p v-if="e.detail" class="mt-1 break-all text-[11.5px] text-ink-2">{{ e.detail }}</p>
      </div>
    </Sheet>

    <MarkSheet
      :open="firstSalary ? 'mark' : null"
      kind="salary"
      :target-id="firstSalary?.c.targetId ?? ''"
      :period="firstSalary?.c.period ?? ''"
      :title="firstSalary?.title ?? ''"
      :amount="firstSalary?.amount ?? 0"
      :first-time="true"
      :amount-note="firstSalary?.note ?? ''"
      @close="firstSalary = null"
    />
    <SectionSheet :row="sectionRow" :week="week" :month-name="restMonth" @close="sectionFor = null" @edit="editHand" @open="(id) => (sectionOp = id)" />
    <!-- Строка выписки в листе раздела — лист операции поверх (FB-04, Р-14). -->
    <OpSheet :op-id="sectionOp" :z="60" @close="sectionOp = null" />
    <HandSpendSheet v-if="canUpload" :open="spendOpen || handEdit !== null" :op-id="handEdit" @close="closeHand" @saved="onHandSaved" />
    <NoteSheet v-if="canUpload" :open="noteOpen || noteEdit !== null" :note-id="noteEdit" @close="closeNoteSheet" @saved="onHandSaved" />
    <WeekFeedSheet :open="feedOpen" :week="week" :feed="feed" @close="feedOpen = false" @edit="editHand" />
    <UploadsSheet :open="uploadsOpen" :me="me" :busy="reading" @close="uploadsOpen = false" @upload="pickFile" />

    <!-- «Сразу готово» (Р-97): тост с «Отменить», пока выписка не отправлена; иначе — короткая фраза -->
    <Toast v-if="store.held" action="Отменить" @action="undo">{{ heldText }}</Toast>
    <Toast v-else-if="note">{{ note }}</Toast>
  </div>
</template>
