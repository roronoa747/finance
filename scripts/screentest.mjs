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
  /*
    Хранилище. Самая дорогая из уже сделанных ошибок жила здесь: миграция
    стирала демонстрационный пример независимо от версии, с которой шёл
    переход, и данные семьи слетали при обновлении.

    Что здесь проверяется честно: данные текущей версии переживают запуск, а
    переход со старой поднимает номер и не трогает оформление и состав семьи.

    Чего проверить нельзя: защиту `from >= 3` внутри migrate. Пока версия в
    коде равна сохранённой, migrate вообще не вызывается — я снимал защиту и
    убедился, что прогон этого не замечает. Она станет проверяемой, когда
    появится версия 4; до тех пор её надёжность держится на чтении кода.
  */
  await open('/capital')
  const kept = await store()
  check('данные текущей версии переживают запуск',
    kept.people.length === 2 && kept.goals[0].have === 2000000 && kept.credits[0].payment === 117000,
    `${kept.people.length} чел., цель ${kept.goals?.[0]?.have}, платёж ${kept.credits?.[0]?.payment}`)

  // Версия 1 — это ещё придуманный пример, его стирают. Но оформление и
  // привязка к семье заводились осознанно и обязаны уцелеть.
  await page.evaluate((v) => {
    const s = JSON.parse(v)
    s.version = 1
    s.state.settings.accent = 'copper'
    localStorage.setItem('kazna-v1', JSON.stringify(s))
  }, JSON.stringify(seed))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav', { timeout: 15000 })
  await page.waitForTimeout(400)
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('kazna-v1')))
  check('переход с первой версии поднимает номер', migrated.version === 3, migrated.version)
  check('оформление и семья при этом уцелели',
    migrated.state.settings.accent === 'copper' && migrated.state.membership.length === 2,
    `${migrated.state.settings.accent}, участников ${migrated.state.membership?.length}`)

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
  // --- рассрочка: ставка 0 законна, раньше правка на ноль молча пропадала ---
  await open('/capital')
  await page.locator('text=Кредит Халык').first().click()
  await page.waitForTimeout(400)

  // Отметка не должна гореть просто оттого, что окно открыли: тогда она не
  // отличала бы сохранение от его отсутствия и врала бы ровно в том случае,
  // ради которого заведена.
  const mark = () => page.locator('text=Сохранено').first().evaluate((e) => getComputedStyle(e).opacity)
  check('при открытии отметки нет', (await mark()) === '0', `прозрачность ${await mark()}`)

  // На телефоне автофокус выбрасывает клавиатуру и выделяет название — при
  // правке существующей записи это только мешает.
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? '—')
  check('окно правки не выхватывает поле', focused !== 'INPUT', focused)

  const rate = page.locator('input[inputmode="decimal"]').first()
  await rate.fill(''); await rate.type('0'); await rate.blur()
  await page.waitForTimeout(400)
  const s9 = await store()
  check('ставка 0 сохраняется', s9.credits[0].annualRate === 0, s9.credits[0].annualRate)
  check('после сохранения отметка загорается', (await mark()) === '1', `прозрачность ${await mark()}`)

  // Закрываем правку и смотрим на строку: «ГЭСВ 0,0%» — это не подпись, это шум.
  await page.locator('button:has-text("Готово")').first().click()
  await page.waitForTimeout(400)
  check('кредит без процентов подписан словами',
    (await page.locator('text=без процентов').count()) > 0,
    await page.locator('button:has-text("Кредит Халык")').first().innerText().catch(() => '—'))

  check('кнопка «Готово» закрывает правку',
    (await page.locator('text=Ставка (ГЭСВ), % годовых').count()) === 0)

  // --- нажимаемая строка выглядит нажимаемой и не срабатывает при прокрутке ---
  check('у строк есть шеврон', (await page.locator('path[d="M1 1l5.5 6L1 13"]').count()) > 0)

  const row = page.locator('button:has-text("Кредит Халык")').first()
  const box = await row.boundingBox()
  await page.mouse.move(box.x + 30, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + 70, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  check('протяжка по строке не открывает правку',
    (await page.locator('text=Ставка (ГЭСВ), % годовых').count()) === 0)

  // --- признак «бюджет уже заведён»: только он не пускает мастер настройки ---
  const gate = await page.evaluate(() => {
    const f = window.__hasBudgetData
    const base = { people: [], obligations: [], credits: [], goals: [], accounts: [] }
    const person = (salary) => ({ id: 'a', name: 'x', salary, payday: 1 })
    const goal = (extra) => ({ id: 'g', name: 'g', need: 1, have: 0, monthly: 0, hue: 'blue', planPct: 0, movements: [], ...extra })
    return {
      empty: f(base),
      withSalary: f({ ...base, people: [person(100)] }),
      zeroSalary: f({ ...base, people: [person(0)] }),
      withGoal: f({ ...base, goals: [goal()] }),
      deletedGoal: f({ ...base, goals: [goal({ deletedAt: '2026-01-01T00:00:00.000Z' })] }),
    }
  })
  // --- пояснения спрятаны под знак вопроса ---
  await open('/capital')
  check('пояснение скрыто, пока не спросили',
    (await page.locator('text=Всё, что есть, минус всё, что должны').count()) === 0)
  const hint = page.locator('button[aria-label="Пояснение"]').first()
  check('знак вопроса на месте', (await hint.count()) > 0)
  await hint.click()
  await page.waitForTimeout(300)
  check('по нажатию пояснение открывается',
    (await page.locator('text=Всё, что есть, минус всё, что должны').count()) > 0)
  await page.mouse.click(200, 700)
  await page.waitForTimeout(300)
  check('нажатие мимо закрывает пояснение',
    (await page.locator('text=Всё, что есть, минус всё, что должны').count()) === 0)

  // --- удаление: два шага и красный блок, а не серая ссылка ---
  await open('/capital')
  await page.locator('text=Аренда').first().click()
  await page.waitForTimeout(400)
  const del = page.locator('button:has-text("Удалить обязательство")').first()
  const delColor = await del.evaluate((e) => getComputedStyle(e).color)
  check('кнопка удаления красная', delColor !== 'rgb(0, 0, 0)' && /rgb\(1[0-9]{2}|rgb\(2[0-9]{2}/.test(delColor), delColor)
  check('у кнопки удаления есть знак внимания', (await del.locator('svg').count()) > 0)
  await del.click()
  await page.waitForTimeout(300)
  check('первое нажатие не удаляет, а спрашивает',
    (await page.locator('text=Отменить нельзя').count()) > 0)
  const s10 = await store()
  check('обязательство пока на месте', !s10.obligations[0].deletedAt)
  await page.locator('button:has-text("Отмена")').first().click()
  await page.waitForTimeout(300)
  check('отмена возвращает к кнопке', (await page.locator('text=Отменить нельзя').count()) === 0)

  // --- какой долг гасить первым ---
  await open('/capital')
  check('совет о самом дорогом долге показан', (await page.locator('text=Что гасить первым').count()) > 0)
  const advice = await page.locator('text=Самая дорогая ставка').locator('xpath=..').innerText()
  check('назван долг с высшей ставкой, а не самый большой',
    advice.includes('Кредитная карта') && !advice.includes('Кредит Халык'),
    advice.split('\n').slice(0, 3).join(' | '))
  check('видно, что половина платежа — проценты', /5[01]%/.test(advice), advice.match(/\d+%/g)?.join(' '))

  const debt = await page.evaluate(() => {
    const f = window.__debtCost
    return {
      // Кредитная карта: платёж 8400, ставка 30,6% — половина уходит в проценты.
      card: f(165000, 0.306, 8400),
      // Платёж меньше процентов: долг не гасится вообще.
      stuck: f(165000, 0.306, 3000),
      // Рассрочка без процентов.
      free: f(120000, 0, 10000),
    }
  })
  check('доля процентов у карты около половины',
    Math.round(debt.card.interestShare * 100) === 50, Math.round(debt.card.interestShare * 100) + '%')
  check('долг с малым платежом признан незакрывающимся', debt.stuck.closes === false)
  check('у рассрочки нет ни процентов, ни переплаты',
    debt.free.monthlyInterest === 0 && Math.round(debt.free.overpay) === 0,
    `проценты ${debt.free.monthlyInterest}, переплата ${debt.free.overpay}`)

  check('пустое состояние — бюджета нет', gate.empty === false)
  check('введённая зарплата — бюджет есть', gate.withSalary === true)
  check('нулевая зарплата сама по себе бюджетом не считается', gate.zeroSalary === false)
  check('цель — бюджет есть', gate.withGoal === true)
  check('удалённая цель не считается', gate.deletedGoal === false)
} catch (e) {
  check('прогон дошёл до конца', false, String(e).slice(0, 300))
}

for (const x of t) console.log((x.ok ? '  ok  ' : ' FAIL ') + x.name + (x.ok || x.got === undefined ? '' : `  → ${x.got}`))
const bad = t.filter((x) => !x.ok).length
console.log(bad ? `\nПРОВАЛЕНО: ${bad} из ${t.length}` : `\nвсе ${t.length} прошли`)
if (errors.length) console.log('\nошибки страницы:\n' + [...new Set(errors)].join('\n'))
await browser.close()
process.exit(bad ? 1 : 0)
