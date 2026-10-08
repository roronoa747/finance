<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { GOAL_TEMPLATES, GOAL_TYPES, TRAVEL_DIRECTIONS, templateImageUrl, type GoalTemplate, type GoalTemplateType } from '@/lib/goalTemplates'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/kit/Sheet.vue'
import TemplateTile from '@/components/kit/TemplateTile.vue'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'

/**
 * Выбор картинки мечты (DESIGN.md §5 `TemplateTile` / `PhotoPicker`, g3 «На что копим» и g4
 * «Новая мечта — фото шаблона»; B2C-17): пять типов с фото Unsplash и «Своё фото» (камера или
 * галерея); у «Путешествия» — второй шаг с направлениями. Ничего не грузит сам — отдаёт
 * выбор родителю (`template` / `file`), тот скачивает, сжимает и загружает (`lib/photos/goalPhoto`).
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    /** Уже выбранный шаблон — подсветить. */
    selected?: string | null
    /** Можно пропустить (цель без картинки). */
    skippable?: boolean
    /** Фото уже есть — показать тихое «Убрать фото» (действия не лежат поверх картинки). */
    removable?: boolean
  }>(),
  { title: 'На что копим?', selected: null, skippable: true, removable: false },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'template', t: GoalTemplate): void
  (e: 'file', f: File): void
  (e: 'skip'): void
  (e: 'remove'): void
}>()

const byType = (type: GoalTemplateType) => GOAL_TEMPLATES.find((t) => t.id === type)!
const pickedType = ref<GoalTemplateType | null>(null)
const pickedId = ref<string | null>(props.selected)
const fileInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pickedId.value = props.selected
    const t = props.selected ? GOAL_TEMPLATES.find((x) => x.id === props.selected) : null
    pickedType.value = t?.type ?? null
  },
)

const directions = computed(() => (pickedType.value === 'travel' ? TRAVEL_DIRECTIONS : []))
const picked = computed(() => GOAL_TEMPLATES.find((t) => t.id === pickedId.value) ?? null)
const form = useFormCheck(() => [['photo', !picked.value && 'Выберите картинку']])

function pickType(type: GoalTemplateType) {
  pickedType.value = type
  pickedId.value = type
}

function confirm() {
  if (picked.value) emit('template', picked.value)
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('file', file)
}
</script>

<template>
  <Sheet :open="open" :title="title" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <Field name="photo" group class="!mb-0">
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
      </Field>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />

      <template v-if="directions.length">
        <div class="mt-1 px-1 type-section">Куда</div>
        <div class="flex flex-wrap gap-2">
          <Chip v-for="d in directions" :key="d.id" :on="pickedId === d.id" @click="pickedId = d.id">{{ d.name }}</Chip>
          <Chip quiet :on="pickedId === 'travel'" @click="pickedId = 'travel'">Своё</Chip>
        </div>
      </template>

      <!-- Автор — один раз, на самом фото героя после выбора (владелец): здесь строкой не повторяем. -->
      <Button size="lg" class="w-full" @click="form.submit(confirm)">Выбрать это</Button>
      <Button v-if="skippable" variant="ghost" class="w-full" @click="emit('skip')">Пропустить</Button>
      <Button v-if="removable" variant="ghost" class="w-full" @click="emit('remove')">Убрать фото</Button>
    </div>
  </Sheet>
</template>
