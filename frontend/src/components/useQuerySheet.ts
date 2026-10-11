import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Лист, который открывается адресом `?<key>=1` из «+» (Блок 5 «понятность»: `?try=1` на «Долгах», `?afford=1` на
 * «Месяце»). Закрыли — параметр снимается: тот же «+» снова ведёт на новый адрес и открывает лист.
 */
export function useQuerySheet(key: string) {
  const route = useRoute()
  const router = useRouter()
  const open = ref(false)
  watch(
    () => route.query[key],
    (v) => {
      if (v === '1') open.value = true
    },
    { immediate: true },
  )
  function close() {
    open.value = false
    if (!(key in route.query)) return
    const q = { ...route.query }
    delete q[key]
    void router.replace({ query: q })
  }
  return { open, close }
}
