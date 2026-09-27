import type { HueKey } from '@/lib/palette'

/**
 * Шаблоны целей (Р-9, Р-28, B2C-17): пять типов и направления путешествий с картинками Unsplash
 * (автор и ссылка — лицензия). Картинки в сборку не встраиваются: при выборе шаблона телефон
 * скачивает её с `images.unsplash.com` (CORS открыт), сжимает и загружает как своё фото; автор
 * сохраняется в цели. Фото — из DESIGN.md §1.1 (референсы Блока 2), адреса картинок —
 * из `unsplash.com/photos/<pageId>/download`.
 */
export type GoalTemplateType = 'car' | 'home' | 'travel' | 'tech' | 'health'

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
  }
  hue: HueKey
}

export const GOAL_TYPES: { type: GoalTemplateType; name: string }[] = [
  { type: 'car', name: 'Машина' },
  { type: 'home', name: 'Квартира' },
  { type: 'travel', name: 'Путешествие' },
  { type: 'tech', name: 'Техника' },
  { type: 'health', name: 'Здоровье' },
]

const photo = (unsplashId: string, pageId: string, author: string, authorUrl: string) => ({ unsplashId, pageId, author, authorUrl })

export const GOAL_TEMPLATES: GoalTemplate[] = [
  // Пять типов.
  { id: 'car', name: 'Машина', type: 'car', hue: 'steel', photo: photo('photo-1455098934982-64c622c5e066', 'uzBiLWpjQEQ', 'Tim Stief', 'https://unsplash.com/@timstief') },
  { id: 'home', name: 'Квартира', type: 'home', hue: 'ochre', photo: photo('17/unsplash_527bf4b4ae00d_1.JPG', 'oFAVqfTSby8', 'Linh Nguyen', 'https://unsplash.com/@linhnguyen') },
  { id: 'travel', name: 'Путешествие', type: 'travel', hue: 'blue', photo: photo('21/string-lights.JPG', 't05kfHeygbE', 'Matthew Skinner', 'https://unsplash.com/@matthewskinner') },
  { id: 'tech', name: 'Техника', type: 'tech', hue: 'indigo', photo: photo('19/desktop.JPG', 'ICW6QYOcdlg', 'Galymzhan Abdugalimov', 'https://unsplash.com/@galymzhan') },
  { id: 'health', name: 'Здоровье', type: 'health', hue: 'green', photo: photo('19/nomad.JPG', 'tvicgTdh7Fg', 'Danka & Peter', 'https://unsplash.com/@dankapeter') },
  // Направления (тип «Путешествие»).
  { id: 'japan', name: 'Япония', type: 'travel', hue: 'plum', photo: photo('21/string-lights.JPG', 't05kfHeygbE', 'Matthew Skinner', 'https://unsplash.com/@matthewskinner') },
  { id: 'turkey', name: 'Турция', type: 'travel', hue: 'teal', photo: photo('photo-1433190152045-5a94184895da', 'xcC5ozHk_N8', 'Joseph Barrientos', 'https://unsplash.com/@jbcreate_') },
  { id: 'georgia', name: 'Грузия', type: 'travel', hue: 'green', photo: photo('photo-1454982523318-4b6396f39d3a', 'mWRR1xj95hg', 'Christian Joudrey', 'https://unsplash.com/@cjoudrey') },
  { id: 'norway', name: 'Норвегия', type: 'travel', hue: 'blue', photo: photo('photo-1443890484047-5eaa67d1d630', '-oWyJoSqBRM', 'Alexey Topolyanskiy', 'https://unsplash.com/@atopolyanskiy') },
  { id: 'bali', name: 'Бали', type: 'travel', hue: 'green', photo: photo('photo-1451337516015-6b6e9a44a8a3', 'Kt5hRENuotI', 'Andrew Ridley', 'https://unsplash.com/@aridley88') },
  { id: 'italy', name: 'Италия', type: 'travel', hue: 'ochre', photo: photo('photo-1437652010333-fbf2cd02a4f8', '_SmZSuZwkHg', 'Stefan Kunze', 'https://unsplash.com/@stefankunze') },
  { id: 'amsterdam', name: 'Амстердам', type: 'travel', hue: 'brick', photo: photo('17/unsplash_527bf56961712_1.JPG', 'agkblvPff5U', 'Linh Nguyen', 'https://unsplash.com/@linhnguyen') },
  { id: 'almaty', name: 'Алматы — горы', type: 'travel', hue: 'steel', photo: photo('photo-1437382944886-45a9f73d4158', 'yOujaSETXlo', 'Wolfgang Lutz', 'https://unsplash.com/@wolfgang_lutz') },
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
