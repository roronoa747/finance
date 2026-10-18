import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Лист, который открывается адресом `?<key>=1` из «+» (Блок 5 «понятность»: `?try=1` на «Долгах», `?afford=1` на
 * «Месяце»; отчёт разбора `?review=1`, бэклог «Разбор», RZ-07). Закрыли — параметр снимается (и сопутствующие `also`,
 * например номер карточки отчёта `card`): тот же «+» снова ведёт на новый адрес и открывает лист. Параметр ушёл с
 * адреса сам («Назад», переход по ссылке на тот же экран) — лист закрывается.
 */
export function useQuerySheet(key: string, also: string[] = []) {
  const route = useRoute()
  const router = useRouter()
  const open = ref(false)
  watch(
    () => route.query[key],
    (v, old) => {
      if (v === '1') open.value = true
      else if (old === '1') open.value = false
    },
    { immediate: true },
  )
  /**
   * Закрыть и снять параметры. Открыли кнопкой, а переход на `?<key>=1` ещё в пути (лист закрыли сразу) — тот же
   * `replace` отменяет его: иначе дошедший адрес открыл бы лист снова.
   */
  function close() {
    const was = open.value
    open.value = false
    const keys = [key, ...also].filter((k) => k in route.query)
    if (!keys.length && !was) return
    const q = { ...route.query }
    for (const k of keys) delete q[k]
    void router.replace({ query: q })
  }
  return { open, close }
}
