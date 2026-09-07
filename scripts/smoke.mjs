import { chromium } from 'playwright-core'
const URL='http://localhost:5180/'
const errors=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
const ctx=await browser.newContext({viewport:{width:390,height:844}})
const page=await ctx.newPage()
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,300))})
page.on('pageerror',e=>errors.push('UNCAUGHT: '+String(e).slice(0,300)))
const out={}
try{
  // 1. чистый старт
  await page.goto(URL,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('nav',{timeout:15000})
  out.fresh=(await page.evaluate(()=>document.querySelector('main')?.innerText??'')).slice(0,120).replace(/\n+/g,' | ')

  // 2. подсовываем ДАННЫЕ СТАРОГО ФОРМАТА (version 1, без updatedAt и seed)
  const legacy={
    state:{
      people:[{id:'a',name:'Ильяс',salary:700000,payday:10},{id:'b',name:'Аруна',salary:500000,payday:25}],
      categories:[{key:'d1',name:'Жильё',note:'x',amount:300000},{key:'d2',name:'Кредит',note:'x',amount:100000},
                  {key:'d3',name:'Цели',note:'x',amount:200000},{key:'d4',name:'Еда и быт',note:'x',amount:200000},
                  {key:'d5',name:'Свободно',note:'x',amount:0}],
      goals:[{id:'flat',name:'Первая квартира',need:6000000,have:2000000,monthly:200000,hue:'green',planPct:0.3,
              movements:[{id:'m1',date:'2026-09-01T00:00:00.000Z',amount:160000,by:'a'}]}],
      wishlist:[{id:'w1',name:'Диван',price:320000,by:'b',addedOn:'12 августа',bought:false}],
      obligations:[{id:'rent',name:'Аренда',note:'квартира',day:5,category:'d1',
                    versions:[{from:'2025-01',amount:280000},{from:'2026-11',amount:220000}]}],
      accounts:[{id:'kaspi',name:'Карта',note:'x',amount:240000,kind:'card'}],
      credits:[{id:'c1',name:'Кредит',note:'x',principal:1640000,annualRate:0.234,payment:117000,day:12}],
      settings:{theme:'auto',accent:'copper',categories:{d1:'blue',d2:'brick',d3:'green',d4:'ochre',d5:'steel'},inflation:0.102}
    },
    version:1
  }
  await page.evaluate(v=>localStorage.setItem('kazna-v1',v),JSON.stringify(legacy))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('nav',{timeout:15000})
  out.afterMigration=(await page.evaluate(()=>document.querySelector('main')?.innerText??'')).slice(0,200).replace(/\n+/g,' | ')

  const migrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('kazna-v1')||'{}'))
  const g=migrated.state?.goals?.[0]
  out.version=migrated.version
  out.goalSeed=g?.seed
  out.goalHave=g?.have
  out.hasUpdatedAt=Boolean(g?.updatedAt)
  out.accentKept=migrated.state?.settings?.accent

  // 3. цель открывается, взнос добавляется
  await page.goto(URL+'#/goals/flat',{waitUntil:'domcontentloaded'})
  await page.waitForTimeout(800)
  out.goalScreen=(await page.evaluate(()=>document.querySelector('main')?.innerText??'')).slice(0,140).replace(/\n+/g,' | ')
}catch(e){out.crash=String(e).slice(0,500)}
console.log(JSON.stringify({out,errors},null,1))
await browser.close()
