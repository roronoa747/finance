import type { HueKey } from '@/lib/palette'

/**
 * Шаблоны целей (Р-9, Р-28, B2C-17): пять типов и направления путешествий с картинками Unsplash
 * (автор и ссылка — лицензия). Картинки в сборку не встраиваются: при выборе шаблона телефон
 * скачивает её с `images.unsplash.com` (CORS открыт), сжимает и загружает как своё фото; автор
 * сохраняется в цели. Фото типов — из DESIGN.md §1.1 (референсы Блока 2), адреса картинок —
 * из `unsplash.com/photos/<pageId>/download`. Направление показывает то место, которое называет
 * (правило 12 «образ вместо текста»): у каждого — фото, на странице которого указано это место
 * (`place` — строка места со страницы, как её печатает Unsplash; сверено 2026-09-28, возврат
 * приёмки Блока 3 п. 6). Тип «Путешествие» места не называет — его фото утверждено в §1.1.
 * Пул шире (B2C-64): шесть тем — у каждой свой тип и своя плитка в сетке «На что копим?».
 */
export type GoalTemplateType = 'car' | 'home' | 'travel' | 'tech' | 'health' | 'wedding' | 'baby' | 'study' | 'renovation' | 'cushion' | 'hajj'

export interface GoalTemplate {
  id: string
  name: string
  type: GoalTemplateType
  photo: {
    /** Путь картинки на `images.unsplash.com` (`photo-…` или старый `21/…JPG`). */
    unsplashId: string
    /** Страница фото на unsplash.com — ссылка на автора и лицензию. */
    pageId: string
    author: string
    authorUrl: string
    /** Место со страницы фото — у направлений путешествий обязательно и совпадает с названием. */
    place?: string
  }
  hue: HueKey
}

export const GOAL_TYPES: { type: GoalTemplateType; name: string }[] = [
  { type: 'car', name: 'Машина' },
  { type: 'home', name: 'Квартира' },
  { type: 'travel', name: 'Путешествие' },
  { type: 'tech', name: 'Техника' },
  { type: 'health', name: 'Здоровье' },
  { type: 'wedding', name: 'Свадьба' },
  { type: 'baby', name: 'Ребёнок' },
  { type: 'study', name: 'Учёба' },
  { type: 'renovation', name: 'Ремонт' },
  { type: 'cushion', name: 'Подушка' },
  { type: 'hajj', name: 'Хадж, Умра' },
]

const photo = (unsplashId: string, pageId: string, author: string, authorUrl: string, place?: string) => ({ unsplashId, pageId, author, authorUrl, ...(place ? { place } : {}) })

export const GOAL_TEMPLATES: GoalTemplate[] = [
  // Пять типов.
  { id: 'car', name: 'Машина', type: 'car', hue: 'steel', photo: photo('photo-1455098934982-64c622c5e066', 'uzBiLWpjQEQ', 'Tim Stief', 'https://unsplash.com/@timstief') },
  { id: 'home', name: 'Квартира', type: 'home', hue: 'ochre', photo: photo('17/unsplash_527bf4b4ae00d_1.JPG', 'oFAVqfTSby8', 'Linh Nguyen', 'https://unsplash.com/@linhnguyen') },
  { id: 'travel', name: 'Путешествие', type: 'travel', hue: 'blue', photo: photo('21/string-lights.JPG', 't05kfHeygbE', 'Matthew Skinner', 'https://unsplash.com/@matthewskinner') },
  { id: 'tech', name: 'Техника', type: 'tech', hue: 'indigo', photo: photo('19/desktop.JPG', 'ICW6QYOcdlg', 'Galymzhan Abdugalimov', 'https://unsplash.com/@galymzhan') },
  { id: 'health', name: 'Здоровье', type: 'health', hue: 'green', photo: photo('19/nomad.JPG', 'tvicgTdh7Fg', 'Danka & Peter', 'https://unsplash.com/@dankapeter') },
  // Темы пула (B2C-64): «Ребёнок» — без людей, «Хадж, Умра» — Зелёный купол Медины без людей.
  { id: 'wedding', name: 'Свадьба', type: 'wedding', hue: 'plum', photo: photo('photo-1515934751635-c81c6bc9a2d8', 'M2T1j-6Fn8w', 'Beatriz Pérez Moya', 'https://unsplash.com/@beatriz_perez') },
  { id: 'baby', name: 'Ребёнок', type: 'baby', hue: 'teal', photo: photo('photo-1542901689-8917f44e3541', 'e1Q-ZCzDuUQ', 'charlesdeluvio', 'https://unsplash.com/@charlesdeluvio') },
  { id: 'study', name: 'Учёба', type: 'study', hue: 'indigo', photo: photo('photo-1564981797816-1043664bf78d', 'n4y3eiQSIoc', 'Drahomír Hugo Posteby-Mach', 'https://unsplash.com/@postebymach') },
  { id: 'renovation', name: 'Ремонт', type: 'renovation', hue: 'brick', photo: photo('photo-1525909002-1b05e0c869d8', '46juD4zY1XA', 'David Pisnoy', 'https://unsplash.com/@davidpisnoy') },
  { id: 'cushion', name: 'Подушка', type: 'cushion', hue: 'ochre', photo: photo('photo-1607863680198-23d4b2565df0', '5OUMf1Mr5pU', 'Andre Taissin', 'https://unsplash.com/@andretaissin') },
  { id: 'hajj', name: 'Хадж, Умра', type: 'hajj', hue: 'green', photo: photo('photo-1765892272462-bad4a8ba0fb9', 'rxk0urG5ZLc', 'Tibvia', 'https://unsplash.com/@tibvia') },
  // Направления (тип «Путешествие»): место — со страницы фото.
  { id: 'japan', name: 'Япония', type: 'travel', hue: 'plum', photo: photo('photo-1624253321171-1be53e12f5f4', 'SlIl9eZjWUc', 'Roméo A.', 'https://unsplash.com/@gronemo', 'Kyoto, Préfecture de Kyoto, Japon') },
  { id: 'turkey', name: 'Турция', type: 'travel', hue: 'teal', photo: photo('photo-1631152282084-b8f1b380ccab', 'f7oe3-tlm0I', 'yyzvic', 'https://unsplash.com/@yyzvic', 'Cappadocia, Avanos, Turkey') },
  { id: 'dubai', name: 'Дубай', type: 'travel', hue: 'ochre', photo: photo('photo-1518684079-3c830dcef090', '7tb-b37yHx4', 'Christoph Schulz', 'https://unsplash.com/@christoph', 'Dubai, United Arab Emirates') },
  { id: 'georgia', name: 'Грузия', type: 'travel', hue: 'green', photo: photo('photo-1603350576276-24747f7bbf40', 'xVLdFIxcDCc', 'K T', 'https://unsplash.com/@_knt', 'Rike Park, Tbilisi, Georgia') },
  { id: 'norway', name: 'Норвегия', type: 'travel', hue: 'blue', photo: photo('photo-1443890484047-5eaa67d1d630', '-oWyJoSqBRM', 'Oleksii Topolianskyi', 'https://unsplash.com/@megapixel_world', 'Preikestolen, Forsand, Norway') },
  { id: 'bali', name: 'Бали', type: 'travel', hue: 'green', photo: photo('photo-1555400038-63f5ba517a47', '-2WlTWZLnRc', 'Niklas Weiss', 'https://unsplash.com/@treesoftheplanet', 'Tegallalang, Gianyar, Bali, Indonesien') },
  { id: 'paris', name: 'Париж', type: 'travel', hue: 'indigo', photo: photo('photo-1502602898657-3e91760cbb34', 'nnzkZNYWHaU', 'Chris Karidis', 'https://unsplash.com/@chriskaridis', 'Eiffel Tower, Paris, France') },
  { id: 'italy', name: 'Италия', type: 'travel', hue: 'ochre', photo: photo('photo-1552832230-c0197dd311b5', 'VFRTXGw1VjU', 'David Köhler', 'https://unsplash.com/@davidkhlr', 'Colosseum, Rome, Italy') },
  { id: 'amsterdam', name: 'Амстердам', type: 'travel', hue: 'brick', photo: photo('photo-1534351590666-13e3e96b5017', 'QRtym77B6xk', 'Adrien Olichon', 'https://unsplash.com/@adrienolichon', 'Amsterdam, Netherlands') },
  { id: 'almaty', name: 'Алматы — горы', type: 'travel', hue: 'steel', photo: photo('photo-1659653159038-f68fe4b1fdc0', 'MemMFhiLJOA', 'Ilyas Dautov', 'https://unsplash.com/@ilyas_d', 'Almaty, Kazakhstan') },
]

/** Направления путешествий — для второго шага выбора после типа «Путешествие». */
export const TRAVEL_DIRECTIONS = GOAL_TEMPLATES.filter((t) => t.type === 'travel' && t.id !== 'travel')

export const templateById = (id: string | null | undefined): GoalTemplate | undefined =>
  id ? GOAL_TEMPLATES.find((t) => t.id === id) : undefined

/** Картинка шаблона нужной ширины — с CDN Unsplash, без ключа; сжимается на телефоне после скачивания. */
export function templateImageUrl(t: GoalTemplate, width = 1200): string {
  return `https://images.unsplash.com/${t.photo.unsplashId}?w=${width}&q=80&fm=jpg&fit=crop`
}

/** Подпись автора для цели: «Фото: <автор> / Unsplash» со ссылкой на страницу фото. */
export function templateCredit(t: GoalTemplate): { author: string; url: string } {
  return { author: t.photo.author, url: `https://unsplash.com/photos/${t.photo.pageId}` }
}
