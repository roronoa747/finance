<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PhCheck, PhGift, PhLink, PhPlus, PhShoppingBag } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { liveWishlist } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import IconBox from '@/components/kit/IconBox.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import GiftSheet from '@/components/goals/GiftSheet.vue'
import WishSheet from '@/components/goals/WishSheet.vue'

/**
 * «Желания» (DESIGN.md §2 g4 «Желания по людям», «Подарок-сюрприз»; B2C-18): вкладки участников и
 * «Общие» (весь список семьи), «Уже купили», нажатие на аватар открывает список участника
 * (`/people/:slot`). На чужой вкладке — «Сюрпризы для <имя>» из личного документа автора:
 * адресат их не увидит. Viewer видит списки, но не правит (Р-12).
 */
type Tab = PersonId | 'all'

const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const me = computed(() => authStore.slot)
const canEdit = computed(() => !authStore.isViewer)

const slotOf = (v: unknown): Tab => (v === 'a' || v === 'b' || v === 'c' ? v : 'all')
const tab = ref<Tab>(slotOf(route.params.slot ?? route.query.tab))
watch(
  () => [route.params.slot, route.query.tab] as const,
  ([slot, q]) => {
    tab.value = slotOf(slot ?? q)
  },
)
const tabs = computed(() => [...people.value.map((p) => ({ value: p.id as Tab, label: p.name })), { value: 'all' as Tab, label: 'Общие' }])
const person = computed(() => people.value.find((p) => p.id === tab.value))

const wishlist = computed(() => liveWishlist(financeStore.wishlist))
// «Общие» — весь список семьи; вкладка участника — его желания (записи до Блока 3 — по добавившему).
const shown = computed(() => (tab.value === 'all' ? wishlist.value : wishlist.value.filter((w) => (w.list ?? w.by) === tab.value)))
const activeWish = computed(() => shown.value.filter((w) => !w.bought))
const boughtWish = computed(() => shown.value.filter((w) => w.bought))
const boughtSum = computed(() => boughtWish.value.reduce((a, w) => a + w.price, 0))

function nameOf(id: PersonId) {
  return people.value.find((p) => p.id === id)?.name || 'Участник'
}

/** Новые даты — ISO («5 сентября»); старые строки из прода (`24.09.2026`) — как есть. */
function wishDate(s: string | null | undefined) {
  if (!s) return ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? atLabel(s) : s
}

/* ------------------ Покупки ------------------ */
const openWishModal = ref(false)
const wishName = ref('')
const wishPrice = ref('')
const wishUrl = ref('')
const wishBy = ref<PersonId>(me.value ?? 'a')
const editWishId = ref<string | null>(null)
/** Последняя отмеченная покупка и её номер среди купленных — на момент отметки. */
const justBought = ref<{ name: string; n: number } | null>(null)

function createWish() {
  if (!wishName.value.trim()) return
  financeStore.addWish({
    name: wishName.value.trim(),
    price: parseMoney(wishPrice.value),
    // Список участника — от своего имени (ТЗ п. 3); «Общие» — с выбором «Кто добавил» (PV-18).
    by: tab.value !== 'all' ? (me.value ?? 'a') : people.value.length > 1 ? wishBy.value : (me.value ?? 'a'),
    url: wishUrl.value.trim() || undefined,
    list: tab.value,
  })
  wishName.value = ''
  wishPrice.value = ''
  wishUrl.value = ''
  openWishModal.value = false
}

// Номер — до отметки: в React `bought.length + 1` считался уже после неё и был на один больше.
function markBought(id: string, itemName: string) {
  justBought.value = { name: itemName, n: boughtWish.value.length + 1 }
  financeStore.toggleBought(id)
}

/* ------------------ Сюрпризы (личный документ автора) ------------------ */
const giftsFor = computed(() => (person.value && person.value.id !== me.value ? financeStore.gifts.filter((g) => g.forSlot === person.value!.id) : []))
const showGifts = computed(() => canEdit.value && !!person.value && person.value.id !== me.value)
const openGift = ref(false)
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1">
    <Segmented v-if="tabs.length > 1" v-model="tab" :options="tabs" />

    <Callout v-if="justBought" tone="ok" :title="`Куплено — ${justBought.name}`">
      Это {{ justBought.n }}-я покупка в дом. Вещь переехала в историю с датой и автором —
      через год будет видно, куда уходили деньги на быт.
    </Callout>

    <Card flush>
      <div
        v-for="w in activeWish"
        :key="w.id"
        class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
      >
        <!-- Viewer видит список, но не правит (Р-12, матрица §3): ни галочки, ни кнопки строки -->
        <button
          v-if="canEdit"
          type="button"
          aria-label="Отметить купленным"
          class="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-line-strong text-transparent hover:border-brand hover:text-brand cursor-pointer"
          @click="markBought(w.id, w.name)"
        >
          <PhCheck :size="14" weight="bold" />
        </button>
        <IconBox v-else><PhShoppingBag :size="18" /></IconBox>
        <!-- Ссылка вынесена из нажимаемой области: ссылка внутри кнопки — невалидная разметка. -->
        <component
          :is="canEdit ? 'button' : 'div'"
          :type="canEdit ? 'button' : undefined"
          :class="cn('min-w-0 flex-1 text-left', canEdit && 'cursor-pointer')"
          @click="canEdit && (editWishId = w.id)"
        >
          <b class="block truncate text-[14.5px] font-medium text-ink">{{ w.name }}</b>
          <span class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
            <i class="size-[7px] shrink-0 rounded-full" :style="{ background: `var(--p${w.by})` }" />
            {{ nameOf(w.by) }} · {{ wishDate(w.addedOn) }}
          </span>
        </component>
        <a
          v-if="w.url"
          :href="w.url"
          target="_blank"
          rel="noreferrer noopener"
          class="inline-flex shrink-0 items-center gap-1 rounded-pill border border-line px-2 py-0.5 text-[11.5px] text-brand"
        >
          <PhLink :size="10" /> ссылка
        </a>
        <span class="shrink-0 text-[14px] font-semibold num text-ink">{{ plain(w.price) }}</span>
      </div>
      <div v-if="!activeWish.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
        Список пуст
      </div>
    </Card>

    <Button v-if="canEdit" variant="secondary" class="w-full" @click="openWishModal = true">
      <PhPlus :size="16" weight="bold" /> Добавить покупку
    </Button>

    <!-- Сюрпризы для адресата вкладки — видит только автор (личный документ) -->
    <template v-if="showGifts && person">
      <Section :title="`Сюрпризы для ${person.name}`" />
      <Card tight class="border-dashed">
        <Callout tone="neutral" icon="lock" class="mb-2">
          Видно только вам. {{ person.name }} этот список не увидит — ни здесь, ни в итогах.
        </Callout>
        <div class="flex flex-col">
          <div v-for="g in giftsFor" :key="g.id" class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <IconBox><PhGift :size="18" /></IconBox>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium" :class="g.bought ? 'text-ink-3 line-through' : 'text-ink'">{{ g.name }}</div>
              <div class="type-meta">{{ g.bought ? `куплено ${wishDate(g.boughtOn)}` : 'сюрприз' }}</div>
            </div>
            <span class="shrink-0 text-[14px] font-semibold num" :class="g.bought ? 'text-ink-3' : 'text-ink'">{{ plain(g.price) }}</span>
            <button
              type="button"
              :aria-label="g.bought ? 'Вернуть сюрприз в список' : 'Сюрприз куплен'"
              :class="cn('grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] cursor-pointer', g.bought ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong text-transparent hover:border-brand hover:text-brand')"
              @click="financeStore.toggleGiftBought(g.id)"
            >
              <PhCheck :size="14" weight="bold" />
            </button>
          </div>
          <p v-if="!giftsFor.length" class="py-2 text-[13px] text-ink-3">Пока ни одного сюрприза.</p>
        </div>
        <Button variant="secondary" class="mt-2 self-start" size="sm" @click="openGift = true"><PhPlus :size="14" weight="bold" /> Сюрприз</Button>
      </Card>
      <GiftSheet :open="openGift" :for-slot="person.id" :for-name="person.name" @close="openGift = false" />
    </template>

    <Section title="Уже купили">
      <template v-if="boughtWish.length" #action>
        <span class="text-[13px] text-ink-3 num">{{ money(boughtSum) }}</span>
      </template>
    </Section>
    <Card flush>
      <div
        v-for="w in boughtWish"
        :key="w.id"
        class="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
      >
        <button
          v-if="canEdit"
          type="button"
          aria-label="Вернуть в список"
          class="grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] border-brand bg-brand text-brand-ink cursor-pointer"
          @click="financeStore.toggleBought(w.id)"
        >
          <PhCheck :size="14" weight="bold" />
        </button>
        <Tag v-else tone="ok">купили</Tag>
        <div class="min-w-0 flex-1">
          <b class="block text-[14.5px] font-medium text-ink-3 line-through">{{ w.name }}</b>
          <div class="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
            <i class="size-[7px] shrink-0 rounded-full" :style="{ background: `var(--p${w.by})` }" />
            {{ nameOf(w.by) }} · куплено {{ wishDate(w.boughtOn) }}
          </div>
        </div>
        <span class="shrink-0 text-[14px] font-semibold text-ink-3 num">{{ plain(w.price) }}</span>
      </div>
      <div v-if="!boughtWish.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
        Пока ничего
      </div>
    </Card>

    <WishSheet :wish-id="canEdit ? editWishId : null" @close="editWishId = null" />

    <!-- Окно: Покупка в дом (React `Goals.tsx:284-305`) -->
    <Sheet :open="openWishModal && canEdit" title="Покупка в дом" @close="openWishModal = false">
      <Field label="Что покупаем">
        <Input v-model="wishName" placeholder="Например, сковорода" class="mb-3" />
      </Field>
      <Field label="Цена, ₸">
        <NumField v-model="wishPrice" placeholder="18 000" class="mb-3" />
      </Field>
      <Field label="Ссылка на товар">
        <Input v-model="wishUrl" inputmode="url" placeholder="можно оставить пустым" class="mb-3" />
      </Field>

      <Field v-if="tab === 'all' && people.length > 1" label="Кто добавил" group>
        <Segmented
          v-model="wishBy"
          :options="people.map((p) => ({ value: p.id, label: p.name }))"
        />
      </Field>

      <Button :disabled="!wishName.trim()" class="w-full mt-2" @click="createWish">
        Добавить в список
      </Button>
    </Sheet>
  </div>
</template>
