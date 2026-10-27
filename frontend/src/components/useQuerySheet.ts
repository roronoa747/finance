import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Значение параметра адреса, которое открывает лист или фильтр (`?cat=<id>` — лист раздела «Месяца» и чип раздела в
 * истории; бэклог «Разбор», Р-18, RZ-08). Значение пришло — `value` его держит; ушло с адреса само («Назад», переход
 * по ссылке на тот же экран) — `null`. Поставить руками (нажатие строки) — можно, адрес не меняется. `close()` —
 * `null` и параметр снят вместе с сопутствующими `also` (номер карточки отчёта `card`). Открыли кнопкой, а переход на
 * адрес с параметром ещё в пути (закрыли сразу) — тот же `replace` отменяет его: иначе дошедший адрес открыл бы снова.
 */
export function useQueryValue(key: string, also: string[] = []) {
  const route = useRoute()
  const router = useRouter()
  const value = ref<string | null>(null)
  const of = (v: unknown) => (typeof v === 'string' && v ? v : null)
  watch(
    () => route.query[key],
    (v, old) => {
      if (of(v)) value.value = of(v)
      else if (of(old)) value.value = null
    },
    { immediate: true },
  )
  function close() {
    const was = value.value !== null
    value.value = null
    const keys = [key, ...also].filter((k) => k in route.query)
    if (!keys.length && !was) return
    const q = { ...route.query }
    for (const k of keys) delete q[k]
    void router.replace({ query: q })
  }
  return { value, close }
}

/**
 * Лист, который открывается адресом `?<key>=1` из «+» (Блок 5 «понятность»: `?try=1` на «Долгах», `?income=1` на
 * «Месяце»; отчёт разбора `?review=1`, бэклог «Разбор», RZ-07) — `useQueryValue` со значением «1». Закрыли — параметр
 * снимается: тот же «+» снова ведёт на новый адрес и открывает лист.
 */
export function useQuerySheet(key: string, also: string[] = []) {
  const { value, close } = useQueryValue(key, also)
  const open = computed({
    get: () => value.value === '1',
    set: (v: boolean) => {
      value.value = v ? '1' : null
    },
  })
  return { open, close }
}
