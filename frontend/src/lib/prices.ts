// Справочник цен образов трат (бэклог «ИИ-польза», Р-26, Р-31, AU-28) — данные, не логика: обновляются руками раз в
// квартал задачей (источник и дата — у каждой цены). Своя мечта или желание семьи с ценой — приоритетнее (`finance.ts`).

export type PriceId = 'car_used' | 'coffee_machine' | 'sea_week_two' | 'iphone' | 'laptop'

export interface Price {
  id: PriceId
  /** Как назовёт образ: «своя машина», «неделя в Анталье на двоих». */
  name: string
  /** Модель или состав мерки для «Как посчитали»: «Hyundai Accent 2015». */
  model: string
  /** Целые ₸. */
  price: number
  source: string
  url: string
  /** Когда сверено, `YYYY-MM-DD`. */
  checkedAt: string
}

export const PRICES: Record<PriceId, Price> = {
  car_used: {
    id: 'car_used', name: 'своя машина', model: 'Hyundai Accent 2015', price: 4_750_000,
    source: 'kolesa.kz, Алматы — середина 20 объявлений', url: 'https://kolesa.kz/cars/hyundai/accent/almaty/?year[from]=2015&year[to]=2015', checkedAt: '2026-10-17',
  },
  coffee_machine: {
    id: 'coffee_machine', name: 'кофемашина', model: 'Nivona CafeRomatica 555 — автомат с кофемолкой', price: 218_864,
    source: 'alfa.kz, Алматы', url: 'https://alfa.kz/household/cofevarki', checkedAt: '2026-10-17',
  },
  sea_week_two: {
    id: 'sea_week_two', name: 'неделя в Анталье на двоих', model: 'тур из Алматы, 7 ночей, двое взрослых', price: 637_000,
    source: 'markettours.kz', url: 'https://markettours.kz/tours/search-tours/turkey_almaty.html', checkedAt: '2026-10-17',
  },
  iphone: {
    id: 'iphone', name: 'iPhone 17', model: 'iPhone 17, 256 ГБ', price: 624_990,
    // Цена старта продаж (сентябрь 2025): свежее на 17.10.2026 не нашлось — дата в названии источника, чтобы «?» не выдавал её за свежую.
    source: 'Freedom Mobile, официальная цена на старте продаж, сентябрь 2025', url: 'https://bes.media/news/iphone-17-nazvana-ofitsialnaya-tsena-v-kazahstane-188442/', checkedAt: '2026-10-17',
  },
  laptop: {
    id: 'laptop', name: 'MacBook Air', model: 'MacBook Air 13″ M4, 16/256 ГБ', price: 479_900,
    source: 'alfa.kz, Алматы', url: 'https://alfa.kz/pc/notebooks/ultrabuk/apple/macbook_air_13_m4__2025_', checkedAt: '2026-10-17',
  },
}

/** Мерки «за год — это …» (доставка, обеды, покупки, проценты): от дешёвой к дорогой. */
export const MEASURES: PriceId[] = ['laptop', 'iphone', 'sea_week_two', 'car_used']

/**
 * Расход кофемашины на чашку (Р-31): зерно 10 г и молоко 150 мл. Зерно — от 10 000 ₸ за кг у обжарщика
 * (obyavleniya.kaspi.kz), в рознице дороже — берём 12 000; молоко — Алматы, июль 2026 (dairynews.today).
 */
export const COFFEE_CUP = {
  beansPerKg: 12_000, beansGrams: 10, milkPerLiter: 826, milkMl: 150,
  source: 'зерно — obyavleniya.kaspi.kz, молоко — dairynews.today (Алматы)', checkedAt: '2026-10-17',
}
