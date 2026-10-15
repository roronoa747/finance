<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { PhContactlessPayment } from '@phosphor-icons/vue'
import { useApplePayStore } from '@/stores/applepay'

/**
 * Тихая строка на «Неделе» под «Загрузить» (AP-06, Р-6): «Траты сами с Apple Pay» → лист подключения в настройках.
 * Только iPhone, только пока не подключено, только когда карточка доступна (member, не демо, есть ссылка); статус —
 * на заходе в «Неделю» (раз за сессию).
 */
const ap = useApplePayStore()
onMounted(() => void ap.load())
const shown = computed(() => ap.available && ap.isIPhone && !!ap.status && !ap.connected)
</script>

<template>
  <RouterLink
    v-if="shown"
    to="/settings?applepay=1"
    class="flex items-center gap-1.5 self-start text-[13.5px] text-ink-2 underline-offset-4 hover:underline"
    data-applepay-week
  >
    <PhContactlessPayment :size="16" class="text-ink-3" />Траты сами с Apple Pay
  </RouterLink>
</template>
