/**
 * Проверка тем: при переключении ни один элемент не должен становиться
 * невидимым. Заказчик поставил это условием, а на глаз такое ловится плохо —
 * пропавшая надпись выглядит как «так и задумано», пока на неё не наткнёшься.
 *
 * Считается контраст между цветом текста и первым непрозрачным фоном выше по
 * дереву. Порог — 4,5:1: это требование к обычному тексту, и приложение его
 * держит на всех экранах в обеих темах. Планка стоит здесь, а не на «лишь бы
 * различалось», потому что телефон с деньгами читают и на солнце.
 * Требует запущенный дев-сервер (npm run dev на порту 5180).
 */
import { chromium } from 'playwright-core'
import { seed } from './seed.mjs'

const URL = process.env.URL ?? 'http://localhost:5180'
const FLOOR = Number(process.env.FLOOR ?? 4.5) // требование к обычному тексту
const SCREENS = ['/', '/budget', '/goals', '/goals?tab=wish', '/goals/flat', '/capital', '/capital/dep']

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push('УПАЛО: ' + String(e).slice(0, 200)))

const probe = () => page.evaluate((floor) => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const parse = (s) => {
    const m = s.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b, a = '1'] = m
    return { rgb: [+r, +g, +b], a: +a }
  }
  // Фон берётся с ближайшего предка, который что-то рисует: у самих надписей
  // фон почти всегда прозрачный.
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0.5) return c.rgb
    }
    return [255, 255, 255]
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue

    // Только собственный текст элемента или иконка: иначе один и тот же
    // текст проверялся бы столько раз, сколько над ним обёрток.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    const icon = el.tagName === 'svg'
    if (!own && !icon) continue

    const fg = parse(cs.color)
    if (!fg || fg.a < 0.15) continue
    const k = ratio(fg.rgb, bgOf(el))
    if (k < floor) {
      bad.push({
        text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
        ratio: +k.toFixed(2),
        color: cs.color,
      })
    }
  }
  return bad
}, FLOOR)

const results = []
try {
  for (const theme of ['light', 'dark']) {
    for (const at of SCREENS) {
      await page.goto(`${URL}/scripts/screentest.html?at=${encodeURIComponent(at)}`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(([v, t]) => {
        const s = JSON.parse(v)
        s.state.settings.theme = t
        localStorage.setItem('kazna-v1', JSON.stringify(s))
      }, [JSON.stringify(seed), theme])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('nav', { timeout: 15000 })
      await page.waitForTimeout(500)
      const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
      if ((theme === 'dark') !== dark) {
        results.push({ at, theme, bad: [{ text: 'тема не применилась', ratio: 0 }] })
        continue
      }
      results.push({ at, theme, bad: await probe() })
    }
  }
} catch (e) {
  results.push({ at: '—', theme: '—', bad: [{ text: 'прогон упал: ' + String(e).slice(0, 200), ratio: 0 }] })
}

let bad = 0
for (const r of results) {
  const label = `${r.theme === 'dark' ? 'тёмная' : 'светлая'} ${r.at}`
  if (!r.bad.length) { console.log(`  ok  ${label}`); continue }
  bad += r.bad.length
  console.log(` FAIL ${label}`)
  for (const b of r.bad) console.log(`        ${b.ratio}:1  «${b.text}»  ${b.color ?? ''}`)
}
console.log(bad ? `\nНЕРАЗЛИЧИМЫХ ЭЛЕМЕНТОВ: ${bad}` : `\nво всех темах всё различимо (${results.length} экранов)`)
if (errors.length) console.log('\nошибки страницы:\n' + [...new Set(errors)].join('\n'))
await browser.close()
process.exit(bad ? 1 : 0)
