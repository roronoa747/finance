<script setup lang="ts">
import { ref } from 'vue'
import { ACCENTS, ACCENT_KEYS, type AccentKey, type ThemeChoice } from '@/lib/palette'
import { readAccent, readThemeChoice, setAccent, setThemeChoice } from '@/lib/theme'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Segmented from '@/components/kit/Segmented.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const financeStore = useFinanceStore()
const router = useRouter()

// Тема применена ещё в main.ts; панель только показывает и меняет выбор.
const currentTheme = ref<ThemeChoice>(readThemeChoice())
const currentAccent = ref<AccentKey>(readAccent())

const userName = ref(authStore.member?.display_name || authStore.user?.email?.split('@')[0] || '')

function updateTheme(th: ThemeChoice) {
  currentTheme.value = th
  setThemeChoice(th)
}

function updateAccent(acc: AccentKey) {
  currentAccent.value = acc
  setAccent(acc)
}

function saveName() {
  const trimmed = userName.value.trim()
  if (!trimmed || !authStore.slot) return
  financeStore.setPerson(authStore.slot, { name: trimmed })
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
    <div>
      <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
        Ваше имя
      </div>
      <Input
        v-model="userName"
        placeholder="Имя"
        @blur="saveName"
      />
      <p class="mt-1 text-[12px] leading-relaxed text-ink-3">
        Так вас видит партнёр на полосе доходов, в покупках и во взносах.
      </p>
    </div>

    <div>
      <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
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

    <div>
      <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
        Основной цвет
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="k in ACCENT_KEYS"
          :key="k"
          type="button"
          :aria-label="ACCENTS[k].label"
          :title="ACCENTS[k].label"
          :class="[
            'size-7 rounded-xl border-2 transition-all cursor-pointer',
            currentAccent === k ? 'border-ink scale-105 shadow-xs' : 'border-transparent hover:scale-105',
          ]"
          :style="{ background: ACCENTS[k].light }"
          @click="updateAccent(k)"
        />
      </div>
    </div>

    <div v-if="authStore.isDemo" class="flex flex-col gap-2 pt-3 border-t border-line">
      <p class="text-[12.5px] leading-relaxed text-ink-2">
        Это демо: всё живёт только на этом телефоне. Создайте семью — и заполненное можно будет взять с
        собой.
      </p>
      <Button class="w-full" @click="leaveDemo">Создать семью или войти</Button>
    </div>
    <div v-else class="pt-3 border-t border-line">
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
        <p v-if="leaving === 'failed' && financeStore.lastError" class="text-[12px] text-ink-3">
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
  </div>
</template>
