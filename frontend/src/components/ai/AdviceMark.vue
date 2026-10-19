<script setup lang="ts">
import { useRouter } from 'vue-router'
import { PhSparkle } from '@phosphor-icons/vue'

/**
 * ✦ у предмета совета ИИ (бэклог «Разбор», Р-9, Р-23, RZ-10): маленькая кнопка после названия раздела, платежа, мечты
 * или долга, про который есть совет разбора текущего месяца (`useAiStore().markFor`). Нажатие — отчёт на карточке этого
 * совета (`/month?review=1&card=<n>`), строка своего не делает (`stop`). Касание — 28 px, а строке — 12 px: отрицательные
 * поля по вертикали, высота строки не меняется. Кнопка — рядом с кнопкой строки, не внутри (кнопка в кнопке недопустима):
 * строка держит своё нажатие растянутой `row-open`, ✦ — над ней (`z-10`). `n` нет — ничего.
 */
const props = defineProps<{ n: number | null }>()
const router = useRouter()

function open() {
  if (props.n) void router.push({ path: '/month', query: { review: '1', card: String(props.n) } })
}
</script>

<template>
  <button
    v-if="n"
    type="button"
    aria-label="Совет ИИ"
    class="press relative z-10 -my-2 inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-full align-middle text-brand"
    data-advice-mark
    :data-advice-card="n"
    data-no-drag
    @click.stop="open"
  >
    <PhSparkle :size="12" weight="fill" aria-hidden="true" />
  </button>
</template>
