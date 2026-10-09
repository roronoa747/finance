<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiClient, ApiError, type AdminMetrics } from '@/api/client'
import Card from '@/components/kit/Card.vue'

/**
 * Цифры для владельца (B2C-28, Р-16): удержание и воронка — таблицами, без графиков. Ручка
 * отвечает только почтам из `ADMIN_EMAILS`; остальным — 404, и экран говорит «нет такой страницы».
 */
const metrics = ref<AdminMetrics | null>(null)
const state = ref<'loading' | 'ok' | 'none' | 'error'>('loading')

onMounted(async () => {
  try {
    metrics.value = await apiClient.adminMetrics()
    state.value = 'ok'
  } catch (e) {
    state.value = e instanceof ApiError && e.status === 404 ? 'none' : 'error'
  }
})

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)} %` : '—')
const second = computed(() => metrics.value?.second_upload_14d)
const totals = computed(() => {
  const m = metrics.value
  if (!m) return []
  return [
    ['Пользователи', m.users],
    ['Семьи', m.households],
    ['Семьи с выпиской', m.households_with_upload],
    ['Активные за 7 дней', m.active_7d],
    ['Активные за 28 дней', m.active_28d],
  ] as const
})
const funnel = computed(() => {
  const f = metrics.value?.funnel_28d
  if (!f) return []
  return [
    ['Создали семью', f.created],
    ['Загрузили выписку', f.uploaded],
    ['Выбрали цель', f.goal],
    ['Прошли первый запуск', f.done],
  ] as const
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <p v-if="state === 'loading'" class="text-[14px] text-ink-2">Минуту…</p>
    <p v-else-if="state === 'none'" class="text-[14px] text-ink-2">Нет такой страницы.</p>
    <p v-else-if="state === 'error'" role="alert" class="text-[14px] text-warn">Не получилось загрузить цифры.</p>

    <template v-else-if="metrics">
      <Card>
        <div class="type-meta">Вторая выписка за 14 дней</div>
        <div class="type-big num mt-1" data-metric="second">{{ pct(second!.retained, second!.eligible) }}</div>
        <div class="type-meta mt-1">{{ second!.retained }} из {{ second!.eligible }} семей</div>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">Всего</h2>
        <table class="w-full text-[14px]">
          <tr v-for="[label, n] in totals" :key="label" class="border-t border-line first:border-0">
            <td class="py-1.5 text-ink-2">{{ label }}</td>
            <td class="py-1.5 text-right num text-ink">{{ n }}</td>
          </tr>
        </table>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">Первый запуск · 28 дней</h2>
        <table class="w-full text-[14px]">
          <tr v-for="[label, n] in funnel" :key="label" class="border-t border-line first:border-0">
            <td class="py-1.5 text-ink-2">{{ label }}</td>
            <td class="py-1.5 text-right num text-ink">{{ n }}</td>
            <td class="w-14 py-1.5 text-right num text-ink-2">{{ pct(n, metrics.funnel_28d.created) }}</td>
          </tr>
        </table>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">По неделям</h2>
        <table class="w-full text-[13.5px]">
          <thead>
            <tr class="text-ink-2">
              <th class="py-1 text-left font-normal">Неделя</th>
              <th class="py-1 text-right font-normal">Семьи</th>
              <th class="py-1 text-right font-normal">Выписки</th>
              <th class="py-1 text-right font-normal">Недели</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in metrics.weeks" :key="w.week" class="border-t border-line">
              <td class="py-1.5 num text-ink-2">{{ w.week }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.new_households }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.uploads }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.week_done }}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </template>
  </div>
</template>
