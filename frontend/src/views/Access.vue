<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhSparkle } from '@phosphor-icons/vue'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { landingPath } from '@/router/landing'
import { seedSpendCategories } from '@/lib/statements/model'
import { monthKey, weekKey } from '@/lib/dates'
import type { SpendTotal } from '@/lib/statements/types'
import { authErrorText } from '@/lib/authErrors'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Field from '@/components/kit/Field.vue'

type Mode = 'login' | 'register' | 'join'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

// Из демо чаще приходят создавать семью — туда и открываем.
const mode = ref<Mode>(financeStore.isDemo ? 'register' : 'login')

// Form fields
const email = ref('')
const pass = ref('')
const displayName = ref('')
const householdName = ref('Наш бюджет')
const inviteCode = ref('')

const busy = ref(false)
const errorMessage = ref('')

onMounted(() => {
  if (route.query.code) {
    inviteCode.value = String(route.query.code).toUpperCase().trim()
    mode.value = 'join'
  }
})

// Документ телефона привязывается к семье, куда вошли: чужой (и черновик демо)
// стирается, свой сливается с серверным — неотправленное после истёкшего входа уходит.
async function enterHousehold() {
  if (authStore.household) await financeStore.enterFamily(authStore.household.id)
}

// Черновик демо на телефоне (Р-32): при создании семьи его можно взять с собой,
// при входе в существующую — нет, и это сказано заранее.
const hasDemoDraft = computed(() => financeStore.isDemo)
const askDemo = ref(false)
// После «Войти заново» правки семьи ждут на телефоне: старт демо стёр бы их молча.
const editsWaitLogin = computed(() => financeStore.hasUnsent && !financeStore.isDemo)

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
      await enterHousehold()
      await router.push(landingPath(authStore, financeStore))
    } else if (mode.value === 'register') {
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
    } else if (mode.value === 'join') {
      if (!inviteCode.value.trim() || !displayName.value.trim()) {
        errorMessage.value = 'Укажите код приглашения и ваше имя'
        return
      }
      await authStore.joinHousehold({
        code: inviteCode.value.trim().toUpperCase(),
        display_name: displayName.value.trim(),
      })
      await enterHousehold()
      await router.push(landingPath(authStore, financeStore))
    }
  } catch (err: unknown) {
    errorMessage.value = authErrorText(err instanceof Error ? err.message : String(err), mode.value)
  } finally {
    busy.value = false
  }
}

function startDemoMode() {
  // Черновик демо уже есть — возвращаемся к нему, а не начинаем пример заново.
  const resume = financeStore.isDemo
  authStore.setAuthData({
    token: DEMO_TOKEN,
    user: { id: 'demo-user-1', email: 'demo@family.local', created_at: new Date().toISOString() },
    household: {
      id: 'demo-household-1',
      name: 'Демо Семья',
      created_by: 'demo-user-1',
      created_at: new Date().toISOString(),
    },
    member: {
      household_id: 'demo-household-1',
      user_id: 'demo-user-1',
      slot: 'a',
      display_name: 'Ильяс',
      role: 'member',
      joined_at: new Date().toISOString(),
    },
  })
  if (resume) {
    void router.push('/')
    return
  }
  financeStore.startNewFamily(DEMO_HOUSEHOLD)
  financeStore.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt = new Date().toISOString()
    doc.people = [
      { id: 'a', name: 'Ильяс', salary: 750_000, payday: 10, onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    doc.categories = [
      { key: 'd1', name: 'Жильё', note: 'аренда и коммуналка', amount: 250_000, updatedAt: new Date().toISOString() },
      { key: 'd2', name: 'Кредиты', note: 'автокредит', amount: 95_000, updatedAt: new Date().toISOString() },
      { key: 'd3', name: 'Цели', note: 'накопления', amount: 150_000, updatedAt: new Date().toISOString() },
      { key: 'd4', name: 'Еда и быт', note: 'питание и расходы', amount: 280_000, updatedAt: new Date().toISOString() },
      { key: 'd5', name: 'Свободно', note: 'остаток', amount: 425_000, updatedAt: new Date().toISOString() },
    ]
    doc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: 'ежемесячно',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 220_000 }],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ob-util',
        name: 'Коммуналка',
        note: 'по счетчикам',
        day: 15,
        category: 'd1',
        estimate: true,
        versions: [{ from: '2026-01', amount: 30_000 }],
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.credits = [
      {
        id: 'cr-car',
        name: 'Автокредит',
        note: 'Kaspi Bank',
        principal: 1_800_000,
        annualRate: 0.19,
        payment: 95_000,
        day: 18,
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.goals = [
      {
        id: 'g-trip',
        name: 'Поездка в Японию',
        need: 2_000_000,
        seed: 600_000,
        have: 600_000,
        monthly: 100_000,
        hue: 'plum',
        planPct: 0.3,
        movements: [],
        // Главная мечта с шаблоном без фото (B2C-19 п. 4): в демо сервера нет — картинок нет.
        template: 'japan',
        main: true,
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.accounts = [
      { id: 'acc-kaspi', name: 'Kaspi Gold', note: '', kind: 'card', amount: 480_000, updatedAt: new Date().toISOString() },
      { id: 'acc-dep', name: 'Депозит Kaspi', note: '', kind: 'deposit', amount: 1_200_000, updatedAt: new Date().toISOString() },
    ]
    // Итоги выписок обоих за эту неделю и месяц (B2C-19 п. 4): главный сразу с картиной недели и «Свободно» по факту.
    seedSpendCategories(doc)
    const at = new Date().toISOString()
    const total = (by: 'a' | 'b', kind: SpendTotal['kind'], period: string, categoryId: string, amount: number, ops: number): SpendTotal => ({ id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops, updatedAt: at })
    const week = weekKey()
    const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
    const month = monthKey()
    doc.spendTotals = [
      total('a', 'week', prevWeek, 'sc_food', 71_000, 11), total('b', 'week', prevWeek, 'sc_food', 24_000, 5), total('a', 'week', prevWeek, 'sc_cafe', 19_000, 4),
      total('a', 'week', prevWeek, 'sc_transport', 12_000, 9), total('a', 'week', prevWeek, '_unknown', 6_000, 1),
      total('a', 'week', week, 'sc_food', 62_000, 9), total('b', 'week', week, 'sc_food', 20_000, 4), total('a', 'week', week, 'sc_cafe', 28_000, 6),
      total('a', 'week', week, 'sc_transport', 9_000, 7), total('b', 'week', week, 'sc_shopping', 34_000, 2), total('a', 'week', week, '_unknown', 10_000, 1),
      total('a', 'month', month, 'sc_food', 184_000, 26), total('b', 'month', month, 'sc_food', 40_000, 8), total('a', 'month', month, 'sc_cafe', 61_000, 14),
      total('a', 'month', month, 'sc_transport', 23_000, 18), total('b', 'month', month, 'sc_shopping', 34_000, 2), total('a', 'month', month, 'sc_credit', 95_000, 1),
      total('a', 'month', month, '_unknown', 40_000, 3),
    ]
  })
  // Записи загрузок демо — когда стор операций уже переключился на демо-семью (watch по владельцу).
  void nextTick().then(() => {
    const today = new Date().toISOString().slice(0, 10)
    const from = `${monthKey()}-01`
    useOperationsStore().seedDemoUploads([
      { id: 'demo-upload-a', slot: 'a', bank: 'kaspi', period_from: from, period_to: today, ops_count: 41, created_at: new Date().toISOString() },
      { id: 'demo-upload-b', slot: 'b', bank: 'kaspi', period_from: from, period_to: today, ops_count: 12, created_at: new Date().toISOString() },
    ])
  })
  void router.push('/')
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-8 text-left">
    <!-- Header Brand -->
    <div class="mb-5 flex items-center gap-2.5">
      <span
        class="grid size-9 place-items-center rounded-xl bg-brand font-display text-[15px] font-bold tracking-[0.02em] text-brand-ink"
      >
        FF
      </span>
      <span class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
        Family Finance
      </span>
    </div>

    <!-- Регистрация из демо: взять ли черновик в новую семью (Р-32) -->
    <div v-if="askDemo" class="flex flex-col gap-3">
      <h1 class="font-display text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        Взять то, что вы заполнили в демо?
      </h1>
      <p class="text-[13.5px] leading-relaxed text-ink-2">
        Бюджет, счета, кредиты и цели из демо станут данными новой семьи, ваше имя — из регистрации.
        Если нет — начнём с чистого листа.
      </p>
      <Button class="w-full mt-1" :disabled="busy" @click="answerDemo(true)">
        {{ busy ? 'Минуту…' : 'Да, взять' }}
      </Button>
      <Button variant="ghost" class="w-full" :disabled="busy" @click="answerDemo(false)">
        Нет, начать с чистого
      </Button>
    </div>

    <template v-else>
    <!-- Title and Note -->
    <div class="mb-5">
      <h1 class="font-display text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        {{
          mode === 'login'
            ? 'Вход'
            : mode === 'register'
              ? 'Создать семью'
              : 'Присоединиться'
        }}
      </h1>
      <p class="mt-1 text-[13.5px] leading-relaxed text-ink-2">
        {{
          mode === 'login'
            ? 'Общий семейный бюджет на двоих. Введите данные для входа.'
            : mode === 'register'
              ? 'Создайте новое домохозяйство и пригласите партнёра по коду.'
              : 'Введите код приглашения, который вам продиктовал партнёр.'
        }}
      </p>
    </div>

    <!-- Tabs Segmented -->
    <div class="mb-4">
      <Segmented
        :model-value="mode"
        :options="[
          { value: 'login', label: 'Войти' },
          { value: 'register', label: 'Создать' },
          { value: 'join', label: 'По коду' },
        ]"
        @update:model-value="(val) => { mode = val; errorMessage = ''; }"
      />
    </div>

    <!-- Forms -->
    <form class="flex flex-col gap-1" @submit.prevent="submit">
      <template v-if="mode === 'login'">
        <Field label="Почта">
          <Input
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
          />
        </Field>
        <Field label="Пароль">
          <Input
            v-model="pass"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
          />
        </Field>
      </template>

      <template v-else-if="mode === 'register'">
        <Field label="Как вас зовут">
          <Input v-model="displayName" placeholder="Ильяс" autocomplete="name" />
        </Field>
        <Field label="Название семьи">
          <Input v-model="householdName" placeholder="Семья Ильяса и Аруны" />
        </Field>
        <Field label="Почта">
          <Input
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
          />
        </Field>
        <Field label="Пароль (от 6 символов)">
          <Input
            v-model="pass"
            type="password"
            placeholder="••••••••"
            autocomplete="new-password"
          />
        </Field>
      </template>

      <template v-else-if="mode === 'join'">
        <Field label="Код приглашения">
          <Input
            v-model="inviteCode"
            placeholder="A1B2C3D4"
            autocapitalize="characters"
            class-name="num tracking-[0.14em] font-semibold uppercase"
          />
        </Field>
        <Field label="Как вас зовут">
          <Input v-model="displayName" placeholder="Аруна" autocomplete="name" />
        </Field>
      </template>

      <!-- Error alert -->
      <div
        v-if="errorMessage"
        class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
      >
        {{ errorMessage }}
      </div>

      <p v-if="hasDemoDraft" class="mb-3 text-[12.5px] leading-relaxed text-ink-3">
        {{
          mode === 'register'
            ? 'После создания спросим, взять ли то, что вы заполнили в демо.'
            : 'Заполненное в демо сюда не переносится: у семьи уже есть свои данные. Взять его с собой можно при создании новой семьи.'
        }}
      </p>

      <Button type="submit" class="w-full mt-1" :disabled="busy">
        {{
          busy
            ? 'Минуту…'
            : mode === 'login'
              ? 'Войти'
              : mode === 'register'
                ? 'Создать бюджет'
                : 'Войти в семью'
        }}
      </Button>
    </form>

    <!-- Sandbox / Demo Mode Button -->
    <p v-if="editsWaitLogin" class="mt-6 pt-5 border-t border-line text-center text-[12px] text-ink-3">
      Неотправленные правки ждут на этом телефоне — войдите в свою семью, и они уйдут.
    </p>
    <div v-else class="mt-6 pt-5 border-t border-line text-center">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline cursor-pointer"
        @click="startDemoMode"
      >
        <PhSparkle :size="16" />
        {{ hasDemoDraft ? 'Вернуться в демо' : 'Попробовать в демо-режиме без регистрации' }}
      </button>
      <p class="mt-1 text-[11.5px] text-ink-3">
        {{
          hasDemoDraft
            ? 'Черновик демо сохранён на этом телефоне.'
            : 'Загружает готовую семью с примерами расходов, кредитов и целей.'
        }}
      </p>
    </div>
    </template>
  </div>
</template>
