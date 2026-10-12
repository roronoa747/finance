/**
 * Файл на устройство — один механизм для карточки-сторис, обоев и «В календарь» (PN-28): системное «Поделиться» с
 * файлом (Android Chrome, iOS Safari), иначе — скачать `<a download>`.
 */

export type ShareNavigator = { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }

/** Поделиться файлом; лист не открылся или нечем — скачать. Отмена пользователем — `cancelled`. */
export async function shareFile(
  blob: Blob,
  opts: { title: string; fileName: string },
  nav: ShareNavigator | null = typeof navigator !== 'undefined' ? (navigator as ShareNavigator) : null,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], opts.fileName, { type: blob.type || 'application/octet-stream' })
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Лист не открылся — скачать.
    }
  }
  downloadBlob(blob, file.name)
  return 'downloaded'
}

/** Скачивание через `<a download>`: object URL живёт, пока браузер не начал сохранять. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : ''
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (url) setTimeout(() => URL.revokeObjectURL(url), 1000)
}
