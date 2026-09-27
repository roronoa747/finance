<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PhCheck, PhGift, PhListBullets, PhPlus, PhSquaresFour } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { liveWishlist } from '@/lib/finance'
import { compressImage } from '@/lib/photos/compress'
import { uploadPhoto } from '@/lib/photos/store'
import { usePhotos } from '@/lib/photos/usePhoto'
import { readStorage, writeStorage } from '@/lib/storage'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import IconBox from '@/components/kit/IconBox.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import GiftSheet from '@/components/goals/GiftSheet.vue'
import WishRow from '@/components/goals/WishRow.vue'
import WishSheet from '@/components/goals/WishSheet.vue'
import WishTile from '@/components/goals/WishTile.vue'

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

// Галерея или список (владелец 2026-09-27): галерея по умолчанию, выбор — на устройстве.
const VIEW_KEY = 'ff_wishes_view'
const view = ref<'grid' | 'list'>(readStorage<'grid' | 'list'>(VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid')
function setView(v: 'grid' | 'list') {
  view.value = v
  writeStorage(VIEW_KEY, v)
}

// Фото желания (Р-9): картинка вместо текста — в строке и в окне; сжимается на телефоне, `photoId` у обоих.
const wishSrc = usePhotos(() => wishlist.value.map((w) => w.photoId))
const wishFile = ref<File | null>(null)
const wishFileInput = ref<HTMLInputElement | null>(null)
const wishPhotoNote = ref<string | null>(null)
function onWishFile(e: Event) {
  const input = e.target as HTMLInputElement
  wishFile.value = input.files?.[0] ?? null
  input.value = ''
}

async function createWish() {
  if (!wishName.value.trim()) return
  const id = financeStore.addWish({
    name: wishName.value.trim(),
    price: parseMoney(wishPrice.value),
    // Список участника — от своего имени (ТЗ п. 3); «Общие» — с выбором «Кто добавил» (PV-18).
    by: tab.value !== 'all' ? (me.value ?? 'a') : people.value.length > 1 ? wishBy.value : (me.value ?? 'a'),
    url: wishUrl.value.trim() || undefined,
    list: tab.value,
  })
  const file = wishFile.value
  wishName.value = ''
  wishPrice.value = ''
  wishUrl.value = ''
  wishFile.value = null
  wishPhotoNote.value = null
  openWishModal.value = false
  // Запись — сразу, фото — следом: без сети желание останется без картинки, добавить можно в окне правки.
  if (file && !financeStore.isDemo) {
    try {
      const { blob } = await compressImage(file)
      financeStore.setWishPhoto(id, await uploadPhoto(blob))
    } catch {
      wishPhotoNote.value = 'Фото не загрузилось — добавьте его в окне покупки при сети.'
    }
  }
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
    <!-- Вкладки участников и один переключатель вида в той же строке (владелец: отдельная строка — шум) -->
    <div class="flex items-center gap-2">
      <Segmented v-if="tabs.length > 1" v-model="tab" :options="tabs" class="min-w-0 flex-1" />
      <button
        type="button"
        :aria-label="view === 'grid' ? 'Списком' : 'Галереей'"
        class="grid size-10 shrink-0 place-items-center rounded-pill bg-surface-3 text-ink-2 cursor-pointer hover:text-ink"
        @click="setView(view === 'grid' ? 'list' : 'grid')"
      >
        <PhListBullets v-if="view === 'grid'" :size="18" />
        <PhSquaresFour v-else :size="18" />
      </button>
    </div>

    <Callout v-if="justBought" tone="ok" :title="`Куплено — ${justBought.name}`">
      Это {{ justBought.n }}-я покупка в дом. Вещь переехала в историю с датой и автором —
      через год будет видно, куда уходили деньги на быт.
    </Callout>

    <!-- Галерея или список (владелец 2026-09-27); viewer — плитки и строки без действий (Р-12) -->
    <div v-if="activeWish.length && view === 'grid'" class="grid grid-cols-2 gap-2.5">
      <WishTile
        v-for="w in activeWish"
        :key="w.id"
        :wish="w"
        :src="w.photoId ? (wishSrc[w.photoId] ?? null) : null"
        :can-edit="canEdit"
        @open="editWishId = w.id"
        @toggle="markBought(w.id, w.name)"
      />
    </div>
    <Card v-else-if="activeWish.length" flush>
      <WishRow
        v-for="w in activeWish"
        :key="w.id"
        :wish="w"
        :src="w.photoId ? (wishSrc[w.photoId] ?? null) : null"
        :can-edit="canEdit"
        :meta="`${nameOf(w.by)} · ${wishDate(w.addedOn)}`"
        @open="editWishId = w.id"
        @toggle="markBought(w.id, w.name)"
      />
    </Card>
    <Card v-else flush>
      <div class="px-4 py-6 text-center text-[13px] text-ink-3">Список пуст</div>
    </Card>

    <Callout v-if="wishPhotoNote" tone="neutral" icon="info">{{ wishPhotoNote }}</Callout>
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
    <div v-if="boughtWish.length && view === 'grid'" class="grid grid-cols-2 gap-2.5">
      <WishTile
        v-for="w in boughtWish"
        :key="w.id"
        :wish="w"
        :src="w.photoId ? (wishSrc[w.photoId] ?? null) : null"
        :can-edit="canEdit"
        bought
        :meta="`${nameOf(w.by)} · куплено ${wishDate(w.boughtOn)}`"
        @open="editWishId = w.id"
        @toggle="financeStore.toggleBought(w.id)"
      />
    </div>
    <Card v-else-if="boughtWish.length" flush>
      <WishRow
        v-for="w in boughtWish"
        :key="w.id"
        :wish="w"
        :src="w.photoId ? (wishSrc[w.photoId] ?? null) : null"
        :can-edit="canEdit"
        bought
        :meta="`${nameOf(w.by)} · куплено ${wishDate(w.boughtOn)}`"
        @open="editWishId = w.id"
        @toggle="financeStore.toggleBought(w.id)"
      />
    </Card>
    <Card v-else flush>
      <div class="px-4 py-6 text-center text-[13px] text-ink-3">Пока ничего</div>
    </Card>

    <WishSheet :wish-id="canEdit ? editWishId : null" @close="editWishId = null" />

    <!-- Окно: Покупка в дом (React `Goals.tsx:284-305`) -->
    <Sheet :open="openWishModal && canEdit" title="Покупка в дом" @close="openWishModal = false">
      <!-- Фото — первым: желание узнаётся по картинке (Р-9); в демо сервера нет -->
      <div v-if="!financeStore.isDemo" class="mb-3 flex flex-wrap items-center gap-2">
        <Chip quiet @click="wishFileInput?.click()">{{ wishFile ? 'Другое фото' : 'Фото' }}</Chip>
        <span v-if="wishFile" class="text-[12px] text-ink-3">{{ wishFile.name }}</span>
        <input ref="wishFileInput" type="file" accept="image/*" class="hidden" @change="onWishFile" />
      </div>
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
