<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useEventsStore } from '@/stores/events'
import { useFxStore } from '@/stores/fx'
import { useAuthStore } from '@/stores/auth'
import { money, parseMoney } from '@/lib/money'
import { monthIn, monthKey } from '@/lib/dates'
import { budgetAmounts, fundsOf, goalDoneMonth, goalMonthly } from '@/lib/finance'
import { GOAL_TEMPLATES, GOAL_TYPES, TRAVEL_DIRECTIONS, templateImageUrl, themePhotos, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate } from '@/lib/photos/goalPhoto'
import type { LinkFound } from '@/lib/photos/useLinkPreview'
import LinkPhotoField from '@/components/goals/LinkPhotoField.vue'
import ThemePhotoRow from '@/components/goals/ThemePhotoRow.vue'
import ThemePhotoViewer from '@/components/goals/ThemePhotoViewer.vue'
import TripFields, { tripDatesError } from '@/components/goals/TripFields.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Chip from '@/components/kit/Chip.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Tag from '@/components/kit/Tag.vue'
import TemplateTile from '@/components/kit/TemplateTile.vue'

/**
 * «Новая мечта» (DESIGN.md §2 g3 «На что копим», «Сумма и срок»; B2C-18): шаблон или своё фото →
 * название → сумма → срок → взнос считается (`goalMonthly`), «будет вашей в …» → цель. Первая
 * цель семьи — главная (стор). Тот же экран — из «+» и из первого запуска (`next` — `Start.vue`).
 * Картинка грузится после создания (`lib/photos/goalPhoto`), офлайн — при следующей сети; не
 * загрузилась — экран цели узнаёт об этом из адреса (`?photo=failed|later`), в первом запуске — нет.
 * «По ссылке» (PN-08): картинка со страницы — как своё фото, название — со страницы, если своего нет.
 * «Подушка» (PN-19): без формы — фонд семьи (`ensureFund`), «нужно» считает план месяца; в первом запуске плитки нет.
 * «Путешествие» и направления (PN-31): под суммой — даты и бюджет поездки, необязательные (`setTripDates` после `addGoal`).
 */
/** Куда идти после мечты: первый запуск (B2C-19) рендерит экран внутри себя и задаёт следующий шаг. */
const props = defineProps<{ next?: string }>()

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const fx = useFxStore()
const authStore = useAuthStore()

const nextPath = () => props.next ?? (route.query.next ? String(route.query.next) : null)

const step = ref<'pick' | 'form'>('pick')
const template = ref<GoalTemplate | null>(null)
const pickedType = ref<GoalTemplate['type'] | null>(null)
const ownFile = ref<File | null>(null)
const ownPreview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
// Поле ссылки — под сеткой, раскрыто плиткой «По ссылке»; выбор темы его сворачивает.
const linkOpen = ref(false)

const name = ref('')
const needText = ref('')
const TERMS = [
  { value: '6', label: '6 мес' },
  { value: '12', label: '12 мес' },
  { value: '18', label: '18 мес' },
  { value: 'custom', label: 'свой' },
]
const term = ref('12')
const customMonths = ref('24')

const need = computed(() => parseMoney(needText.value))
// Поездка (PN-31): даты и бюджет — только у «Путешествия» (и направлений); своё фото — мечта без дат.
const isTrip = computed(() => template.value?.type === 'travel')
const tripFrom = ref('')
const tripTo = ref('')
const tripBudget = ref('')
const months = computed(() => (term.value === 'custom' ? Math.max(1, parseMoney(customMonths.value) || 1) : Number(term.value)))
const monthly = computed(() => (need.value > 0 ? goalMonthly(need.value, months.value) : 0))
// Та же дата, что покажут экран цели и герой (`goalDoneMonth`); срок здесь всегда конечен.
const doneMonth = computed(() => monthIn(goalDoneMonth(months.value, monthKey())!))
// «Реально» — взнос укладывается в свободное по плану месяца. В первом запуске мечта — до зарплаты:
// свободного ещё нет, ни «при остатке», ни «реально» не показываем (бэклог «первый» FR-01).
const free = computed(() => budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits, book: fx.book }).d5)
const realistic = computed(() => !props.next && monthly.value > 0 && monthly.value <= free.value)
// Одна форма на экран (provide один): правила — по шагу.
const form = useFormCheck(() =>
  step.value === 'pick'
    ? [['photo', !template.value && 'Выберите картинку']]
    : [
        ['name', !name.value.trim() && 'Введите название'],
        ['need', need.value <= 0 && 'Введите сумму'],
        ['tripDates', isTrip.value && tripDatesError(tripFrom.value, tripTo.value)],
      ],
)

// Первый запуск (`next` задаёт только `Start.vue`) — только мечты: подушка героем не бывает, «Мечты» новичка остались бы
// пустыми (решение владельца, `pn-block-6-first-run-cushion.md`). Подушку заводят позже — «Новая мечта» или «Месяц».
const types = computed(() => (props.next ? GOAL_TYPES.filter((k) => k.type !== 'cushion') : GOAL_TYPES))
// Темы по две в ряд (FR-09): тем нечётно — «По ссылке» на весь последний ряд, без пустой ячейки (`/ux` возврата Б6).
const linkWide = computed(() => types.value.length % 2 === 1)
const directions = computed(() => (pickedType.value === 'travel' ? TRAVEL_DIRECTIONS : []))
// Несколько фото на тему (B2C-64-а): ряд под сеткой, первое — фото плитки.
const variants = computed(() => (pickedType.value ? themePhotos(pickedType.value) : []))
const byType = (type: GoalTemplate['type']) => GOAL_TEMPLATES.find((t) => t.id === type)!
const previewSrc = computed(() => ownPreview.value ?? (template.value ? templateImageUrl(template.value, 800) : null))

/** Превью своего фото — object URL: освобождается при смене выбора и уходе с экрана. */
function dropPreview() {
  if (ownPreview.value) URL.revokeObjectURL(ownPreview.value)
  ownPreview.value = null
}
onBeforeUnmount(dropPreview)

function pickType(type: GoalTemplate['type']) {
  pickedType.value = type
  template.value = byType(type)
  ownFile.value = null
  linkOpen.value = false
  dropPreview()
  // Фото темы — на весь экран, листаются (владелец, FR-09); у «Путешествия» — направления чипами, просмотра нет.
  viewerOpen.value = variants.value.length > 1
}
/** Просмотр фото темы на весь экран (FR-09). */
const viewerOpen = ref(false)
/** «Выбрать это» в просмотре — это фото, дальше форма (как «Дальше» под сеткой). */
function onViewerPick(t: GoalTemplate) {
  template.value = t
  viewerOpen.value = false
  next()
}
function pickTemplate(t: GoalTemplate) {
  template.value = t
}
/** Своё фото — из галереи или со страницы по ссылке: шаблон снимается, превью из object URL, дальше форма. */
function pickOwn(file: File) {
  ownFile.value = file
  template.value = null
  pickedType.value = null
  // Фото выбрано — поле ссылки сворачивается: «Назад» из формы не возвращает его раскрытым с клавиатурой (`/ux` Блока 3).
  linkOpen.value = false
  dropPreview()
  ownPreview.value = typeof URL !== 'undefined' && 'createObjectURL' in URL ? URL.createObjectURL(file) : null
  next()
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) pickOwn(file)
}
function onLink(found: LinkFound) {
  if (!found.file) return
  // Название со страницы — если своего ещё нет (как у желаний).
  if (!name.value.trim() && found.title) name.value = found.title
  pickOwn(found.file)
}
function next() {
  // «Подушка» (PN-19, Р-12) — фонд семьи, а не мечта: «нужно» считает план месяца, формы нет.
  if (pickedType.value === 'cushion') return void createCushion()
  if (template.value && !name.value) name.value = template.value.name
  step.value = 'form'
}
function skip() {
  void router.push(nextPath() ?? '/')
}

async function create() {
  if (authStore.isViewer) return
  const file = ownFile.value
  const tpl = template.value
  const id = financeStore.addGoal({
    name: name.value.trim(),
    need: need.value,
    monthly: monthly.value,
    hue: tpl?.hue ?? 'blue',
    template: tpl?.id ?? null,
  })
  const budget = parseMoney(tripBudget.value)
  if (isTrip.value && (tripFrom.value || budget > 0)) financeStore.setTripDates(id, { from: tripFrom.value, to: tripTo.value, budget })
  await land(id, () => (file ? attachFile(financeStore, id, file) : tpl ? attachTemplate(financeStore, id, tpl).then((r) => r === 'uploaded') : Promise.resolve(true)), file ? 'failed' : 'later')
}

/**
 * Подушка одна на семью (`ensureFund`): есть (в том числе копилка Блока 11) — ведём к ней с тостом «Подушка уже есть»
 * (`?fund=exists`), фото не трогаем; новая — с выбранным вариантом фото темы.
 */
async function createCushion() {
  if (authStore.isViewer) return
  const tpl = template.value
  const existed = fundsOf(financeStore.householdDoc).cushion
  const id = financeStore.ensureFund('cushion')
  if (existed) return void (await land(id, null, 'later', { fund: 'exists' }))
  await land(id, () => (tpl ? attachTemplate(financeStore, id, tpl).then((r) => r === 'uploaded') : Promise.resolve(true)), 'later')
}

/** Цель записана → на её экран (или дальше первого запуска), потом картинка. */
async function land(id: string, upload: (() => Promise<boolean>) | null, failed: 'failed' | 'later', query: Record<string, string> = {}) {
  const next = nextPath()
  // Цель выбрана в первом запуске (B2C-28): событие воронки.
  if (next?.startsWith('/start')) useEventsStore().track('first_run_goal')
  const here = `/goals/${id}`
  await router.push(next ?? { path: here, query })
  // Картинка — после перехода: цель уже есть, фото догрузится (шаблон — и при следующей сети).
  const done = upload ? await upload() : true
  // Не загрузилось — экран цели скажет об этом (своё фото само не догрузится); первый запуск и
  // демо (сервера нет) — без заметки.
  if (done || next || financeStore.isDemo || router.currentRoute.value.path !== here) return
  await router.replace({ path: here, query: { photo: failed } })
}

// Внутри AppShell (/goals/new) шапка экрана уже есть; в первом запуске (/start/dream) — нет.
const inShell = inject<boolean>('ff-shell-actions', false)
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <template v-if="step === 'pick'">
      <!-- В оболочке заголовок «Новая мечта» уже в шапке — второй заголовок подряд не нужен (возврат смоука); в первом запуске это заголовок шага. -->
      <h2 v-if="!inShell" class="type-h2-lg text-ink">На что копим?</h2>
      <Field name="photo" group class="!mb-0">
        <div class="grid grid-cols-2 gap-2.5">
          <TemplateTile
            v-for="k in types"
            :key="k.type"
            :name="k.name"
            :src="templateImageUrl(byType(k.type), 400)"
            :selected="pickedType === k.type"
            @click="pickType(k.type)"
          />
          <div class="contents" data-own-tiles>
            <TemplateTile name="Своё фото" camera @click="fileInput?.click()" />
            <TemplateTile name="По ссылке" link :selected="linkOpen" :class="linkWide && 'col-span-2'" data-link-tile @click="linkOpen = !linkOpen" />
          </div>
        </div>
      </Field>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
      <LinkPhotoField v-if="linkOpen" @found="onLink" />
      <template v-if="directions.length">
        <div class="mt-1 px-1 type-section">Куда</div>
        <div class="flex flex-wrap gap-2">
          <Chip v-for="d in directions" :key="d.id" :on="template?.id === d.id" @click="pickTemplate(d)">{{ d.name }}</Chip>
          <Chip quiet :on="template?.id === 'travel'" @click="pickTemplate(byType('travel'))">Своё</Chip>
        </div>
      </template>
      <ThemePhotoRow v-if="variants.length > 1" :photos="variants" :selected="template?.id" @pick="pickTemplate" />
      <ThemePhotoViewer v-if="viewerOpen" :photos="variants" @pick="onViewerPick" @close="viewerOpen = false" />
      <!-- Механика (Unsplash, сжатие) на экране не объясняется — автор виден на фото (правило интерфейса). -->
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" @click="form.submit(next)">Дальше</Button>
        <!-- В первом запуске — «Пропустить» в шапке шага (FR-03); вне его «Пока без мечты» ведёт на главный. -->
        <Button v-if="!props.next" variant="ghost" size="md" class="w-full" @click="skip">Пока без мечты</Button>
      </div>
    </template>

    <template v-else>
      <DreamHero
        size="preview"
        :src="previewSrc"
        :author="template?.photo.author"
        line=""
      />
      <Field label="Название" name="name">
        <Input v-model="name" placeholder="Япония" class="bg-surface" />
      </Field>
      <Field label="Сколько нужно" name="need">
        <NumField v-model="needText" placeholder="1 800 000" class="bg-surface" />
      </Field>
      <TripFields v-if="isTrip" v-model:from="tripFrom" v-model:to="tripTo" v-model:budget="tripBudget" field-class="bg-surface" />
      <Field label="Когда" group>
        <Segmented v-model="term" :options="TERMS" />
        <NumField v-if="term === 'custom'" v-model="customMonths" kind="int" placeholder="месяцев" class="mt-2 bg-surface" />
      </Field>
      <div v-if="need > 0" class="rounded-inner bg-surface-2 px-3.5 py-3">
        <div class="flex items-center justify-between gap-3">
          <span class="font-medium text-ink">По {{ money(monthly) }} в месяц</span>
          <Tag v-if="realistic" tone="ok">реально</Tag>
        </div>
        <div class="mt-1 text-[13px] text-ink-2"><template v-if="!props.next">при остатке ≈ {{ money(Math.max(0, free)) }} · </template>будет вашей в {{ doneMonth }}</div>
      </div>
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <!-- В первом запуске дальше — зарплата, а не мечта (`/ux` Блока 1 «первый»): кнопка называет следующий шаг. -->
        <Button size="lg" class="w-full" @click="form.submit(create)">{{ props.next ? 'Дальше' : 'Готово — к мечте' }}</Button>
        <Button variant="ghost" size="md" class="w-full" @click="step = 'pick'">Назад</Button>
      </div>
    </template>
  </div>
</template>
