<script setup lang="ts">
import { computed } from 'vue'
import { PhCaretDown, PhCaretRight, PhCopy } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'
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
 * (`AppearancePanel`), «С кем» — участники (своя строка — «Свой кружок», B2C-63), код для партнёра (DESIGN §6; первый запуск обещает
 * «Код есть и в настройках») и состояние обмена (шторка синка с «Начать бюджет заново»).
 * Напоминание о выписке — Блок 5, удаление аккаунта и политика — Блок 4: секции появятся своими
 * задачами.
 */
const authStore = useAuthStore()
const financeStore = useFinanceStore()

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const me = computed(() => authStore.slot)
const canStyle = (slot: string) => slot === me.value && !authStore.isViewer
const joined = (slot: string) => (slot === me.value ? (authStore.isViewer ? 'вы · только просмотр' : 'вы · участник') : 'участник')

// Дом приглашения (приёмка Блока 3 п. 8): код создаёт участник с правом правки, в демо сервера нет.
const { code: inviteCode, canInvite, busy: inviteBusy, error: inviteError, copied, make: makeInvite, copy: copyInvite } = useInvite()
</script>

<template>
  <div class="flex flex-col gap-3 pt-1">
    <!-- Порядок макета g7: «Оформление» → «С кем» → выход; разбор выписок — свёрнут (правило 12). -->
    <Card>
      <h2 class="type-h3 mb-3 text-ink">Оформление</h2>
      <AppearancePanel section="look" />
    </Card>

    <Card>
      <h2 class="type-h3 text-ink">С кем</h2>
      <div class="mt-2 flex flex-col">
        <!-- Своя строка у участника — «Свой кружок» (Р-61): смайлик и цвет; чужая и у viewer — без перехода. -->
        <component
          :is="canStyle(p.id) ? RouterLink : 'div'"
          v-for="(p, i) in people"
          :key="p.id"
          v-bind="canStyle(p.id) ? { to: '/settings/me', 'aria-label': 'Свой кружок' } : {}"
          class="flex items-center gap-3 py-2.5"
          :class="i ? 'border-t border-line' : 'pt-0'"
        >
          <Avatar :id="p.id" :name="p.name" :size="34" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-ink">{{ p.name }}</div>
            <div class="type-meta">{{ joined(p.id) }}</div>
          </div>
          <PhCaretRight v-if="canStyle(p.id)" :size="16" class="shrink-0 text-ink-3" />
        </component>
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

    <!-- Разбор выписок (B2C-21): разделы трат и память разбора — свёрнуты; viewer выписок не грузит -->
    <Card v-if="!authStore.isViewer" tight>
      <details>
        <summary class="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <span class="min-w-0 flex-1">
            <span class="block type-h3 text-ink">Разбор трат</span>
          </span>
          <PhCaretDown :size="16" class="shrink-0 text-ink-3" />
        </summary>
        <div class="mt-3 border-t border-line pt-3"><ParseSettings /></div>
      </details>
    </Card>

    <Card tight>
      <AppearancePanel section="account" />
    </Card>
  </div>
</template>
