/**
 * Прогон по экранам: что нажимается, что редактируется, что удаляется.
 * Требует запущенный дев-сервер (npm run dev на порту 5180).
 */
import { chromium } from 'playwright-core'
import { seed } from './seed.mjs'

const URL = process.env.URL ?? 'http://localhost:5180'
const t = []
const check = (name, ok, got) => t.push({ name, ok, got })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push('УПАЛО: ' + String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

const open = async (at) => {
  await page.goto(`${URL}/scripts/screentest.html?at=${encodeURIComponent(at)}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((v) => localStorage.setItem('kazna-v1', v), JSON.stringify(seed))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav', { timeout: 15000 })
  await page.waitForTimeout(400)
}

const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('kazna-v1')).state)

try {
  // --- кредит: строка открывается, поля правятся, удаление спрашивает ---
  await open('/capital')
  check('капитал открылся', (await page.locator('text=Чистый капитал').count()) > 0)

  await page.locator('text=Кредит Халык').first().click()
  await page.waitForTimeout(400)
  check('кредит открывается по нажатию', (await page.locator('text=Ставка (ГЭСВ), % годовых').count()) > 0)

  const pay = page.locator('input[inputmode="numeric"]').nth(1)
  await pay.fill(''); await pay.type('130000'); await pay.blur()
  await page.waitForTimeout(300)
  const s1 = await store()
  check('платёж по кредиту сохранился', s1.credits[0].payment === 130000, s1.credits[0].payment)

  await page.locator('text=Удалить кредит').click()
  await page.waitForTimeout(200)
  check('удаление сначала спрашивает', (await page.locator('text=Отменить нельзя').count()) > 0)
  await page.locator('button:has-text("Удалить")').last().click()
  await page.waitForTimeout(400)
  const s2 = await store()
  check('кредит помечен удалённым, а не стёрт', Boolean(s2.credits[0].deletedAt), s2.credits[0].deletedAt)

  // --- счёт: правка и удаление ---
  await open('/capital')
  await page.locator('text=Карта Kaspi').first().click()
  await page.waitForTimeout(400)
  check('счёт открывается по нажатию', (await page.locator('text=Примечание').count()) > 0)
  const sum = page.locator('input[inputmode="numeric"]').first()
  await sum.fill(''); await sum.type('300000'); await sum.blur()
  await page.waitForTimeout(300)
  const s3 = await store()
  check('сумма счёта сохранилась', s3.accounts[0].amount === 300000, s3.accounts[0].amount)

  // --- валютный счёт: курс пересчитывает тенге ---
  await open('/capital')
  await page.locator('text=Доллары').first().click()
  await page.waitForTimeout(400)
  const fx = page.locator('input[inputmode="decimal"]').first()
  await fx.fill(''); await fx.type('500'); await fx.blur()
  await page.waitForTimeout(300)
  const s4 = await store()
  const usd = s4.accounts.find((a) => a.id === 'usd')
  check('курс пересчитал сумму в тенге', usd.amount === 500000, `${usd.amount} при курсе ${usd.rate}`)

  // --- вклад: переименование и удаление ---
  await open('/capital/dep')
  check('экран вклада открылся', (await page.locator('text=Эффективная ставка').count()) > 0)
  const nameField = page.locator('input:not([inputmode])').first()
  await nameField.fill('Отбасы Банк'); await nameField.blur()
  await page.waitForTimeout(300)
  const s5 = await store()
  check('вклад переименовался', s5.accounts.find((a) => a.id === 'dep').name === 'Отбасы Банк', s5.accounts.find((a) => a.id === 'dep').name)

  // --- цель на счёте: удаление счёта не должно съедать накопления ---
  await open('/capital')
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kazna-v1'))
    s.state.goals[0].accountId = 'card'
    localStorage.setItem('kazna-v1', JSON.stringify(s))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav', { timeout: 15000 })
  await page.locator('text=Карта Kaspi').first().click()
  await page.waitForTimeout(400)
  await page.locator('text=Удалить счёт').click()
  await page.waitForTimeout(200)
  check('предупреждает про цель на счёте', (await page.locator('text=Первая квартира').count()) > 0)
  await page.locator('button:has-text("Удалить")').last().click()
  await page.waitForTimeout(400)
  const s6 = await store()
  check('связь цели со счётом разорвана', s6.goals[0].accountId === null, s6.goals[0].accountId)
  // --- покупки: строка открывает правку, ссылка осталась ссылкой ---
  await open('/goals?tab=wish')
  check('список покупок открылся', (await page.locator('text=Сковорода').count()) > 0)
  check('ссылка на товар осталась ссылкой', (await page.locator('a:has-text("ссылка")').count()) > 0)

  await page.locator('button:has-text("Сковорода")').first().click()
  await page.waitForTimeout(400)
  check('покупка открывается по нажатию', (await page.locator('text=Что покупаем').count()) > 0)

  const wishPrice = page.locator('input[inputmode="numeric"]').first()
  await wishPrice.fill(''); await wishPrice.type('45000'); await wishPrice.blur()
  await page.waitForTimeout(300)
  const s7 = await store()
  check('цена покупки сохранилась', s7.wishlist[0].price === 45000, s7.wishlist[0].price)

  await page.locator('text=Удалить из списка').click()
  await page.waitForTimeout(200)
  check('удаление покупки спрашивает', (await page.locator('text=Отменить нельзя').count()) > 0)
  await page.locator('button:has-text("Удалить")').last().click()
  await page.waitForTimeout(400)
  const s8 = await store()
  check('покупка помечена удалённой', Boolean(s8.wishlist[0].deletedAt), s8.wishlist[0].deletedAt)
  // --- строки «Впереди» и «Бюджета» ведут туда, где запись правят ---
  await open('/')
  await page.locator('text=Аренда').first().click()
  await page.waitForTimeout(500)
  check('из «Обзора» открывается обязательство', (await page.locator('text=Сумма сейчас, ₸').count()) > 0)

  await open('/budget')
  await page.locator('button:has-text("Список")').click()
  await page.waitForTimeout(300)
  await page.locator('text=Кредит Халык').first().click()
  await page.waitForTimeout(500)
  check('из «Бюджета» открывается кредит', (await page.locator('text=Ставка (ГЭСВ), % годовых').count()) > 0)

  await open('/budget')
  await page.locator('button:has-text("Список")').click()
  await page.waitForTimeout(300)
  await page.locator('text=Зарплата · Ильяс').first().click()
  await page.waitForTimeout(500)
  check('из «Бюджета» открывается оклад', (await page.locator('text=Оклад сейчас, ₸').count()) > 0)

  // Ссылка на обязательство должна открывать его сразу, а не общий список.
  await open('/capital?obligation=rent')
  check('адрес открывает обязательство напрямую', (await page.locator('text=Сумма сейчас, ₸').count()) > 0)
} catch (e) {
  check('прогон дошёл до конца', false, String(e).slice(0, 300))
}

for (const x of t) console.log((x.ok ? '  ok  ' : ' FAIL ') + x.name + (x.ok || x.got === undefined ? '' : `  → ${x.got}`))
const bad = t.filter((x) => !x.ok).length
console.log(bad ? `\nПРОВАЛЕНО: ${bad} из ${t.length}` : `\nвсе ${t.length} прошли`)
if (errors.length) console.log('\nошибки страницы:\n' + [...new Set(errors)].join('\n'))
await browser.close()
process.exit(bad ? 1 : 0)
