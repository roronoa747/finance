import { apiClient, ApiError, type ApiClient } from '@/api/client'
import { cacheDisk, type PhotoDisk } from './disk'

/**
 * Фото на телефоне (B2C-17): загрузка байтов на сервер и показ по id. `<img src="/api/…">`
 * токен не несёт — картинку забираем `fetch`-ом с `Authorization` и показываем через object
 * URL. Порядок — память (на сессию) → диск телефона (B2C-71, `disk.ts`) → сеть; из сети
 * картинка ложится на диск. `releasePhotos` освобождает URL при выходе (диск — только
 * `clearPhotoDisk`, вместе с документами семьи). 404 и сбой сети — `null` (заглушка без стоковых
 * картинок), сбой сети не кэшируется — следующий показ попробует снова.
 */
const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
const missing = new Set<string>()

/** Диск по умолчанию; тесты подменяют методы (`vi.spyOn`) или передают свой. */
export const photoDisk: PhotoDisk = cacheDisk()

/** Растёт при стирании диска: загрузка, начатая до выхода, не кладёт фото прежней семьи обратно. */
let diskEpoch = 0

/** Кладёт байты на диск, если с начала загрузки (`at`) диск не стирали. */
function keep(id: string, blob: Blob, disk: PhotoDisk, at: number) {
  if (at === diskEpoch) void disk.put(id, blob).catch(() => {})
}

/** Загружает сжатую картинку; возвращает id фото. `hidden` — подарок-сюрприз (только автору). */
export async function uploadPhoto(
  blob: Blob,
  opts: { hidden?: boolean } = {},
  client: ApiClient = apiClient,
  disk: PhotoDisk = photoDisk,
): Promise<string> {
  const at = diskEpoch
  const { id } = await client.uploadPhoto(blob, opts.hidden ?? false)
  keep(id, blob, disk, at)
  return id
}

/** Object URL картинки по id; null — нет фото, 404 или нет сети. */
export function photoUrl(id: string, client: ApiClient = apiClient, disk: PhotoDisk = photoDisk): Promise<string | null> {
  const known = urls.get(id)
  if (known) return Promise.resolve(known)
  if (missing.has(id)) return Promise.resolve(null)
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const p = (async () => {
    const at = diskEpoch
    try {
      let blob = await disk.get(id).catch(() => null)
      if (!blob) {
        blob = await client.getPhoto(id)
        if (!blob) {
          missing.add(id)
          return null
        }
        keep(id, blob, disk, at)
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

/** Удаляет фото на сервере и забывает его URL и копию на телефоне. */
export async function deletePhoto(id: string, client: ApiClient = apiClient, disk: PhotoDisk = photoDisk): Promise<void> {
  await client.deletePhoto(id)
  forgetPhoto(id, disk)
}

/** Забыть одно фото (после удаления или замены) — в памяти и на диске. */
export function forgetPhoto(id: string, disk: PhotoDisk = photoDisk) {
  const url = urls.get(id)
  if (url) URL.revokeObjectURL(url)
  urls.delete(id)
  missing.add(id)
  void disk.remove(id).catch(() => {})
}

/** Освобождает все object URL — при выходе из аккаунта. Диск не трогает (вход «keep» — та же семья). */
export function releasePhotos() {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  pending.clear()
  missing.clear()
}

/** Стирает фото с телефона — вместе с документами семьи (`finance.clearLocal`). */
export function clearPhotoDisk(disk: PhotoDisk = photoDisk): Promise<void> {
  diskEpoch++
  return disk.clear().catch(() => {})
}

/** Сколько картинок сейчас в кэше — для тестов. */
export const cachedPhotos = () => urls.size
