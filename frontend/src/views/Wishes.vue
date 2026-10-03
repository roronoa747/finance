<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCheck, PhGift, PhListBullets, PhPlus, PhSquaresFour } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, parseMoney } from '@/lib/money'
import { addedLabel } from '@/lib/dates'
import { liveWishlist, wishTotal } from '@/lib/finance'
import { compressImage } from '@/lib/photos/compress'
import { uploadPhoto } from '@/lib/photos/store'
import { usePhotos } from '@/lib/photos/usePhoto'
import { cleanLink, useLinkPreview, type LinkFound } from '@/lib/photos/useLinkPreview'
import { readStorage, writeStorage } from '@/lib/storage'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import Field from '@/components/kit/Field.vue'
import HeaderActions from '@/components/kit/HeaderActions.vue'
import IconBox from '@/components/kit/IconBox.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import GiftSheet from '@/components/goals/GiftSheet.vue'
import WishRow from '@/components/goals/WishRow.vue'
import WishSheet from '@/components/goals/WishSheet.vue'
import WishTile from '@/components/goals/WishTile.vue'
import PhotoSlot from '@/components/goals/PhotoSlot.vue'

/**
 * «Желания» (DESIGN.md §2 g4 «Желания по людям», «Подарок-сюрприз»; B2C-18): вкладки участников и
 * «Общие» (весь список семьи), «Уже купили», нажатие на аватар открывает список участника
 * (`/people/:slot`). На чужой вкладке — «Сюрпризы для <имя>» из личного документа автора:
 * адресат их не увидит. Viewer видит списки, но не правит (Р-12).
 */
type Tab = PersonId | 'all'

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const me = computed(() => authStore.slot)
const canEdit = computed(() => !authStore.isViewer)

const slotOf = (v: unknown): Tab => (v === 'a' || v === 'b' || v === 'c' ? v : 'all')
// Вкладка живёт в адресе (`/people/:slot`, «Общие» — `/wishes`): аватар в шапке и перезагрузка
// открывают её же (критик Блока 3: локальная вкладка терялась и не давала повторно нажать аватар).
const tab = computed<Tab>({
  get: () => slotOf(route.params.slot ?? route.query.tab),
  set: (v) => {
    void router.replace(v === 'all' ? '/wishes' : `/people/${v}`)
  },
})
const tabs = computed(() => [...people.value.map((p) => ({ value: p.id as Tab, label: p.name })), { value: 'all' as Tab, label: 'Общие' }])
const person = computed(() => people.value.find((p) => p.id === tab.value))

const wishlist = computed(() => liveWishlist(financeStore.wishlist))
// «Общие» — весь список семьи; вкладка участника — его желания (записи до Блока 3 — по добавившему).
const shown = computed(() => (tab.value === 'all' ? wishlist.value : wishlist.value.filter((w) => (w.list ?? w.by) === tab.value)))
const activeWish = computed(() => shown.value.filter((w) => !w.bought))
const boughtWish = computed(() => shown.value.filter((w) => w.bought))
const boughtSum = computed(() => wishTotal(boughtWish.value))

function nameOf(id: PersonId) {
  return people.value.find((p) => p.id === id)?.name || 'Участник'
}

/* ------------------ Покупки ------------------ */
const openWishModal = ref(false)
const wishName = ref('')
const wishPrice = ref('')
const wishUrl = ref('')
const wishBy = ref<PersonId>(me.value ?? 'a')
const editWishId = ref<string | null>(null)
/** Название последней отмеченной покупки — для «Куплено — …». */
const justBought = ref<string | null>(null)

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
const wishPhotoNote = ref<string | null>(null)

// Ссылка на товар (B2C-66): вставили — фото и название со страницы; название правится, цену вводит человек.
const link = useLinkPreview()
/** Название, подставленное со страницы: следующая ссылка заменит его, своё — нет. */
let linkName = ''
watch(wishUrl, (text) => link.schedule(text, applyLink))
function applyLink(found: LinkFound) {
  if (found.file) wishFile.value = found.file
  if (found.title && (!wishName.value.trim() || wishName.value === linkName)) wishName.value = linkName = found.title
}
function onWishFile(file: File) {
  wishFile.value = file
  link.clearNote()
}

async function createWish() {
  if (!wishName.value.trim()) return
  const id = financeStore.addWish({
    name: wishName.value.trim(),
    price: parseMoney(wishPrice.value),
    // Список участника — от своего имени (ТЗ п. 3); «Общие» — с выбором «Кто добавил» (PV-18).
    by: tab.value !== 'all' ? (me.value ?? 'a') : people.value.length > 1 ? wishBy.value : (me.value ?? 'a'),
    url: cleanLink(wishUrl.value) || undefined,
    list: tab.value,
  })
  const file = wishFile.value
  wishName.value = ''
  wishPrice.value = ''
  wishUrl.value = ''
  wishFile.value = null
  wishPhotoNote.value = null
  linkName = ''
  link.reset()
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

function markBought(id: string, itemName: string) {
  justBought.value = itemName
  financeStore.toggleBought(id)
}

/* ------------------ Сюрпризы (личный документ автора) ------------------ */
const giftsFor = computed(() => (person.value && person.value.id !== me.value ? financeStore.gifts.filter((g) => g.forSlot === person.value!.id) : []))
const showGifts = computed(() => canEdit.value && !!person.value && person.value.id !== me.value)
const openGift = ref(false)
// Фото сюрприза — скрытое, сервер отдаёт его только автору; показываем в строке (критик Блока 3: грузилось, но не показывалось).
const giftSrc = usePhotos(() => financeStore.gifts.map((g) => g.photoId))
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

    <!-- Одна строка без абзаца (правило 12): вещь видна ниже, в «Уже купили» -->
    <Callout v-if="justBought" tone="ok" :title="`Куплено — ${justBought}`" />

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
        :meta="`${nameOf(w.by)} · ${addedLabel(w.addedOn)}`"
        @open="editWishId = w.id"
        @toggle="markBought(w.id, w.name)"
      />
    </Card>
    <Card v-else>
      <EmptyState title="Список пуст">
        <Button v-if="canEdit" @click="openWishModal = true"><PhPlus :size="16" weight="bold" /> Добавить покупку</Button>
      </EmptyState>
    </Card>

    <Callout v-if="wishPhotoNote" tone="neutral" icon="info">{{ wishPhotoNote }}</Callout>
    <!-- «+» — справа в шапке (g4 «Желания по людям»), брендовым тоном: главное действие видно без чтения (правило 12). -->
    <HeaderActions v-if="canEdit">
      <button type="button" aria-label="Добавить покупку" class="rounded-[12px] cursor-pointer" @click="openWishModal = true">
        <IconBox tone="brand"><PhPlus :size="20" /></IconBox>
      </button>
    </HeaderActions>

    <!-- Сюрпризы для адресата вкладки — видит только автор (личный документ) -->
    <template v-if="showGifts && person">
      <Section :title="`Сюрпризы для ${person.name}`" />
      <Card tight class="border-dashed">
        <Callout tone="neutral" icon="lock" class="mb-2">
          Видно только вам. {{ person.name }} этот список не увидит — ни здесь, ни в итогах.
        </Callout>
        <div class="flex flex-col">
          <div v-for="g in giftsFor" :key="g.id" class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <img v-if="g.photoId && giftSrc[g.photoId]" :src="giftSrc[g.photoId]!" alt="" class="size-[38px] shrink-0 rounded-[12px] object-cover" />
            <IconBox v-else><PhGift :size="18" /></IconBox>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium" :class="g.bought ? 'text-ink-3 line-through' : 'text-ink'">{{ g.name }}</div>
              <div class="type-meta">{{ g.bought ? `куплено ${addedLabel(g.boughtOn)}` : 'сюрприз' }}</div>
            </div>
            <span class="shrink-0 text-[14px] font-semibold num" :class="g.bought ? 'text-ink-3' : 'text-ink'">{{ money(g.price) }}</span>
            <button
              type="button"
              :aria-label="g.bought ? 'Вернуть сюрприз в список' : 'Сюрприз куплен'"
              :class="cn('grid size-[26px] shrink-0 place-items-center rounded-lg border-[1.5px] cursor-pointer', g.bought ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong text-transparent hover:border-brand hover:text-brand')"
              @click="financeStore.toggleGiftBought(g.id)"
            >
              <PhCheck :size="14" weight="bold" />
            </button>
          </div>
          <p v-if="!giftsFor.length" class="py-2 type-meta">Пока ни одного сюрприза.</p>
        </div>
        <Button variant="secondary" class="mt-2 w-full" @click="openGift = true"><PhPlus :size="16" weight="bold" /> Сюрприз</Button>
      </Card>
      <GiftSheet :open="openGift" :for-slot="person.id" :for-name="person.name" @close="openGift = false" />
    </template>

    <!-- «Уже купили» — только когда есть что показать (правило 12: без пустых секций). -->
    <Section v-if="boughtWish.length" title="Уже купили">
      <template #action>
        <span class="type-meta num">{{ money(boughtSum) }}</span>
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
        :meta="`${nameOf(w.by)} · куплено ${addedLabel(w.boughtOn)}`"
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
        :meta="`${nameOf(w.by)} · куплено ${addedLabel(w.boughtOn)}`"
        @open="editWishId = w.id"
        @toggle="financeStore.toggleBought(w.id)"
      />
    </Card>

    <WishSheet :wish-id="canEdit ? editWishId : null" @close="editWishId = null" />

    <!-- Окно: новое желание в список вкладки (React `Goals.tsx:284-305`) -->
    <Sheet :open="openWishModal && canEdit" title="Новое желание" @close="openWishModal = false">
      <!-- Ссылка — первой (макет «Желание по ссылке»): вставили — фото и название подтянулись; в демо сервера нет -->
      <Field v-if="!financeStore.isDemo" label="Ссылка на товар">
        <Input v-model="wishUrl" inputmode="url" placeholder="Вставьте ссылку" class="mb-3" />
      </Field>
      <p v-else class="mb-3 type-meta">По ссылке — в приложении</p>
      <!-- Фото — крупно: желание узнаётся по картинке (Р-9) -->
      <PhotoSlot v-if="!financeStore.isDemo" class="mb-3" :file="wishFile" :busy="link.busy.value" removable @file="onWishFile" @remove="wishFile = null" />
      <Callout v-if="link.note.value" tone="neutral" icon="info" class="mb-3">{{ link.note.value }}</Callout>
      <Field label="Что покупаем">
        <Input v-model="wishName" placeholder="Например, сковорода" class="mb-3" />
      </Field>
      <Field label="Цена, ₸">
        <NumField v-model="wishPrice" placeholder="18 000" class="mb-3" />
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
