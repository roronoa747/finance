<script setup lang="ts">
import { computed } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'
import type { PushCounts, PushStats } from '@/api/client'
import Card from '@/components/kit/Card.vue'
import Hint from '@/components/kit/Hint.vue'

/**
 * Пуши банков в «Цифрах» (бэклог «Apple Pay», Блок 2, Р-10): одна строка за 7 дней — сколько стало операциями и
 * сколько сервер не понял (по ним владелец присылает вид пуша для таблицы форм); по банкам и за 30 дней — под
 * «Подробнее». Пушей за 30 дней не было — карточки нет.
 */
const props = defineProps<{ stats: PushStats[] }>()

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom', halyk: 'Halyk', unknown: 'Банк не узнан' }
const sum = (key: 'd7' | 'd30') =>
  props.stats.reduce<PushCounts>((t, s) => ({ parsed: t.parsed + s[key].parsed, ignored: t.ignored + s[key].ignored, unknown: t.unknown + s[key].unknown }), {
    parsed: 0,
    ignored: 0,
    unknown: 0,
  })
const week = computed(() => sum('d7'))
const any = computed(() => props.stats.some((s) => s.d30.parsed + s.d30.ignored + s.d30.unknown > 0))
</script>

<template>
  <Card v-if="any" data-push-stats>
    <div class="flex items-center gap-1.5">
      <h2 class="type-h3 text-ink">Пуши за 7 дней</h2>
      <Hint label="Про пуши">Не разобрано — сервер не понял текст пуша: пришлите его вид, разбор подстроим</Hint>
    </div>
    <p class="mt-1 text-[14.5px] text-ink num" data-push-week>
      разобрано {{ week.parsed }} · <span :class="week.unknown ? 'text-warn' : ''">не разобрано {{ week.unknown }}</span>
    </p>
    <details class="mt-2">
      <summary class="flex cursor-pointer list-none items-center gap-1 text-[13.5px] text-ink-2">Подробнее<PhCaretDown :size="14" class="text-ink-3" /></summary>
      <table class="mt-2 w-full text-[13.5px]" data-push-banks>
        <thead>
          <tr class="text-ink-2">
            <th class="py-1 text-left font-normal">Банк</th>
            <th class="py-1 text-right font-normal">Операции</th>
            <th class="py-1 text-right font-normal">Не операции</th>
            <th class="py-1 text-right font-normal">Не разобрано</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="s in stats" :key="s.bank">
            <tr class="border-t border-line" :data-push-bank="s.bank">
              <td class="py-1.5 text-ink">{{ BANKS[s.bank] ?? s.bank }} · 7 дн.</td>
              <td class="py-1.5 text-right num text-ink">{{ s.d7.parsed }}</td>
              <td class="py-1.5 text-right num text-ink-2">{{ s.d7.ignored }}</td>
              <td class="py-1.5 text-right num" :class="s.d7.unknown ? 'text-warn' : 'text-ink'">{{ s.d7.unknown }}</td>
            </tr>
            <tr>
              <td class="pb-1.5 text-ink-2">30 дн.</td>
              <td class="pb-1.5 text-right num text-ink-2">{{ s.d30.parsed }}</td>
              <td class="pb-1.5 text-right num text-ink-2">{{ s.d30.ignored }}</td>
              <td class="pb-1.5 text-right num text-ink-2">{{ s.d30.unknown }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </details>
  </Card>
</template>
