<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhLink } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney } from '@/lib/money'
import { addedLabel } from '@/lib/dates'
import { liveWishlist } from '@/lib/finance'
import { compressImage } from '@/lib/photos/compress'
import { deletePhoto, uploadPhoto } from '@/lib/photos/store'
import { usePhoto } from '@/lib/photos/usePhoto'
import { linkIn, useLinkPreview } from '@/lib/photos/useLinkPreview'
import type { PersonId } from '@/types/finance'

import Callout from '@/components/kit/Callout.vue'
import Field from '@/components/kit/Field.vue'
import PhotoSlot from '@/components/goals/PhotoSlot.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Правка покупки (React `WishDialog`, `src/screens/Goals.tsx:317-388`): поля пишутся по
 * уходу из поля, удаление — внутри и спрашивает. Удалил партнёр — окно закрылось.
 * Фото желания (Р-9, B2C-18): сжимается на телефоне, `WishItem.photoId` — у обоих.
 */
const props = defineProps<{ wishId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const people = computed(() => financeStore.people)

const wish = computed(() => liveWishlist(financeStore.wishlist).find((w) => w.id === props.wishId))
// Кто и когда добавил — здесь, а не на плитке (плитка — фото, название, цена).
const meta = computed(() => (wish.value ? `${people.value.find((p) => p.id === wish.value!.by)?.name ?? 'Участник'} · ${addedLabel(wish.value.addedOn)}` : ''))
const saved = useSavedMark(
  () => wish.value?.id,
  () => wish.value?.updatedAt,
)

/* ---------- фото ---------- */
const photoSrc = usePhoto(() => wish.value?.photoId)
const photoBusy = ref(false)
const photoNote = ref<string | null>(null)

async function onFile(file: File) {
  const w = wish.value
  if (!file || !w || financeStore.isDemo) return
  photoBusy.value = true
  photoNote.value = null
  try {
    const { blob } = await compressImage(file)
    const id = await uploadPhoto(blob)
    const old = w.photoId
    financeStore.setWishPhoto(w.id, id)
    if (old) await deletePhoto(old).catch(() => {})
  } catch {
    photoNote.value = 'Фото не загрузилось — попробуйте при сети.'
  } finally {
    photoBusy.value = false
  }
}

async function removePhoto() {
  const w = wish.value
  if (!w?.photoId) return
  const id = w.photoId
  financeStore.setWishPhoto(w.id, null)
  await deletePhoto(id).catch(() => {})
}

function onName(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (wish.value && v && v !== wish.value.name) financeStore.updateWish(wish.value.id, { name: v })
}
function onPrice(text: string) {
  const v = parseMoney(text)
  if (wish.value && v !== wish.value.price) financeStore.updateWish(wish.value.id, { price: v })
}
// Пустая ссылка пишется пустой строкой, а не undefined: пропавший ключ слияние вернуло бы
// из записи партнёра (`mergeList` берёт поля проигравшего, которых нет у победителя).
function onUrl(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const v = linkIn(raw) ?? raw.trim()
  if (wish.value && v !== (wish.value.url ?? '')) financeStore.updateWish(wish.value.id, { url: v })
}
// Вставили ссылку (B2C-66): фото со страницы заменяет прежнее тем же путём, что своё; ссылка
// пишется сразу. Название не трогаем — у желания уже есть имя, данное человеком.
const link = useLinkPreview()
let linkTimer: ReturnType<typeof setTimeout> | undefined
// Другое желание — ждущая вставка прежнего не применяется к новому (критик Б12).
watch(
  () => props.wishId,
  () => {
    clearTimeout(linkTimer)
    link.reset()
  },
)
function onUrlInput(e: Event) {
  const text = (e.target as HTMLInputElement).value
  clearTimeout(linkTimer)
  linkTimer = setTimeout(() => void onLink(text), 300)
}
async function onLink(text: string) {
  const found = await link.load(text)
  const w = wish.value
  if (!found || !w) return
  if (found.url !== (w.url ?? '')) financeStore.updateWish(w.id, { url: found.url })
  if (found.file) await onFile(found.file)
}
function onBy(by: PersonId) {
  if (wish.value) financeStore.updateWish(wish.value.id, { by })
}
function remove() {
  const w = wish.value
  if (w) {
    // Фото на сервере — вместе с желанием, иначе байты остаются сиротой (критик Блока 3).
    if (w.photoId) void deletePhoto(w.photoId).catch(() => {})
    financeStore.removeWish(w.id)
  }
  emit('close')
}
</script>

<template>
  <Sheet :open="!!wish" :title="wish?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="saved" />
    </template>
    <template v-if="wish" #default="{ close }">
      <!-- Фото — первым и крупно: желание узнаётся по картинке; сменить/убрать — маленькие кнопки в углах -->
      <PhotoSlot
        v-if="!financeStore.isDemo"
        class="mb-3"
        :src="photoSrc"
        :present="!!wish.photoId"
        :busy="photoBusy || link.busy.value"
        :removable="!!wish.photoId"
        @file="onFile"
        @remove="removePhoto"
      />
      <Callout v-if="photoNote || link.note.value" tone="neutral" icon="info" class="mb-3">{{ photoNote ?? link.note.value }}</Callout>
      <p class="mb-3 type-meta">{{ meta }}</p>
      <!-- Ссылка в магазин — заметной кнопкой, а не строкой -->
      <a
        v-if="wish.url"
        :href="wish.url"
        target="_blank"
        rel="noreferrer noopener"
        class="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-surface-3 text-[15px] font-semibold text-ink"
      >
        <PhLink :size="16" /> Открыть ссылку
      </a>

      <Field label="Что покупаем">
        <Input :default-value="wish.name" class="mb-3" @blur="onName" />
      </Field>
      <Field label="Цена, ₸">
        <NumFieldBlur :initial="plain(wish.price)" class="mb-3" @commit="onPrice" />
      </Field>
      <!-- Ссылка подтягивает фото со страницы — нужен сервер: в демо поля нет (B2C-66) -->
      <Field v-if="!financeStore.isDemo" label="Ссылка на товар">
        <Input
          :default-value="wish.url ?? ''"
          inputmode="url"
          placeholder="Вставьте ссылку"
          class="mb-3"
          @input="onUrlInput"
          @blur="onUrl"
        />
      </Field>
      <Field v-if="people.length > 1" label="Кто добавил" group>
        <Segmented
          :model-value="wish.by"
          :options="people.map((p) => ({ value: p.id, label: p.name }))"
          @update:model-value="onBy"
        />
      </Field>

      <Button class="mb-3 w-full" @click="close">Готово</Button>

      <DangerZone
        label="Удалить из списка"
        warning="Покупка исчезнет из списка у обоих. Отменить нельзя."
        @confirm="remove"
      />
    </template>
  </Sheet>
</template>
