import { ref } from 'vue'
import { apiClient, type ApiClient } from '@/api/client'

/**
 * Фото желания по ссылке (B2C-66, Р-60): вставили ссылку на товар — сервер берёт со страницы
 * картинку и название (`POST /api/photos/preview`), цену вводит человек. Картинка приходит
 * файлом и дальше идёт тем же путём, что выбранная своя: сжатие на телефоне и `uploadPhoto`.
 * Не вышло — одна строка «загрузите своё», желание добавляется как обычно.
 */
export const LINK_PHOTO_MISSED = 'Фото не нашли — загрузите своё'

/** Первая https-ссылка во вставленном тексте («Поделиться» в Kaspi даёт текст со ссылкой внутри). */
export function linkIn(text: string): string | null {
  const m = text.match(/https:\/\/[^\s"'<>]+/i)
  return m ? m[0].replace(/[),.;!?»]+$/, '') : null
}

export interface LinkFound {
  url: string
  title: string
  /** Картинка со страницы; null — не нашли. */
  file: File | null
}

export function useLinkPreview(client: ApiClient = apiClient) {
  const busy = ref(false)
  const note = ref<string | null>(null)
  let last: string | null = null
  let seq = 0

  /** Превью ссылки из текста; null — ссылки нет, она та же, что в прошлый раз, или ответ устарел. */
  async function load(text: string): Promise<LinkFound | null> {
    const url = linkIn(text)
    if (!url || url === last) return null
    last = url
    const mine = ++seq
    busy.value = true
    note.value = null
    try {
      const { title, blob } = await client.linkPreview(url)
      if (mine !== seq) return null
      return { url, title, file: new File([blob], 'link-photo', { type: blob.type }) }
    } catch {
      if (mine !== seq) return null
      note.value = LINK_PHOTO_MISSED
      return { url, title: '', file: null }
    } finally {
      if (mine === seq) busy.value = false
    }
  }

  function reset() {
    last = null
    seq++
    busy.value = false
    note.value = null
  }

  return { busy, note, load, reset }
}
