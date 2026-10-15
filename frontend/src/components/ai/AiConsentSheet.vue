<script setup lang="ts">
import { onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { PhChartBar, PhImage, PhStorefront } from '@phosphor-icons/vue'
import { useAiStore } from '@/stores/ai'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Лист согласия на ИИ-помощника (бэклог «ИИ», Р-9): один на приложение, в оболочке; открывает его
 * `useAiStore().ensureConsent()`. Что уходит — три строки с иконками, куда — одной строкой, «Включить» — главная,
 * «Не надо» — тихая. Закрыли свайпом или крестиком — на этот раз нет, вопрос остаётся. Финальные слова — `/ux`.
 */
const ai = useAiStore()

const items = [
  { icon: PhChartBar, text: 'Цифры месяца — без имён' },
  { icon: PhStorefront, text: 'Названия продавцов' },
  { icon: PhImage, text: 'Скриншот товара' },
]

// Ушли с экрана с открытым листом (ссылка «Подробнее», выход) — ждущий ответа получает «нет».
onUnmounted(() => {
  if (ai.sheetOpen) ai.answer(null)
})
</script>

<template>
  <Sheet :open="ai.sheetOpen" title="ИИ-помощник" @close="ai.answer(null)">
    <ul class="flex flex-col gap-3" data-ai-consent>
      <li v-for="it in items" :key="it.text" class="flex items-center gap-3 text-[15px] text-ink">
        <span class="grid size-9 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2">
          <component :is="it.icon" :size="18" />
        </span>
        {{ it.text }}
      </li>
    </ul>
    <p class="mt-4 text-[13.5px] text-ink-2">
      Уходит в Anthropic (Claude). Не обучается на ваших данных.
      <RouterLink to="/privacy" class="text-brand" data-ai-privacy @click="ai.answer(null)">Подробнее</RouterLink>
    </p>
    <div class="mt-5 flex flex-col gap-2">
      <Button class="w-full" data-ai-yes @click="ai.answer(true)">Включить</Button>
      <Button variant="ghost" class="w-full" data-ai-no @click="ai.answer(false)">Не надо</Button>
    </div>
  </Sheet>
</template>
