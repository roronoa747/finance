<script lang="ts">
/** Демо и офлайн: ручки превью нет — строка вместо запроса. */
export const LINK_PHOTO_NEEDS_NET = 'Фото по ссылке — при сети'
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { PhCircleNotch } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { linkIn, useLinkPreview, type LinkFound } from '@/lib/photos/useLinkPreview'
import Field from '@/components/kit/Field.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Фото цели по ссылке (PN-08, Р-4): вставили адрес картинки или страницы магазина — та же ручка, что у
 * желаний (`POST /api/photos/preview`, `useLinkPreview`), картинка уходит родителю файлом (`found`) и грузится
 * как своё фото — автора нет. Маленькая картинка или ошибка — строка «загрузите своё» из composable; в демо
 * и офлайн сервера нет — строка «при сети», ручка не зовётся. Один компонент — два места: `PhotoPicker`
 * (цель с фото) и «Новая мечта». Пустая ссылка — ничего; поле не закрывает лист — это делает родитель.
 */
const emit = defineEmits<{ (e: 'found', found: LinkFound): void }>()

const finance = useFinanceStore()
const link = useLinkPreview()
const text = ref('')
const netNote = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)
const note = computed(() => netNote.value ?? link.note.value)
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

watch(text, (t) => {
  netNote.value = null
  if (!linkIn(t)) return
  if (finance.isDemo || offline()) {
    netNote.value = LINK_PHOTO_NEEDS_NET
    return
  }
  link.schedule(t, (found) => {
    if (found.file) emit('found', found)
  })
})

// Поле раскрыто нажатием на плитку — курсор сразу в нём, клавиатура открыта.
onMounted(() => void nextTick(() => root.value?.querySelector('input')?.focus()))
</script>

<template>
  <div ref="root" data-link-photo>
    <Field label="Ссылка на картинку или страницу" name="link" class="!mb-0">
      <div class="relative">
        <Input v-model="text" inputmode="url" placeholder="Вставьте ссылку" class="bg-surface pr-10" />
        <PhCircleNotch v-if="link.busy.value" :size="18" class="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-2" aria-label="Ищем фото" data-link-busy />
      </div>
      <span v-if="note" class="text-[12.5px] text-ink-2" aria-live="polite" data-link-note>{{ note }}</span>
    </Field>
  </div>
</template>
