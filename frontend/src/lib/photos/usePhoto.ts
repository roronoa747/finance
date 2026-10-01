import { ref, watch, type Ref } from 'vue'
import { photoUrl } from './store'

/** Object URL одного фото по id (реактивно); null — фото нет или пока не загрузилось. */
export function usePhoto(id: () => string | null | undefined): Ref<string | null> {
  const src = ref<string | null>(null)
  watch(
    id,
    (value) => {
      src.value = null
      if (!value) return
      void photoUrl(value).then((url) => {
        // Пока грузилось, id мог смениться — не подставлять чужую картинку.
        if (id() === value) src.value = url
      })
    },
    { immediate: true },
  )
  return src
}

/** Object URL нескольких фото по id — плитки мечт. */
export function usePhotos(ids: () => (string | null | undefined)[]): Ref<Record<string, string | null>> {
  const map = ref<Record<string, string | null>>({})
  watch(
    () => ids().filter((x): x is string => !!x),
    (list) => {
      for (const id of list) {
        if (id in map.value) continue
        map.value = { ...map.value, [id]: null }
        void photoUrl(id).then((url) => {
          map.value = { ...map.value, [id]: url }
        })
      }
    },
    { immediate: true },
  )
  return map
}
