<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PhCamera, PhX } from '@phosphor-icons/vue'
import { useWideFit } from '@/lib/photos/fit'

/**
 * Фото желания или сюрприза в окне (правило 12; владелец 2026-09-28: кнопки смены фото занимали
 * больше места, чем само фото): картинка во всю ширину, поверх — две маленькие круглые кнопки в
 * углах (сменить, убрать), как у героя цели. Без фото — пунктирная плитка «Фото», нажатие —
 * выбор файла. `file` — выбранный, ещё не загруженный файл: превью из object URL, освобождается
 * при замене и уходе; `present` — фото есть, но картинка ещё грузится.
 */
const props = withDefaults(
  defineProps<{
    src?: string | null
    file?: File | null
    present?: boolean
    busy?: boolean
    removable?: boolean
    /** Широкое фото — целиком (B2C-73): у желаний; цели и сюрпризы — как были. */
    fit?: boolean
  }>(),
  { src: null, file: null, present: false, busy: false, removable: false, fit: false },
)

const emit = defineEmits<{ (e: 'file', file: File): void; (e: 'remove'): void }>()

const input = ref<HTMLInputElement | null>(null)
const preview = ref<string | null>(null)
watch(
  () => props.file,
  (f) => {
    if (preview.value) URL.revokeObjectURL(preview.value)
    preview.value = f ? URL.createObjectURL(f) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (preview.value) URL.revokeObjectURL(preview.value)
})

const shown = computed(() => preview.value ?? props.src)
const wideFit = useWideFit(() => shown.value)

function onChange(e: Event) {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  el.value = ''
  if (f) emit('file', f)
}
</script>

<template>
  <div>
    <input ref="input" type="file" accept="image/*" class="hidden" @change="onChange" />
    <div v-if="shown || present" class="relative h-[180px] overflow-hidden rounded-tile bg-surface-3" :class="busy && 'opacity-60'">
      <img v-if="shown" :src="shown" alt="" :class="['size-full', fit ? wideFit.fit() : 'object-cover']" @load="wideFit.onLoad" />
      <button
        type="button"
        aria-label="Сменить фото"
        :disabled="busy"
        class="absolute left-2.5 top-2.5 grid size-[34px] place-items-center rounded-full bg-photo-scrim text-on-photo cursor-pointer"
        @click="input?.click()"
      >
        <PhCamera :size="18" />
      </button>
      <button
        v-if="removable"
        type="button"
        aria-label="Убрать фото"
        :disabled="busy"
        class="absolute right-2.5 top-2.5 grid size-[34px] place-items-center rounded-full bg-photo-scrim text-on-photo cursor-pointer"
        @click="emit('remove')"
      >
        <PhX :size="16" />
      </button>
    </div>
    <button
      v-else
      type="button"
      :disabled="busy"
      class="flex h-[88px] w-full flex-col items-center justify-center gap-1 rounded-tile border border-dashed border-line-strong bg-surface text-ink-2 cursor-pointer disabled:opacity-50"
      @click="input?.click()"
    >
      <PhCamera :size="22" />
      <span class="text-[13px]">Фото</span>
    </button>
  </div>
</template>
