<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, parseMoney } from '@/lib/money'
import { monthIn, monthKey } from '@/lib/dates'
import { budgetAmounts, goalDoneMonth, goalMonthly } from '@/lib/finance'
import { GOAL_TEMPLATES, GOAL_TYPES, TRAVEL_DIRECTIONS, templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'
import { attachFile, attachTemplate } from '@/lib/photos/goalPhoto'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Chip from '@/components/kit/Chip.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Tag from '@/components/kit/Tag.vue'
import TemplateTile from '@/components/kit/TemplateTile.vue'

/**
 * «Новая мечта» (DESIGN.md §2 g3 «На что копим», «Сумма и срок»; B2C-18): шаблон или своё фото →
 * название → сумма → срок → взнос считается (`goalMonthly`), «будет вашей в …» → цель. Первая
 * цель семьи — главная (стор). Тот же экран — из «+» и из первого запуска (`?next=`).
 * Картинка грузится после создания (`lib/photos/goalPhoto`), офлайн — при следующей сети; не
 * загрузилась — экран цели узнаёт об этом из адреса (`?photo=failed|later`), в первом запуске — нет.
 */
/** Куда идти после мечты: первый запуск (B2C-19) рендерит экран внутри себя и задаёт следующий шаг. */
const props = defineProps<{ next?: string }>()

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const nextPath = () => props.next ?? (route.query.next ? String(route.query.next) : null)

const step = ref<'pick' | 'form'>('pick')
const template = ref<GoalTemplate | null>(null)
const pickedType = ref<GoalTemplate['type'] | null>(null)
const ownFile = ref<File | null>(null)
const ownPreview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

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
const months = computed(() => (term.value === 'custom' ? Math.max(1, parseMoney(customMonths.value) || 1) : Number(term.value)))
const monthly = computed(() => (need.value > 0 ? goalMonthly(need.value, months.value) : 0))
// Та же дата, что покажут экран цели и герой (`goalDoneMonth`); срок здесь всегда конечен.
const doneMonth = computed(() => monthIn(goalDoneMonth(months.value, monthKey())!))
// «Реально» — взнос укладывается в свободное по плану месяца.
const free = computed(() => budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits }).d5)
const realistic = computed(() => monthly.value > 0 && monthly.value <= free.value)
const canCreate = computed(() => name.value.trim().length > 0 && need.value > 0 && !authStore.isViewer)

const directions = computed(() => (pickedType.value === 'travel' ? TRAVEL_DIRECTIONS : []))
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
  dropPreview()
}
function pickDirection(t: GoalTemplate) {
  template.value = t
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  ownFile.value = file
  template.value = null
  pickedType.value = null
  dropPreview()
  ownPreview.value = typeof URL !== 'undefined' && 'createObjectURL' in URL ? URL.createObjectURL(file) : null
  next()
}
function next() {
  if (template.value && !name.value) name.value = template.value.name
  step.value = 'form'
}
function skip() {
  void router.push(nextPath() ?? '/')
}

async function create() {
  if (!canCreate.value) return
  const file = ownFile.value
  const tpl = template.value
  const id = financeStore.addGoal({
    name: name.value.trim(),
    need: need.value,
    monthly: monthly.value,
    hue: tpl?.hue ?? 'blue',
    template: tpl?.id ?? null,
  })
  const next = nextPath()
  const here = `/goals/${id}`
  await router.push(next ?? here)
  // Картинка — после перехода: цель уже есть, фото догрузится (шаблон — и при следующей сети).
  const done = file ? await attachFile(financeStore, id, file) : tpl ? (await attachTemplate(financeStore, id, tpl)) === 'uploaded' : true
  // Не загрузилось — экран цели скажет об этом (своё фото само не догрузится); первый запуск и
  // демо (сервера нет) — без заметки.
  if (done || next || financeStore.isDemo || router.currentRoute.value.path !== here) return
  await router.replace({ path: here, query: { photo: file ? 'failed' : 'later' } })
}
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <template v-if="step === 'pick'">
      <h2 class="type-h2-lg text-ink">На что копим?</h2>
      <div class="grid grid-cols-3 gap-2.5">
        <TemplateTile
          v-for="k in GOAL_TYPES"
          :key="k.type"
          :name="k.name"
          :src="templateImageUrl(byType(k.type), 400)"
          :selected="pickedType === k.type"
          @click="pickType(k.type)"
        />
        <TemplateTile name="Своё фото" camera @click="fileInput?.click()" />
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
      <template v-if="directions.length">
        <div class="mt-1 px-1 type-section">Куда</div>
        <div class="flex flex-wrap gap-2">
          <Chip v-for="d in directions" :key="d.id" :on="template?.id === d.id" @click="pickDirection(d)">{{ d.name }}</Chip>
          <Chip quiet :on="template?.id === 'travel'" @click="pickDirection(byType('travel'))">Своё</Chip>
        </div>
      </template>
      <!-- Механика (Unsplash, сжатие) на экране не объясняется — автор виден на фото (правило интерфейса). -->
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" :disabled="!template" @click="next">Дальше</Button>
        <Button variant="ghost" class="w-full" @click="skip">Пока без мечты</Button>
      </div>
    </template>

    <template v-else>
      <DreamHero
        size="preview"
        :src="previewSrc"
        :author="template?.photo.author"
        :line="template ? `${GOAL_TYPES.find((k) => k.type === template!.type)?.name ?? ''} · ${template.name}` : 'Своё фото'"
      />
      <Field label="Название">
        <Input v-model="name" placeholder="Япония" />
      </Field>
      <Field label="Сколько нужно">
        <NumField v-model="needText" placeholder="1 800 000" />
      </Field>
      <Field label="Когда" group>
        <Segmented v-model="term" :options="TERMS" />
        <NumField v-if="term === 'custom'" v-model="customMonths" kind="int" placeholder="месяцев" class="mt-2" />
      </Field>
      <div v-if="need > 0" class="rounded-inner bg-surface-2 px-3.5 py-3">
        <div class="flex items-center justify-between gap-3">
          <span class="font-medium text-ink">По {{ money(monthly) }} в месяц</span>
          <Tag v-if="realistic" tone="ok">реально</Tag>
        </div>
        <div class="mt-1 text-[13px] text-ink-2">при свободных ≈ {{ money(Math.max(0, free)) }} · будет вашей в {{ doneMonth }}</div>
      </div>
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" :disabled="!canCreate" @click="create">Готово — к мечте</Button>
        <Button variant="ghost" class="w-full" @click="step = 'pick'">Назад</Button>
      </div>
    </template>
  </div>
</template>
