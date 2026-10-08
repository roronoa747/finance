<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PhDownloadSimple, PhShareNetwork } from '@phosphor-icons/vue'
import { loadStoryImage, renderStory, shareStory, storyText, type StoryData, type StoryKind, type StoryTexts } from '@/lib/storyCard'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * Предпросмотр карточки для сторис и «Поделиться» / «Сохранить» (Р-10, B2C-20). Рисуется
 * при открытии в canvas 1080 × 1920 (показан в масштабе), сумм на карточке нет —
 * `storyText`. Viewer тоже может поделиться: карточка ничего не меняет.
 */
const props = defineProps<{
  open: boolean
  kind: StoryKind
  data: StoryData
  /** Фото мечты (object URL или CDN шаблона); null — фон без фото. */
  src: string | null
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const blob = ref<Blob | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<'shared' | 'downloaded' | null>(null)

const texts = computed<StoryTexts>(() => storyText(props.kind, props.data))
const title = computed(() => (props.kind === 'goal' ? 'Карточка для сторис' : 'Карточка месяца'))
const shareTitle = computed(() => (props.kind === 'goal' ? `${texts.value.big} до мечты` : `${texts.value.big} подписки`))
// Системный лист — где браузер умеет делиться файлами (Android Chrome, iOS Safari); иначе только «Сохранить».
const canShare = computed(() => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function')

async function draw() {
  if (!canvas.value) return
  busy.value = true
  error.value = null
  result.value = null
  blob.value = null
  try {
    const image = props.src ? await loadStoryImage(props.src) : null
    blob.value = await renderStory(canvas.value, { image, texts: texts.value })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

// Рисуем, когда лист открыт и canvas в DOM: при монтировании открытым и при каждом открытии/смене данных.
onMounted(() => {
  if (props.open) void draw()
})
watch(
  () => [props.open, props.src, texts.value] as const,
  ([open]) => {
    if (open) void draw()
  },
  { flush: 'post' },
)

async function share() {
  if (!blob.value) return
  const r = await shareStory(blob.value, { title: shareTitle.value })
  if (r !== 'cancelled') result.value = r
}
async function save() {
  if (!blob.value) return
  const r = await shareStory(blob.value, { title: shareTitle.value }, null)
  if (r !== 'cancelled') result.value = r
}
</script>

<template>
  <Sheet :open="open" :title="title" @close="emit('close')">
    <div class="flex flex-col items-center gap-3">
      <canvas ref="canvas" width="1080" height="1920" class="h-auto w-[270px] rounded-card bg-surface-3 shadow-sheet" aria-label="Предпросмотр карточки" />
      <p class="text-center text-[12.5px] text-ink-2">
        {{ kind === 'goal' ? 'Без сумм — только процент, имя мечты и месяц.' : 'Без сумм — только число подписок.' }}
      </p>
      <Callout v-if="error" tone="warn">Не получилось нарисовать карточку: {{ error }}</Callout>
      <div class="flex w-full gap-2">
        <Button v-if="canShare" class="flex-1" :disabled="busy || !blob" @click="share"><PhShareNetwork :size="16" /> Поделиться</Button>
        <Button :variant="canShare ? 'secondary' : 'default'" class="flex-1" :disabled="busy || !blob" @click="save"><PhDownloadSimple :size="16" /> Сохранить</Button>
      </div>
      <p v-if="result" class="text-[12.5px] text-ink-2" aria-live="polite">{{ result === 'shared' ? 'Отправлено' : 'Сохранено в загрузки' }}</p>
    </div>
  </Sheet>
</template>
