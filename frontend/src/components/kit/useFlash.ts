import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * Короткий тост одной фразой: `flash(text)` показывает, через `ms` гаснет сам; новая фраза
 * перебивает прежнюю (таймер один). Один паттерн для «Загружено N» на «Неделе», «ближе на N дней»
 * после взноса (PN-09) и т. п. — экран рендерит `<Toast v-if="note">{{ note }}</Toast>`.
 * Таймер снимается при уходе с экрана (критик Блока 3 «понятность»: три копии в трёх экранах).
 */
export function useFlash(defaultMs = 4000): { note: Ref<string | null>; flash: (text: string, ms?: number) => void; clear: () => void } {
  const note = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clear() {
    clearTimeout(timer)
    timer = undefined
    note.value = null
  }

  function flash(text: string, ms = defaultMs) {
    clearTimeout(timer)
    note.value = text
    timer = setTimeout(() => (note.value = null), ms)
  }

  onScopeDispose(() => clearTimeout(timer))

  return { note, flash, clear }
}
