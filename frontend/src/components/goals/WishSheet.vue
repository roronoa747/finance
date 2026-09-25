<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney } from '@/lib/money'
import { liveWishlist } from '@/lib/finance'
import type { PersonId } from '@/types/finance'

import Field from '@/components/kit/Field.vue'
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
 */
const props = defineProps<{ wishId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const people = computed(() => financeStore.people)

const wish = computed(() => liveWishlist(financeStore.wishlist).find((w) => w.id === props.wishId))
const saved = useSavedMark(
  () => wish.value?.id,
  () => wish.value?.updatedAt,
)

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
  const v = (e.target as HTMLInputElement).value.trim()
  if (wish.value && v !== (wish.value.url ?? '')) financeStore.updateWish(wish.value.id, { url: v })
}
function onBy(by: PersonId) {
  if (wish.value) financeStore.updateWish(wish.value.id, { by })
}
function remove() {
  if (wish.value) financeStore.removeWish(wish.value.id)
  emit('close')
}
</script>

<template>
  <Sheet :open="!!wish" :title="wish?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="saved" />
    </template>
    <template v-if="wish">
      <Field label="Что покупаем">
        <Input :default-value="wish.name" class="mb-3" @blur="onName" />
      </Field>
      <Field label="Цена, ₸">
        <NumFieldBlur :initial="plain(wish.price)" class="mb-3" @commit="onPrice" />
      </Field>
      <Field label="Ссылка на товар">
        <Input
          :default-value="wish.url ?? ''"
          inputmode="url"
          placeholder="можно оставить пустым"
          class="mb-3"
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

      <Button class="mb-3 w-full" @click="emit('close')">Готово</Button>

      <DangerZone
        label="Удалить из списка"
        warning="Покупка исчезнет из списка у обоих. Отменить нельзя."
        @confirm="remove"
      />
    </template>
  </Sheet>
</template>
