<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowsClockwise, PhCheck, PhCloudSlash, PhWarning } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { memberColor } from '@/lib/palette'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'

/**
 * Состояние синхронизации словами и шторка по нему (React `SyncBadge.tsx`, Б-18): дата
 * обмена, участники, пояснение про офлайн и «Начать бюджет заново». Приглашение второго — в
 * «С кем» Настроек (`useInvite`, приёмка Блока 3 п. 8), не здесь.
 * «Выйти» — в «Оформлении» (PV-21 п. 6). Участники — из `people` документа: ручки
 * участников с ролями у Go нет (Р-15), поэтому «только просмотр» — только у себя.
 */
/**
 * `compact` (шапка оболочки, B2C-13): только точка-иконка, и только когда есть что сказать —
 * обмен идёт, ждёт отправки, нет сети или «не сошлось»; в покое и в демо шапка чистая.
 * Полный вид с подписью — в Настройках.
 */
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const financeStore = useFinanceStore()
const authStore = useAuthStore()
const router = useRouter()

const open = ref(false)
const syncing = ref(false)

const status = computed(() => financeStore.syncStatus)
const lastSyncedAt = computed(() => financeStore.lastSyncedAt)
const lastError = computed(() => financeStore.lastError)
const people = computed(() => financeStore.people)
const me = computed(() => authStore.slot)

const isBad = computed(() => status.value === 'error' || status.value === 'conflict')
const quiet = computed(() => props.compact && (authStore.isDemo || status.value === 'idle'))

const label = computed(() => {
  switch (status.value) {
    case 'syncing':
      return 'синхронизация'
    case 'dirty':
      return 'ждёт отправки'
    case 'offline':
      return 'нет сети'
    case 'conflict':
    case 'error':
      return 'не сошлось'
    case 'idle':
    default:
      return 'синхронизировано'
  }
})

// Личный документ (свои счета, память продавцов) сброс не трогает — хвост PV, B2C-13.
const resetWarning = computed(() =>
  authStore.isDemo
    ? 'Сотрутся доходы, цели, покупки, обязательства и счета демо на этом телефоне. Отменить будет нельзя.'
    : 'Сотрутся общие счета, доходы, цели, покупки и обязательства — у обоих участников и в облаке. Личные счета останутся. Отменить будет нельзя.',
)

async function triggerManualSync() {
  syncing.value = true
  try {
    await Promise.all([
      financeStore.syncHousehold(),
      financeStore.privateUnsent ? financeStore.syncPrivate() : financeStore.pullPrivateDoc(),
    ])
  } finally {
    syncing.value = false
  }
}

// После сброса — первый запуск из выписки (`/start`, B2C-19); гейт в роутере, поэтому переход явный.
function startOver() {
  financeStore.resetAll()
  open.value = false
  void financeStore.syncHousehold()
  void router.replace('/start')
}
</script>

<template>
  <div>
    <button
      v-if="!quiet"
      type="button"
      :class="[
        'flex items-center gap-1.5 font-medium transition-colors cursor-pointer',
        compact ? 'grid size-[38px] place-items-center rounded-[12px] bg-surface-2' : 'text-[12px]',
        authStore.isDemo
          ? 'text-ink-2 hover:text-ink-2'
          : isBad
            ? 'text-warn'
            : status === 'idle'
              ? 'text-ink-2 hover:text-ink-2'
              : 'text-brand',
      ]"
      :title="authStore.isDemo ? 'Демо живёт только на этом телефоне' : lastError || label"
      :aria-label="compact ? `Обмен: ${label}` : undefined"
      @click="open = true"
    >
      <!-- Демо к серверу не ходит (Р-32): статуса синхронизации у него нет. -->
      <template v-if="authStore.isDemo">демо</template>
      <template v-else>
        <PhArrowsClockwise v-if="status === 'syncing'" :size="compact ? 18 : 13" class="animate-spin" />
        <PhWarning v-else-if="isBad" :size="compact ? 18 : 13" />
        <PhCloudSlash v-else-if="status === 'offline'" :size="compact ? 18 : 13" />
        <PhArrowsClockwise v-else-if="status === 'dirty'" :size="compact ? 18 : 13" />
        <PhCheck v-else :size="13" />
        <span v-if="!compact">{{ label }}</span>
      </template>
    </button>

    <Sheet :open="open" title="Синхронизация" @close="open = false">
      <div class="flex flex-col gap-3 text-left">
        <div class="rounded-xl border border-line bg-surface-2 p-3.5 text-[13.5px]">
          <div class="flex items-center justify-between">
            <span class="text-ink-2">Состояние</span>
            <b v-if="authStore.isDemo" class="font-semibold text-ink">демо</b>
            <b v-else :class="['font-semibold', isBad ? 'text-warn' : 'text-ink']">{{ label }}</b>
          </div>
          <p v-if="authStore.isDemo" class="mt-2 text-[12.5px] text-ink-2">
            Демо живёт только на этом телефоне.
          </p>
          <div
            v-else-if="lastSyncedAt"
            class="mt-2 flex items-center justify-between text-[12.5px] text-ink-2"
          >
            <span>Последний обмен</span>
            <span class="num">{{ new Date(lastSyncedAt).toLocaleString('ru-RU') }}</span>
          </div>
          <div
            v-if="lastError && !authStore.isDemo"
            class="mt-2 rounded-lg border border-warn-line bg-warn-soft p-2.5 text-[12px] text-ink-2"
          >
            {{ lastError }}
          </div>
        </div>

        <div v-if="people.length" class="rounded-xl border border-line px-3.5 py-3">
          <div class="mb-2 text-[12px] uppercase tracking-[0.07em] text-ink-2">В бюджете</div>
          <div
            v-for="p in people"
            :key="p.id"
            class="flex items-center gap-2.5 py-1 text-[14px] text-ink"
          >
            <i
              class="size-2.5 shrink-0 rounded-full"
              :style="{ background: memberColor(people, p.id) }"
            />
            {{ p.name }}
            <span v-if="p.id === me" class="text-[12px] text-ink-2">это вы</span>
            <span v-if="p.id === me && authStore.isViewer" class="text-[12px] text-ink-2">
              только просмотр
            </span>
          </div>
        </div>

        <div v-if="authStore.household && !authStore.isDemo" class="rounded-xl border border-line p-3.5 text-[13px]">
          <div class="text-ink-2">Семья</div>
          <div class="mt-0.5 font-semibold text-ink">{{ authStore.household.name }}</div>
        </div>


        <Button
          v-if="!authStore.isDemo"
          variant="outline"
          class="w-full"
          :disabled="syncing || status === 'syncing'"
          @click="triggerManualSync"
        >
          {{ syncing ? 'Синхронизируем…' : 'Синхронизировать' }}
        </Button>

        <p class="text-[12px] leading-relaxed text-ink-2">
          Записи сохраняются на устройстве сразу, даже без сети, и уезжают в облако при первой
          возможности. Если оба правили одно и то же офлайн — взносы и покупки сложатся, а не
          перезатрут друг друга.
        </p>

        <DangerZone
          v-if="!authStore.isViewer"
          label="Начать бюджет заново"
          :warning="resetWarning"
          confirm-label="Стереть всё"
          @confirm="startOver"
        />
      </div>
    </Sheet>
  </div>
</template>
