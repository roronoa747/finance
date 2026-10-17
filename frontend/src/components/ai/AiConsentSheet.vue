<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { PhChartBar, PhChatCircleText, PhReceipt, PhStorefront } from '@phosphor-icons/vue'
import { AI_AUTO, AI_NO_TRAINING, AI_SENDS, AI_TO, useAiStore } from '@/stores/ai'
import IconBox from '@/components/kit/IconBox.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Лист согласия на ИИ-помощника (бэклог «ИИ», Р-9): один на приложение, в оболочке; открывает его
 * `useAiStore().ensureConsent()`. Что уходит — строки с иконками (v2 — пять, бэклог «ИИ-польза», Р-12), когда — строкой под ними (Х-16), куда —
 * одной строкой, «Включить» — главная, «Не надо» — тихая. Закрыли свайпом или крестиком — на этот раз нет, вопрос
 * остаётся. Финальные слова — `/ux`.
 */
const ai = useAiStore()

const items = [PhChartBar, PhStorefront, PhReceipt, PhChatCircleText].map((icon, i) => ({ icon, text: AI_SENDS[i] }))

// Лист есть — стору есть чем спросить. Ушли с экрана с открытым листом (ссылка «Подробнее», выход) — ждущий
// ответа получает «нет».
onMounted(() => (ai.sheetMounted = true))
onUnmounted(() => {
  ai.sheetMounted = false
  if (ai.sheetOpen) ai.answer(null)
})
</script>

<template>
  <!-- z 70 — над листами экранов (50) и вложенными (60): согласие спрашивают и изнутри листа («Новое желание»). -->
  <Sheet :open="ai.sheetOpen" title="ИИ-помощник" :z="70" @close="ai.answer(null)">
    <p class="text-[14px] text-ink-2" data-ai-to>{{ AI_TO }} получит:</p>
    <ul class="mt-3 flex flex-col gap-3" data-ai-consent>
      <li v-for="it in items" :key="it.text" class="flex items-center gap-3 text-[15px] text-ink">
        <IconBox><component :is="it.icon" :size="20" /></IconBox>
        {{ it.text }}
      </li>
    </ul>
    <p class="mt-4 text-[13.5px] text-ink-2" data-ai-auto>{{ AI_AUTO }}.</p>
    <p class="mt-1 text-[13.5px] text-ink-2">
      {{ AI_NO_TRAINING }}.
      <RouterLink to="/privacy" class="text-brand" data-ai-privacy @click="ai.answer(null)">Подробнее</RouterLink>
    </p>
    <div class="mt-5 flex flex-col gap-2">
      <Button class="w-full" data-ai-yes @click="ai.answer(true)">Включить</Button>
      <Button variant="ghost" size="md" class="w-full" data-ai-no @click="ai.answer(false)">Не надо</Button>
    </div>
  </Sheet>
</template>
