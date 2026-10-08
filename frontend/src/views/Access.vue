<script setup lang="ts">
import { ref, computed, onMounted, nextTick, defineAsyncComponent } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { afterFamilyLoaded } from '@/stores/syncEngine'
import { landingPath } from '@/router/landing'
import { authErrorText } from '@/lib/authErrors'
import { googleClientId, renderGoogleButton } from '@/lib/googleSignIn'
import { isDark } from '@/lib/theme'
import { writeDemoPending } from '@/lib/storage'
import Hint from '@/components/kit/Hint.vue'

// Вход по почте — только стенд: под константой сборки ветка и чанк в прод-сборку не попадают.
const DevLogin = import.meta.env.DEV ? defineAsyncComponent(() => import('@/components/DevLogin.vue')) : null

/**
 * Вход (B2C-25, Р-13; DESIGN.md §6 «Первый запуск»): «Реально.», кнопка Google и «Попробовать».
 * Почта и пароль — только в dev-сборке (стенд, e2e): `DevLogin` подключается под
 * `import.meta.env.DEV`, в прод-сборку не попадает. «По коду» — на `/who`, после входа.
 */

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

const busy = ref(false)
const errorMessage = ref('')
// Вход истёк (401 любой ручки, B2C-25) — одной строкой над кнопкой.
const expired = computed(() => route.query.expired === '1')

const googleEl = ref<HTMLElement | null>(null)
const googleUnavailable = ref(false)

onMounted(async () => {
  if (!googleClientId) {
    googleUnavailable.value = true
    return
  }
  await nextTick()
  if (!googleEl.value) return
  try {
    await renderGoogleButton(googleEl.value, onGoogleToken, { theme: isDark.value ? 'dark' : 'light' })
  } catch {
    googleUnavailable.value = true
  }
})

async function onGoogleToken(idToken: string) {
  busy.value = true
  errorMessage.value = ''
  try {
    await authStore.googleLogin(idToken)
    await afterSignIn()
  } catch (err: unknown) {
    errorMessage.value = authErrorText(err instanceof Error ? err.message : String(err), 'google')
  } finally {
    busy.value = false
  }
}

// После входа: без семьи — «с кем» (Р-13); черновик демо на телефоне — вопрос «взять?» там, после
// создания семьи (B2C-27). Семья есть — её документы (черновик демо стирается) и первый запуск или главный.
async function afterSignIn() {
  if (!authStore.household) {
    writeDemoPending(financeStore.isDemo)
    await router.push('/who')
    return
  }
  writeDemoPending(false)
  await enterHousehold()
  await router.push(landingPath(authStore, financeStore))
}

// Документ телефона привязывается к семье, куда вошли: чужой (и черновик демо)
// стирается, свой сливается с серверным — неотправленное после истёкшего входа уходит.
async function enterHousehold() {
  if (!authStore.household) return
  await financeStore.enterFamily(authStore.household.id)
  afterFamilyLoaded()
}

// Черновик демо на телефоне: «Вернуться в демо» вместо «Попробовать».
const hasDemoDraft = computed(() => financeStore.isDemo)
// После «Войти заново» правки семьи ждут на телефоне: старт демо стёр бы их молча.
const editsWaitLogin = computed(() => financeStore.hasUnsent && !financeStore.isDemo)

</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-8 text-left">
    <div class="mb-8 flex items-center gap-2.5">
      <span
        class="grid size-9 place-items-center rounded-xl bg-brand font-display text-[15px] font-bold tracking-[0.02em] text-brand-ink"
      >
        FF
      </span>
      <span class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
        Family Finance
      </span>
    </div>

    <h1 class="font-display text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink">Реально.</h1>
    <p class="mt-2 text-[15px] text-ink-2">Фото цели и одна цифра — сколько до неё.</p>

    <p
      v-if="expired"
      role="status"
      class="mt-5 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
    >
      Вход истёк, войдите снова
    </p>

    <!-- Главное действие — кнопка Google (её рисует GIS: цвета Google, не бренд). -->
    <div class="mt-7 flex flex-col gap-2.5">
      <div ref="googleEl" class="flex min-h-[44px] justify-center" data-testid="google-button" />
      <p v-if="googleUnavailable" class="text-center text-[13px] text-ink-2">Вход через Google недоступен</p>
      <p class="flex items-center justify-center gap-1 text-[12.5px] text-ink-2">
        Раньше входили по почте?
        <Hint label="Раньше входили по почте">Войдите через Google с той же почтой — данные на месте.</Hint>
      </p>
    </div>

    <div
      v-if="errorMessage"
      role="alert"
      class="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
    >
      {{ errorMessage }}
    </div>

    <p v-if="editsWaitLogin" class="mt-6 text-center text-[12px] text-ink-2">
      Неотправленные правки ждут на этом телефоне — войдите в свою семью, и они уйдут.
    </p>
    <p v-else-if="hasDemoDraft" class="mt-6 text-center text-[12px] text-ink-2">После входа спросим, взять ли демо с собой.</p>
    <RouterLink to="/" class="mt-6 text-center text-[13px] text-brand">‹ Назад к описанию</RouterLink>

    <p class="mt-8 text-center text-[11.5px] text-ink-3">
      Бесплатно · выписка остаётся на телефоне ·
      <RouterLink to="/privacy" class="underline">политика</RouterLink>
    </p>

    <!-- Стенд и e2e: вход по почте (только dev-сборка). -->
    <component :is="DevLogin" v-if="DevLogin" @signed-in="afterSignIn" />
  </div>
</template>
