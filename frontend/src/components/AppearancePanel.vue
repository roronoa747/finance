<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  ACCENTS,
  ACCENT_KEYS,
  type AccentKey,
  type ThemeChoice,
  applyTheme,
} from '@/lib/palette'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Segmented from '@/components/kit/Segmented.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const financeStore = useFinanceStore()
const router = useRouter()

const currentTheme = ref<ThemeChoice>(
  (typeof localStorage !== 'undefined' && (localStorage.getItem('ff_theme') as ThemeChoice)) || 'auto',
)
const currentAccent = ref<AccentKey>(
  (typeof localStorage !== 'undefined' && (localStorage.getItem('ff_accent') as AccentKey)) || 'emerald',
)

const userName = ref(authStore.member?.display_name || authStore.user?.email?.split('@')[0] || '')

function updateTheme(th: ThemeChoice) {
  currentTheme.value = th
  if (typeof localStorage !== 'undefined') localStorage.setItem('ff_theme', th)
  applyCurrentPalette()
}

function updateAccent(acc: AccentKey) {
  currentAccent.value = acc
  if (typeof localStorage !== 'undefined') localStorage.setItem('ff_accent', acc)
  applyCurrentPalette()
}

function applyCurrentPalette() {
  applyTheme({
    theme: currentTheme.value,
    accent: currentAccent.value,
    categories: { d1: 'blue', d2: 'brick', d3: 'green', d4: 'ochre', d5: 'steel' },
  })
}

function saveName() {
  const trimmed = userName.value.trim()
  if (!trimmed || !authStore.slot) return
  financeStore.setPerson(authStore.slot, { name: trimmed })
}

function handleLogout() {
  authStore.logout()
  router.push('/access')
}

onMounted(() => {
  applyCurrentPalette()
})
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

    <div class="pt-3 border-t border-line">
      <Button variant="ghost" class="w-full text-destructive hover:bg-destructive-soft" @click="handleLogout">
        Выйти из аккаунта
      </Button>
    </div>
  </div>
</template>
