<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhCaretDown, PhCaretRight, PhCopy } from '@phosphor-icons/vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useInvite, useMembers } from '@/components/useInvite'
import AppearancePanel from '@/components/AppearancePanel.vue'
import ParseSettings from '@/components/ParseSettings.vue'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Настройки (DESIGN.md §2 g7; B2C-13): «Оформление» с именем прямо на экране
 * (`AppearancePanel`), «С кем» — участники семьи с ролями с сервера (B2C-25; своя строка — «Свой
 * кружок», B2C-63), код для партнёра и состояние обмена; «Выйти» и «Удалить аккаунт» (B2C-25,
 * Р-14). Без семьи («с кем» не пройдено) — только выход и удаление.
 * Напоминание о выписке — Блок 5.
 */
const router = useRouter()
const authStore = useAuthStore()

const me = computed(() => authStore.slot)
const canStyle = (slot: string) => slot === me.value && !authStore.isViewer

// Участники — одним местом с шторкой синка и «Пригласить» (`useMembers`); кружок — из документа по слоту.
const { rows } = useMembers()
const joined = (r: { id: string; role: string }) =>
  r.role === 'viewer' ? (r.id === me.value ? 'вы · только просмотр' : 'только просмотр') : r.id === me.value ? 'вы · участник' : 'участник'

onMounted(() => {
  void authStore.fetchMembers()
  // Флаг владельца (`/auth/me`, B2C-28) — пункт «Цифры».
  if (!authStore.isDemo && authStore.token) void authStore.fetchMe().catch(() => {})
})

// Дом приглашения (приёмка Блока 3 п. 8): правило «кому виден код» — в `useInvite`.
const { code: inviteCode, canInvite, busy: inviteBusy, error: inviteError, copied, make: makeInvite, copy: copyInvite } = useInvite()

// Удаление аккаунта (B2C-25, Р-14): что уйдёт и что останется у семьи — одной строкой предупреждения.
// Состав — тот же, что в «С кем»: без ответа сервера — живые люди документа (ревью frontend Б4 Н-3).
const deleting = ref(false)
const deleteError = ref('')
const deleteWarning = computed(() =>
  authStore.hasHousehold && rows.value.length > 1
    ? 'Удалятся ваш аккаунт, операции, выписки и ваши фото — безвозвратно. Общий бюджет останется у семьи.'
    : 'Удалятся аккаунт и все данные — бюджет, мечты, операции и фото — безвозвратно.',
)
async function deleteAccount() {
  deleting.value = true
  deleteError.value = ''
  try {
    await authStore.deleteAccount()
    await router.replace('/access')
  } catch {
    deleteError.value = 'Не получилось удалить. Проверьте сеть и попробуйте ещё раз.'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 pt-1">
    <template v-if="authStore.hasHousehold || authStore.isDemo">
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
            :is="canStyle(r.id) ? RouterLink : 'div'"
            v-for="(r, i) in rows"
            :key="r.id"
            v-bind="canStyle(r.id) ? { to: '/settings/me', 'aria-label': 'Свой кружок' } : {}"
            class="flex items-center gap-3 py-2.5"
            :class="i ? 'border-t border-line' : 'pt-0'"
            :data-member="r.id"
          >
            <Avatar :id="r.id" :name="r.name" :size="34" />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-ink">{{ r.name }}</div>
              <div class="type-meta">{{ joined(r) }}</div>
            </div>
            <PhCaretRight v-if="canStyle(r.id)" :size="16" class="shrink-0 text-ink-3" />
          </component>
          <p v-if="!rows.length" class="text-[14px] text-ink-2">Участников пока нет.</p>
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
    </template>

    <Card tight>
      <AppearancePanel section="account" />
      <RouterLink v-if="authStore.admin" to="/admin" class="mt-3 flex items-center justify-between border-t border-line pt-3 text-[14px] text-ink-2">
        Цифры <PhCaretRight :size="16" class="text-ink-3" />
      </RouterLink>
      <RouterLink to="/privacy" class="mt-3 flex items-center justify-between border-t border-line pt-3 text-[14px] text-ink-2">
        Политика конфиденциальности <PhCaretRight :size="16" class="text-ink-3" />
      </RouterLink>
      <!-- Удаление аккаунта (Р-14) — любому вошедшему, и без семьи; в демо аккаунта нет. -->
      <DangerZone
        v-if="!authStore.isDemo"
        label="Удалить аккаунт и данные"
        :warning="deleteWarning"
        confirm-word="удалить"
        confirm-label="Удалить навсегда"
        :busy="deleting"
        @confirm="deleteAccount"
      />
      <p v-if="deleteError" role="alert" class="mt-2 text-[12.5px] text-warn">{{ deleteError }}</p>
    </Card>
  </div>
</template>
