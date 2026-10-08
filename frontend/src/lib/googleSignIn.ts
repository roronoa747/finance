/**
 * Вход через Google в веб (B2C-25, Р-25): Google Identity Services. Скрипт грузится только на
 * экране входа, кнопку рисует Google (`renderButton`), One Tap не включается. Ответ — ID-токен
 * (`credential`), его проверяет Go (`POST /api/auth/google`). В оболочках магазинов — нативный
 * плагин (Блоки 7–8), та же ручка.
 */

/** Публичный id веб-клиента OAuth (`VITE_GOOGLE_CLIENT_ID`); без него вход через Google выключен. */
export const googleClientId: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ''

const GIS_SRC = 'https://accounts.google.com/gsi/client'

type GoogleId = {
  initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup' | 'redirect'; auto_select?: boolean }): void
  renderButton(el: HTMLElement, options: Record<string, unknown>): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } }
  }
}

let loading: Promise<GoogleId> | null = null

/** Скрипт GIS один раз на страницу; сбой (нет сети, блокировщик) — повтор при следующем вызове. */
export function loadGoogleId(doc: Document = document, win: Window = window): Promise<GoogleId> {
  const ready = win.google?.accounts?.id
  if (ready) return Promise.resolve(ready)
  if (loading) return loading
  loading = new Promise<GoogleId>((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      const id = win.google?.accounts?.id
      if (id) resolve(id)
      else reject(new Error('gis unavailable'))
    }
    script.onerror = () => reject(new Error('gis unavailable'))
    doc.head.appendChild(script)
  }).catch((e) => {
    loading = null
    throw e
  })
  return loading
}

/**
 * Кнопка «Продолжить с Google» в `el`: по нажатию — окно Google, затем `onToken(ID-токен)`.
 * Ширина — по контейнеру (GIS принимает 200…400 px).
 */
export async function renderGoogleButton(
  el: HTMLElement,
  onToken: (idToken: string) => void,
  opts: { theme?: 'light' | 'dark'; width?: number } = {},
): Promise<void> {
  const id = await loadGoogleId()
  id.initialize({
    client_id: googleClientId,
    callback: (r) => {
      if (r.credential) onToken(r.credential)
    },
    ux_mode: 'popup',
    auto_select: false,
  })
  id.renderButton(el, {
    type: 'standard',
    theme: opts.theme === 'dark' ? 'filled_black' : 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    locale: 'ru',
    width: Math.max(200, Math.min(400, Math.round(opts.width ?? el.clientWidth ?? 320))),
  })
}
