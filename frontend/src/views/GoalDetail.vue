<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { PhArrowUUpLeft, PhCamera, PhCaretRight, PhCheck, PhDotsThree, PhPause, PhPencilSimple, PhPlay, PhMinus, PhShareNetwork, PhStar } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { money, pct, plain, parseMoney, ratePct } from '@/lib/money'
import {
  INFLATION,
  closerDays,
  contributionStreak,
  cushionCover,
  doneLabel,
  doneTerm,
  dreamShift,
  fundMonthsOf,
  goalMonthly,
  goalPace,
  goalTerm,
  indexedNeed,
  liveGoals,
  monthsBetween,
  monthsLabel,
  movementMonth,
  payableAccounts,
  planForecast,
  returnTermShift,
  shiftLabel,
  tripStatus,
} from '@/lib/finance'
import { addMonths, atLabel, monthIn, monthKey, monthTitle, MONTHS_NOM, parseMonthKey, todayIso, weekRangeLabel } from '@/lib/dates'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import { cn, plural } from '@/lib/utils'
import { templateById, templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate } from '@/lib/photos/goalPhoto'
import { deletePhoto } from '@/lib/photos/store'
import { usePhoto } from '@/lib/photos/usePhoto'
import type { PersonId } from '@/types/finance'

import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import Field from '@/components/kit/Field.vue'
import { useFlash } from '@/components/kit/useFlash'
import { useFormCheck } from '@/components/kit/useFormCheck'
import HeaderActions from '@/components/kit/HeaderActions.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Section from '@/components/kit/Section.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import Toast from '@/components/kit/Toast.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import DoneSheet from '@/components/goals/DoneSheet.vue'
import DoSheet from '@/components/plan/DoSheet.vue'
import GoalSheet from '@/components/goals/GoalSheet.vue'
import PhotoPicker from '@/components/goals/PhotoPicker.vue'
import StorySheet from '@/components/goals/StorySheet.vue'
import TripCard from '@/components/goals/TripCard.vue'
import Button from '@/components/ui/Button.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'
import { buttonVariants } from '@/components/ui/button'
import Input from '@/components/ui/Input.vue'

/**
 * Экран цели (DESIGN.md §2 g4 «Экран цели»; B2C-18): фото-герой с процентом и «накоплено из
 * нужно» (имя — в шапке, месяц — в карточке ниже), «Будет вашей в …» со взносом и числом
 * взносов, «Пополнить» / «Поделиться» (B2C-20) / «Сделать главной», взносы с аватарами, правка
 * по карандашу (`GoalSheet`), viewer — без форм. Расчёты («за год», «дорожает», ритм) — за
 * свёрнутым «Подробнее» (правило 12). Хвосты: месяц взноса и серия — по Алматы
 * (`movementMonth`), цена «дорожает» — до месяца закрытия (после плана — позже).
 */
const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const goalId = computed(() => route.params.id as string)
// Удалил партнёр — «Цель не найдена», как окно правки (`GoalSheet`): пополнение ушло бы в
// надгробие, а счёт списался бы.
const goal = computed(() => liveGoals(financeStore.goals).find((g) => g.id === goalId.value)) // Сбылось (PN-13): все живые — сбывшаяся открывается
const people = computed(() => financeStore.people)
const canEdit = computed(() => !authStore.isViewer)
const isMain = computed(() => financeStore.heroGoal?.id === goalId.value)
// Фонд («Запас», «Подушка») героем не бывает (Р-84) — пункта «Сделать главной» у него нет.
const isDream = computed(() => financeStore.queue.find((x) => x.id === goalId.value)?.kind === 'goal')
// Выключена в плане месяца (Р-83): стоит, пока не включат; срок сдвигается.
const off = computed(() => !!goal.value?.pausedAt)
const menuOpen = ref(false)
function menu(action: 'main' | 'edit' | 'pause' | 'done' | 'undo') {
  menuOpen.value = false
  if (!goal.value) return
  if (action === 'main') financeStore.makeMain(goal.value.id)
  else if (action === 'edit') {
    termDoneBefore.value = doneMonth.value
    openEditModal.value = true
  }
  else if (action === 'done') markDone()
  else if (action === 'undo') financeStore.undoGoalDone(goal.value.id)
  else financeStore.pauseGoal(goal.value.id, !off.value)
}

/* ------------------ «Сбылось» (PN-14, Р-13; макет done.html) ------------------ */
// Сбывшаяся: деньги ушли покупкой (PN-13) — в очереди её нет; экран — память: 100 %, месяц и срок, история.
const isDone = computed(() => !!goal.value?.doneAt)
const doneTermLine = computed(() => (goal.value && isDone.value ? doneLabel(doneTerm(goal.value)) : ''))
const doneAtTitle = computed(() => (goal.value?.doneAt ? `Сбылось в ${monthIn(monthKey(new Date(goal.value.doneAt)))}` : ''))
// «Ещё нет» прячет вопрос до следующего открытия экрана (ref живёт, пока экран открыт).
const notYet = ref(false)
watch(goalId, () => (notYet.value = false))
const doneOpen = ref(false)
function markDone() {
  if (!goal.value) return
  financeStore.markGoalDone(goal.value.id)
  doneOpen.value = true
}
function shareDone() {
  doneOpen.value = false
  storyOpen.value = true
}
// Пополнение и снятие двигают тенговую базу счёта: валютный счёт пересчитал бы её по
// курсу при следующей правке и молча потерял сдвиг. Удалённые счета — тоже не сюда.
const accounts = computed(() => payableAccounts(financeStore.accounts))

// План «Сначала долги» (PV-15): пауза выводится из плана, взнос цели не трогается (Р-9).
const plan = computed(() => financeStore.activePlan)
const paused = computed(() => financeStore.pausedGoalIds.has(goalId.value))
const planCushion = computed(() => !!plan.value && plan.value.cushionGoalId === goalId.value)

// Фонд («Запас», «Подушка», Р-82): «нужно» — порог плана, не своя сумма; «фонд» в шапке, без «мечты».
const isFund = computed(() => financeStore.queue.find((x) => x.id === goalId.value)?.kind === 'fund')

// Срок, «нужно» и «осталось N взносов» — из строки плана месяца, одной функцией с «Мечтами» (`goalTerm`, ревью
// frontend Б14 Н-2). Цель на паузе плана «Сначала долги» стоит, пока план не закроет долги с процентами (Н-8 ревью
// Блока 3): дата — от месяца без процентных долгов по прогнозу плана; не закрываются — месяца нет.
const forecast = computed(() => (paused.value && plan.value ? planForecast(plan.value, financeStore.planState(), monthKey()) : null))
const planItem = computed(() => (goal.value ? financeStore.monthPlanOf(monthKey()).queue.find((x) => x.goalId === goal.value!.id) : undefined))
const term = computed(() => (goal.value ? goalTerm(planItem.value, goal.value, monthKey(), forecast.value ?? undefined) : null))
/** ✦ у срока (бэклог «Разбор», RZ-11): совет разбора текущего месяца про эту цель — номер карточки отчёта. */
const ai = useAiStore()
const goalMark = computed(() => (goal.value ? ai.markFor('goal', goal.value.id) : null))
const need = computed(() => term.value?.need ?? 0)
const remaining = computed(() => term.value?.remaining ?? 0)
const months = computed(() => term.value?.months ?? Infinity)
const doneMonth = computed(() => term.value?.doneMonth ?? null)
const progress = computed(() => (isDone.value ? 100 : goal.value ? pct(goal.value.have, need.value) : 0))
// «Купили?» (PN-14): мечта (не фонд — у фонда «Собрано», он не сбывается) накоплена целиком и ещё не отмечена.
const askBought = computed(() => !!goal.value && !isDone.value && isDream.value && remaining.value <= 0 && !notYet.value)

const doneTitle = computed(() => {
  if (term.value?.off) return 'На паузе'
  if (doneMonth.value) return `${isFund.value ? 'Соберём' : 'Будет вашей'} в ${monthIn(doneMonth.value)}`
  if (term.value?.afterPlan) return 'После плана'
  // Взнос есть, но остатка месяца на него не хватает (план даёт 0) — срока нет, как на «Мечтах».
  return goal.value && goal.value.monthly > 0 && remaining.value > 0 ? 'Срока пока нет' : 'Взнос не задан'
})
/**
 * «Мечта сдвинулась» (AU-06, Р-6): метка к снимку начала месяца — тот же расчёт, что на «Мечтах» (`dreamShift`);
 * «Вернуть срок» — кандидат `returnTermShift` (денег нет — кнопки нет), лист `DoSheet`.
 */
const shiftInput = computed(() => financeStore.planInput(monthKey()))
const shiftSnap = computed(() => financeStore.termSnapFor(monthKey()))
// Раздел причины — только свой (Х-8, Р-29); viewer — семейная причина, как было.
const shiftBy = computed(() => (authStore.isViewer ? undefined : authStore.slot ?? undefined))
const shift = computed(() => (goal.value && !isDone.value ? dreamShift(shiftInput.value.state, shiftInput.value.ctx, shiftSnap.value, goal.value.id, shiftBy.value) : null))
const shiftText = computed(() => (shift.value ? shiftLabel(shift.value) : ''))
const returnShift = computed(() =>
  shift.value && shift.value.days > 0 && goal.value ? returnTermShift(shiftInput.value.state, shiftInput.value.ctx, shiftSnap.value, goal.value.id) : null,
)
const returnOpen = ref(false)
// Выключенная в плане — без строки взносов: её нет в этом месяце.
const doneLine = computed(() => {
  if (!goal.value || term.value?.off) return ''
  if (remaining.value <= 0) return isFund.value ? 'Собрано' : 'Накоплено — мечта ваша'
  if (!Number.isFinite(months.value)) return goal.value.monthly > 0 ? 'Остатка месяца не хватает на взнос' : 'Задайте взнос — и появится дата'
  return `${money(goal.value.monthly)} в месяц`
})
// Сколько взносов осталось и «после плана» — в «Подробнее» (Р-116): под сроком одна строка.
const leftLine = computed(() => {
  if (!goal.value || term.value?.off || remaining.value <= 0 || !Number.isFinite(months.value)) return ''
  // Подушка (PN-20): срок «Соберём в …» уходит сюда — в карточке «хватит на N».
  if (cover.value && doneMonth.value) return `Соберём в ${monthIn(doneMonth.value)} · осталось ${months.value} ${plural(months.value, 'взнос', 'взноса', 'взносов')}`
  return `Осталось ${months.value} ${plural(months.value, 'взнос', 'взноса', 'взносов')}${term.value?.afterPlan && doneMonth.value ? ' · после плана' : ''}`
})
// Во сколько обойдётся та же цель к сроку (хвост PV: горизонт — до месяца закрытия, у паузы — позже). Фонд — не покупка.
const indexed = computed(() =>
  goal.value && !isFund.value && doneMonth.value ? indexedNeed(goal.value.need, monthsBetween(monthKey(), doneMonth.value)) : null,
)

/* ------------------ Поездка (PN-31, Р-14) ------------------ */
// До поездки — экран как обычно, даты строкой в «Подробнее»; с первого дня — карточка «Потрачено N из M» под героем.
const trip = computed(() => (goal.value ? tripStatus(goal.value, todayIso()) : 'none'))
const tripDates = computed(() => (goal.value?.from && goal.value.to ? `Поездка ${weekRangeLabel({ from: goal.value.from, to: goal.value.to })}` : ''))
// «Съездили?» (возврат приёмки Б9, решение владельца Б): после последнего дня вместо срока и «Пополнить» — как «Купили?»;
// «Ещё нет» — тот же `notYet`: срок и «Пополнить» на этот заход.
const askTrip = computed(() => trip.value === 'after' && !isDone.value && isDream.value && !notYet.value)

/* ------------------ Взнос полем (исключение из Р-2, владелец 2026-09-25) ------------------ */
// «Сохранено» — по самому взносу, а не по updatedAt цели: пополнение тоже меняет цель, но
// взнос оно не трогает.
const monthlySaved = useSavedMark(
  () => goal.value?.id,
  () => (goal.value ? String(goal.value.monthly) : undefined),
)
function onMonthly(text: string) {
  const v = parseMoney(text)
  if (goal.value && v > 0 && v !== goal.value.monthly) financeStore.setGoalMonthly(goal.value.id, v)
}

/* ------------------ Порог фонда полем (Р-82, ревью frontend Б14 Н-9; владелец 2026-10-05 — в клинап) ------------------ */
// Свой `fundMonths` вместо умолчания семьи; «нужно» выше пересчитает план месяца.
const fundKind = computed(() => {
  const q = financeStore.queue.find((x) => x.id === goalId.value)
  return q?.kind === 'fund' ? q.fund : null
})
const fundMonths = computed(() => (goal.value && fundKind.value ? fundMonthsOf(fundKind.value, goal.value, financeStore.moneySettings) : 0))
const fundSaved = useSavedMark(
  () => goal.value?.id,
  () => (goal.value && fundKind.value ? String(fundMonths.value) : undefined),
)
// Подушка (PN-20, Р-12): карточка срока — «Хватит на N месяцев», под ней «нужно M месяцев · сумма»; на паузе — как у всех.
const cover = computed(() =>
  goal.value && fundKind.value === 'cushion' && !term.value?.off ? cushionCover(planItem.value, goal.value, financeStore.moneySettings) : null,
)
const coverFull = computed(() => !!cover.value && cover.value.need > 0 && cover.value.have >= cover.value.need)
const coverTitle = computed(() => (cover.value?.months == null ? 'Пока не на что считать' : `Хватит на ${monthsLabel(cover.value.months)}`))
function onFundMonths(text: string) {
  const v = parseMoney(text)
  if (goal.value && v > 0 && v !== fundMonths.value) financeStore.setFundMonths(goal.value.id, v)
}

/* ------------------ Ритм (месяцы по Алматы) ------------------ */
const rhythmColor = computed(() => (goal.value ? hueColor(goal.value.hue, isDark.value) : ''))
const streak = computed(() => (goal.value ? contributionStreak(goal.value.movements || []) : 0))
const filled = computed(() => new Set((goal.value?.movements || []).filter((m) => m.amount > 0).map((m) => movementMonth(m.date))))
const last12 = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const k = addMonths(monthKey(), i - 11)
    return { key: k, label: monthTitle(k), filled: filled.value.has(k) }
  }),
)

/* ------------------ Пополнение / Снятие ------------------ */
const openDepositModal = ref(false)
const depositOperation = ref<'deposit' | 'withdraw'>('deposit')
const depositAmount = ref('')
const depositBy = ref<PersonId>(authStore.slot ?? 'a')
const depositAccountId = ref<string>('')
const depositNote = ref('')
// Сумма — сразу под пальцем (React `autoFocus`): лист вставляется после открытия, атрибут не сработал бы.
const depositAmountRef = ref<HTMLElement | null>(null)
watch(openDepositModal, (open) => {
  if (open) void nextTick(() => depositAmountRef.value?.querySelector('input')?.focus())
})

// История — новые сверху по дате: слияние хранит «новые первыми», взнос дописывается в конец.
const history = computed(() => [...(goal.value?.movements ?? [])].sort((a, b) => b.date.localeCompare(a.date)))
const monthOf = (iso: string) => MONTHS_NOM[parseMonthKey(movementMonth(iso)).month]

const form = useFormCheck(() => [['amount', parseMoney(depositAmount.value) <= 0 && 'Введите сумму']])

/* ---------- тост «ближе на N дней» после пополнения (PN-09, Р-15): 4 с, снятие — без тоста ---------- */
const { note: closerNote, flash: flashCloser } = useFlash()

/* ---------- сумму правили — срок прежний (хотфикс 2026-10-12): тост с новым взносом, «Оставить взнос» — сдвинуть срок ---------- */
// Тост — когда лист закрыт (над листом его не видно); правили несколько раз — «Оставить взнос» вернёт взнос до листа.
// Взносов — сколько на экране; на паузе (и ради плана — взнос идёт в долг) взнос не трогаем. «Срок прежний» — только если
// месяц на экране не сдвинулся (очередь плана может не дать нового взноса целиком).
const { note: termNote, flash: flashTerm, clear: clearTerm } = useFlash(6000)
const termMonths = computed(() => (term.value && !term.value.off && !term.value.afterPlan && Number.isFinite(term.value.months) ? term.value.months : null))
const termDoneBefore = ref<string | null>(null)
const termChange = ref<{ prev: number; next: number } | null>(null)
const termPrev = ref(0)
function onTerm(change: { prev: number; next: number }) {
  termChange.value = { prev: termChange.value?.prev ?? change.prev, next: change.next }
}
function closeEdit() {
  openEditModal.value = false
  const c = termChange.value
  termChange.value = null
  if (!c || c.prev === c.next) return
  termPrev.value = c.prev
  flashTerm(`Взнос ${money(c.next)} в месяц${doneMonth.value === termDoneBefore.value ? ' — срок прежний' : ''}`)
}
function keepMonthly() {
  if (goal.value) financeStore.setGoalMonthly(goal.value.id, termPrev.value)
  clearTerm()
}

function applyDeposit() {
  const v = parseMoney(depositAmount.value)
  if (!v || !goal.value) return

  if (depositOperation.value === 'deposit') {
    // Темп — до записи взноса (без плана он считается по движениям); нет темпа — тоста нет.
    const days = closerDays(v, goalPace(goal.value, monthKey()))
    financeStore.contribute(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    // Сдвиг остатка, а не сверка: отметки оплат до взноса продолжают считаться. Запись сдвига (FG-14): тот же перевод
    // в выписке второй раз не вычтется.
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, -v, { kind: 'goal-in', goalId: goal.value.id })
    if (days) flashCloser(`${goal.value.name} ближе на ${days} ${plural(days, 'день', 'дня', 'дней')}`)
  } else {
    financeStore.withdraw(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, v, { kind: 'goal-out', goalId: goal.value.id })
  }

  depositAmount.value = ''
  depositNote.value = ''
  depositAccountId.value = ''
  openDepositModal.value = false
}

/* ------------------ Редактирование цели ------------------ */
// Поля окна пишутся сами по уходу из поля (`GoalSheet`); viewer окна не открывает (Р-12).
const openEditModal = ref(false)

/* ------------------ Фото цели (B2C-17) ------------------ */
const photoSrc = usePhoto(() => goal.value?.photoId)
const pickerOpen = ref(false)
const photoNote = ref<string | null>(null)
// «Новая мечта» уходит сюда до загрузки фото; не загрузилось — заметка приходит в адресе (`?photo=`).
watch(
  () => route.query.photo,
  (p) => {
    if (p === 'failed') photoNote.value = 'Фото не загрузилось — добавьте его ещё раз.'
    else if (p === 'later' && !goal.value?.photoId) photoNote.value = 'Картинка появится при сети.'
  },
  { immediate: true },
)
// «Новая мечта → Подушка», а подушка уже есть (PN-19): одна на семью — привели к ней, тост говорит почему.
watch(
  () => route.query.fund,
  (f) => {
    if (f === 'exists') flashCloser('Подушка уже есть')
  },
  { immediate: true },
)

// Замена фото: новое загружено и записано — прежнее удаляется с сервера, иначе байты остаются сиротой (критик Блока 3).
function dropReplaced(old: string | null | undefined) {
  if (old && goal.value?.photoId !== old) void deletePhoto(old).catch(() => {})
}

async function onTemplate(t: GoalTemplate) {
  pickerOpen.value = false
  if (!goal.value) return
  const old = goal.value.photoId
  const result = await attachTemplate(financeStore, goal.value.id, t)
  // Замена не загрузилась — у цели всё прежнее (`offline`); цель без фото ждёт сети с шаблоном.
  photoNote.value = result === 'uploaded' ? null : result === 'offline' ? 'Нет сети — фото не сменилось.' : 'Картинка появится при сети.'
  if (result === 'uploaded') dropReplaced(old)
}

async function onFile(file: File) {
  pickerOpen.value = false
  if (!goal.value) return
  const old = goal.value.photoId
  const ok = await attachFile(financeStore, goal.value.id, file)
  photoNote.value = ok ? null : 'Фото не загрузилось — попробуйте при сети.'
  if (ok) dropReplaced(old)
}

/** Убрать фото: сначала из документа (партнёр перестаёт видеть), затем с сервера. */
async function removePhoto() {
  pickerOpen.value = false
  const g = goal.value
  if (!g?.photoId) return
  const id = g.photoId
  financeStore.setGoalPhoto(g.id, null)
  financeStore.updateGoal(g.id, { template: null })
  await deletePhoto(id).catch(() => {})
}

/* ------------------ Карточка для сторис (B2C-20) ------------------ */
// `/share/:goalId` из DESIGN.md §2 — редирект сюда с `?share=1`: лист открывается сразу.
const storyOpen = ref(route.query.share === '1')
// Фото мечты; без загруженного — картинка шаблона с CDN (CORS открыт); без шаблона — фон без фото.
const storySrc = computed(() => {
  if (photoSrc.value) return photoSrc.value
  const t = templateById(goal.value?.template)
  return t ? templateImageUrl(t, 1080) : null
})
// Обои 1170 × 2532 (PN-10) кроют горизонтальное фото по высоте: шаблону с CDN — картинка 2400 (не 1080), иначе
// растяжение в 3,5 раза; своё фото уже сжато при загрузке (≤ 1600) — крупнее нет (критик Блока 3 «понятность»).
const wallpaperSrc = computed(() => {
  if (photoSrc.value) return photoSrc.value
  const t = templateById(goal.value?.template)
  return t ? templateImageUrl(t, 2400) : null
})
const storyData = computed(() => ({
  percent: progress.value,
  goalName: goal.value?.name,
  doneMonth: doneMonth.value ? monthIn(doneMonth.value) : null,
  // Сбывшаяся (PN-14): «<имя> · сбылось за N месяцев».
  doneTerm: goal.value && isDone.value ? doneTerm(goal.value) : null,
}))
function share() {
  storyOpen.value = true
}
</script>

<template>
  <div v-if="!goal" class="pt-6 text-center text-[14px] text-ink-2">
    Цель не найдена.
    <button class="text-brand font-medium cursor-pointer" @click="router.push('/')">
      К списку
    </button>
  </div>

  <div v-else class="flex flex-col gap-3 pt-1 text-left">
    <!-- «Назад» и имя — в шапке оболочки; меню цели — справа в ней (макет month-plan.html «Сделать главной»):
         «Сделать главной» первым и цветом, «Изменить», пауза в плане месяца (Р-83, Р-84). -->
    <HeaderActions>
      <!-- «Поделиться» — значком в шапке (Б17): в карточке остаётся одно действие — «Пополнить». -->
      <button
        type="button"
        aria-label="Поделиться"
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
        data-goal-share
        @click="share"
      >
        <PhShareNetwork :size="19" />
      </button>
      <button
        v-if="canEdit"
        type="button"
        aria-label="Меню цели"
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
        @click="menuOpen = true"
      >
        <PhDotsThree :size="20" weight="bold" />
      </button>
    </HeaderActions>
    <Sheet v-if="canEdit" :open="menuOpen" :title="goal.name" @close="menuOpen = false">
      <!-- Сбывшаяся (PN-14, ворота): «Вернуть в мечты» и «Изменить цель» — удаление внутри листа правки, как у всех. -->
      <div v-if="isDone" class="flex flex-col">
        <button type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-ink" data-goal-undo @click="menu('undo')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink-2"><PhArrowUUpLeft :size="18" /></span>Вернуть в мечты
        </button>
        <button type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-ink" @click="menu('edit')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink-2"><PhPencilSimple :size="18" /></span>Изменить цель
        </button>
      </div>
      <div v-else class="flex flex-col">
        <button v-if="isDream && !isMain" type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-brand" @click="menu('main')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-brand-soft text-brand"><PhStar :size="18" weight="fill" /></span>Сделать главной
        </button>
        <button type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-ink" @click="menu('edit')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink-2"><PhPencilSimple :size="18" /></span>Изменить цель
        </button>
        <!-- «Сбылось» — у мечты всегда (купили раньше, чем накопили), цветом «готово», не брендом (ворота PN-12). -->
        <button v-if="isDream" type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-ok" data-goal-done-menu @click="menu('done')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-ok-soft text-ok"><PhCheck :size="18" weight="bold" /></span>Сбылось
        </button>
        <button type="button" class="press flex w-full cursor-pointer items-center gap-3 border-t border-line px-1 py-[13px] text-left text-[16px] font-semibold first:border-t-0 text-ink" @click="menu('pause')">
          <span class="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-surface-2 text-ink-2"><component :is="off ? PhPlay : PhPause" :size="18" /></span>{{ off ? 'Снять с паузы' : 'Поставить на паузу' }}
        </button>
      </div>
    </Sheet>

    <!-- Фото-герой (B2C-17): картинка шаблона или своя; автор — один раз, на фото, ссылкой (Р-28).
         Поверх картинки — только маленькая кнопка смены фото (владелец, 2026-09-27: крупные чипы
         закрывали фото); «Убрать фото» — в окне выбора, «Сделать главной» — в карточке ниже.
         Строка — только «накоплено из нужно» (макет g4): имя уже в шапке, месяц — в карточке. -->
    <DreamHero
      :percent="progress"
      :line="isDone ? money(goal.have) : `${plain(goal.have)} из ${money(need)}`"
      :eyebrow="isDone ? 'Сбылось' : isFund ? 'Собрано' : undefined"
      :src="photoSrc"
      :author="goal.photoCredit?.author"
      :author-url="goal.photoCredit?.url"
      size="goal"
    >
      <template v-if="canEdit && goal.photoId && !isDone" #corner>
        <button
          type="button"
          aria-label="Сменить фото"
          class="grid size-[34px] place-items-center rounded-full bg-photo-scrim text-on-photo cursor-pointer"
          @click="pickerOpen = true"
        >
          <PhCamera :size="18" />
        </button>
      </template>
      <template v-if="canEdit && !goal.photoId && !isDone" #actions>
        <Chip quiet @click="pickerOpen = true"><PhCamera /> Добавить фото</Chip>
      </template>
    </DreamHero>
    <Callout v-if="photoNote" tone="neutral" icon="info">{{ photoNote }}</Callout>
    <PhotoPicker
      :open="pickerOpen"
      title="Фото мечты"
      :selected="goal.template"
      :skippable="false"
      :removable="!!goal.photoId"
      @close="pickerOpen = false"
      @template="onTemplate"
      @file="onFile"
      @remove="removePhoto"
    />

    <!-- Поездка (PN-31): в пути и после — «Потрачено N из M» у мечты; в пути срок и «Пополнить» ниже остаются (копить можно), после — «Съездили?». -->
    <TripCard v-if="trip === 'during' || trip === 'after'" :goal="goal" :status="trip" />

    <!-- Карточка g4: срок цели (живёт здесь, Р-116), взнос в месяц и одна главная — «Пополнить» у срока. -->
    <!-- Сбывшаяся (PN-14): вместо срока — месяц и «за N месяцев»; действий нет. -->
    <Card v-if="isDone">
      <h2 class="type-h2 flex items-center gap-2 text-ink" data-goal-done-at>
        <span class="grid size-[22px] shrink-0 place-items-center rounded-full bg-ok text-surface"><PhCheck :size="13" weight="bold" /></span>{{ doneAtTitle }}
      </h2>
      <p class="mt-1.5 text-[15px] text-ink-2">{{ doneTermLine }}</p>
    </Card>
    <!-- Накоплено целиком (PN-14): «Купили?» — брендовая «Сбылось» у предмета, тихая «Ещё нет»; «Пополнить» нет. -->
    <Card v-else-if="askBought" data-goal-ask>
      <h2 class="type-h2 text-ink">{{ canEdit ? 'Накоплено!' : 'Накоплено' }}</h2>
      <template v-if="canEdit">
        <p class="mt-1.5 text-[15px] text-ink-2">Купили?</p>
        <div class="mt-3.5 flex gap-2.5">
          <Button variant="secondary" size="md" class="flex-1" data-goal-not-yet @click="notYet = true">Ещё нет</Button>
          <Button size="md" class="flex-1" data-goal-done @click="markDone">Сбылось</Button>
        </div>
      </template>
    </Card>
    <!-- Поездка прошла (решение владельца Б, Б9): «Съездили?» — брендовая «Сбылось», тихая «Ещё нет»; срока и «Пополнить» нет. -->
    <Card v-else-if="askTrip" data-trip-ask>
      <h2 class="type-h2 text-ink">Съездили?</h2>
      <template v-if="canEdit">
        <p class="mt-1.5 text-[15px] text-ink-2">Отметьте — поездка уйдёт в «Сбылось»</p>
        <div class="mt-3.5 flex gap-2.5">
          <Button variant="secondary" size="md" class="flex-1" data-goal-not-yet @click="notYet = true">Ещё нет</Button>
          <Button size="md" class="flex-1" data-goal-done @click="markDone">Сбылось</Button>
        </div>
      </template>
    </Card>
    <Card v-else>
      <!-- Подушка (PN-20): «хватит на N месяцев» — заголовок, «нужно на M месяцев» строкой (сумма — в герое, /ux Б6); собрано — ✓ цветом «готово», «Собрано» не пишем. -->
      <template v-if="cover">
        <h2 class="type-h2" :class="coverFull ? 'text-ok' : 'text-ink'" data-cushion-cover>{{ coverTitle }}{{ coverFull ? ' ✓' : '' }}<AdviceMark :n="goalMark" /></h2>
        <p class="mt-1.5 text-[15px] text-ink-2 num" data-cushion-need>нужно на {{ monthsLabel(cover.monthsNeeded) }}</p>
      </template>
      <template v-else>
        <!-- ✦ совета ИИ про эту цель (бэклог «Разбор», RZ-11) — у срока: нажатие — отчёт на карточке совета. -->
        <h2 class="type-h2 text-ink" data-goal-term>{{ doneTitle }}<AdviceMark :n="goalMark" /></h2>
        <p v-if="doneLine" class="mt-1.5 text-[15px] text-ink-2">{{ doneLine }}</p>
      </template>
      <!-- Метка «мечта сдвинулась» (AU-06, Р-6) и «Вернуть срок» у неё — тихо, главная остаётся «Пополнить» -->
      <div v-if="shift" class="mt-2 flex items-center justify-between gap-2">
        <p class="flex min-w-0 items-start gap-1.5 text-[13px] text-ink-2" data-goal-shift>
          <!-- Точка — у первой строки: метка рядом с «Вернуть срок» переносится на две -->
          <i class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="shift.days > 0 ? 'bg-warn' : 'bg-ok'" aria-hidden="true" />{{ shiftText }}
        </p>
        <Button v-if="canEdit && returnShift" variant="secondary" size="sm" class="shrink-0" data-return-term @click="returnOpen = true">Вернуть срок</Button>
      </div>
      <Button
        v-if="canEdit"
        class="mt-3.5 w-full"
        @click="
          depositOperation = 'deposit';
          openDepositModal = true;
        "
      >
        Пополнить
      </Button>
    </Card>

    <!-- Пауза плана и подушка — строкой к плану долгов на «Закрыть быстрее» (Б17, принято на воротах); абзаца нет. -->
    <RouterLink
      v-if="(paused || planCushion) && !isDone"
      to="/money/debts/faster"
      class="press flex items-center gap-2.5 rounded-[16px] px-3.5 py-3 text-[14.5px] font-semibold"
      :class="paused ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'"
      data-goal-plan
    >
      <span class="min-w-0 flex-1">{{ paused ? 'На паузе — взнос идёт в долг' : 'Подушка плана — взносы идут' }}</span>
      <PhCaretRight :size="16" class="shrink-0" />
    </RouterLink>

    <!-- Взнос полем, «Снять», расчёты и график — за «Подробнее», по умолчанию свёрнуты (правило 12; в макете g4 их нет) -->
    <details v-if="!isDone">
      <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Подробнее</summary>
      <div class="mt-2 flex flex-col gap-3">
        <p v-if="leftLine" class="px-1 text-[14px] text-ink-2 num" data-goal-left>{{ leftLine }}</p>
        <p v-if="tripDates" class="px-1 text-[14px] text-ink-2 num" data-trip-dates>{{ tripDates }}</p>
        <!-- Взнос вводится числом, а не ползунком (исключение из Р-2, владелец 2026-09-25). Viewer — только сумма. -->
        <Card v-if="canEdit">
          <div class="-mb-3.5 flex justify-end">
            <SavedMark :on="monthlySaved" />
          </div>
          <Field label="Откладывать в месяц">
            <NumFieldBlur :initial="plain(goal.monthly)" @commit="onMonthly" />
          </Field>
          <Button
            variant="ghost"
            class="mt-2 px-2.5"
            @click="
              depositOperation = 'withdraw';
              openDepositModal = true;
            "
          >
            <PhMinus :size="16" weight="bold" /> Снять
          </Button>
        </Card>

        <!-- Порог фонда — месяцев трат (Н-9): «нужно» = месяцы × траты месяца по плану. -->
        <Card v-if="canEdit && fundKind">
          <div class="-mb-3.5 flex justify-end">
            <SavedMark :on="fundSaved" />
          </div>
          <Field label="Месяцев трат">
            <template v-if="cover" #hint><Hint label="Как считается «нужно»">Нужно = месяцы × (платежи + траты по плану)</Hint></template>
            <NumFieldBlur :initial="String(fundMonths)" aria-label="Порог фонда — месяцев трат" @commit="onFundMonths" />
          </Field>
        </Card>

        <!-- Фонд — не покупка к сроку: «за год» и «дорожает» только у мечты (PN-20). -->
        <p v-if="remaining > 0 && !isFund" class="px-1 text-[13px] text-ink-2">
          Чтобы успеть за год, нужно {{ money(goalMonthly(remaining, 12)) }} в месяц.
        </p>

        <Callout v-if="indexed !== null" tone="neutral" title="Цель дорожает вместе с рынком">
          При инфляции {{ ratePct(INFLATION, 1) }} в год {{ doneMonth ? `в ${monthIn(doneMonth)}` : 'к сроку' }}
          такая же покупка будет стоить около {{ money(indexed) }}. Расчёт выше — в сегодняшних деньгах.
        </Callout>

        <!-- Ритм цели -->
        <Section title="Ритм цели" />
        <Card>
          <div class="mb-3 flex items-center gap-2.5">
            <b class="text-[14.5px] font-semibold text-ink">Пополняем без пропусков</b>
            <Hint>
              {{
                streak > 0
                  ? 'Считается по взносам именно в эту цель, а не по общему плану.'
                  : 'Закрасится, как только появится первый взнос в эту цель.'
              }}
            </Hint>
            <Tag v-if="streak > 0" tone="gold">{{ streak }} мес.</Tag>
          </div>
          <div class="flex gap-1.5">
            <i
              v-for="m in last12"
              :key="m.key"
              :title="m.label"
              class="h-[20px] flex-1 rounded transition-colors"
              :style="{ background: m.filled ? rhythmColor : 'var(--track)' }"
            />
          </div>
        </Card>
      </div>
    </details>

    <!-- Взносы -->
    <Section title="Взносы" />
    <Card flush>
      <div
        v-for="m in history"
        :key="m.id"
        class="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
      >
        <Avatar :id="m.by" :name="people.find((p) => p.id === m.by)?.name || 'Участник'" :size="34" />
        <div class="min-w-0 flex-1 text-left">
          <b class="block text-[14.5px] font-medium text-ink">
            {{ m.amount > 0 ? monthOf(m.date) : 'Снятие' }}
          </b>
          <span class="block text-[12.5px] text-ink-2">
            {{ atLabel(m.date) }} · {{ people.find((p) => p.id === m.by)?.name || 'Участник' }}
            <span v-if="m.note">· {{ m.note }}</span>
          </span>
        </div>
        <span
          :class="[
            'shrink-0 text-[14.5px] font-semibold num',
            m.amount > 0 ? 'text-ok' : 'text-ink-2',
          ]"
        >
          {{ m.amount > 0 ? '+' : '−' }}{{ plain(Math.abs(m.amount)) }} ₸
        </span>
      </div>
      <div v-if="!(goal.movements && goal.movements.length)" class="px-4 py-6 text-center text-[13px] text-ink-2">
        Взносов пока нет — история появится после первого пополнения
      </div>
    </Card>

    <!-- Окно: Пополнить / Снять -->
    <Sheet
      :open="openDepositModal"
      :title="depositOperation === 'deposit' ? `Пополнить «${goal.name}»` : 'Снять средства'"
      @close="openDepositModal = false"
    >
      <div ref="depositAmountRef">
        <Field label="Сумма" name="amount">
          <NumField
            v-model="depositAmount"
            :placeholder="depositOperation === 'deposit' ? plain(goal.monthly) : '10 000'"
          />
        </Field>
      </div>

      <Field v-if="accounts.length > 0" :label="depositOperation === 'deposit' ? 'Списать со счёта (опционально)' : 'Зачислить на счёт (опционально)'">
        <Select
          v-model="depositAccountId"
          :options="[
            { value: '', label: 'Не списывать со счетов' },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${money(a.amount)})` })),
          ]"
          class="mb-3"
        />
      </Field>

      <Field v-if="people.length > 1" label="Кто вносит" group>
        <Segmented v-model="depositBy" :options="people.map((p) => ({ value: p.id, label: p.name }))" />
      </Field>

      <Field label="Примечание">
        <Input v-model="depositNote" placeholder="Премия, накопления…" />
      </Field>

      <Button class="w-full mt-2" @click="form.submit(applyDeposit)">
        {{ depositOperation === 'deposit' ? 'Внести' : 'Снять' }}
      </Button>
    </Sheet>

    <!-- «Ближе на N дней» (PN-09): тост после пополнения, в оболочке — над вкладками -->
    <DoSheet :candidate="returnOpen ? returnShift : null" returning @close="returnOpen = false" />
    <Toast v-if="closerNote"><span data-closer>{{ closerNote }}</span></Toast>
    <Toast v-if="termNote" action="Оставить взнос" @action="keepMonthly"><span data-term>{{ termNote }}</span></Toast>

    <!-- Карточка для сторис (B2C-20): без сумм -->
    <!-- Момент «Сбылось» (PN-14): «Поделиться» — та же карточка ниже, со строкой «сбылось за N месяцев» -->
    <DoneSheet :goal-id="doneOpen ? goal.id : null" :src="storySrc" @close="doneOpen = false" @share="shareDone" />

    <StorySheet :open="storyOpen" kind="goal" :data="storyData" :src="storySrc" :wallpaper-src="wallpaperSrc" @close="storyOpen = false" />

    <!-- Окно: Изменить цель -->
    <GoalSheet
      :goal-id="openEditModal && canEdit ? goal.id : null"
      :term-months="termMonths"
      @close="closeEdit"
      @term="onTerm"
      @removed="router.push('/')"
    />
  </div>
</template>

