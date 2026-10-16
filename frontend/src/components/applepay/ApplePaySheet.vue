<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApplePayStore } from '@/stores/applepay'
import Sheet from '@/components/kit/Sheet.vue'
import Stepper from '@/components/kit/Stepper.vue'
import Button from '@/components/ui/Button.vue'
import ApplePayStepArt, { type StepArt } from './ApplePayStepArt.vue'

/**
 * Лист подключения Apple Pay (AP-06, Р-3, Р-18): шаги по одному на экран — схема и одна строка. Первый шаг создаёт
 * ключ этого iPhone (`connect`) и копирует его: ключ живёт только здесь, пока лист открыт (Р-5); команда спросит его
 * «вопросом при импорте». iOS 27 — пять шагов (триггер внутри команды), iOS 17–26 — ещё автоматизация руками.
 * Названия пунктов iOS — из инструкции владельцу `OWNER-SHORTCUT.md` (одно место правды).
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

type Step = { art: StepArt; text: string; action?: 'copy' | 'open' | 'done' }
/** Имя команды не рвётся переносом строки (ux). */
const NAME = '«Траты сами»'
const KEY: Step = { art: 'key', text: 'Скопируйте ключ этого iPhone', action: 'copy' }
const OPEN: Step = { art: 'open', text: `Откройте команду ${NAME}`, action: 'open' }
const ADD: Step = { art: 'add', text: 'Нажмите «Добавить» и вставьте ключ' }
const DONE: Step = { art: 'done', text: 'Готово — оплатите что-нибудь телефоном', action: 'done' }
const STEPS: Record<'ios27' | 'legacy', Step[]> = {
  ios27: [KEY, OPEN, ADD, { art: 'toggle', text: 'Включите автоматизацию тумблером' }, DONE],
  legacy: [
    KEY,
    OPEN,
    ADD,
    { art: 'automation', text: 'Автоматизация → + → «Транзакция»' },
    { art: 'cards', text: 'Выберите карты и «Запускать сразу»' },
    { art: 'action', text: `Действие «Запустить команду» → ${NAME}` },
    DONE,
  ],
}

const ap = useApplePayStore()
const steps = computed(() => STEPS[ap.path])
const index = ref(0)
const step = computed(() => steps.value[Math.min(index.value, steps.value.length - 1)])
/** Ключ этого телефона — только в памяти листа. */
const key = ref<string | null>(null)
const busy = ref(false)
const failed = ref(false)
/** Буфер недоступен — ключ показывается целиком, чтобы скопировать руками (иначе ключа на экране нет — ux). */
const manual = ref(false)
/** Версия iOS не распознана — тихий выбор пути на первом шаге. */
const legacyChoice = computed(() => !ap.pathKnown && !!ap.status?.shortcut_url && !!ap.status?.shortcut_url_legacy)

async function makeKey() {
  if (key.value || busy.value) return
  busy.value = true
  failed.value = false
  try {
    key.value = await ap.connect()
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void makeKey()
    else {
      key.value = null
      index.value = 0
      manual.value = false
      failed.value = false
    }
  },
  { immediate: true },
)

const next = () => (index.value = Math.min(index.value + 1, steps.value.length - 1))
const back = () => (index.value = Math.max(index.value - 1, 0))

async function copy() {
  if (!key.value) return makeKey()
  try {
    await navigator.clipboard.writeText(key.value)
    next()
  } catch {
    manual.value = true
  }
}
</script>

<template>
  <Sheet :open="open" title="Apple Pay" @close="emit('close')">
    <div class="flex flex-col gap-4" data-applepay-sheet :data-path="ap.path" :data-step="index + 1">
      <Stepper :n="index + 1" :k="steps.length" />
      <ApplePayStepArt :art="step.art" />
      <!-- Строке шага — место на две строки, тихому ряду ниже — одна высота: лист не прыгает от шага к шагу (ux). -->
      <p class="flex min-h-[2lh] items-center justify-center text-center text-[16px] font-semibold text-ink" data-step-text>{{ step.text }}</p>

      <template v-if="step.action === 'copy'">
        <p v-if="failed" role="alert" class="text-center text-[13.5px] text-warn">Не получилось. Проверьте сеть.</p>
        <input
          v-if="key && manual"
          :value="key"
          readonly
          aria-label="Ключ"
          class="h-11 w-full rounded-[12px] border border-line-strong bg-surface-2 px-3 text-[13px] text-ink num"
          data-key-manual
          @focus="($event.target as HTMLInputElement).select()"
        />
        <Button class="w-full" :disabled="busy" data-main @click="failed ? makeKey() : copy()">
          {{ busy ? 'Минуту…' : failed ? 'Ещё раз' : manual ? 'Скопировать ещё раз' : 'Скопировать ключ' }}
        </Button>
      </template>

      <a
        v-else-if="step.action === 'open'"
        :href="ap.link"
        target="_blank"
        rel="noopener"
        class="press inline-flex h-13 w-full items-center justify-center rounded-pill bg-brand px-6 text-[15.5px] font-semibold text-brand-ink"
        data-main
        @click="next"
      >
        Открыть команду
      </a>

      <Button v-else-if="step.action === 'done'" class="w-full" data-main @click="emit('close')">Готово</Button>
      <Button v-else class="w-full" data-main @click="next">Дальше</Button>

      <!-- Тихий ряд под главной кнопкой: «Скопировал — дальше», выбор старого iOS (версия не распознана — PWA с экрана
           «Домой»: путь iOS 27) или «Назад»; на первом и последнем шаге пустой — той же высоты. -->
      <div class="flex h-11 items-center justify-center">
        <Button v-if="step.action === 'copy' && manual" variant="ghost" size="md" class="w-full" @click="next">Скопировал — дальше</Button>
        <button
          v-else-if="step.action === 'copy' && legacyChoice"
          type="button"
          class="cursor-pointer text-[13.5px] text-ink-2 underline underline-offset-4"
          data-legacy-toggle
          @click="ap.chooseLegacy(ap.path === 'ios27')"
        >
          {{ ap.path === 'ios27' ? 'У меня iOS 26 или старше' : 'У меня iOS 27' }}
        </button>
        <Button v-else-if="index > 0 && step.action !== 'done'" variant="ghost" size="md" class="w-full" data-back @click="back">Назад</Button>
      </div>
    </div>
  </Sheet>
</template>
