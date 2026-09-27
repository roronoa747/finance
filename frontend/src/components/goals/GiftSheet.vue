<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { parseMoney } from '@/lib/money'
import { compressImage } from '@/lib/photos/compress'
import { uploadPhoto } from '@/lib/photos/store'
import type { PersonId } from '@/types/finance'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * «Сюрприз для <имя>» (DESIGN.md g4 «Подарок-сюрприз»; B2C-18): запись в личном документе
 * автора — адресат не увидит ни здесь, ни в итогах. Фото — со скрытым признаком (только автору).
 */
const props = defineProps<{
  open: boolean
  forSlot: PersonId
  forName: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()
const name = ref('')
const price = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const note = ref<string | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = ''
      price.value = ''
      file.value = null
      note.value = null
    }
  },
)

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  input.value = ''
}

async function add() {
  const what = name.value.trim()
  if (!what) return
  busy.value = true
  try {
    let photoId: string | null = null
    if (file.value && !finance.isDemo) {
      try {
        const { blob } = await compressImage(file.value)
        photoId = await uploadPhoto(blob, { hidden: true })
      } catch {
        note.value = 'Фото не загрузилось — подарок записан без него.'
      }
    }
    finance.addGift({ forSlot: props.forSlot, name: what, price: parseMoney(price.value), photoId })
    if (!note.value) emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet :open="open" :title="`Сюрприз для ${forName}`" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <Callout tone="neutral" icon="lock">{{ forName }} не увидит — только вы.</Callout>
      <Field label="Что">
        <Input v-model="name" placeholder="Билеты на концерт" />
      </Field>
      <Field label="Сколько">
        <NumField v-model="price" placeholder="36 000" />
      </Field>
      <div class="flex flex-wrap items-center gap-2">
        <Chip quiet @click="fileInput?.click()">{{ file ? 'Другое фото' : 'Фото' }}</Chip>
        <span v-if="file" class="text-[12px] text-ink-3">{{ file.name }} · увидите только вы</span>
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
      <Callout v-if="note" tone="neutral" icon="info">{{ note }}</Callout>
      <Button size="lg" class="w-full" :disabled="!name.trim() || busy" @click="add">Добавить</Button>
    </div>
  </Sheet>
</template>
