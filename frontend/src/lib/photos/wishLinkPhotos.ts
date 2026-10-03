import { apiClient, LinkPreviewError } from '@/api/client'
import type { WishItem } from '@/types/finance'
import { liveWishlist } from '@/lib/finance'
import { LINK_PHOTO_TRIED_KEY, readStorage, writeStorage } from '@/lib/storage'
import { compressImage } from './compress'
import { bigEnough } from './linkPhoto'
import { deletePhoto, uploadPhoto } from './store'

/**
 * Фото у старых желаний со ссылкой (B2C-68, возврат смоука Б12): желание со ссылкой, но без фото —
 * сохранённое до Блока 12 или добавленное без сети — получает картинку со страницы при открытии
 * «Желаний». Тот же путь, что при вставке ссылки (`useLinkPreview`): превью → сжатие → `uploadPhoto`
 * → `setWishPhoto`. Обход бережный к ручке без лимита: по одному, не больше `LINK_PHOTOS_PER_OPEN`
 * за открытие экрана; адрес, где картинки нет, запоминается на телефоне (`LINK_PHOTO_TRIED_KEY`,
 * выход стирает) и больше не спрашивается. Без кнопок и текста — фото просто появляются в плитках
 * (правило 12). Зовёт только участник: у viewer ручка — 403.
 */
/** Сколько ссылок спрашивается за одно открытие экрана. */
export const LINK_PHOTOS_PER_OPEN = 10
/** Сколько адресов без картинки помнит телефон. */
export const TRIED_MAX = 200

export type WishPhotoStore = {
  wishlist: WishItem[]
  isDemo: boolean
  setWishPhoto(id: string, photoId: string | null): void
}

/** Адреса, по которым фото не нашлось. */
export type TriedLinks = { has(url: string): boolean; add(url: string): void }

export type WishPhotoDeps = {
  /**
   * Картинка со страницы. `null` — ручка посмотрела адрес и отказала (нет картинки, адрес закрыт,
   * страница недоступна): адрес больше не спрашивается. Исключение — до адреса не дошло (сети нет,
   * вход истёк, лимит, сервер упал): обход прерывается, адреса не запоминаются.
   */
  preview: (url: string) => Promise<Blob | null>
  /** Сжатие; размеры выхода — для порога маленьких картинок (B2C-75: `compressImage` не увеличивает). */
  compress: (blob: Blob) => Promise<{ blob: Blob; width: number; height: number }>
  upload: (blob: Blob) => Promise<string>
  /** Фото загрузилось зря: желание исчезло или получило своё, пока грузили. */
  remove: (photoId: string) => Promise<void>
  tried: TriedLinks
}

/** Память «фото не нашлось» на устройстве (`ff_link_photo_tried`): последние `TRIED_MAX` адресов. */
export function triedLinks(): TriedLinks {
  const raw = readStorage<unknown>(LINK_PHOTO_TRIED_KEY, [])
  const urls = new Set<string>(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  return {
    has: (url) => urls.has(url),
    add(url) {
      urls.delete(url)
      urls.add(url)
      while (urls.size > TRIED_MAX) urls.delete(urls.values().next().value!)
      writeStorage(LINK_PHOTO_TRIED_KEY, [...urls])
    },
  }
}

/**
 * Превью через ручку: `null` — только когда она посмотрела адрес и отказала (400 `bad url`/`blocked`,
 * 422 `no image`/`too large`/`timeout`/`unavailable`). Сети нет (`offline`), 401, 403, 429, 5xx — адрес
 * не виноват, запоминать его нельзя: иначе после входа заново или починки сервера фото не придёт
 * никогда — исключение наверх, обход прерывается.
 */
export async function previewLink(url: string): Promise<Blob | null> {
  try {
    return (await apiClient.linkPreview(url)).blob
  } catch (e) {
    if (e instanceof LinkPreviewError && (e.status === 400 || e.status === 422)) return null
    throw e
  }
}

const defaults = (): WishPhotoDeps => ({
  preview: previewLink,
  compress: (blob) => compressImage(blob),
  upload: (blob) => uploadPhoto(blob),
  remove: (id) => deletePhoto(id),
  tried: triedLinks(),
})

/** Живые желания без фото со ссылкой https — кандидаты обхода, в порядке списка. */
export function wishesNeedingPhoto(wishlist: WishItem[]): (WishItem & { url: string })[] {
  return liveWishlist(wishlist).filter((w): w is WishItem & { url: string } => !w.photoId && !!w.url && /^https:\/\//i.test(w.url))
}

/**
 * Желания, чьё фото уже грузится: «Желания» открылись второй раз (другая вкладка — другой экземпляр
 * экрана), пока первый обход ещё идёт, — то же желание не спрашивается и не грузится дважды.
 */
const inFlight = new Set<string>()

/**
 * Обход при открытии «Желаний»: по одному, последовательно, не больше `LINK_PHOTOS_PER_OPEN` запросов.
 * Перед загрузкой и перед записью — желание ещё живо и без фото (партнёр мог удалить или поставить
 * своё). `signal` — уход с экрана: начатое желание доводится, следующее не берётся. В демо сервера
 * нет. Возвращает, сколько желаний получили фото.
 */
export async function fillWishPhotos(store: WishPhotoStore, deps: WishPhotoDeps = defaults(), signal?: AbortSignal): Promise<number> {
  if (store.isDemo) return 0
  const bare = (id: string) => {
    const w = liveWishlist(store.wishlist).find((x) => x.id === id)
    return !!w && !w.photoId
  }
  let asked = 0
  let got = 0
  for (const wish of wishesNeedingPhoto(store.wishlist)) {
    if (asked >= LINK_PHOTOS_PER_OPEN || signal?.aborted) break
    if (deps.tried.has(wish.url) || inFlight.has(wish.id)) continue
    asked += 1
    inFlight.add(wish.id)
    try {
      let picture: Blob | null
      try {
        picture = await deps.preview(wish.url)
      } catch {
        break // до адреса не дошло (сеть, вход, лимит, сервер) — остальные тоже не получатся; адреса не виноваты
      }
      if (!picture) {
        deps.tried.add(wish.url)
        continue
      }
      if (!bare(wish.id)) continue
      try {
        const { blob, width, height } = await deps.compress(picture)
        if (!bigEnough(width, height)) {
          deps.tried.add(wish.url) // логотип вместо товара (B2C-75) — как «картинки нет»
          continue
        }
        const id = await deps.upload(blob)
        if (bare(wish.id)) {
          store.setWishPhoto(wish.id, id)
          got += 1
        } else {
          await deps.remove(id).catch(() => {})
        }
      } catch {
        // Сжатие или загрузка не вышли — это не отказ ручки: попробуем при следующем открытии.
      }
    } finally {
      inFlight.delete(wish.id)
    }
  }
  return got
}
