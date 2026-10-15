import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import type { AiConsent } from '@/types/finance'

/**
 * ИИ-помощник (бэклог «ИИ», Р-7, Р-9, Р-10): доступен ли человеку и его согласие. Согласие — один раз на человека,
 * в личном документе (`aiConsent`, общее для его устройств). Функции ИИ зовут `ensureConsent()` перед запросом:
 * «да» — идём, «нет» — функция не вызывается. Лист согласия один на приложение (`AiConsentSheet` в оболочке).
 */
export const useAiStore = defineStore('ai', () => {
  const auth = useAuthStore()
  const finance = useFinanceStore()

  /** Семье включён ИИ (ключ и флаг на сервере), человек — участник, не демо: viewer кнопок ИИ не видит (Р-7). */
  const available = computed(() => auth.ai && !auth.isViewer && !auth.isDemo)

  const consent = computed<'unknown' | 'on' | 'off'>(() => {
    const c = finance.privateDoc.aiConsent as AiConsent | undefined
    return !c ? 'unknown' : c.on ? 'on' : 'off'
  })

  /** Лист «что уходит» открыт — ждёт ответа на `ensureConsent`. */
  const sheetOpen = ref(false)
  let pending: Promise<boolean> | null = null
  let resolve: ((on: boolean) => void) | null = null

  function setConsent(on: boolean) {
    finance.mutatePrivateDoc((d) => {
      d.aiConsent = { on, at: new Date().toISOString() } satisfies AiConsent
    })
  }

  /** `on` → да без листа; `off` → нет без листа; не спрошено → лист и ответ человека. */
  function ensureConsent(): Promise<boolean> {
    if (!available.value || consent.value === 'off') return Promise.resolve(false)
    if (consent.value === 'on') return Promise.resolve(true)
    if (pending) return pending
    sheetOpen.value = true
    pending = new Promise<boolean>((r) => (resolve = r))
    return pending
  }

  /** Ответ листа: «Включить» / «Не надо» записываются; `null` — закрыли (свайп, крестик): на этот раз нет, вопрос остаётся. */
  function answer(on: boolean | null) {
    if (on !== null) setConsent(on)
    sheetOpen.value = false
    const r = resolve
    pending = null
    resolve = null
    r?.(on === true)
  }

  return { available, consent, sheetOpen, setConsent, ensureConsent, answer }
})
