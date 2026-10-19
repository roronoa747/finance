<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApplePayStore } from '@/stores/applepay'
import Sheet from '@/components/kit/Sheet.vue'
import Stepper from '@/components/kit/Stepper.vue'
import Button from '@/components/ui/Button.vue'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ApplePayStepArt, { type StepArt } from './ApplePayStepArt.vue'

/**
 * Лист подключения Apple Pay (AP-06, Р-3, Р-18): шаги по одному на экран — схема и одна строка. Ключ этого iPhone
 * создаётся только нажатием «Скопировать ключ» (`connect`, владелец 2026-10-19: открыли лист и закрыли — ключа нет) и
 * сразу копируется; живёт только здесь, пока лист открыт (Р-5); команда спросит его «вопросом при импорте». iOS 27 —
 * пять шагов (триггер внутри команды), iOS 17–26 — ещё автоматизация руками.
 * Названия пунктов iOS — из инструкции владельцу `OWNER-SHORTCUT.md` (одно место правды).
 */
const props = defineProps<{
  open: boolean
  /**
   * Блок 2: `push` — сразу шаги второй команды «Пуши банков» (из карточки подключённого iPhone). Из шагов касания к
   * ним ведёт тихая «Ещё — пуши банков» на последнем шаге — с тем же ключом, он ещё в памяти листа.
   */
  mode?: 'tap' | 'push'
}>()
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

/** Имя второй команды — тоже без переноса внутри. */
const PUSH_NAME = '«Пуши банков»'
/**
 * Вторая команда (Блок 2, AP-11): триггер «Уведомление» iOS 27 внутри неё — выбрать приложения банков и включить.
 * Kaspi не шлёт пуш на Kaspi QR и переводы клиентам Kaspi — финал их не обещает (они придут с выпиской).
 */
const PUSH_STEPS: Step[] = [
  KEY,
  { art: 'open', text: `Откройте команду ${PUSH_NAME}`, action: 'open' },
  ADD,
  { art: 'apps', text: 'Выберите Kaspi, Freedom и Halyk' },
  { art: 'toggle', text: 'Включите автоматизацию тумблером' },
  { art: 'pushDone', text: 'Готово — покупки и переводы из пушей придут сами', action: 'done' },
]

const ap = useApplePayStore()
/** Какая команда в листе: касание или пуши (Блок 2). */
const flow = ref<'tap' | 'push'>(props.mode ?? 'tap')
const steps = computed(() => (flow.value === 'push' ? PUSH_STEPS : STEPS[ap.path]))
const link = computed(() => (flow.value === 'push' ? ap.pushLink : ap.link))
/** «Ещё — пуши банков» на последнем шаге касания: путь iOS 27 и ссылка второй команды есть. */
const morePush = computed(() => flow.value === 'tap' && !!ap.pushLink)
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

watch(
  () => props.open,
  (open) => {
    if (open) {
      flow.value = props.mode ?? 'tap'
    } else {
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
/** К шагам второй команды — с тем же ключом (он ещё в памяти листа): копировать его снова. */
function toPush() {
  flow.value = 'push'
  index.value = 0
  manual.value = false
}

/**
 * «Скопировать ключ». Ключ уже в памяти листа (вторая команда, «Скопировать ещё раз») — копируется он. Нет — создаётся
 * этим нажатием: буфер iOS пишет только в жесте, а ключ приходит с сервера позже — поэтому `ClipboardItem` с обещанием
 * (запись начинается синхронно в обработчике нажатия). Без `ClipboardItem` — `writeText` после ответа. Ключ не создан
 * — «Ещё раз»; создан, а буфер отказал — ключ целиком на экране.
 */
async function copy() {
  if (key.value) {
    try {
      await navigator.clipboard.writeText(key.value)
      next()
    } catch {
      manual.value = true
    }
    return
  }
  if (busy.value) return
  busy.value = true
  failed.value = false
  // Лист закрыли, пока ключ в пути, — в памяти листа он не остаётся.
  const made = ap.connect().then((k) => {
    if (props.open) key.value = k
    return k
  })
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': made.then((k) => new Blob([k], { type: 'text/plain' })) })])
    } else {
      await navigator.clipboard.writeText(await made)
    }
    next()
  } catch {
    try {
      await made
      manual.value = true
    } catch {
      failed.value = true
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- Заголовок — по команде в листе: «Пуши банков» открыли — «Пуши банков» и видят (ux Б2: нажатие ведёт, куда ждёшь). -->
  <Sheet :open="open" :title="flow === 'push' ? 'Пуши банков' : 'Apple Pay'" @close="emit('close')">
    <div class="flex flex-col gap-4" data-applepay-sheet :data-path="ap.path" :data-flow="flow" :data-step="index + 1">
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
        <Button class="w-full" :disabled="busy" data-main @click="copy">
          {{ busy ? 'Минуту…' : failed ? 'Ещё раз' : manual ? 'Скопировать ещё раз' : 'Скопировать ключ' }}
        </Button>
      </template>

      <a
        v-else-if="step.action === 'open'"
        :href="link"
        target="_blank"
        rel="noopener"
        :class="cn(buttonVariants(), 'w-full')"
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
          v-else-if="step.action === 'copy' && legacyChoice && flow === 'tap'"
          type="button"
          class="cursor-pointer text-[13.5px] text-ink-2 underline underline-offset-4"
          data-legacy-toggle
          @click="ap.chooseLegacy(ap.path === 'ios27')"
        >
          {{ ap.path === 'ios27' ? 'У меня iOS 26 или старше' : 'У меня iOS 27' }}
        </button>
        <Button v-else-if="index > 0 && step.action !== 'done'" variant="ghost" size="md" class="w-full" data-back @click="back">Назад</Button>
        <!-- Блок 2: вторая команда — тихо, после первой (правило 12: одно действие за раз). -->
        <Button v-else-if="step.action === 'done' && morePush" variant="ghost" size="md" class="w-full" data-more-push @click="toPush">
          Ещё — пуши банков
        </Button>
      </div>
    </div>
  </Sheet>
</template>
