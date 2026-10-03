/**
 * Байты фото на телефоне (B2C-71): после перезапуска фото видны сразу, без повторной загрузки.
 * Cache API, кэш `ff-photos`, ключ — синтетический адрес по id (фото по id неизменны: замена —
 * новый id, сверять с сервером не нужно). Нет `caches` (старый браузер, тест), квота, приватный
 * режим — тихо: `get` → null, запись и стирание — ничего; фото тогда идут из сети, как раньше.
 */
export interface PhotoDisk {
  get(id: string): Promise<Blob | null>
  put(id: string, blob: Blob): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export const PHOTO_CACHE = 'ff-photos'

const keyOf = (id: string) => `https://photos.ff.local/${encodeURIComponent(id)}`

/** `caches` берётся при каждом вызове — подмена в тестах и отсутствие в Node работают одинаково. */
const storage = (): CacheStorage | null => (typeof caches === 'undefined' ? null : caches)

export function cacheDisk(): PhotoDisk {
  return {
    async get(id) {
      try {
        const s = storage()
        if (!s) return null
        const hit = await (await s.open(PHOTO_CACHE)).match(keyOf(id))
        return hit ? await hit.blob() : null
      } catch {
        return null
      }
    },
    async put(id, blob) {
      try {
        const s = storage()
        if (!s) return
        const headers = { 'Content-Type': blob.type || 'application/octet-stream' }
        await (await s.open(PHOTO_CACHE)).put(keyOf(id), new Response(blob, { headers }))
      } catch {
        /* квота, приватный режим — фото останется в сети */
      }
    },
    async remove(id) {
      try {
        const s = storage()
        if (s) await (await s.open(PHOTO_CACHE)).delete(keyOf(id))
      } catch {
        /* нечего стирать */
      }
    },
    async clear() {
      try {
        const s = storage()
        if (s) await s.delete(PHOTO_CACHE)
      } catch {
        /* нечего стирать */
      }
    },
  }
}
