# PN-11 — Демо, e2e и доки Блока 3 (фронт)

Блок 3 · MVP · Репо/каталог: `frontend/src/lib/demo.ts`, `frontend/e2e/`, `DESIGN.md`, `memory/` · Зависит от: PN-10 · Роли: —

## Контекст (что уже есть)

- Демо — `lib/demo.ts`: цели `g-trip` (japan), `g-car`, `g-pot` «Подушка», `g-reserve` «Запас», `g-sofa` «Новый диван»
  (:236-253, на паузе); картинки демо — `assets/demo/*.jpg` с id `demo:<имя>` (`lib/photos/store.ts`), байты из бандла;
  `template` цели — id шаблона (у дивана — свой демо-файл `sofa`).
- e2e — `frontend/e2e/*.test.ts`, образец — `e2e/b2c-block12-week-personal.test.ts` (фото по ссылке у желаний через
  заглушку клиента), `e2e/support/family.ts`.
- Гварды: `views/Access.demo.dom.test.ts` (состав демо), `views/Dreams.test.ts:53` (`WEEKLY` — чего нет на «Мечтах»).

## Задача

1. Демо: «Новый диван» → `template: 'furniture'` (новая тема видна в демо; картинка остаётся демо-файлом `sofa`);
   одно движение месяца у героя «Поездка в Японию», чтобы под героем была строка «ближе на N дней» (если демо ещё не
   даёт). `Access.demo.dom.test.ts` — ожидания.
2. e2e `frontend/e2e/pn-block3-dreams.test.ts`: (а) 19 тем, у новых — 5 фото, выбор новой темы → `attachTemplate` →
   `photoId` и `photoCredit`; (б) фото по ссылке: заглушка `linkPreview` → у цели `photoId`, `template: null`,
   `photoCredit: null`; (в) «ближе на N дней»: взнос → тост с числом по `closerDays`, SSR «Мечт» — строка героя;
   (г) второй телефон после синка видит фото и строку; (д) `storyText('wallpaper')` без сумм (Node).
3. Снимки «до | после» (PhotoPicker с 19 плитками и «По ссылке», герой со строкой, лист истории с «обоями») обе темы
   → артефакт для `/ux` и приёмки (Р-41).
4. Доки: `DESIGN.md` §5 (`PhotoPicker`), §7 (обои), экран «Мечты» (строка героя); §6 бэклога «После Блока 3»
   (функции `goalPace`/`closerDays`, `LinkPhotoField`, `StoryKind wallpaper`, 19 тем).

## Тесты

- e2e п. 2; гвард демо.

## Критерии приёмки

- `cd frontend && npm run build && npx vitest run` зелёные (весь набор); артефакт со снимками.

## Вне скоупа

- Деплой — приёмка. Новые демо-картинки в бандл — нет.
