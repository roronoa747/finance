/**
 * Регистрация и вход — без боевой базы.
 *
 * Ответы Supabase подменяются в браузере, поэтому ни один пользователь не
 * создаётся и ни одно письмо не уходит. Проверяется ровно тот тупик, в который
 * попал третий зарегистрировавшийся: письмо не дошло, вход отвечал
 * «Email not confirmed», повторная регистрация — «уже зарегистрирована».
 *
 * Требует запущенный дев-сервер (npm run dev на порту 5180).
 */
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:5180'
const t = []
const check = (name, ok, got) => t.push({ name, ok, got })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push('УПАЛО: ' + String(e).slice(0, 200)))

const calls = { signup: [], resend: [] }
const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

await page.route('**/auth/v1/token**', (route) =>
  json(route, 400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }))
await page.route('**/auth/v1/signup**', (route) => {
  calls.signup.push({ url: route.request().url(), body: route.request().postDataJSON() })
  // Подтверждение включено: пользователь создан, сессии нет.
  return json(route, 200, {
    id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: '',
    email: 'new@example.com', confirmation_sent_at: new Date().toISOString(),
    app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString(),
  })
})
await page.route('**/auth/v1/resend**', (route) => {
  calls.resend.push({ url: route.request().url(), body: route.request().postDataJSON() })
  return json(route, 200, {})
})

try {
  // Хранилище чистится до загрузки: приложение при старте может перезагрузить
  // страницу само, и очистка после загрузки попадала в эту перезагрузку.
  await page.addInitScript(() => localStorage.clear())
  await page.goto(URL + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })

  // --- вход с неподтверждённой почтой ---
  await page.fill('input[type="email"]', 'stuck@example.com')
  await page.fill('input[type="password"]', 'secret123')
  await page.locator('button:has-text("Войти")').last().click()
  await page.waitForTimeout(800)
  check('ошибка переведена, а не «Email not confirmed»',
    (await page.locator('text=Почта ещё не подтверждена').count()) > 0 &&
    (await page.locator('text=Email not confirmed').count()) === 0)

  const again = page.locator('button:has-text("отправить ещё раз")')
  check('из тупика есть выход — кнопка повторной отправки', (await again.count()) > 0)
  await again.click()
  await page.waitForTimeout(600)
  check('повторная отправка ушла на ту же почту',
    calls.resend.length === 1 && calls.resend[0].body?.email === 'stuck@example.com',
    JSON.stringify(calls.resend[0]?.body))
  check('после отправки человек видит подтверждение', (await page.locator('text=Отправили').count()) > 0)

  // --- регистрация: ссылка из письма должна вернуть в приложение ---
  await page.locator('button:has-text("Регистрация")').click()
  await page.fill('input[type="email"]', 'new@example.com')
  await page.fill('input[type="password"]', 'secret123')
  await page.locator('button:has-text("Создать аккаунт")').click()
  await page.waitForTimeout(800)
  const redirect = calls.signup[0] ? new globalThis.URL(calls.signup[0].url).searchParams.get('redirect_to') : null
  check('ссылка из письма ведёт обратно в приложение', redirect === URL, redirect)
  check('после регистрации экран «подтвердите почту»',
    (await page.locator('text=Осталось подтвердить почту').count()) > 0)
  check('и там тоже можно отправить письмо заново',
    (await page.locator('button:has-text("отправить ещё раз")').count()) > 0)
} catch (e) {
  check('прогон дошёл до конца', false, String(e).slice(0, 300))
}

for (const x of t) console.log((x.ok ? '  ok  ' : ' FAIL ') + x.name + (x.ok || x.got === undefined ? '' : `  → ${x.got}`))
const bad = t.filter((x) => !x.ok).length
console.log(bad ? `\nПРОВАЛЕНО: ${bad} из ${t.length}` : `\nвсе ${t.length} прошли`)
if (errors.length) console.log('\nошибки страницы:\n' + [...new Set(errors)].join('\n'))
await browser.close()
process.exit(bad ? 1 : 0)
