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
 * ключ скопирован, а оплаты с ним ещё не было — «Ждём первую оплату» и та же «Подключить» (владелец 2026-10-19:
 * «Подключено» — только по ключам, которыми оплатили), и тихая «Отключить»: скопированный ключ жив — его можно
 * отозвать (владелец 2026-10-19); подключено — какими командами платили и когда пришла последняя трата (команды, а не
 * телефоны: владелец 2026-10-19), тихие «Подключить снова» и «Отключить» (подтверждение в один шаг; отключает все
 * телефоны человека). Только member с ссылкой на команду для пути этого телефона (`available`); не iPhone — только
 * подключённая или ждущая оплаты (`shown`), без «Подключить».
 */
const ap = useApplePayStore()
const sheet = useQuerySheet('applepay')
/** Блок 2: лист сразу на шагах второй команды «Пуши банков» (`?applepush=1`). */
const pushSheet = useQuerySheet('applepush')
function closeSheets() {
  sheet.close()
  pushSheet.close()
}
const confirming = ref(false)
const busy = ref(false)
const error = ref(false)

onMounted(() => void ap.load())

/** Ключ скопирован, оплаты ещё не было. */
const waiting = computed(() => !ap.connected && !!ap.status?.waiting)
const line = computed(() => {
  const s = ap.status
  if (!s?.connected) return s?.waiting ? 'Ждём первую оплату' : 'Траты появятся сами'
  if (!s.last_used_at) return 'Подключено'
  // «16 октября» не рвётся переносом (ux: на 390 px «16» оставалось в первой строке).
  const last = atLabel(s.last_used_at).replace(' ', ' ')
  // Команды, а не телефоны (владелец 2026-10-19): один iPhone с касанием и пушами держит два ключа — «2 iPhone» врал.
  // Только касание — без слов о командах: значок уже говорит «подключено» (`/ux` Б1, вопрос 3). С командами — «трата»
  // без «последняя»: строка одна и на 360 px.
  return s.push ? `${s.tap ? 'Касание и пуши' : 'Пуши'} · трата ${last}` : `Последняя трата ${last}`
})
/**
 * Подключают только с iPhone (Р-3): на Android и компьютере карточка — только когда уже подключено или ждём оплату
 * (чтобы «Отключить» было под рукой), без «Подключить» и листа (ux: иначе лист «ключ этого iPhone» создавал ключ на
 * Android).
 */
const shown = computed(() => ap.available && (ap.isIPhone || ap.connected || waiting.value))

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
  <Card v-if="shown" tight data-applepay-card :data-connected="ap.connected">
    <div class="flex items-center gap-3">
      <IconBox :tone="ap.connected ? 'brand' : 'neutral'"><PhContactlessPayment /></IconBox>
      <div class="min-w-0 flex-1">
        <h2 class="type-h3 text-ink">Apple Pay</h2>
        <p class="text-[13.5px] leading-snug text-ink-2" data-applepay-line>{{ line }}</p>
      </div>
      <!-- Тихая, как «Создать код» карточки «С кем» (`/ux` Б1, вопрос 2): звать к Apple Pay умеет строка «Недели». -->
      <Button v-if="!ap.connected && ap.isIPhone" variant="secondary" size="sm" data-connect @click="sheet.open.value = true">Подключить</Button>
    </div>

    <!-- Три тихие в одну строку на 390 px: поля кнопок уже (px-2), ряд — на ширину полей (-mx-2); уже 390 — переносится
         (стенд возврата: «Подключить снова» длиннее «Ещё iPhone», «Пуши банков» уходила за край). -->
    <!-- Ждём первую оплату — одна «Отключить» (владелец 2026-10-19): «Подключить» уже стоит в строке заголовка. -->
    <div v-if="(ap.connected || waiting) && !confirming" class="-mx-2 mt-3 flex flex-wrap items-center justify-end gap-0.5 border-t border-line pt-2" data-applepay-actions>
      <Button v-if="ap.connected && ap.isIPhone && ap.pushLink" variant="ghost" size="sm" class="px-2" data-push @click="pushSheet.open.value = true">Пуши банков</Button>
      <Button v-if="ap.connected && ap.isIPhone" variant="ghost" size="sm" class="px-2" data-more @click="sheet.open.value = true">Подключить снова</Button>
      <Button variant="ghost" size="sm" class="px-2" data-disconnect @click="confirming = true">Отключить</Button>
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
  <ApplePaySheet
    v-if="ap.available && ap.isIPhone"
    :open="sheet.open.value || pushSheet.open.value"
    :mode="pushSheet.open.value && !!ap.pushLink ? 'push' : 'tap'"
    @close="closeSheets"
  />
</template>
