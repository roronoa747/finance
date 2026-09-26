import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authErrorText } from '@/lib/authErrors'

/**
 * Код приглашения второго участника — баннер Обзора, шаг мастера и шторка синка (PV-21).
 * Ошибка — русским текстом на экране, а не в консоли (Б-14, `authErrorText`).
 */
export function useInvite() {
  const authStore = useAuthStore()
  const code = ref<string | null>(null)
  const busy = ref(false)
  const error = ref('')
  const copied = ref(false)

  async function make() {
    busy.value = true
    error.value = ''
    try {
      code.value = (await authStore.createInvite()).code
    } catch (e) {
      error.value = authErrorText(e instanceof Error ? e.message : String(e), 'invite')
    } finally {
      busy.value = false
    }
  }

  async function copy() {
    if (!code.value) return
    try {
      await navigator.clipboard.writeText(code.value)
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    } catch {
      // Буфер может быть недоступен — код и так виден на экране.
    }
  }

  return { code, busy, error, copied, make, copy }
}
