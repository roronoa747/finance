<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { PhArrowUUpLeft, PhCamera, PhCaretRight, PhCheck, PhDotsThree, PhPause, PhPencilSimple, PhPlay, PhShareNetwork, PhStar } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { money, pct, plain, parseMoney } from '@/lib/money'
import {
  closerDays,
  cushionCover,
  doneLabel,
  doneTerm,
  dreamShift,
  fundMonthsOf,
  goalPace,
  goalTerm,
  liveGoals,
  monthsLabel,
  movementMonth,
  payableAccounts,
  planForecast,
  returnTermShift,
  shiftLabel,
  tripStatus,
} from '@/lib/finance'
import { atLabel, monthIn, monthKey, MONTHS_DAT, MONTHS_NOM, parseMonthKey, todayIso, weekRangeLabel } from '@/lib/dates'
import { plural } from '@/lib/utils'
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
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
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
import Input from '@/components/ui/Input.vue'

/**
 * Экран цели v2 (пачка 2 «Figma», 78:50 / 78:104, FG-24): обложка-карточка — название, процент, «накоплено из нужно», полоса,
 * внизу срок («к сентябрю 2034») и главная «Пополнить» у предмета; под ней карточка «В месяц | Осталось» — «В месяц» открывает
 * лист «Взнос в месяц» (поле, «Снять», у фонда — месяцев трат, «осталось N взносов»); метка сдвига и «Вернуть срок» — под
 * ней; взносы — на экране. «Подробнее» нет: «за год», «дорожает» и ритм сняты (вариант составителя, Р-9). «Купили?» /
 * «Съездили?» — тонкой строкой с маленькими кнопками. Правка по меню (`GoalSheet`), viewer — без форм и кнопок.
 * Хвосты: месяц взноса — по Алматы (`movementMonth`).
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
// Сколько взносов осталось и «после плана» — подписью под полем в листе «Взнос в месяц» (FG-24).
const leftLine = computed(() => {
  if (!goal.value || term.value?.off || remaining.value <= 0 || !Number.isFinite(months.value)) return ''
  // Подушка (PN-20): срок «Соберём в …» уходит сюда — в карточке «хватит на N».
  if (cover.value && doneMonth.value) return `Соберём в ${monthIn(doneMonth.value)} · осталось ${months.value} ${plural(months.value, 'взнос', 'взноса', 'взносов')}`
  return `Осталось ${months.value} ${plural(months.value, 'взнос', 'взноса', 'взносов')}${term.value?.afterPlan && doneMonth.value ? ' · после плана' : ''}`
})
/**
 * Срок на обложке (FG-24, 78:50) — одна строка 13: «к сентябрю 2034», «на паузе», «после плана», «срока пока нет», «взнос не
 * задан»; поездка — её даты; сбывшаяся — «Сбылось». Те же `term`, что у прежней карточки. Подушка — тот же срок: «хватит на N»
 * уже заголовком карточки под обложкой (правило 12 «нет шумных цифр» — не дублировать).
 */
const termShort = computed(() => {
  if (!goal.value) return ''
  if (isDone.value) return 'Сбылось'
  if (goal.value.from && goal.value.to) return weekRangeLabel({ from: goal.value.from, to: goal.value.to })
  if (term.value?.off) return 'на паузе'
  if (remaining.value <= 0) return isFund.value ? 'собрано' : 'накоплено'
  if (doneMonth.value) {
    const { year, month } = parseMonthKey(doneMonth.value)
    return `к ${MONTHS_DAT[month]} ${year}`
  }
  if (term.value?.afterPlan) return 'после плана'
  return goal.value.monthly > 0 ? 'срока пока нет' : 'взнос не задан'
})

/* ------------------ Поездка (PN-31, Р-14) ------------------ */
// Даты поездки — сроком на обложке (FG-24); с первого дня — карточка «Потрачено в поездке» под ней.
const trip = computed(() => (goal.value ? tripStatus(goal.value, todayIso()) : 'none'))
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

/* ------------------ Лист «Взнос в месяц» (FG-24): поле взноса, «Снять», у фонда — месяцев трат ------------------ */
const monthlyOpen = ref(false)
/** «Снять» из листа взноса — тот же лист «Снять средства», что был в «Подробнее». */
function openWithdraw() {
  monthlyOpen.value = false
  depositOperation.value = 'withdraw'
  openDepositModal.value = true
}
function openDeposit() {
  depositOperation.value = 'deposit'
  openDepositModal.value = true
}

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
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-glass text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
        data-goal-share
        @click="share"
      >
        <PhShareNetwork :size="19" />
      </button>
      <button
        v-if="canEdit"
        type="button"
        aria-label="Меню цели"
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-glass text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
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

    <!-- Обложка-карточка (FG-24, 78:50): название, процент, «накоплено из нужно», полоса; внизу — срок и «Пополнить» у предмета.
         Поверх картинки — маленькая кнопка смены фото; автор — один раз, на фото, ссылкой (Р-28). -->
    <DreamHero
      :title="goal.name"
      :percent="progress"
      :line="isDone ? money(goal.have) : `${plain(goal.have)} из ${money(need)}`"
      :src="photoSrc"
      :author="goal.photoCredit?.author"
      :author-url="goal.photoCredit?.url"
      size="goal"
      data-goal-cover
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
      <template #footer="{ onPhoto }">
        <!-- ✦ совета ИИ про эту цель (бэклог «Разбор», RZ-11) — у срока: нажатие — отчёт на карточке совета. -->
        <span class="flex min-w-0 items-center gap-1 text-[13px] num" :class="onPhoto ? 'opacity-90' : 'text-ink-2'" data-goal-term>{{ termShort }}<AdviceMark :n="goalMark" /></span>
        <Button v-if="canEdit && !isDone && !askBought && !askTrip" size="sm" class="shrink-0" data-goal-deposit @click="openDeposit">Пополнить</Button>
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

    <!-- Поездка (PN-31, FG-24 78:104): в пути и после — «Потрачено в поездке» у мечты. -->
    <TripCard v-if="trip === 'during' || trip === 'after'" :goal="goal" :status="trip" />

    <!-- «Купили?» / «Съездили?» (PN-14, Б9) — тонкая строка 48: «Ещё нет» и брендовая «Сбылось» маленькими, у вопроса. -->
    <div v-if="!isDone && (askBought || askTrip)" class="flex min-h-12 items-center justify-between gap-3 rounded-card border border-card-border bg-surface px-4" :data-goal-ask="askBought ? '' : undefined" :data-trip-ask="askTrip ? '' : undefined">
      <span class="text-[14px] font-medium text-ink">{{ askTrip ? 'Съездили?' : canEdit ? 'Купили?' : 'Накоплено' }}</span>
      <span v-if="canEdit" class="flex shrink-0 gap-2">
        <Button variant="outline" size="xs" data-goal-not-yet @click="notYet = true">Ещё нет</Button>
        <Button size="xs" data-goal-done @click="markDone">Сбылось</Button>
      </span>
    </div>

    <!-- Пауза плана и подушка — тихой строкой к плану долгов на «Закрыть быстрее», между обложкой и ячейками, без черты
         (FG-24, макет 78:50: без цветной плашки). -->
    <RouterLink
      v-if="(paused || planCushion) && !isDone"
      to="/money/debts/faster"
      class="press flex items-center gap-2.5 px-1 py-1.5 text-[14px] text-ink"
      data-goal-plan
    >
      <span class="min-w-0 flex-1">{{ paused ? 'На паузе — взнос идёт в долг' : 'Подушка плана — взносы идут' }}</span>
      <PhCaretRight :size="16" class="shrink-0 text-ink-3" />
    </RouterLink>

    <!-- Сбывшаяся (PN-14): месяц и «за N месяцев»; действий нет. -->
    <Card v-if="isDone">
      <h2 class="type-h2 flex items-center gap-2 text-ink" data-goal-done-at>
        <span class="grid size-[22px] shrink-0 place-items-center rounded-full bg-ok text-surface"><PhCheck :size="13" weight="bold" /></span>{{ doneAtTitle }}
      </h2>
      <p class="mt-1.5 text-[15px] text-ink-2">{{ doneTermLine }}</p>
    </Card>
    <!-- «В месяц | Осталось» (FG-24): «В месяц» — лист взноса (поле, «Снять», фонд); подушка — «хватит на» заголовком над ячейками.
         Пока висит «Купили?» / «Съездили?» — ячеек нет, как и «Пополнить» (макет 78:104): сначала ответ; «Ещё нет» их вернёт. -->
    <Card v-else-if="!askBought && !askTrip" data-goal-cells>
      <template v-if="cover">
        <h2 class="type-h2" :class="coverFull ? 'text-ok' : 'text-ink'" data-cushion-cover>{{ coverTitle }}{{ coverFull ? ' ✓' : '' }}</h2>
        <p class="mb-3 mt-1 text-[14px] text-ink-2 num" data-cushion-need>нужно на {{ monthsLabel(cover.monthsNeeded) }}</p>
      </template>
      <div class="grid grid-cols-2 gap-3">
        <component
          :is="canEdit ? 'button' : 'div'"
          :type="canEdit ? 'button' : undefined"
          class="flex min-w-0 flex-col items-start text-left"
          :class="canEdit && 'press cursor-pointer'"
          data-goal-monthly
          @click="canEdit && (monthlyOpen = true)"
        >
          <span class="flex items-center gap-0.5 text-[13px] text-ink-2">В месяц<PhCaretRight v-if="canEdit" :size="12" class="text-ink-3" /></span>
          <span class="text-[17px] font-semibold num text-ink" data-goal-monthly-value>{{ goal.monthly > 0 ? money(goal.monthly) : '—' }}</span>
        </component>
        <!-- Разделитель между ячейками — как в макете 78:50. -->
        <div class="flex min-w-0 flex-col items-start border-l border-line pl-3" data-goal-left>
          <span class="text-[13px] text-ink-2">Осталось</span>
          <span class="text-[17px] font-semibold num text-ink">{{ money(Math.max(0, remaining)) }}</span>
        </div>
      </div>
      <!-- Метка «мечта сдвинулась» (AU-06, Р-6) и «Вернуть срок» у неё — тихо, под ячейками -->
      <div v-if="shift" class="mt-3 flex items-center justify-between gap-2">
        <p class="flex min-w-0 items-start gap-1.5 text-[13px] text-ink-2" data-goal-shift>
          <!-- Точка — у первой строки: метка рядом с «Вернуть срок» переносится на две -->
          <i class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="shift.days > 0 ? 'bg-warn' : 'bg-ok'" aria-hidden="true" />{{ shiftText }}
        </p>
        <Button v-if="canEdit && returnShift" variant="secondary" size="sm" class="shrink-0" data-return-term @click="returnOpen = true">Вернуть срок</Button>
      </div>
    </Card>

    <!-- Взносы — прямо на экране (FG-24); заголовок 17 жирным, пусто — одной строкой без карточки (макеты 78:50, 78:104) -->
    <h2 class="mt-3 px-1 text-[17px] font-semibold text-ink">Взносы</h2>
    <Card v-if="history.length" flush>
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
          data-goal-movement
        >{{ m.amount > 0 ? '+' : '−' }}{{ money(Math.abs(m.amount)) }}</span>
      </div>
    </Card>
    <p v-else class="-mt-1 px-1 text-[13px] text-ink-2" data-goal-no-movements>Пока нет — появятся после первого пополнения</p>

    <!-- Лист «Взнос в месяц» (FG-24): поле взноса, у фонда — месяцев трат; «осталось N взносов» подписью; тихая «Снять». -->
    <Sheet v-if="canEdit" :open="monthlyOpen" title="Взнос в месяц" @close="monthlyOpen = false">
      <template #default="{ close }">
        <!-- Подписи над полем нет — её говорит заголовок листа (`/ux`: «Откладывать в месяц» повторяло «Взнос в месяц»). -->
        <Field>
          <NumFieldBlur :initial="plain(goal.monthly)" aria-label="Откладывать в месяц" data-goal-monthly-field @commit="onMonthly" />
        </Field>
        <div v-if="leftLine || monthlySaved" class="-mt-2 mb-3.5 flex items-baseline justify-between gap-2">
          <p v-if="leftLine" class="text-[13px] text-ink-2 num" data-goal-left-line>{{ leftLine }}</p>
          <SavedMark class="ml-auto" :on="monthlySaved" />
        </div>
        <!-- Порог фонда — месяцев трат (Н-9): «нужно» = месяцы × траты месяца по плану; число месяцев — без «₸». -->
        <Field v-if="fundKind" label="Месяцев трат">
          <template #hint>
            <Hint v-if="cover" label="Как считается «нужно»">Нужно = месяцы × (платежи + траты по плану)</Hint>
            <SavedMark class="ml-auto" :on="fundSaved" />
          </template>
          <NumFieldBlur :initial="String(fundMonths)" kind="int" aria-label="Порог фонда — месяцев трат" @commit="onFundMonths" />
        </Field>
        <Button class="w-full" data-goal-monthly-save @click="close">Сохранить</Button>
        <Button variant="outline" size="md" class="mx-auto mt-2 flex w-fit" data-goal-withdraw @click="openWithdraw">Снять</Button>
      </template>
    </Sheet>

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

