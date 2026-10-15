<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhContactlessPayment } from '@phosphor-icons/vue'
import { useApplePayStore } from '@/stores/applepay'
import { useQuerySheet } from '@/components/useQuerySheet'
import { atLabel } from '@/lib/dates'
import Card from '@/components/kit/Card.vue'
import IconBox from '@/components/kit/IconBox.vue'
import Button from '@/components/ui/Button.vue'
import ApplePaySheet from './ApplePaySheet.vue'

/**
 * Карточка «Apple Pay» в настройках (AP-06, Р-6, Р-13): не подключено — строка и «Подключить» (лист `?applepay=1`);
 * подключено — когда пришла последняя трата, тихие «Ещё iPhone» и «Отключить» (подтверждение в один шаг; отключает
 * все телефоны человека). Только member с ссылкой на команду для пути этого телефона (`available`).
 */
const ap = useApplePayStore()
const sheet = useQuerySheet('applepay')
const confirming = ref(false)
const busy = ref(false)
const error = ref(false)

onMounted(() => void ap.load())

const line = computed(() => {
  const s = ap.status
  if (!s?.connected) return 'Траты появятся сами после оплаты'
  const phones = s.phones > 1 ? ` · ${s.phones} iPhone` : ''
  return s.last_used_at ? `Подключено${phones} · последняя трата ${atLabel(s.last_used_at)}` : `Подключено${phones} · ждём первую оплату`
})

async function disconnect() {
  busy.value = true
  error.value = false
  try {
    await ap.disconnect()
    confirming.value = false
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Card v-if="ap.available" tight data-applepay-card :data-connected="ap.connected">
    <div class="flex items-center gap-3">
      <IconBox :tone="ap.connected ? 'brand' : 'neutral'"><PhContactlessPayment /></IconBox>
      <div class="min-w-0 flex-1">
        <h2 class="type-h3 text-ink">Apple Pay</h2>
        <p class="truncate text-[13.5px] text-ink-2" data-applepay-line>{{ line }}</p>
      </div>
      <Button v-if="!ap.connected" size="sm" data-connect @click="sheet.open.value = true">Подключить</Button>
    </div>

    <div v-if="ap.connected && !confirming" class="mt-3 flex items-center justify-end gap-1 border-t border-line pt-2">
      <Button v-if="ap.isIPhone" variant="ghost" size="sm" data-more @click="sheet.open.value = true">Ещё iPhone</Button>
      <Button variant="ghost" size="sm" data-disconnect @click="confirming = true">Отключить</Button>
    </div>
    <div v-if="confirming" class="mt-3 flex flex-col gap-2 border-t border-line pt-3" data-confirm>
      <p class="text-[14px] text-ink">Отключить? Траты перестанут приходить сами</p>
      <div class="flex justify-end gap-1">
        <Button variant="ghost" size="sm" @click="confirming = false">Не надо</Button>
        <Button variant="secondary" size="sm" :disabled="busy" data-confirm-yes @click="disconnect">Отключить</Button>
      </div>
      <p v-if="error" role="alert" class="text-[12.5px] text-warn">Не получилось. Проверьте сеть.</p>
    </div>
  </Card>
  <ApplePaySheet v-if="ap.available" :open="sheet.open.value" @close="sheet.close()" />
</template>
