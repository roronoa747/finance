import { describe, it, expect } from 'vitest'

/**
 * Гвард уборки раскладки (B2C-58, Р-52): разбор заменил \`WeekSalary\` — в коде \`src/\` нет ни экрана, ни
 * его адреса \`/week/salary\`, кроме редиректа в \`router/index.ts\` (старые ссылки и закладки PWA). Тесты не
 * считаются: они проверяют сам редирект. Файлы — через node:fs, как \`style.literals.test.ts\`.
 */
type Dirent = { name: string; isDirectory(): boolean }
type NodeFs = {
  readFileSync(path: URL, encoding: string): string
  readdirSync(path: URL, opts: { withFileTypes: true }): Dirent[]
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs

const SRC = new URL('../', import.meta.url)

/** Код под `src/` (без тестов) — пути относительно `src/`. */
function codeFiles(dir = ''): string[] {
  return fs.readdirSync(new URL(dir || './', SRC), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'test' ? [] : codeFiles(`${rel}/`)
    return /\.(vue|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : []
  })
}

describe('B2C-58: старой раскладки в коде нет', () => {
  it('нет WeekSalary; адрес /week/salary — только редиректом в router/index.ts', () => {
    const hits = codeFiles().flatMap((rel) =>
      fs
        .readFileSync(new URL(rel, SRC), 'utf-8')
        .split('\n')
        .map((line, i) => ({ rel, line: line.trim(), n: i + 1 }))
        .filter((x) => /WeekSalary|week\/salary/.test(x.line)),
    )
    const allowed = (x: { rel: string; line: string }) =>
      x.rel === 'router/index.ts' && /path: 'week\/salary', redirect:/.test(x.line)
    expect(hits.filter((x) => !allowed(x)).map((x) => `${x.rel}:${x.n} ${x.line}`)).toEqual([])
    expect(hits.filter(allowed)).toHaveLength(1)
  })
})

/**
 * Блок 14 (B2C-89, Р-78): кольцо разбора и «Ваш порядок» убраны — в коде `src/` нет их экранов, пути и расчёта;
 * старые адреса `/week/breakdown`, `/week/order`, `/week/salary`, `/ritual` — только редиректами на `/money`.
 */
describe('B2C-89: кольца разбора и «Вашего порядка» в коде нет', () => {
  const grep = (re: RegExp) =>
    codeFiles().flatMap((rel) =>
      fs
        .readFileSync(new URL(rel, SRC), 'utf-8')
        .split('\n')
        .map((line, i) => ({ rel, line: line.trim(), n: i + 1 }))
        .filter((x) => re.test(x.line)),
    )

  it('нет Breakdown.vue, YourOrder, BreakdownRing, breakdownPath, orderPath, salaryBreakdownPath, incomeBreakdownPath, breakdownWith, monthBreakdown', () => {
    const hits = grep(/views\/Breakdown|\bYourOrder\b|BreakdownRing|\bbreakdownPath\b|\borderPath\b|salaryBreakdownPath|incomeBreakdownPath|\bbreakdownWith\b|\bmonthBreakdown\b|\blayBreakdown\b|\busualCard\b/)
    expect(hits.map((x) => `${x.rel}:${x.n} ${x.line}`)).toEqual([])
  })

  it('старые адреса — только редиректами на /money в router/index.ts', () => {
    const hits = grep(/week\/(breakdown|order|salary)|path: 'ritual'/)
    expect(hits.every((x) => x.rel === 'router/index.ts' && /redirect: toPlan/.test(x.line))).toBe(true)
    expect(hits).toHaveLength(4)
  })
})


/**
 * Ревью frontend Б14, Н-4: вход плана месяца собирается одним местом — `planInput` / `monthPlanOf` стора. Экраны
 * не зовут `monthPlan(` / `planFromSource(` со своим входом: кто зовёт — берёт `planInput`. Демо `Access.vue` —
 * намеренно с пустыми итогами (запись прошлого месяца демо-семьи).
 */
describe('Н-4: план месяца — один вход', () => {
  it('экраны и компоненты зовут monthPlan / planFromSource только со входом planInput', () => {
    const screens = codeFiles().filter((rel) => /^(views|components)\//.test(rel) && rel !== 'views/Access.vue')
    const bad = screens.filter((rel) => {
      const text = fs.readFileSync(new URL(rel, SRC), 'utf-8')
      return /\b(monthPlan|planFromSource)\(/.test(text) && !/planInput\(/.test(text)
    })
    expect(bad).toEqual([])
  })
})
