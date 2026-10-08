<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ThemeChoice } from '@/lib/palette'
import { readThemeChoice, setThemeChoice } from '@/lib/theme'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Segmented from '@/components/kit/Segmented.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import { useRouter } from 'vue-router'

/**
 * Оформление устройства (тема) и имя; внизу — выход или «Создать семью» из демо.
 * `section` — какая часть: в Настройках они в разных карточках (g7 «Оформление» и «Выйти»).
 */
const props = defineProps<{ section: 'look' | 'account' }>()

const authStore = useAuthStore()
const financeStore = useFinanceStore()
const router = useRouter()

// Тема применена ещё в main.ts; панель только показывает и меняет выбор. Акцента
// пользователя нет — бренд один (DESIGN.md §3, B2C-12).
const currentTheme = ref<ThemeChoice>(readThemeChoice())

// Имя — из документа (React `AppearancePanel.tsx:45-64`): переименование в зарплатах видно здесь.
const myName = computed(() => financeStore.people.find((p) => p.id === authStore.slot)?.name ?? '')
const userName = ref(myName.value)
watch(myName, (name) => {
  userName.value = name
})

function updateTheme(th: ThemeChoice) {
  currentTheme.value = th
  setThemeChoice(th)
}

// Пустое имя не пишется — в поле возвращается прежнее.
function saveName() {
  const trimmed = userName.value.trim()
  if (!trimmed) {
    userName.value = myName.value
    return
  }
  if (authStore.slot && trimmed !== myName.value) financeStore.setPerson(authStore.slot, { name: trimmed })
}

// Выход при неотправленных правках сначала спрашивает (RP-04): 'ask' — предложить
// отправить, 'failed' — отправить не вышло (нет сети или истёк вход).
const leaving = ref<'ask' | 'failed' | null>(null)
const sending = ref(false)

function handleLogout() {
  if (authStore.logout()) void router.push('/access')
  else leaving.value = 'ask'
}

async function sendAndLeave() {
  sending.value = true
  try {
    if (financeStore.unsent) await financeStore.syncHousehold()
    if (financeStore.privateUnsent) await financeStore.pushPrivateDoc(financeStore.privateDoc).catch(() => {})
  } finally {
    sending.value = false
  }
  if (authStore.logout()) void router.push('/access')
  else leaving.value = 'failed'
}

// Из демо — к созданию семьи или входу; черновик демо остаётся на телефоне до ответа
// «взять ли его» при регистрации (Р-32).
function leaveDemo() {
  authStore.clearAuth()
  void router.push('/access')
}

function leave(choice: 'keep' | 'discard') {
  authStore.logout(choice)
  leaving.value = null
  void router.push('/access')
}
</script>

<template>
  <div class="flex flex-col gap-4 text-left">
    <template v-if="props.section === 'look'">
    <!-- Имя пишется в общий документ — у viewer поля нет (его запись сервер не примет). -->
    <div v-if="!authStore.isViewer">
      <div class="mb-1.5 type-section">
        Ваше имя
      </div>
      <Input
        v-model="userName"
        placeholder="Имя"
        @blur="saveName"
      />
      <p class="mt-1 type-meta">Так вас видит партнёр</p>
    </div>

    <div>
      <div class="mb-1.5 type-section">
        Тема
      </div>
      <Segmented
        :model-value="currentTheme"
        :options="[
          { value: 'auto', label: 'Авто' },
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]"
        @update:model-value="updateTheme"
      />
    </div>
    </template>

    <template v-else>

    <div v-if="authStore.isDemo" class="flex flex-col gap-2">
      <p class="text-[12.5px] leading-relaxed text-ink-2">
        Это демо: всё живёт только на этом телефоне. Создайте семью — и заполненное можно будет взять с
        собой.
      </p>
      <Button class="w-full" @click="leaveDemo">Создать семью или войти</Button>
    </div>
    <div v-else>
      <Button
        v-if="!leaving"
        variant="ghost"
        class="w-full text-destructive hover:bg-destructive-soft"
        @click="handleLogout"
      >
        Выйти из аккаунта
      </Button>
      <div v-else class="flex flex-col gap-2">
        <Callout :title="leaving === 'ask' ? 'Не всё успело уйти на сервер' : 'Сейчас отправить не получилось'">
          <template v-if="leaving === 'ask'">
            Последние правки есть только на этом телефоне. Отправим их и тогда выйдем.
          </template>
          <template v-else>
            Если истёк вход — войдите заново: правки подождут на телефоне и уйдут после входа в эту же
            семью. Или выйдите без них.
          </template>
        </Callout>
        <p v-if="leaving === 'failed' && financeStore.lastError" class="text-[12px] text-ink-2">
          Причина: {{ financeStore.lastError }}
        </p>
        <Button v-if="leaving === 'ask'" class="w-full" :disabled="sending" @click="sendAndLeave">
          {{ sending ? 'Отправляем…' : 'Отправить и выйти' }}
        </Button>
        <Button v-else class="w-full" @click="leave('keep')">Войти заново</Button>
        <Button
          variant="ghost"
          class="w-full text-destructive hover:bg-destructive-soft"
          :disabled="sending"
          @click="leave('discard')"
        >
          Выйти, правки пропадут
        </Button>
        <Button variant="ghost" class="w-full" :disabled="sending" @click="leaving = null">Остаться</Button>
      </div>
    </div>
    </template>
  </div>
</template>
