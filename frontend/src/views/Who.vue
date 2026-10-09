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
import { readDemoPending, readDemoPendingKind, writeDemoPending } from '@/lib/storage'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Field from '@/components/kit/Field.vue'

/**
 * «С кем ведём?» (B2C-25, Р-7, Р-13; DESIGN.md §2 «Шаг 1 — с кем», §6): вошедший через Google без
 * семьи выбирает — один, создать семью (код для партнёра сразу) или по коду партнёра. Один
 * человек — тоже семья. Дальше — первый запуск (`/start`); участник по коду проходит свои шаги.
 * Вход из демо (B2C-27): после создания семьи — «Взять демо?»; по коду демо не переносится.
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

// Черновик демо ждёт ответа (`ff_demo_pending`): семья уже создана — вопрос сразу, в том числе
// после перезапуска приложения; ещё нет — после «Один» / «Создать семью».
const demoPending = ref(readDemoPending() && financeStore.isDemo)
const askDemo = computed(() => demoPending.value && authStore.hasHousehold)

// Имя участника на сервере — из Google; у старого пользователя без имени — начало почты.
const name = computed(() => authStore.user?.display_name?.trim() || authStore.user?.email.split('@')[0] || 'Участник')

async function create(kind: 'alone' | 'family') {
  choice.value = kind
  busy.value = true
  error.value = ''
  try {
    const res = await authStore.createHousehold({ display_name: name.value })
    // Черновик демо ждёт ответа (askDemo), документ телефона не трогаем; выбор помним — перезапуск
    // до ответа не теряет код для партнёра.
    if (demoPending.value) {
      writeDemoPending(kind)
      return
    }
    // Новая семья пуста: остатки прежнего документа телефона не переносятся.
    if (res.household) financeStore.startNewFamily(res.household.id)
    await afterCreate(kind)
  } catch (e) {
    error.value = authErrorText(e instanceof Error ? e.message : String(e), 'household')
  } finally {
    busy.value = false
  }
}

async function afterCreate(kind: 'alone' | 'family') {
  if (kind === 'alone') {
    await router.push(landingPath(authStore, financeStore))
    return
  }
  await makeInvite()
  // Код не создался — семья уже есть: код возьмут в настройках, дальше — первый запуск.
  if (!invite.value) {
    error.value = inviteError.value
    await router.push(landingPath(authStore, financeStore))
  }
}

/** «Да» — демо-документ становится документом новой семьи (Р-32); «Нет» — чистый лист. */
async function answerDemo(take: boolean) {
  const household = authStore.household
  if (!household) return
  busy.value = true
  try {
    const kind = choice.value === 'family' || choice.value === 'alone' ? choice.value : readDemoPendingKind()
    if (take) await financeStore.adoptDemo(household.id, name.value, undefined, kind === 'family')
    else financeStore.startNewFamily(household.id)
    writeDemoPending(false)
    demoPending.value = false
    await afterCreate(kind)
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
    // У семьи партнёра свои данные: черновик демо не переносится (сказано у поля кода).
    writeDemoPending(false)
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
    <!-- Вход из демо: семья создана — взять ли черновик (B2C-27, Р-32) -->
    <template v-if="askDemo">
      <h1 class="type-h1 text-ink">Взять демо?</h1>
      <p class="mt-1 text-[14px] text-ink-2">То, что вы заполнили в демо, станет вашим.</p>
      <Button class="mt-6 w-full" :disabled="busy" @click="answerDemo(true)">{{ busy ? 'Минуту…' : 'Да, взять' }}</Button>
      <Button variant="ghost" class="mt-2 w-full" :disabled="busy" @click="answerDemo(false)">Нет, начать с чистого</Button>
    </template>

    <!-- Семья создана: код для партнёра — сразу, дальше первый запуск -->
    <template v-else-if="invite">
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
      <Button class="mt-4 w-full" @click="router.push(landingPath(authStore, financeStore))">Дальше</Button>
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
        <Field label="Код приглашения" :error="error">
          <Input
            v-model="code"
            placeholder="A1B2C3D4"
            autocapitalize="characters"
            class-name="bg-surface num tracking-[0.14em] font-semibold uppercase"
          />
        </Field>
        <p v-if="demoPending" class="mb-2 text-[12.5px] text-ink-2">Демо сюда не переносится — у семьи уже свои данные.</p>
        <Button type="submit" class="w-full mt-1" :disabled="busy">{{ busy ? 'Минуту…' : 'Войти в семью' }}</Button>
      </form>

      <p v-if="busy && choice !== 'code'" class="mt-4 text-center text-[13px] text-ink-2">Минуту…</p>
      <p
        v-if="error && choice !== 'code'"
        role="alert"
        class="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
      >
        {{ error }}
      </p>

      <RouterLink to="/settings" class="mt-8 text-center text-[12.5px] text-ink-2">Выйти или удалить аккаунт</RouterLink>
    </template>
  </div>
</template>
