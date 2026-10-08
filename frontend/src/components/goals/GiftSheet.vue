<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { parseMoney, plain } from '@/lib/money'
import { compressImage } from '@/lib/photos/compress'
import { deletePhoto, uploadPhoto } from '@/lib/photos/store'
import { usePhoto } from '@/lib/photos/usePhoto'
import type { PersonId } from '@/types/finance'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import PhotoSlot from '@/components/goals/PhotoSlot.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * «Сюрприз для <имя>» (DESIGN.md g4 «Подарок-сюрприз»; B2C-18): запись в личном документе
 * автора — адресат не увидит ни здесь, ни в итогах. Фото — со скрытым признаком (только автору).
 * `giftId` — правка (ML-07, хвост 955): имя, цена, фото; «Сохранить» — главное, «Удалить» — тихо
 * внизу и уносит фото с сервера. Viewer — только смотрит.
 */
const props = defineProps<{
  open: boolean
  forSlot: PersonId
  forName: string
  giftId?: string | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()
const authStore = useAuthStore()
const canEdit = computed(() => !authStore.isViewer)
const gift = computed(() => (props.giftId ? finance.gifts.find((g) => g.id === props.giftId) : undefined))
const editing = computed(() => !!props.giftId)
const name = ref('')
const price = ref('')
const file = ref<File | null>(null)
// Правка: «убрать фото» — до «Сохранить» только отметка, сервер не трогаем.
const dropPhoto = ref(false)
const busy = ref(false)
const form = useFormCheck(() => [['name', !name.value.trim() && 'Введите, что это']])
const note = ref<string | null>(null)
const photoSrc = usePhoto(() => (dropPhoto.value ? null : gift.value?.photoId))

watch(
  () => [props.open, props.giftId] as const,
  ([open]) => {
    if (open) {
      name.value = gift.value?.name ?? ''
      price.value = gift.value ? plain(gift.value.price) : ''
      file.value = null
      dropPhoto.value = false
      note.value = null
    }
  },
  { immediate: true },
)

/** Новое фото — на сервер со скрытым признаком; сбой — null и заметка. */
async function upload(): Promise<string | null> {
  if (!file.value || finance.isDemo) return null
  try {
    const { blob } = await compressImage(file.value)
    return await uploadPhoto(blob, { hidden: true })
  } catch {
    note.value = editing.value ? 'Фото не загрузилось — остальное сохранено.' : 'Фото не загрузилось — подарок записан без него.'
    return null
  }
}

async function add() {
  const what = name.value.trim()
  if (!what) return
  busy.value = true
  try {
    const photoId = await upload()
    finance.addGift({ forSlot: props.forSlot, name: what, price: parseMoney(price.value), photoId })
    // Записано — поля пустые: второе «Добавить» после сбоя фото не создаст дубль (критик Блока 3).
    name.value = ''
    price.value = ''
    file.value = null
    if (!note.value) emit('close')
  } finally {
    busy.value = false
  }
}

async function save() {
  const g = gift.value
  const what = name.value.trim()
  if (!g || !what) return
  busy.value = true
  try {
    const old = g.photoId ?? null
    const fresh = await upload()
    const photoId = fresh ?? (dropPhoto.value ? null : old)
    finance.updateGift(g.id, { name: what, price: parseMoney(price.value), photoId })
    // Прежнее фото заменено или убрано — байты на сервере не остаются сиротой.
    if (old && old !== photoId) void deletePhoto(old).catch(() => {})
    file.value = null
    dropPhoto.value = false
    if (!note.value) emit('close')
  } finally {
    busy.value = false
  }
}

function remove() {
  const g = gift.value
  if (g) {
    if (g.photoId) void deletePhoto(g.photoId).catch(() => {})
    finance.removeGift(g.id)
  }
  emit('close')
}

function onFile(f: File) {
  file.value = f
  dropPhoto.value = false
}
function onRemovePhoto() {
  file.value = null
  if (gift.value?.photoId) dropPhoto.value = true
}
</script>

<template>
  <Sheet :open="open && (!editing || !!gift)" :title="`Сюрприз для ${forName}`" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <Callout tone="neutral" icon="lock">{{ forName }} не увидит — только вы.</Callout>
      <PhotoSlot
        v-if="editing && !finance.isDemo && (canEdit || gift?.photoId)"
        :src="photoSrc"
        :file="file"
        :present="!!gift?.photoId && !dropPhoto"
        :busy="busy"
        :removable="canEdit && (!!file || (!!gift?.photoId && !dropPhoto))"
        @file="onFile"
        @remove="onRemovePhoto"
      />
      <Field label="Что" name="name">
        <Input v-model="name" placeholder="Билеты на концерт" :disabled="!canEdit" />
      </Field>
      <Field label="Сколько">
        <NumField v-model="price" placeholder="36 000" :disabled="!canEdit" />
      </Field>
      <PhotoSlot v-if="!editing && !finance.isDemo" :file="file" removable @file="file = $event" @remove="file = null" />
      <Callout v-if="note" tone="neutral" icon="info">{{ note }}</Callout>
      <template v-if="canEdit">
        <Button v-if="editing" size="lg" class="w-full" :disabled="busy" @click="form.submit(save)">Сохранить</Button>
        <Button v-else size="lg" class="w-full" :disabled="busy" @click="form.submit(add)">Добавить</Button>
        <DangerZone v-if="editing" label="Удалить сюрприз" warning="Сюрприз и его фото исчезнут. Отменить нельзя." @confirm="remove" />
      </template>
    </div>
  </Sheet>
</template>
