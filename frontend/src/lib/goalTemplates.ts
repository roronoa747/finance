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
 * Несколько фото на тему (B2C-64-а): варианты `<тип>-2…` того же типа — ряд под сеткой, плитка — первое фото.
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
  // Варианты фото тем (B2C-64-а): «Хадж, Умра» — без людей, «Ребёнок» — без детей.
  { id: 'car-2', name: 'Машина', type: 'car', hue: 'steel', photo: photo('photo-1572401611152-cf63d874b019', 'bFTVxTo266E', 'Maksim Tarasov', 'https://unsplash.com/@awsmsky') },
  { id: 'car-3', name: 'Машина', type: 'car', hue: 'steel', photo: photo('photo-1610213728302-9528164e663e', 'HBcOK_gq2Z0', 'Tyler Clemmensen', 'https://unsplash.com/@tyler_clemmensen') },
  { id: 'car-4', name: 'Машина', type: 'car', hue: 'steel', photo: photo('photo-1620591687847-1e75446f131d', 'ROdIreK_960', 'Colin Lloyd', 'https://unsplash.com/@onthesearchforpineapples') },
  { id: 'home-2', name: 'Квартира', type: 'home', hue: 'ochre', photo: photo('photo-1615529182904-14819c35db37', 'YqFz7UMm8qE', 'Spacejoy', 'https://unsplash.com/@spacejoy') },
  { id: 'home-3', name: 'Квартира', type: 'home', hue: 'ochre', photo: photo('photo-1564078516393-cf04bd966897', 'rEJxpBskj3Q', 'Roberto Nickson', 'https://unsplash.com/@rpnickson') },
  { id: 'home-4', name: 'Квартира', type: 'home', hue: 'ochre', photo: photo('photo-1741156386380-0236c72eb6f9', 'bqUZEAeWuok', 'Jakub Żerdzicki', 'https://unsplash.com/@jakubzerdzicki') },
  { id: 'tech-2', name: 'Техника', type: 'tech', hue: 'indigo', photo: photo('photo-1625461291092-13d0c45608b3', 'wLqA-YZBDsY', 'Zesan H.', 'https://unsplash.com/@arianzesan') },
  { id: 'tech-3', name: 'Техника', type: 'tech', hue: 'indigo', photo: photo('photo-1505740420928-5e560c06d30e', 'PDX_a_82obo', 'C D-X', 'https://unsplash.com/@cdx2') },
  { id: 'tech-4', name: 'Техника', type: 'tech', hue: 'indigo', photo: photo('photo-1523206489230-c012c64b2b48', '6wdRuK7bVTE', 'Neil Soni', 'https://unsplash.com/@neilsoniphotography') },
  { id: 'health-2', name: 'Здоровье', type: 'health', hue: 'green', photo: photo('photo-1646239646963-b0b9be56d6b5', 'b8Q5fHBsyik', 'Samantha Sheppard', 'https://unsplash.com/@samsheppardphoto') },
  { id: 'health-3', name: 'Здоровье', type: 'health', hue: 'green', photo: photo('photo-1542291026-7eec264c27ff', '164_6wVEHfI', 'Ryan Waring', 'https://unsplash.com/@ryanwaring') },
  { id: 'health-4', name: 'Здоровье', type: 'health', hue: 'green', photo: photo('photo-1684403731883-67a71a793d2d', 'opJ-TlLYu4Q', 'Abdelrahman Sarayreh', 'https://unsplash.com/@sarayra') },
  { id: 'wedding-2', name: 'Свадьба', type: 'wedding', hue: 'plum', photo: photo('photo-1606800052052-a08af7148866', '8vaQKYnawHw', 'Sandy Millar', 'https://unsplash.com/@sandym10') },
  { id: 'wedding-3', name: 'Свадьба', type: 'wedding', hue: 'plum', photo: photo('photo-1667555150959-3e881131b9e4', 'P4WRiQJXDQs', 'Sam Lashbrooke', 'https://unsplash.com/@fotosvoneuch') },
  { id: 'wedding-4', name: 'Свадьба', type: 'wedding', hue: 'plum', photo: photo('photo-1723832348140-a2d9eb1753b1', 'TgV07XNKS54', 'Jennifer Kalenberg', 'https://unsplash.com/@jkalen71') },
  { id: 'baby-2', name: 'Ребёнок', type: 'baby', hue: 'teal', photo: photo('photo-1749703827003-8e5046941847', 'Uk4R6BHQkcc', 'Kailun Zhang', 'https://unsplash.com/@kailun2019') },
  { id: 'baby-3', name: 'Ребёнок', type: 'baby', hue: 'teal', photo: photo('photo-1594150878496-a921e5af8907', 'kWJm2a6DbAw', 'Madhuri Mohite', 'https://unsplash.com/@madhurimohite') },
  { id: 'baby-4', name: 'Ребёнок', type: 'baby', hue: 'teal', photo: photo('photo-1559454403-b8fb88521f11', 'Zzgmde4_lYU', 'kids&me Germany', 'https://unsplash.com/@kidsandme') },
  { id: 'study-2', name: 'Учёба', type: 'study', hue: 'indigo', photo: photo('photo-1524995997946-a1c2e315a42f', '2JIvboGLeho', 'Susan Q Yin', 'https://unsplash.com/@syinq') },
  { id: 'study-3', name: 'Учёба', type: 'study', hue: 'indigo', photo: photo('photo-1562774053-701939374585', 'U0dBV_QeiYk', 'Michael Marsh', 'https://unsplash.com/@mmarsh101') },
  { id: 'study-4', name: 'Учёба', type: 'study', hue: 'indigo', photo: photo('photo-1497633762265-9d179a990aa6', 'lUaaKCUANVI', 'Kimberly Farmer', 'https://unsplash.com/@kimberlyfarmer') },
  { id: 'renovation-2', name: 'Ремонт', type: 'renovation', hue: 'brick', photo: photo('photo-1562259949-e8e7689d7828', 'Cl-OpYWFFm0', 'Theme Photos', 'https://unsplash.com/@themephotos') },
  { id: 'renovation-3', name: 'Ремонт', type: 'renovation', hue: 'brick', photo: photo('photo-1645651964715-d200ce0939cc', 'EJU7A__krX0', 'benjamin lehman', 'https://unsplash.com/@abject') },
  { id: 'renovation-4', name: 'Ремонт', type: 'renovation', hue: 'brick', photo: photo('photo-1556912167-f556f1f39fdf', 'RryFk4n-vOs', 'roam in color', 'https://unsplash.com/@roamincolor') },
  { id: 'cushion-2', name: 'Подушка', type: 'cushion', hue: 'ochre', photo: photo('photo-1607863680151-1da3e60691bb', 'Dc2SRspMak4', 'Andre Taissin', 'https://unsplash.com/@andretaissin') },
  { id: 'cushion-3', name: 'Подушка', type: 'cushion', hue: 'ochre', photo: photo('photo-1633158829875-e5316a358c6f', 'joqWSI9u_XM', 'Towfiqu barbhuiya', 'https://unsplash.com/@towfiqu999999') },
  { id: 'cushion-4', name: 'Подушка', type: 'cushion', hue: 'ochre', photo: photo('photo-1582341305248-af5d85a9c0cd', '_TSHXXo52hA', 'Nik Shuliahin 💛💙', 'https://unsplash.com/@tjump') },
  { id: 'hajj-2', name: 'Хадж, Умра', type: 'hajj', hue: 'green', photo: photo('photo-1710695198971-3abdf7fcc82e', 'Cg4NDIa4iN0', 'Juned Khatri', 'https://unsplash.com/@hijunedkhatri') },
  { id: 'hajj-3', name: 'Хадж, Умра', type: 'hajj', hue: 'green', photo: photo('photo-1667456416191-43ba057635c1', 'YpMYTuKTglA', 'djonk creative', 'https://unsplash.com/@djonk_creative') },
  { id: 'hajj-4', name: 'Хадж, Умра', type: 'hajj', hue: 'green', photo: photo('photo-1771170983433-1576bc4a7eec', 'tvEDhFhBhXM', 'Rumman Amin', 'https://unsplash.com/@rumanamin') },
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

/** Фото темы для выбора (B2C-64-а): фото плитки и варианты `<тип>-N`; у «Путешествия» вместо них — направления. */
export const themePhotos = (type: GoalTemplateType): GoalTemplate[] =>
  type === 'travel' ? [] : GOAL_TEMPLATES.filter((t) => t.type === type && (t.id === type || t.id.startsWith(`${type}-`)))

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
