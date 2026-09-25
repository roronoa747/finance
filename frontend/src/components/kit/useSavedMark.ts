import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * «Сохранено» в шапке формы правки — когда запись действительно изменилась (React
 * `useSavedMark`, `src/components/kit.tsx:106-139`).
 *
 * Поля пишутся по уходу из поля, без кнопки, и без отметки правка выглядит
 * несработавшей. Отметка висит на `updatedAt` самой записи, а не на событии формы:
 * показано ровно то, что легло в документ. Загорается при смене `stamp` той же
 * записи, гаснет через 1,8 с. Смена `id` (открыли другую запись, закрыли окно) —
 * не правка: отметка гаснет и ждёт следующей смены `stamp`.
 */
export function useSavedMark(
  id: MaybeRefOrGetter<string | undefined>,
  stamp: MaybeRefOrGetter<string | undefined>,
): Ref<boolean> {
  const saved = ref(false)
  let seen = { id: toValue(id), stamp: toValue(stamp) }
  let timer: ReturnType<typeof setTimeout> | undefined

  watch([() => toValue(id), () => toValue(stamp)], ([nextId, nextStamp]) => {
    if (nextId === seen.id && nextStamp === seen.stamp) return
    clearTimeout(timer)
    const same = nextId === seen.id
    seen = { id: nextId, stamp: nextStamp }
    saved.value = same
    if (same) timer = setTimeout(() => (saved.value = false), 1800)
  })

  onScopeDispose(() => clearTimeout(timer))
  return saved
}
