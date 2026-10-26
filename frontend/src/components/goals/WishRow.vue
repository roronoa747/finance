<script setup lang="ts">
import { PhCheck, PhLink, PhShoppingBag } from '@phosphor-icons/vue'
import { money } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { WishItem } from '@/types/finance'
import { useWideFit } from '@/lib/photos/fit'
import Tag from '@/components/kit/Tag.vue'

/**
 * Строка желания — второй режим списка (владелец 2026-09-27: галерея и список с переключателем). Пачка 2 «Figma» (90:19,
 * FG-22): строка 80 — галочка «купил» 26, фото 56, название 16 по центру высоты, цена 15 справа; серой подписи «кто · когда»
 * нет — «кто добавил» в листе желания. Купленное — зачёркнутое название и «купили», без даты. Нет фото — плашка с сумкой.
 * Ссылка вынесена из нажимаемой области: ссылка внутри кнопки — невалидная разметка. Viewer — строка без действий (Р-12).
 */
const props = defineProps<{
  wish: WishItem
  src: string | null
  canEdit: boolean
  bought?: boolean
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'toggle'): void }>()
// Широкое фото — целиком (B2C-73).
const { onLoad, fit } = useWideFit(() => props.src)
</script>

<template>
  <div class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0" data-wish-row>
    <button
      v-if="canEdit"
      type="button"
      :aria-label="bought ? 'Вернуть в список' : 'Отметить купленным'"
      :class="
        cn(
          'grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] cursor-pointer',
          bought ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong text-transparent hover:border-brand hover:text-brand',
        )
      "
      @click="emit('toggle')"
    >
      <PhCheck :size="14" weight="bold" />
    </button>
    <div :class="cn('grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-surface-3 text-ink-3', bought && 'opacity-70')" data-photo>
      <img v-if="wish.photoId && src" :src="src" alt="" :class="['size-full', fit()]" @load="onLoad" />
      <PhShoppingBag v-else-if="!wish.photoId" :size="20" />
    </div>
    <component
      :is="canEdit ? 'button' : 'div'"
      :type="canEdit ? 'button' : undefined"
      :data-wish="wish.id"
      :class="cn('flex min-w-0 flex-1 items-center gap-2 text-left', canEdit && 'cursor-pointer')"
      @click="canEdit && emit('open')"
    >
      <b :class="cn('block truncate text-[16px] font-medium', bought ? 'text-ink-2 line-through' : 'text-ink')">{{ wish.name }}</b>
      <Tag v-if="bought" tone="ok" class="shrink-0">купили</Tag>
    </component>
    <a
      v-if="wish.url"
      :href="wish.url"
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Открыть ссылку"
      class="inline-flex shrink-0 items-center gap-1 rounded-pill border border-line px-2 py-0.5 text-[11.5px] text-brand"
    >
      <PhLink :size="10" /> ссылка
    </a>
    <span :class="cn('shrink-0 text-[15px] font-semibold num', bought ? 'text-ink-2' : 'text-ink')">{{ money(wish.price) }}</span>
  </div>
</template>
