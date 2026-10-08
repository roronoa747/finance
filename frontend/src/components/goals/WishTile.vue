<script setup lang="ts">
import { PhCheck, PhLink, PhShoppingBag } from '@phosphor-icons/vue'
import { money } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { WishItem } from '@/types/finance'
import { useWideFit } from '@/lib/photos/fit'
import Tag from '@/components/kit/Tag.vue'

/**
 * Плитка желания (владелец 2026-09-27: «галерея, не список»): фото занимает квадрат, под ним —
 * только название и цена. Нажатие на плитку — окно покупки (member); галочка «куплено» и ссылка в
 * магазин — поверх плитки, а не внутри кнопки (вложенные кнопки — невалидная разметка). Viewer
 * видит плитку без действий (Р-12).
 */
const props = defineProps<{
  wish: WishItem
  /** Object URL фото; null — ещё грузится или фото нет. */
  src: string | null
  canEdit: boolean
  bought?: boolean
  /** Подпись купленного: «Аруна · куплено 20 сентября». */
  meta?: string
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'toggle'): void }>()
// Широкое фото (баннер магазина) — целиком на фоне плитки (B2C-73).
const { onLoad, fit } = useWideFit(() => props.src)
</script>

<template>
  <div class="relative min-w-0">
    <component
      :is="canEdit ? 'button' : 'div'"
      :type="canEdit ? 'button' : undefined"
      :data-wish="wish.id"
      :class="
        cn(
          'flex w-full flex-col overflow-hidden rounded-tile border border-card-border bg-surface text-left',
          canEdit && 'cursor-pointer press',
          bought && 'opacity-75',
        )
      "
      @click="canEdit && emit('open')"
    >
      <div class="relative aspect-square w-full bg-surface-3" :data-photo="wish.photoId ? '' : undefined">
        <img v-if="src" :src="src" alt="" :class="['absolute inset-0 size-full', fit()]" @load="onLoad" />
        <div v-else class="grid size-full place-items-center text-ink-3"><PhShoppingBag :size="28" /></div>
      </div>
      <div class="flex items-baseline gap-2 px-3 pt-2.5" :class="bought ? 'pb-1' : 'pb-2.5'">
        <b :class="cn('min-w-0 flex-1 truncate text-[14px] font-medium', bought ? 'text-ink-2 line-through' : 'text-ink')">{{ wish.name }}</b>
        <span :class="cn('shrink-0 text-[14px] font-semibold num', bought ? 'text-ink-2' : 'text-ink')">{{ money(wish.price) }}</span>
      </div>
      <div v-if="bought && meta" class="px-3 pb-2.5 text-[12px] text-ink-2">{{ meta }}</div>
    </component>

    <!-- Поверх плитки: «куплено» / «вернуть» и ссылка в магазин -->
    <button
      v-if="canEdit"
      type="button"
      :aria-label="bought ? 'Вернуть в список' : 'Отметить купленным'"
      :class="
        cn(
          'absolute left-2 top-2 grid size-7 place-items-center rounded-lg border-[1.5px] cursor-pointer',
          bought ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong bg-surface/90 text-transparent hover:border-brand hover:text-brand',
        )
      "
      @click.stop="emit('toggle')"
    >
      <PhCheck :size="14" weight="bold" />
    </button>
    <Tag v-else-if="bought" tone="ok" class="absolute left-2 top-2">купили</Tag>
    <a
      v-if="wish.url"
      :href="wish.url"
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Открыть ссылку"
      class="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-surface/90 text-brand"
      @click.stop
    >
      <PhLink :size="14" />
    </a>
  </div>
</template>
