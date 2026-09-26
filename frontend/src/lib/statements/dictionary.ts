import type { OperationKind, SpendCategory } from './types'

// Стартовый словарь (Р-22) — данные, не логика. Семья правит названия и цвета разделов
// у себя в документе (`spendCategories`), а продавцов учит правилами (`merchantRules`).

export const UNKNOWN_CATEGORY = '_unknown'

export const DEFAULT_SPEND_CATEGORIES: Omit<SpendCategory, 'updatedAt'>[] = [
  { id: 'sc_food', name: 'Продукты', hue: 'green', order: 1 },
  { id: 'sc_cafe', name: 'Кафе и рестораны', hue: 'ochre', order: 2 },
  { id: 'sc_transport', name: 'Транспорт', hue: 'blue', order: 3 },
  { id: 'sc_telecom', name: 'Связь и интернет', hue: 'steel', order: 4 },
  { id: 'sc_subscriptions', name: 'Подписки', hue: 'indigo', order: 5 },
  { id: 'sc_health', name: 'Здоровье и аптеки', hue: 'teal', order: 6 },
  { id: 'sc_home', name: 'Дом и быт', hue: 'brick', order: 7 },
  { id: 'sc_shopping', name: 'Одежда и покупки', hue: 'plum', order: 8 },
  { id: 'sc_fun', name: 'Развлечения', hue: 'ochre', order: 9 },
  { id: 'sc_people', name: 'Переводы людям', hue: 'teal', order: 10 },
  { id: 'sc_credit', name: 'Кредиты и рассрочки', hue: 'brick', order: 11 },
  { id: 'sc_utilities', name: 'Коммуналка', hue: 'steel', order: 12 },
  { id: 'sc_education', name: 'Образование', hue: 'indigo', order: 13 },
  { id: 'sc_travel', name: 'Путешествия', hue: 'blue', order: 14 },
  { id: 'sc_cash', name: 'Наличные', hue: 'green', order: 15 },
  { id: 'sc_fees', name: 'Комиссии', hue: 'plum', order: 16 },
  { id: 'sc_other', name: 'Прочее', hue: 'steel', order: 17 },
]

/** Вид операции сам говорит о разделе — продавец не нужен. */
export const KIND_CATEGORY: Partial<Record<OperationKind, string>> = {
  cash: 'sc_cash',
  fee: 'sc_fees',
}

/**
 * Слова названия целиком (граница — не буква и не цифра: `\b` в JS кириллицу не видит);
 * `*` в конце — «слово начинается с». Фраза из нескольких слов — через пробел.
 */
function words(...list: string[]): RegExp {
  const parts = list.map((w) => {
    const prefix = w.endsWith('*')
    const body = (prefix ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `(?<![\\p{L}\\p{N}])${body}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`
  })
  return new RegExp(parts.join('|'), 'u')
}

/**
 * «Слово в названии → раздел». Проверяется по `normalizeMerchant` (нижний регистр, без
 * точек, кавычек, правовой формы, города и страны); первое совпадение побеждает —
 * частное выше общего.
 */
export const DICTIONARY: { test: RegExp; categoryId: string }[] = [
  // Сервисы Яндекса и доставка — раньше общих слов.
  { test: words('yandex eda', 'яндекс еда', 'wolt', 'wolt com', 'glovo', 'chocofood'), categoryId: 'sc_cafe' },
  { test: words('yandex lavka', 'яндекс лавка', 'arbuz', 'арбуз'), categoryId: 'sc_food' },
  { test: words('yandex plus', 'яндекс плюс', 'kinopoisk', 'кинопоиск'), categoryId: 'sc_subscriptions' },
  { test: words('yandex go', 'яндекс go', 'yandex taxi', 'indrive', 'uber', 'taxi', 'такси'), categoryId: 'sc_transport' },
  { test: words('kaspi кредита', 'kaspi кредит', 'kaspi red', 'рассрочк*', 'кредит*', 'home credit', 'погашени*'), categoryId: 'sc_credit' },
  { test: words('beeline', 'билайн', 'kcell', 'activ', 'tele2', 'altel', 'izi', 'kazakhtelecom', 'казахтелеком', 'интернет'), categoryId: 'sc_telecom' },
  { test: words('netflix', 'netflix com', 'spotify', 'apple com', 'icloud', 'google one', 'google cloud', 'youtube', 'ivi', 'okko', 'megogo', 'openai', 'chatgpt', 'supabase', 'airalo'), categoryId: 'sc_subscriptions' },
  { test: words('yandex delivery', 'яндекс доставка'), categoryId: 'sc_shopping' },
  { test: words('magnum', 'магнум', 'small', 'смолл', 'galmart', 'orken', 'оркен', 'anvar', 'ramstore', 'metro', 'toimart', 'supermarket', 'супермаркет', 'minimarket', 'минимаркет', 'm mart', 'продукты', 'живая вода'), categoryId: 'sc_food' },
  { test: words('coffee', 'кофе', 'kofeynya', 'кофейня', 'espresso', 'cafe', 'кафе', 'restoran', 'ресторан', 'kfc', 'mcdonalds', 'burger king', 'popeyes', 'starbucks', 'dodo pizza', 'pizza', 'пицц*', 'sushi', 'суши', 'shawarma', 'шаурм*', 'askhana', 'асхана', 'canteen', 'столов*'), categoryId: 'sc_cafe' },
  { test: words('onay', 'avtobys', 'lrt', 'автобус', 'проезд*', 'parking', 'парковк*', 'паркинг', 'azs', 'азс', 'helios', 'sinooil', 'qazaq oil', 'gazprom', 'kmg'), categoryId: 'sc_transport' },
  { test: words('aviata', 'air astana', 'flyarystan', 'scat', 'hotel', 'hote', 'отель', 'booking', 'airbnb', 'chocotravel', 'temir zholy'), categoryId: 'sc_travel' },
  { test: words('apteka', 'аптек*', 'pharmacy', 'biosfera', 'europharma', 'sadykhan', 'клиник*', 'clinic', 'стомат*', 'dental', 'invitro', 'olymp'), categoryId: 'sc_health' },
  { test: words('leroy merlin', 'ikea', 'hoff', 'jysk', 'home style', 'fix price', 'хозтовар*'), categoryId: 'sc_home' },
  { test: words('kaspi magazin', 'wildberries', 'ozon', 'lamoda', 'zara', 'lc waikiki', 'sportmaster', 'adidas', 'nike', 'technodom', 'sulpak', 'mechta', 'xiaomi', 'dns', 'alser', 'flowwow'), categoryId: 'sc_shopping' },
  { test: words('steam', 'steamgames com', 'playstation', 'kinopark', 'chaplin', 'cinema', 'кино', 'fitness', 'gym', 'бассейн'), categoryId: 'sc_fun' },
  { test: words('коммунал*', 'ерц', 'erc', 'алсеко', 'alseco', 'энерго*', 'energo', 'водоканал', 'kaztransgaz', 'оси', 'osi'), categoryId: 'sc_utilities' },
  { test: words('школ*', 'school', 'университет', 'university', 'udemy', 'coursera', 'skillbox', 'детский сад'), categoryId: 'sc_education' },
  // Наличные и комиссии по названию — если банк отдал их обычной строкой.
  { test: words('банкомат', 'atm'), categoryId: 'sc_cash' },
  { test: words('комисси*'), categoryId: 'sc_fees' },
  // Запасное (замер B2C-08): «… MARKET», «MAGAZIN …» в Казахстане — почти всегда продукты
  // у дома. Последним — частные записи выше (Kaspi Magazin — покупки) побеждают.
  { test: words('market', 'маркет', 'magazin', 'магазин'), categoryId: 'sc_food' },
]
