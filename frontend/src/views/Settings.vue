<script setup lang="ts">
import { computed } from 'vue'
import { PhCopy } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useInvite } from '@/components/useInvite'
import AppearancePanel from '@/components/AppearancePanel.vue'
import ParseSettings from '@/components/ParseSettings.vue'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Настройки (DESIGN.md §2 g7; B2C-13): «Оформление» с именем прямо на экране
 * (`AppearancePanel`), «С кем» — участники, код для партнёра (DESIGN §6; первый запуск обещает
 * «Код есть и в настройках») и состояние обмена (шторка синка с «Начать бюджет заново»).
 * Напоминание о выписке — Блок 5, удаление аккаунта и политика — Блок 4: секции появятся своими
 * задачами.
 */
const authStore = useAuthStore()
const financeStore = useFinanceStore()

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const me = computed(() => authStore.slot)
const joined = (slot: string) => (slot === me.value ? (authStore.isViewer ? 'вы · только просмотр' : 'вы · участник') : 'участник')

// Дом приглашения (приёмка Блока 3 п. 8): код создаёт участник с правом правки, в демо сервера нет.
const { code: inviteCode, canInvite, busy: inviteBusy, error: inviteError, copied, make: makeInvite, copy: copyInvite } = useInvite()
</script>

<template>
  <div class="flex flex-col gap-3 pt-1">
    <Card>
      <h2 class="type-h3 mb-3 text-ink">Оформление</h2>
      <AppearancePanel />
    </Card>

    <!-- Разбор выписок (B2C-21): разделы трат и память разбора; viewer выписок не грузит -->
    <Card v-if="!authStore.isViewer">
      <h2 class="type-h3 mb-3 text-ink">Разбор выписок</h2>
      <ParseSettings />
    </Card>

    <Card>
      <h2 class="type-h3 text-ink">С кем</h2>
      <div class="mt-2 flex flex-col">
        <div v-for="p in people" :key="p.id" class="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
          <Avatar :id="p.id" :name="p.name" :size="34" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-ink">{{ p.name }}</div>
            <div class="type-meta">{{ joined(p.id) }}</div>
          </div>
        </div>
        <p v-if="!people.length" class="text-[14px] text-ink-2">Участников пока нет.</p>
      </div>
      <div v-if="canInvite" class="mt-3 border-t border-line pt-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[14px] text-ink">{{ inviteCode ? 'Код для партнёра' : 'Пригласить партнёра' }}</span>
          <button
            v-if="inviteCode"
            type="button"
            class="flex items-center gap-1.5 font-display text-[18px] font-semibold tracking-[0.14em] num text-ink cursor-pointer"
            :aria-label="`Код ${inviteCode} — копировать`"
            @click="copyInvite"
          >
            {{ inviteCode }} <PhCopy :size="15" class="text-ink-3" />
          </button>
          <Button v-else size="sm" variant="secondary" :disabled="inviteBusy" @click="makeInvite">
            {{ inviteBusy ? 'Минуту…' : 'Создать код' }}
          </Button>
        </div>
        <p v-if="inviteError" role="alert" class="mt-1.5 text-[12.5px] text-warn">{{ inviteError }}</p>
        <p v-if="copied" class="mt-1.5 text-[12px] text-brand">Скопировано</p>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span class="text-[14px] text-ink-2">Обмен между телефонами</span>
        <SyncBadge />
      </div>
    </Card>
  </div>
</template>
