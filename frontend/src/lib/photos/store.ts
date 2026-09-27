import { apiClient, ApiError, type ApiClient } from '@/api/client'

/**
 * Фото на телефоне (B2C-17): загрузка байтов на сервер и показ по id. `<img src="/api/…">`
 * токен не несёт — картинку забираем `fetch`-ом с `Authorization` и показываем через object
 * URL; кэш — на сессию, в памяти; `releasePhotos` освобождает URL при выходе. 404 и сбой сети —
 * `null` (заглушка без стоковых картинок), сбой сети не кэшируется — следующий показ попробует
 * снова.
 */
const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
const missing = new Set<string>()

/** Загружает сжатую картинку; возвращает id фото. `hidden` — подарок-сюрприз (только автору). */
export async function uploadPhoto(blob: Blob, opts: { hidden?: boolean } = {}, client: ApiClient = apiClient): Promise<string> {
  const { id } = await client.uploadPhoto(blob, opts.hidden ?? false)
  return id
}

/** Object URL картинки по id (кэш на сессию); null — нет фото, 404 или нет сети. */
export function photoUrl(id: string, client: ApiClient = apiClient): Promise<string | null> {
  const known = urls.get(id)
  if (known) return Promise.resolve(known)
  if (missing.has(id)) return Promise.resolve(null)
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const p = (async () => {
    try {
      const blob = await client.getPhoto(id)
      if (!blob) {
        missing.add(id)
        return null
      }
      const url = URL.createObjectURL(blob)
      urls.set(id, url)
      return url
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) missing.add(id)
      return null
    } finally {
      pending.delete(id)
    }
  })()
  pending.set(id, p)
  return p
}

/** Удаляет фото на сервере и забывает его URL. */
export async function deletePhoto(id: string, client: ApiClient = apiClient): Promise<void> {
  await client.deletePhoto(id)
  forgetPhoto(id)
}

/** Забыть одно фото (после удаления или замены). */
export function forgetPhoto(id: string) {
  const url = urls.get(id)
  if (url) URL.revokeObjectURL(url)
  urls.delete(id)
  missing.add(id)
}

/** Освобождает все object URL — при выходе из аккаунта. */
export function releasePhotos() {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  pending.clear()
  missing.clear()
}

/** Сколько картинок сейчас в кэше — для тестов. */
export const cachedPhotos = () => urls.size
