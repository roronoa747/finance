import { plural } from '@/lib/utils'

/**
 * Карточка для сторис (Р-10, DESIGN.md §7; B2C-20): 1080 × 1920, фото цели + процент + имя,
 * или «утечки» — сколько подписок отменили. **Сумм нет никогда**: `storyText` вычищает из
 * пользовательского текста всё похожее на деньги, а `drawStory` рисует только эти строки.
 * Композиция и тексты — чистые функции (тесты в Node без canvas), рисование — в браузере.
 */
export const STORY_SIZE = { width: 1080, height: 1920 } as const
/** Обои экрана блокировки (PN-10, Р-15): iPhone 19,5:9 — на других телефонах масштабируется системой. */
export const WALLPAPER_SIZE = { width: 1170, height: 2532 } as const
export type StoryKind = 'goal' | 'leaks' | 'wallpaper'
export const storySize = (kind: StoryKind): { width: number; height: number } => (kind === 'wallpaper' ? WALLPAPER_SIZE : STORY_SIZE)
export type StoryData = {
  /** Мечта: процент собранного, имя, «в мае 2027». */
  percent?: number
  goalName?: string
  doneMonth?: string | null
  /** Утечки: сколько подписок отменили за месяц. */
  count?: number
}
export type StoryTexts = { kind: StoryKind; app: string; label: string; big: string; line: string; percent: number | null }

const APP = 'Family Finance'
// Карточка от темы не зависит (§7), а canvas CSS-переменных не читает: значение токена
// `--surface-3` светлой темы из style.css (текст — `--ink` / `--on-photo` там же).
const NO_PHOTO_BG = '#e7e7e3'
const INK = '25,25,27'
// Шрифты — системные стеки `--font-display` / `--font-num` / `--font-sans` из style.css (пивот 3, Р-36).
const DISPLAY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, 'Segoe UI', Roboto, sans-serif"
const NUM = "ui-rounded, -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, sans-serif"
const TEXT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, sans-serif"
/** Шрифт строки имени мечты — ужимается в `drawStory`. */
export const lineFont = (size: number) => `500 ${size}px ${TEXT}`
const WHITE = '255,255,255'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Всё похожее на сумму — вон: «1 800 000 ₸», «₸», разряды через пробел, числа от пяти цифр. Год остаётся. */
export function withoutMoney(text: string): string {
  return text
    .replace(/\d[\d\s  ]*\s*₸/gu, '')
    .replace(/₸/g, '')
    // «1,8 млн», «800 тыс.», «300000 тг» — тоже деньги (критик Блока 3).
    .replace(/\d+(?:[.,]\d+)?\s*(?:млн|тыс|тенге|тг)\.?(?=\s|$|[,.!?])/giu, '')
    .replace(/\d{1,3}(?:[\s  ]\d{3})+/g, '')
    .replace(/\d{5,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim()
}

export function storyText(kind: StoryKind, data: StoryData): StoryTexts {
  if (kind === 'leaks') {
    const n = Math.max(0, Math.round(data.count ?? 0))
    const line = `${plural(n, 'подписка', 'подписки', 'подписок')}, без ${plural(n, 'которой', 'которых', 'которых')} можно`
    return { kind, app: APP, label: 'За месяц', big: `−${n}`, line, percent: null }
  }
  const percent = clamp(Math.round(data.percent ?? 0), 0, 100)
  const name = withoutMoney(data.goalName ?? '') || 'Мечта'
  const line = withoutMoney(data.doneMonth ? `${name} · будет нашей в ${data.doneMonth}` : name)
  // Обои (PN-10): те же процент и строка, подписей сверху нет — верх экрана блокировки занят часами.
  const top = kind === 'wallpaper' ? { app: '', label: '' } : { app: APP, label: 'До мечты' }
  return { kind, ...top, big: `${percent} %`, line, percent }
}

export type StoryLayout = {
  width: number
  height: number
  margin: number
  gradient: { from: number; to: number; color: string }
  /** Имя приложения сверху; у обоев — null (верх — часам). */
  app: { x: number; y: number; font: string; alpha: number } | null
  /** «До мечты» над процентом; у обоев — null. */
  label: { x: number; y: number; font: string; alpha: number } | null
  big: { x: number; y: number; font: string; size: number; lineHeight: number }
  line: { x: number; y: number; font: string; size: number; maxWidth: number }
  bar: { x: number; y: number; width: number; height: number; radius: number } | null
}

/**
 * Координаты слоёв по DESIGN.md §7 (в масштабе от 1080 × 1920); `y` — базовая линия текста. Обои (PN-10): фото во
 * весь кадр, затемнение снизу от половины высоты, процент и имя — в нижней трети над нижним полем (кнопки iOS снизу),
 * без подписей сверху.
 */
export function layoutStory(kind: StoryKind = 'goal', size: { width: number; height: number } = storySize(kind)): StoryLayout {
  const { width: w, height: h } = size
  const k = w / STORY_SIZE.width
  const m = 96 * k
  const barH = 12 * k
  const wallpaper = kind === 'wallpaper'
  // У обоев нижнее поле больше: фонарик и камера экрана блокировки — в нижних 12 %.
  const bottom = wallpaper ? Math.max(m, 0.12 * h) : m
  const bar = kind === 'goal' || wallpaper ? { x: m, y: h - bottom - barH, width: w - 2 * m, height: barH, radius: 6 * k } : null
  const lineSize = 56 * k
  const lineY = (bar ? bar.y : h - m) - 40 * k
  const bigSize = (kind === 'leaks' ? 220 : 300) * k
  const bigY = lineY - lineSize - 32 * k
  const labelY = bigY - bigSize * 0.9 - 24 * k
  return {
    width: w,
    height: h,
    margin: m,
    gradient: { from: (wallpaper ? 0.5 : 0.3) * h, to: h, color: 'rgba(24,18,14,0.82)' },
    app: wallpaper ? null : { x: m, y: m + 44 * k, font: `700 ${44 * k}px ${DISPLAY}`, alpha: 0.95 },
    label: wallpaper ? null : { x: m, y: labelY, font: `500 ${40 * k}px ${TEXT}`, alpha: 0.9 },
    big: { x: m, y: bigY, font: `700 ${bigSize}px ${NUM}`, size: bigSize, lineHeight: 0.9 },
    line: { x: m, y: lineY, font: lineFont(lineSize), size: lineSize, maxWidth: w - 2 * m },
    bar,
  }
}

/** Что нужно от контекста canvas — чтобы композицию можно было проверить записывающей заглушкой. */
export type StoryContext = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'measureText' | 'drawImage' | 'createLinearGradient' | 'beginPath' | 'fill' | 'roundRect' | 'save' | 'restore'> & {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textBaseline: CanvasTextBaseline
  textAlign: CanvasTextAlign
}

export type StoryImage = { width: number; height: number; source: CanvasImageSource } | null

/** Рисует карточку: фото cover + градиент (или фон без фото и ink-текст), четыре строки, полоса. */
export function drawStory(ctx: StoryContext, image: StoryImage, texts: StoryTexts, layout: StoryLayout = layoutStory(texts.kind)): void {
  const { width: w, height: h } = layout
  const photo = !!image
  ctx.save()
  if (image) {
    const scale = Math.max(w / image.width, h / image.height)
    const dw = image.width * scale
    const dh = image.height * scale
    ctx.drawImage(image.source, (w - dw) / 2, (h - dh) / 2, dw, dh)
    const g = ctx.createLinearGradient(0, layout.gradient.from, 0, layout.gradient.to)
    g.addColorStop(0, 'rgba(24,18,14,0)')
    g.addColorStop(1, layout.gradient.color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.fillStyle = NO_PHOTO_BG
    ctx.fillRect(0, 0, w, h)
  }
  const ink = photo ? WHITE : INK
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  if (layout.app) {
    ctx.font = layout.app.font
    ctx.fillStyle = `rgba(${ink},${layout.app.alpha})`
    ctx.fillText(texts.app, layout.app.x, layout.app.y)
  }

  if (layout.label) {
    ctx.font = layout.label.font
    ctx.fillStyle = `rgba(${ink},${layout.label.alpha})`
    ctx.fillText(texts.label, layout.label.x, layout.label.y)
  }

  ctx.font = layout.big.font
  ctx.fillStyle = `rgb(${ink})`
  ctx.fillText(texts.big, layout.big.x, layout.big.y)

  // Длинное имя мечты — шрифт ужимается до ширины поля, а не режется.
  let size = layout.line.size
  ctx.font = layout.line.font
  while (size > layout.line.size * 0.5 && ctx.measureText(texts.line).width > layout.line.maxWidth) {
    size -= 2
    ctx.font = lineFont(size)
  }
  ctx.fillText(texts.line, layout.line.x, layout.line.y)

  if (layout.bar && texts.percent !== null) {
    const b = layout.bar
    ctx.fillStyle = `rgba(${ink},0.3)`
    ctx.beginPath()
    ctx.roundRect(b.x, b.y, b.width, b.height, b.radius)
    ctx.fill()
    if (texts.percent > 0) {
      ctx.fillStyle = `rgb(${ink})`
      ctx.beginPath()
      ctx.roundRect(b.x, b.y, Math.max(b.height, (b.width * texts.percent) / 100), b.height, b.radius)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Шрифты карточки — те же семейства, что у экрана; без `document.fonts` (тесты) — как есть. */
export async function loadStoryFonts(layout: StoryLayout): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts?.load) return
  await Promise.all([layout.app?.font, layout.label?.font, layout.big.font, layout.line.font].flatMap((f) => (f ? [fonts.load(f).catch(() => null)] : [])))
}

/** Картинка по адресу (object URL или CDN с CORS) — для canvas; сбой — карточка без фото. */
export function loadStoryImage(src: string): Promise<StoryImage> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, source: img })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Рисует карточку в canvas и отдаёт PNG (DESIGN.md §7); размер — по `kind` (обои — `WALLPAPER_SIZE`) или `size`. */
export async function renderStory(
  canvas: HTMLCanvasElement,
  opts: { image: StoryImage; texts: StoryTexts; layout?: StoryLayout; size?: { width: number; height: number } },
): Promise<Blob> {
  const layout = opts.layout ?? layoutStory(opts.texts.kind, opts.size)
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d недоступен')
  await loadStoryFonts(layout)
  drawStory(ctx, opts.image, opts.texts, layout)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob не дал картинку'))), 'image/png')
  })
}

export const STORY_FILE = 'family-finance-story.png'
export const WALLPAPER_FILE = 'family-finance-wallpaper.png'

type ShareNavigator = { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }

/** Системное «Поделиться» с файлом (Android Chrome, iOS Safari); иначе — скачать. */
export async function shareStory(
  blob: Blob,
  opts: { title: string; fileName?: string },
  nav: ShareNavigator | null = typeof navigator !== 'undefined' ? (navigator as ShareNavigator) : null,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], opts.fileName ?? STORY_FILE, { type: blob.type || 'image/png' })
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
