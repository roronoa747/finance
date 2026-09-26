# B2C-17 — Фото на телефоне и шаблоны целей (фронт; бывший RP-16 + Р-9, Р-28)

Блок 3 · MVP · Каталог: `frontend/src/lib/photos/` (новый), `lib/goalTemplates.ts`, `api/client.ts`, `types/finance.ts`, `components/` · Зависит от: B2C-16 · Роли: member (загрузка), все (показ)

## Контекст (что уже есть)

- Р-9 (фото ~100 КБ webp, в документе только id; добавить цель офлайн можно, фото — с сетью),
  Р-28 (шаблоны: список в коде, картинка Unsplash скачивается на телефон при выборе, сжимается и
  загружается как своё фото; автор сохраняется и показывается; офлайн — шаблон без картинки).
  `DESIGN.md` §5 (герой, плитка шаблона), §6 (названия шаблонов).
- Ручки B2C-16: `POST /api/photos?hidden=`, `GET /api/photos/{id}`, `DELETE`. `api/client.ts`:
  токен в `Authorization` — `<img src>` его не несёт → картинку получать `fetch` с заголовком и
  показывать через `URL.createObjectURL` (токен в URL не класть).
- `Goal` (`types/finance.ts`): `id, name, need, seed, have, monthly, hue, planPct, movements,
  accountId?` + `Tracked`; `WishItem`: `id, name, price, by, addedOn, url?, bought, boughtOn?`.
  Действия стора: `addGoal`, `updateGoal`, `addWish`, `updateWish`, `removeWish`, `toggleBought`.
- PWA: `navigateFallbackDenylist: [/^\/api\//]` — ответы `/api` в кэш SW не попадают. Тесты —
  Node без DOM: canvas / `createImageBitmap` недоступны — логика подбора размера/качества
  выносится в чистую функцию.
- Unsplash: статические ссылки `https://images.unsplash.com/photo-<id>?w=1200&q=80` открываются
  без ключа; лицензия требует указания автора и ссылки на профиль. Если скачивание с телефона
  упрётся в CORS/hotlink — запасной путь: в сборку кладутся **пять** маленьких картинок типов
  (webp ≤ 40 КБ каждая, с автором) — решение и причина в Handoff.

## Задача

1. `lib/photos/compress.ts`: картинка (файл/`Blob`) → webp ~100 КБ (длинная сторона ≤ 1600,
   качество подбирается до целевого размера; нет webp на выходе — jpeg); `pickQuality(sizeBytes,
   target)` — чистая функция с тестами; параметры — константы с комментарием.
2. `lib/photos/store.ts`: `uploadPhoto(blob, { hidden })` → id; `photoUrl(id)` → object URL с
   кэшем в памяти на сессию и освобождением; `deletePhoto(id)`; 404/нет сети → `null` (заглушка
   без стоковых картинок). Методы клиента — в `api/client.ts`.
3. Модель: `Goal.photoId?`, `Goal.photoCredit?: { author: string; url: string } | null`,
   `Goal.template?: string`; `WishItem.photoId?`. Стор: `setGoalPhoto(id, photoId | null,
   credit?)`, `setWishPhoto`.
4. `lib/goalTemplates.ts` (данные): пять типов (машина, квартира, путешествие, техника,
   здоровье) и 8–12 направлений (Япония, Турция, Дубай, Грузия, Бали, Париж, Алматы-горы, …) —
   `{ id, name, type, photo: { unsplashId, author, authorUrl }, hue }`. `templateImageUrl(t,
   width)`.
5. Выбор шаблона (компонент плитки B2C-12 + окно выбора): с сетью — скачать картинку →
   `compress` → `uploadPhoto` → `photoId` + `photoCredit`; без сети — цель с `template` и
   `hue`, подпись «картинка появится при сети», дозагрузка при следующем открытии с сетью.
   Своё фото — камера/галерея → тот же путь без `credit`. Подпись автора — на экране цели
   (маленькая, «Фото: <автор> / Unsplash», ссылка).
6. Показ: герой (B2C-14), экран цели, плитки — через `photoUrl`; замена/удаление фото.

## Тесты

- `compress.test.ts`: `pickQuality`; выбор формата.
- `store.test.ts` (фейковый `fetch`): загрузка шлёт байты с типом и токеном; кэш URL —
  повторный запрос не идёт; 404 → `null`; освобождение.
- Стор: `setGoalPhoto`, офлайн-шаблон без `photoId`, дозагрузка.
- `goalTemplates.test.ts`: у каждого шаблона есть автор и ссылка; id уникальны.

## Критерии приёмки

- Браузер (стенд с Postgres, 390px, два профиля): цель из шаблона «Япония» — картинка
  загрузилась (≤ ~150 КБ на сервере), видна партнёру; своё фото из галереи; офлайн — цель без
  картинки, после сети — появилась; подпись автора.
- `cd frontend && npm run build && npm test` зелёные.

## Вне скоупа

- Экраны целей, списки, подарки — B2C-18. Сторис — B2C-20. Советы/цены в шаблонах — не-скоуп.
