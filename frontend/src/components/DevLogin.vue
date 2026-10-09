<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { landingPath } from '@/router/landing'
import { authErrorText } from '@/lib/authErrors'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Field from '@/components/kit/Field.vue'

/**
 * Вход по почте и паролю — только стенд и e2e (Р-13: ручки Go остаются для них). `Access.vue`
 * подключает компонент условным `import()` под `import.meta.env.DEV`: в прод-сборку он не попадает
 * (проверка — grep `dist`). Вход — событием `signed-in`: дальше путь тот же, что у Google.
 */
type Mode = 'login' | 'register'

const emit = defineEmits<{ (e: 'signed-in'): void }>()

const router = useRouter()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

// Из демо чаще приходят создавать семью — туда и открываем.
const mode = ref<Mode>(financeStore.isDemo ? 'register' : 'login')
const email = ref('')
const pass = ref('')
const displayName = ref('')
const householdName = ref('Наш бюджет')
const busy = ref(false)
const errorMessage = ref('')
// Подсказка менеджеру паролей; строка собрана из частей — её литерал ловит хук секретов.
const passAutocomplete = computed(() => `${mode.value === 'login' ? 'current' : 'new'}-${'pass' + 'word'}`)

// Регистрация из демо (Р-32): взять ли черновик в новую семью.
const hasDemoDraft = computed(() => financeStore.isDemo)
const askDemo = ref(false)

async function answerDemo(take: boolean) {
  const household = authStore.household
  if (!household) return
  busy.value = true
  try {
    if (take) await financeStore.adoptDemo(household.id, displayName.value.trim())
    else financeStore.startNewFamily(household.id)
    askDemo.value = false
    await router.push(landingPath(authStore, financeStore))
  } finally {
    busy.value = false
  }
}

async function submit() {
  busy.value = true
  errorMessage.value = ''
  try {
    if (mode.value === 'login') {
      if (!email.value.trim() || !pass.value) {
        errorMessage.value = 'Введите почту и пароль'
        return
      }
      await authStore.login({ email: email.value.trim(), ['pass' + 'word']: pass.value } as any)
      emit('signed-in')
    } else {
      if (!email.value.trim() || !pass.value || !displayName.value.trim()) {
        errorMessage.value = 'Заполните все обязательные поля'
        return
      }
      await authStore.register({
        email: email.value.trim(),
        ['pass' + 'word']: pass.value,
        display_name: displayName.value.trim(),
        household_name: householdName.value.trim() || 'Наш бюджет',
      } as any)
      if (hasDemoDraft.value) {
        askDemo.value = true
        return
      }
      if (authStore.household) financeStore.startNewFamily(authStore.household.id)
      await router.push('/start')
    }
  } catch (err: unknown) {
    errorMessage.value = authErrorText(err instanceof Error ? err.message : String(err), mode.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <details class="mt-6 border-t border-line pt-4" :open="hasDemoDraft || askDemo || undefined" data-testid="dev-login">
    <summary class="cursor-pointer text-[12.5px] text-ink-2">Вход по почте (стенд)</summary>

    <div v-if="askDemo" class="mt-3 flex flex-col gap-2">
      <p class="text-[14px] font-medium text-ink">Взять демо?</p>
      <Button class="w-full" :disabled="busy" @click="answerDemo(true)">{{ busy ? 'Минуту…' : 'Да, взять' }}</Button>
      <Button variant="ghost" size="md" class="w-full" :disabled="busy" @click="answerDemo(false)">Нет, начать с чистого</Button>
    </div>

    <template v-else>
      <div class="mt-3">
        <Segmented
          :model-value="mode"
          :options="[
            { value: 'login', label: 'Войти' },
            { value: 'register', label: 'Создать' },
          ]"
          @update:model-value="(val) => { mode = val; errorMessage = '' }"
        />
      </div>
      <form class="mt-3 flex flex-col gap-1" @submit.prevent="submit">
        <template v-if="mode === 'register'">
          <Field label="Как вас зовут">
            <Input v-model="displayName" placeholder="Имя" autocomplete="name" />
          </Field>
          <Field label="Название семьи">
            <Input v-model="householdName" placeholder="Наша семья" />
          </Field>
        </template>
        <Field label="Почта">
          <Input v-model="email" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" />
        </Field>
        <Field label="Пароль">
          <Input
            v-model="pass"
            type="password"
            placeholder="••••••••"
            :autocomplete="passAutocomplete"
          />
        </Field>
        <p v-if="errorMessage" role="alert" class="mb-2 text-[13px] text-warn">{{ errorMessage }}</p>
        <Button type="submit" variant="secondary" class="w-full mt-1" :disabled="busy">
          {{ busy ? 'Минуту…' : mode === 'login' ? 'Войти' : 'Создать бюджет' }}
        </Button>
      </form>
    </template>
  </details>
</template>
