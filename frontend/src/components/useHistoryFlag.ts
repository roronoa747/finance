import { ref } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Раскрытие на месте, которое живёт в записи истории (альбом «Сбылось» на «Мечтах», «Уже купили» на «Желаниях»):
 * «назад» со своей карточки — как оставили (прокрутка оболочки на месте), новый заход — новая запись, свёрнуто
 * (`/ux` Б4 «понятность», PN-34). Без роутера (SSR-тесты) — просто флаг.
 */
export function useHistoryFlag(key: string) {
  const history = useRouter()?.options.history
  const open = ref(history?.state?.[key] === true)
  function toggle() {
    open.value = !open.value
    history?.replace(history.location, { ...history.state, [key]: open.value })
  }
  return { open, toggle }
}
