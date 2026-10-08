<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { PhCaretRight, PhCopy, PhUser, PhUsers, PhKey } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { afterFamilyLoaded } from '@/stores/syncEngine'
import { landingPath } from '@/router/landing'
import { authErrorText } from '@/lib/authErrors'
import { useInvite } from '@/components/useInvite'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Field from '@/components/kit/Field.vue'

/**
 * «С кем ведём?» (B2C-25, Р-7, Р-13; DESIGN.md §2 «Шаг 1 — с кем», §6): вошедший через Google без
 * семьи выбирает — один, создать семью (код для партнёра сразу) или по коду партнёра. Один
 * человек — тоже семья. Дальше — первый запуск (`/start`); участник по коду проходит свои шаги.
 */
type Choice = 'alone' | 'family' | 'code'

const router = useRouter()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

const choice = ref<Choice | null>(null)
const busy = ref(false)
const error = ref('')
const code = ref('')
// Код — общий с настройками (useInvite): там виден тот же, второй не создаётся.
const { code: invite, copied, make: makeInvite, copy, error: inviteError } = useInvite()

// Имя участника на сервере — из Google; у старого пользователя без имени — начало почты.
const name = computed(() => authStore.user?.display_name?.trim() || authStore.user?.email.split('@')[0] || 'Участник')

async function create(kind: 'alone' | 'family') {
  choice.value = kind
  busy.value = true
  error.value = ''
  try {
    const res = await authStore.createHousehold({ display_name: name.value })
    // Новая семья пуста: остатки прежнего документа телефона не переносятся.
    if (res.household) financeStore.startNewFamily(res.household.id)
    if (kind === 'alone') {
      await router.push('/start')
      return
    }
    await makeInvite()
    // Код не создался — семья уже есть: код возьмут в настройках, дальше — первый запуск.
    if (!invite.value) {
      error.value = inviteError.value
      await router.push('/start')
    }
  } catch (e) {
    error.value = authErrorText(e instanceof Error ? e.message : String(e), 'household')
  } finally {
    busy.value = false
  }
}

async function join() {
  if (!code.value.trim()) {
    error.value = 'Введите код приглашения.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await authStore.joinHousehold({ code: code.value.trim().toUpperCase(), display_name: name.value })
    if (authStore.household) {
      await financeStore.enterFamily(authStore.household.id)
      afterFamilyLoaded()
    }
    await router.push(landingPath(authStore, financeStore))
  } catch (e) {
    error.value = authErrorText(e instanceof Error ? e.message : String(e), 'join')
  } finally {
    busy.value = false
  }
}

const options = [
  { id: 'alone' as const, icon: PhUser, title: 'Один', meta: 'свои выписки, свои мечты' },
  { id: 'family' as const, icon: PhUsers, title: 'Создать семью', meta: 'приглашу партнёра по коду' },
  { id: 'code' as const, icon: PhKey, title: 'По коду', meta: 'у партнёра уже есть семья' },
]

function pick(id: Choice) {
  error.value = ''
  if (id === 'code') choice.value = 'code'
  else void create(id)
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-8 text-left">
    <!-- Семья создана: код для партнёра — сразу, дальше первый запуск -->
    <template v-if="invite">
      <h1 class="type-h1 text-ink">Код для партнёра</h1>
      <p class="mt-1 text-[14px] text-ink-2">Действует две недели. Есть и в настройках.</p>
      <button
        type="button"
        class="mt-6 flex items-center justify-center gap-2 rounded-card border border-line bg-surface py-5 font-display text-[30px] font-semibold tracking-[0.16em] num text-ink cursor-pointer"
        :aria-label="`Код ${invite} — копировать`"
        @click="copy"
      >
        {{ invite }} <PhCopy :size="18" class="text-ink-3" />
      </button>
      <p class="mt-1.5 h-4 text-center text-[12px] text-brand">{{ copied ? 'Скопировано' : '' }}</p>
      <Button class="mt-4 w-full" @click="router.push('/start')">Дальше</Button>
    </template>

    <template v-else>
      <h1 class="type-h1 text-ink">С кем ведём?</h1>
      <p class="mt-1 text-[14px] text-ink-2">Один человек — тоже семья.</p>

      <div class="mt-6 flex flex-col gap-2.5">
        <button
          v-for="o in options"
          :key="o.id"
          type="button"
          class="press flex items-center gap-3 rounded-card border bg-surface px-4 py-3.5 text-left cursor-pointer disabled:opacity-60"
          :class="choice === o.id ? 'border-brand' : 'border-line'"
          :disabled="busy"
          :data-choice="o.id"
          @click="pick(o.id)"
        >
          <component :is="o.icon" :size="22" class="shrink-0 text-brand" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-ink">{{ o.title }}</span>
            <span class="type-meta">{{ o.meta }}</span>
          </span>
          <PhCaretRight :size="16" class="shrink-0 text-ink-3" />
        </button>
      </div>

      <form v-if="choice === 'code'" class="mt-4 flex flex-col gap-1" @submit.prevent="join">
        <Field label="Код приглашения">
          <Input
            v-model="code"
            placeholder="A1B2C3D4"
            autocapitalize="characters"
            class-name="num tracking-[0.14em] font-semibold uppercase"
          />
        </Field>
        <Button type="submit" class="w-full mt-1" :disabled="busy">{{ busy ? 'Минуту…' : 'Войти в семью' }}</Button>
      </form>

      <p v-if="busy && choice !== 'code'" class="mt-4 text-center text-[13px] text-ink-2">Минуту…</p>
      <p
        v-if="error"
        role="alert"
        class="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
      >
        {{ error }}
      </p>

      <RouterLink to="/settings" class="mt-8 text-center text-[12.5px] text-ink-2">Выйти или удалить аккаунт</RouterLink>
    </template>
  </div>
</template>
