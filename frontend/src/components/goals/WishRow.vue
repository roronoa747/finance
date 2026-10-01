<script setup lang="ts">
import { PhCheck, PhLink, PhShoppingBag } from '@phosphor-icons/vue'
import { money } from '@/lib/money'
import { cn } from '@/lib/utils'
import { personColor } from '@/lib/palette'
import type { WishItem } from '@/types/finance'
import IconBox from '@/components/kit/IconBox.vue'
import Tag from '@/components/kit/Tag.vue'

/**
 * Строка желания — второй режим списка (владелец 2026-09-27: галерея и список с переключателем):
 * галочка, картинка, название с автором и датой, ссылка, цена. Ссылка вынесена из нажимаемой
 * области: ссылка внутри кнопки — невалидная разметка. Viewer — строка без действий (Р-12).
 */
defineProps<{
  wish: WishItem
  src: string | null
  canEdit: boolean
  bought?: boolean
  /** «Ильяс · 10 сентября» или «Аруна · куплено 20 сентября». */
  meta: string
}>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'toggle'): void }>()
</script>

<template>
  <div class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
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
    <Tag v-else-if="bought" tone="ok">купили</Tag>
    <IconBox v-else><PhShoppingBag :size="18" /></IconBox>
    <div v-if="wish.photoId" :class="cn('size-11 shrink-0 overflow-hidden rounded-inner bg-surface-3', bought && 'opacity-70')" data-photo>
      <img v-if="src" :src="src" alt="" class="size-full object-cover" />
    </div>
    <component
      :is="canEdit ? 'button' : 'div'"
      :type="canEdit ? 'button' : undefined"
      :data-wish="wish.id"
      :class="cn('min-w-0 flex-1 text-left', canEdit && 'cursor-pointer')"
      @click="canEdit && emit('open')"
    >
      <b :class="cn('block truncate text-[14.5px] font-medium', bought ? 'text-ink-3 line-through' : 'text-ink')">{{ wish.name }}</b>
      <span class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
        <i class="size-[7px] shrink-0 rounded-full" :style="{ background: personColor(wish.by) }" />
        {{ meta }}
      </span>
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
    <span :class="cn('shrink-0 text-[14px] font-semibold num', bought ? 'text-ink-3' : 'text-ink')">{{ money(wish.price) }}</span>
  </div>
</template>
