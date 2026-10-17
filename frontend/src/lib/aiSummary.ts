import type { Person, PersonId } from '@/types/finance'

/**
 * Сводка месяца разбора v1 (бэклог «ИИ», Р-3) — только чтение: так «что ушло» рисует разборы, сохранённые до v2
 * (до 12 в документе). Новые разборы шлют факты (`aiFacts.ts`). Значения — целые тенге (ставки — проценты); имена
 * людей — «участник N» (по слоту: a — 1, b — 2, c — 3).
 */
export type MonthSummaryAI = {
  /** Месяц `YYYY-MM`. */
  month: string
  /** Дней до ближайшей зарплаты; null — зарплат не ждём. */
  daysToPayday: number | null
  income: { total: number; byPerson: { who: string; amount: number }[] }
  /** Платежи месяца: обязательства и кредиты. */
  dues: { total: number; items: { name: string; amount: number }[] }
  /**
   * Траты: `total` — план трат месяца (раздел «Траты» «Месяца»), `fact` — потрачено по выпискам (null — выписок за
   * месяц нет), `byCategory` — он же по разделам (`monthSpendByCategory`: вместе дают `fact`), «Без раздела» —
   * неразобранное.
   */
  spend: { total: number; fact: number | null; byCategory: { name: string; amount: number }[] }
  /** Остаётся после платежей, трат и целей (крупная цифра «Месяца»). */
  rest: number
  /** Не хватает на платежи и траты. */
  short: number
  /** Доход − платежи − траты: что получает очередь целей; меньше нуля — не хватает. */
  free: number
  /** Уже отложено в этом месяце по очереди. */
  saved: number
  debts: { total: number; items: { name: string; left: number; payment: number; ratePercent: number | null; endMonth: string | null }[] }
  /**
   * Досрочка в долг — строка долга очереди месяца (карточка «закрыть кредит» или шаг плана «Сначала долги»):
   * `monthlyPut` — сколько план отводит в этом месяце, `doneMonth` — когда закроем с ней; null — досрочки нет.
   * Необязательна: разборы, сохранённые до неё, её не знают (ревью frontend Блока 2, Н-1).
   */
  prepay?: { name: string; monthlyPut: number; doneMonth: string | null } | null
  /**
   * Цели и фонды: `want` — сколько собрать, `have` — собрано, `monthlyPut` — сколько план даёт в этом месяце;
   * `afterPlan` — на паузе ради плана «Сначала долги» (срок — после плана), а не выключена (необязательно — как `prepay`).
   */
  goals: { name: string; want: number; have: number; monthlyPut: number; doneMonth: string | null; paused: boolean; afterPlan?: boolean }[]
}

const SLOT_NO: Record<PersonId, number> = { a: 1, b: 2, c: 3 }
const who = (id: PersonId) => `участник ${SLOT_NO[id]}`

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** «ё» пишут и через «е»: «Пётр» — и «Петра». */
const yo = (s: string) => s.replace(/[её]/giu, '[её]')
/** Окончания падежей имени после основы: Дан-ы, Мари-ей, Айгул-ью, Андре-я, Павл-ом. */
const CASE = '(?:а|я|ы|и|е|у|ю|ь|й|ой|ей|ою|ею|ом|ем|ём|ью)'

/**
 * Формы слова имени: «Ерлан» — с любым хвостом («Ерлану», «Ерланова»); на гласную, -ь, -й — основа без последней буквы
 * и окончание падежа («Дана» → «Даны», «Мария» → «Марии», «Айгуль» → «Айгули»); беглая гласная — «Павел» → «Павла».
 * Короче 3 букв («Вы», «Ян») — целым словом или с окончанием, иначе «Выплата» стала бы участником.
 */
function nameForms(word: string): string {
  const w = yo(escapeRe(word))
  if (word.length < 3) return `${w}${CASE}?`
  const forms = [`${w}\\p{L}*`]
  if (/[аяьйеёоиыуюэ]$/iu.test(word)) forms.push(`${yo(escapeRe(word.slice(0, -1)))}${CASE}`)
  else if (word.length >= 4 && /[еёо]$/iu.test(word.slice(0, -1))) forms.push(`${yo(escapeRe(word.slice(0, -2) + word.slice(-1)))}${CASE}`)
  return `(?:${forms.join('|')})`
}

/**
 * Имя участника в тексте («Кредит Айгуль», «Подарок Ерлану», «Кружок Даны») → «участник N». Каждое слово имени — без
 * учёта регистра, во всех падежах (`nameForms`). Удалённые участники — тоже: их имя могло остаться в названии статьи.
 */
export function maskNames(text: string, people: Pick<Person, 'id' | 'name'>[]): string {
  let out = text
  for (const p of people) {
    for (const word of (p.name ?? '').split(/[\s\p{P}]+/u)) {
      if (word.length < 2) continue
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${nameForms(word)}(?![\\p{L}\\p{N}])`, 'giu')
      out = out.replace(re, (_m, before: string) => `${before}${who(p.id)}`)
    }
  }
  return out
}
