import { chromium } from 'playwright-core'
const URL = process.env.URL ?? 'http://localhost:5180'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)))
await p.goto(URL + '/scripts/numtest.html', { waitUntil: 'networkidle' })

const t = await p.evaluate(() => window.__r)
if (!t) { console.log('страница не загрузилась:', errs); process.exit(1) }

// Живое поле: значение «0», ставим курсор в начало и набираем 5 — должно стать «5».
const zero = p.locator('#zero')
await zero.click(); await p.keyboard.press('Home'); await p.keyboard.type('5')
t.push({ name: 'живое поле: 0 не залипает', got: await zero.inputValue(), want: '5', ok: (await zero.inputValue()) === '5' })

// Курсор: «1 000», встаём после первой цифры, набираем 2 → «12 000», курсор после «2».
const mid = p.locator('#mid')
await mid.click()
await mid.evaluate((e) => e.setSelectionRange(1, 1))
await p.keyboard.type('2')
const val = await mid.inputValue()
const car = await mid.evaluate((e) => e.selectionStart)
t.push({ name: 'живое поле: разряды при вводе', got: val, want: '12 000', ok: val === '12 000' })
t.push({ name: 'живое поле: курсор не уехал в конец', got: car, want: 2, ok: car === 2 })

const show = (s) => String(s).replace(/ /g, '␣')
for (const x of t) console.log((x.ok ? '  ok  ' : ' FAIL ') + x.name + (x.ok ? '' : `  получено «${show(x.got)}», ждали «${show(x.want)}»`))
const bad = t.filter((x) => !x.ok).length
console.log(bad ? `\nПРОВАЛЕНО: ${bad} из ${t.length}` : `\nвсе ${t.length} прошли`)
if (errs.length) console.log('ошибки страницы:', errs)
await b.close()
process.exit(bad ? 1 : 0)
