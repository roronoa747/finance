import { chromium } from 'playwright-core'
const URL='http://localhost:5180/'
const EMAIL=`kazna.check.${Date.now()}@mailinator.com`
const PASS='ProbaKazny2026!'
const errors=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
const ctx=await browser.newContext({viewport:{width:390,height:844}})
const page=await ctx.newPage()
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,250))})
page.on('pageerror',e=>errors.push('UNCAUGHT: '+String(e).slice(0,250)))
const out={email:EMAIL}
const txt=()=>page.evaluate(()=>document.body.innerText.replace(/\n+/g,' | ').slice(0,240))
try{
  await page.goto(URL,{waitUntil:'domcontentloaded'})
  await page.waitForTimeout(2500)
  out.gate=await txt()

  // регистрация
  await page.getByRole('button',{name:'Регистрация'}).click()
  await page.waitForTimeout(300)
  const inputs=page.locator('input')
  await inputs.nth(0).fill(EMAIL)
  await inputs.nth(1).fill(PASS)
  await page.getByRole('button',{name:'Создать аккаунт'}).click()
  await page.waitForTimeout(4000)
  out.afterSignUp=await txt()

  // если дошли до выбора казны — создаём
  if((out.afterSignUp||'').includes('Общая казна')){
    const nameInput=page.locator('input').first()
    await nameInput.fill('Ильяс')
    await page.getByRole('button',{name:'Создать казну'}).click()
    await page.waitForTimeout(5000)
    out.afterCreate=await txt()
    out.syncLabel=await page.evaluate(()=>{
      const b=[...document.querySelectorAll('button')].find(x=>/синхрон|ждёт|нет сети|не сошлось|локально/i.test(x.textContent||''))
      return b?b.textContent.trim():null
    })
    // правим цель и смотрим, доедет ли
    await page.goto(URL+'#/goals',{waitUntil:'domcontentloaded'})
    await page.waitForTimeout(1200)
    out.goalsScreen=(await page.evaluate(()=>document.querySelector('main')?.innerText??'')).slice(0,120).replace(/\n+/g,' | ')
  }
}catch(e){out.crash=String(e).slice(0,400)}
console.log(JSON.stringify({out,errors},null,1))
await browser.close()
