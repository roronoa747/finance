# Блок 6 — Прод-инфраструктура и cutover · сессии

**Цель блока:** перевести прод `family-finance-ff.vercel.app` с React + Supabase на Go + Vue на тех же Vercel и Supabase — с переносом семьи и паролей, без потери данных и с отрепетированным откатом.

Сессии: исполнитель ✅ · критик ✅ · приёмка ✅ · ревью backend ✅ · ревью frontend ✅ · клинап (cutover) ✅

---

## Промпт исполнителя — уровень build · Opus 5 · effort high (ultrathink)

```
/worker migrate-go-vue 6 ultrathink
```

Блок-специфика:

- **Ветка блока** `mgv-block-6-prod` от `main`. `main` не пушится до клинапа (прод на Vite
  деплоится из `origin/main`); push ветки блока (CI + preview Vercel) — с согласия владельца.
- Задачи строго по порядку: `MGV-15` → `MGV-16` → `MGV-17` → `MGV-18` → `MGV-19`.
  MGV-19 — эксплуатационная (репетиция + `CUTOVER.md`), кода почти нет.
- **Каждый шаг, пишущий в живую базу Supabase или в настройки Vercel, — только после явного
  «да» владельца в этой сессии** (Р-12): миграции `app`, `transfer forward`, env Preview.
  Production-env и `main` — не трогать вообще (это клинап).
- Секреты: строка подключения Supabase — владелец кладёт в `memory/secrets/`; `JWT_SECRET`
  генерирует агент туда же. В Handoff — только имена файлов/переменных. Pre-commit-хук
  не обходить.
- Верификация: `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` +
  PG-режим (`TEST_DATABASE_URL`, `-p 1 -run Postgres`); `cd frontend && npm run build && npm test`;
  preview-адрес в реальном браузере (десктоп + телефон).
- Риски брифа, закрыть явно в Handoff: передаёт ли Supavisor `search_path` (MGV-15 уходит от
  него квалификацией имён), собирает ли Vercel `go 1.27.0`, видит ли Go-функция исходный путь
  `/api/...` после rewrite, `lib/pq` на транзакционном пулере.

---

## Промпт критика — уровень review · Opus 5 · effort xhigh (ultracode)

```
/critic migrate-go-vue 6 ultracode
```

Блок-специфика:

- Безопасность прода: fail-fast недостижим в обход (`APP_ENV=production` без БД/с дефолтным
  секретом не стартует ни `cmd/server`, ни Vercel-функция); `/api/fx-rate` — публичный, но без
  утечек и с таймаутом; секретов нет в диффе и доках.
- Перенос (`cmd/transfer`): одна транзакция, сверка до `COMMIT`, `-dry-run` реально
  откатывает, `back` пишет только документы; отчёт без email и содержимого документов.
- Схема `app`: ни один SQL Go не обращается к `public` (кроме `cmd/transfer`); тесты PG
  зелёные.
- SW: тот же `/sw.js`/scope, `/api/` не попадает в кэш и навигационный fallback.
- Живые доки: README бэкенда (запуск `cmd/migrate`, `cmd/transfer`), `memory/STATE.md`.
- Следующего блока нет → вместо актуализации его промпта проверить, что `CUTOVER.md` готов
  для клинапа, и готовность бэклога к закрытию после cutover.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh (ultracode)

```
/accept migrate-go-vue 6 ultracode
```

Блок-специфика:

- Критерии брифа — на **preview-адресе** с копией живых данных: оба участника входят старыми
  паролями; сверка «данные целы» `app` = `public` + `rev` `private_docs`; синк двух устройств;
  PWA ставится и открывается без сети; курс валют; `transfer back -dry-run` зелёный, ID
  React-деплоя для отката записан.
- Регрессия: `go test ./...` (+ PG-режим), `npm test` (весь `frontend/e2e/`), CI `ci-backend`
  и `ci-frontend` зелёные на HEAD ветки.
- Любая запись в живую базу (например, свежая копия перед проверкой) — с согласия владельца.
- **L-блок: приёмка НЕ деплоит и прод не переключает.** Следующий шаг —
  `/dir-review migrate-go-vue 6 backend`.

---

## Промпт ревью backend — уровень review · Opus 5 · effort xhigh

```
/dir-review migrate-go-vue 6 backend
```

Блок-специфика:

- Каталог `backend/` + корневые `api/`, `go.mod` (адаптер Vercel — часть Go).
- Фокус: `server`-пакет vs `cmd/server` (нет ли дублей), пул соединений под serverless,
  `cmd/transfer` (идемпотентность, транзакция, отчёт), квалификация схемы `app`.
- От критика (решить вердиктом): `\u0000`/одиночный суррогат в `data` синка → 500 (хвост §4);
  `api/index.go` держит мьютекс на время `db.Connect` (до 5 с) и отвечает 500, а не 503, на
  непроснувшуюся базу; у `/api/fx-rate` нет отрицательного кэша — при лежащем банке каждый
  запрос ждёт до 8 с; `RunMigrations` с `MaxOpen: 1` зависнет (лок на отдельном соединении —
  сейчас вызовы с 2+).
- Следующий шаг — `/dir-review migrate-go-vue 6 frontend`.

---

## Промпт ревью frontend — уровень review · Opus 5 · effort xhigh

```
/dir-review migrate-go-vue 6 frontend
```

Блок-специфика:

- Каталог `frontend/` + `vercel.json`, `.github/workflows/ci-frontend.yml`.
- Фокус: конфиг PWA против React (манифест, иконка, `/sw.js`), fallback/denylist, `fx.ts`.
- От критика: `frontend/public/icons.svg` (шаблон Блока 2) ни на что не ссылается, но в прекэше;
  SPA-rewrite `/(.*)` отдаёт `index.html` 200 и на пропавший `/assets/*.js` (ленивых чанков
  нет — сейчас безвредно); `pwa-build.test.ts` читает корневой `public/favicon.svg` — после
  уборки React тест надо перевести на свою копию; движок синка после правок критика
  (`localEdits`/`syncRuns` в `finance.ts`).
- От приёмки: курс в форме счёта не меняется при смене валюты (`Capital.vue:190-193`, унаследовано от React) —
  хвост §4, вынести вердикт (клинап до cutover или после).
- Следующий шаг — `/cleanup migrate-go-vue 6`.

---

## Промпт клинапа (cutover) — уровень build · Opus 5 · effort high

```
/cleanup migrate-go-vue 6
```

Блок-специфика:

- Выполнить «клинап»-вердикты `REVIEW-backend.md`, `REVIEW-frontend.md`.
- **Деплой = переключение прода строго по `CUTOVER.md`**, каждая точка «стоп» — явное «да»
  владельца: окно → `transfer forward -replace` → сверка → Production-env Vercel → merge
  `mgv-block-6-prod` в `main` + push → смоук на `family-finance-ff.vercel.app` (вход обоих
  старыми паролями, данные на месте, правка видна на втором устройстве).
- **План отката:** промоут записанного Production-деплоя React в Vercel + `transfer back` +
  сверка; триггер — красный смоук или «данные не те» от владельца.
- После 🏁: хвост «Уборка старого» остаётся ⏳ (2 недели стабильной работы + «да» владельца);
  предложить владельцу закрытие бэклога по DoD, кроме этого хвоста — решение за ним.
- Обновить `memory/STATE.md` и снять запись `no-push-main-during-migration` из памяти агента
  (ограничение больше не действует).

---

## Handoff (заполняет исполнитель)

Сессия исполнителя 2026-09-24 (Opus 5.5). **MGV-15…19 ✅**: репетиция на preview пройдена с обоими
участниками; `CUTOVER.md` готов для клинапа.

- **Коммиты** (ветка `mgv-block-6-prod`, запушена; `main` не тронут):
  `2f30fea` MGV-15 · `4680541` MGV-16 · `9c43408` MGV-16 (регион) · `46219db` MGV-17 · `0acd3c1` MGV-18 ·
  `0180567` статусы §4 · `42a9471` Handoff + `CUTOVER.md` · `5fb9f3d` репетиция копии ·
  `8fbab4b` **MGV-19: автоподкачка правок партнёра во Vue** · коммит закрытия.
- **Что сделано:**
  - MGV-15: `config.Load` — fail-fast при `APP_ENV=production` (нет `DATABASE_URL`; `JWT_SECRET` пуст / дефолт / < 32).
    Схема `app` — **выбран путь квалификации имён** (`app.users` … в `000001_init.sql`, в SQL репозиториев,
    `app.schema_migrations`), от `search_path` ничего не зависит; `testdb` сбрасывает `app` и `public`.
    Хелпер `decodeJSONBody` — 413 при превышении лимита во всех 4 ручках; битый UTF-8 в `data` синка → 400
    до БД. `internal/fx` + `GET /api/fx-rate` (порт Edge Function: отступ до 7 дней, USD/EUR/RUB/CNY, кэш 1 ч,
    `Cache-Control: public, s-maxage=3600`, банк недоступен → 502, таймаут 8 с на всю цепочку).
  - MGV-16: пакет `backend/server` (`NewHandler`, `NewRouter`, `FromEnv`), `cmd/server` — тонкая обёртка;
    `api/index.go` + корневой `go.mod` (`finance-vercel`, `replace finance-backend => ./backend`);
    `vercel.json` (сборка `frontend/`, `/api/*` → функция, SPA-rewrite, `regions: icn1`); `cmd/migrate`;
    `db.Connect(url, Pool)` — `ServerPool` 25/10, `ServerlessPool` 2/2; README бэкенда; CI бэкенда
    покрывает `api/`. **Живое:** миграции `app` на Supabase применены (7 таблиц, повтор — no-op;
    `anon`/`authenticated` доступа к `app` не имеют); env **Preview** только для ветки `mgv-block-6-prod`:
    `APP_ENV` plain, `DATABASE_URL` (пулер 6543) и `JWT_SECRET` — sensitive.
  - MGV-17: `vite-plugin-pwa` во фронте — манифест, цвета, иконка как у React; `/sw.js` scope `/`,
    `autoUpdate`, `cleanupOutdatedCaches`, `navigateFallback` + denylist `/api/`; `index.html` — `lang=ru`,
    `theme-color`; `fetchRates()` → `/api/fx-rate` (ошибка → `null`); `ci-frontend.yml` (npm, Node 24).
    Проверка сборки — **юнит-тест `e2e/pwa-build.test.ts`, читающий `dist`** (в CI идёт после `build`;
    без `dist` пропускается).
  - MGV-18: `cmd/transfer forward|back [-replace|-force] [-dry-run]`: одна транзакция `REPEATABLE READ`,
    сверка до `COMMIT` — построчный `EXCEPT ALL` всех таблиц и пользователей + запрос «данные целы» +
    `rev` каждого `private_docs`; расхождение → ROLLBACK, код 1. Пользователи без email/пароля
    пропускаются с записью в отчёт. `back` пишет только `data/rev/updated_at` существующих строк.
    **Живое:** `forward -dry-run` на Supabase — всё `OK` (4 пользователя, 1 семья, 2 участника,
    казна rev 632, оба `private_docs` rev =), откачено.
- **Отклонения от ТЗ:**
  - `server.NewHandler(cfg, database)` принимает готовый пул, а не открывает его сам: `cmd/server` должен
    прогнать миграции до сборки роутера, а `api/` не может назвать тип `internal/config` — для него есть
    `server.FromEnv()`.
  - `api/index.go`: вместо `sync.Once` — мьютекс. Неудачная инициализация (БД не ответила на холодном
    старте) повторяется следующим запросом и не закрепляет инстанс в ошибке; успешная — один раз.
  - `doc_repo`: `jsonb` передаётся строкой, а не `[]byte`. С `binary_parameters=yes` `lib/pq` шлёт `[]byte`
    бинарно, и `jsonb` его отвергает (проверено: E2E на PG падал 500-ми, после правки зелёный в обоих режимах).
  - `fx`: курс делится на `<quant>` (у AMD — 10 ед.); для USD/EUR/RUB/CNY `quant=1`, результат как у Edge
    Function. Дата «сегодня» — по Алматы (UTC+5); Edge Function брала UTC.
  - `.gitignore`: снята строка `backend/server` — она прятала новый пакет (бинарник туда больше не
    соберётся: Go не пишет поверх каталога).
  - `vercel.json` `regions: ["icn1"]` — не было в ТЗ: база в Сеуле, а функция по умолчанию в `iad1`.
  - `frontend/public/favicon.svg` заменён корневым (ТЗ: иконка — от React).
  - **MGV-19 — код вне ТЗ (решение владельца «починить сейчас»):** Vue ходил к серверу только при входе,
    своей правке или по кнопке — правка партнёра не появлялась (пробел порта Блока 2, тесты не ловили).
    `frontend/src/stores/syncEngine.ts` + `main.ts`: триггеры `startSyncEngine` из React (focus,
    visibilitychange, online, раз в 60 с на видимом экране; offline → «нет сети»). При `idle` — только GET
    (ревизия не растёт от открытого экрана), иначе и на старте — полный круг со слиянием (не затирает правку
    офлайн/неотправленную). Демо и гость к серверу не ходят. Тест `syncEngine.test.ts` (5).
- **Грабли среды:**
  - Строки подключения — `memory/secrets/supabase-db.md` (`DATABASE_URL_SESSION` 5432 /
    `DATABASE_URL_POOLER` 6543), JWT Preview — `memory/secrets/vercel-jwt.md`. Пароль базы владелец
    **сбросил 2026-09-24** (старый не помнил); React не затронут — он ходит через API-ключи. Прямой
    `db.<ref>.supabase.co` — только IPv6, используется Session pooler `aws-0-ap-northeast-2`.
  - Коннектор Supabase — только чтение; запись — через свою сессионную строку.
  - Preview закрыт SSO Vercel: share-ссылка (23 ч) на алиас ветки `family-financevercela-git-4dcf56-…vercel.app`.
    Манифест браузер тянет **без cookie** → 302 на логин → на preview PWA не ставится. Та же сборка без
    защиты — 0 ошибок устанавливаемости.
  - Локальная PG — embedded PostgreSQL 16 из scratchpad (`fergusstrange/embedded-postgres`), не в репо.
  - `gofmt -l` на Windows ругается на CRLF рабочей копии; проверка по LF-версиям из git — чисто.
  - Pre-commit-хук ловит `xxxPassword = "..."` и в тестах — имя константы изменено, хук не обходился.
  - Классификатор прав Claude Code заблокировал `transfer forward -replace` как прод-действие; после явного
    «даю» владельца повтор прошёл.
  - Share-ссылка Vercel работает только на URL **конкретного деплоя**; на алиас ветки — редирект на логин.
    У кого в браузере открыт свой аккаунт Vercel (у Аруны) — 404 «logged in as…»: открывать в приватной вкладке.
    Новый деплой = новый origin → вход заново.
- **Риски брифа:**
  - `search_path`/пулер — снят: имена квалифицированы.
  - Go 1.27 на Vercel — снят: сборщик скачал `go1.27.0` и собрал функцию.
  - Путь после rewrite — снят: функция видит исходный `/api/...` (health/fx/401/404 от chi на preview).
  - `lib/pq` на 6543 — подтверждён и снят: без `binary_parameters` 141 из 320 параллельных запросов
    падают («bind message supplies N parameters…»), с `binary_parameters=yes` — 320/320. Параметр
    зашит в `DATABASE_URL_POOLER` и в `CUTOVER.md`.
- **Верификация:**
  - `cd backend && go build ./... && go vet ./... && go test -count=1 ./...` — PASS; PG-режим
    (`-p 1 -run Postgres`, embedded PG 16) — PASS, в т.ч. с `binary_parameters=yes`; `go test ./api/...` — PASS.
  - `cd frontend && npm run build && npm test` — 21 файл, 103 теста PASS (после `8fbab4b`).
  - CI: `ci-backend` ✅ (`2f30fea`, `4680541`, `0acd3c1`), `ci-frontend` ✅ (`46219db`, `8fbab4b`).
  - Локально: `APP_ENV=production go run ./cmd/server` без env → падает с понятной ошибкой; `/api/fx-rate` —
    живой курс, повтор — из кэша.
  - Preview (headless Chrome, share-cookie): `/api/health` → `db: connected`; `/api/fx-rate` → курс;
    F5 на `/`, `/capital`, `/budget/plan` → Vue; регистрация тестового пользователя → 201, затем удалён из
    `app`; тело > 1 МБ → 413; демо-режим → форма счёта в USD подставила 445.65 (Нацбанк).
  - **Замена SW** (headless Chrome, локальный стенд с заголовками как у Vercel): React-сборка, её SW
    управляет страницей → на том же origin выложена Vue-сборка → **одна ручная перезагрузка = две
    навигации**: старый SW отдал React из прекэша, его `autoUpdate` сам перезагрузил страницу → Vue.
    В прекэше только ассеты Vue; закладка `/#/capital` → Vue (без входа — `/access`).
  - **Офлайн:** вход через форму на локальном Go → сводка «700 000 ₸»; сервер и API погашены →
    перезагрузка `/` и переход на `/capital` открывают Vue с данными из `localStorage`.
  - React-прод не менялся: `family-finance-ff.vercel.app` — `#root`, `/api/health` → 404; Production-деплой
    `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` (коммит `b3e0dd9`) — кандидат на откат.
- **MGV-19 — репетиция (2026-09-24, с «да» владельца на каждый пишущий шаг):**
  - Копия: `transfer forward -replace` на живой базе — сверка всё `OK` (4 / 1 / 2 / казна rev 632 `= app` /
    оба `private_docs` rev `=`), `committed`. Откат: `transfer back -dry-run` — `OK`, откачено.
  - Вход старыми паролями (Р-15): владелец — 200 (10:35), Аруна — 200 (10:50, её IP другой) — по логам Vercel.
  - Экраны на копии: владелец подтвердил совпадение с React.
  - Синк двух устройств: правка владельца (зарплата +1) видна у Аруны; **обратная — нет** → найден пробел
    Блока 2 (см. отклонения), исправлен `8fbab4b`, повтор на новом preview — «все да» от владельца: правки в обе
    стороны появляются без нажатий; итог в `app` — rev 638.
  - Офлайн (режим полёта) — открывается с данными; курс в форме счёта — подставляется.
  - Замена SW React — на preview не проверить (другой origin), сделано локально в MGV-17; PWA-установка на
    preview закрыта SSO — проверяется в смоуке cutover (`CUTOVER.md` §5).
  - ID Production-деплоя React для отката — `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` (в `CUTOVER.md`).
  - Тестовых пользователей на preview не осталось (проба MGV-16 удалена). Данные репетиции в `app` лежат до
    финальной копии (`-replace` их сотрёт). React-прод всё время работал (в `public` за день rev 632 → 639).
  - Пользователи Supabase: 4 — двое участников семьи + 2 аккаунта без семьи и без единого входа (`mir…@gmail.com`
    с 08.09, `ily…@mail.ru` с 14.09); переносятся как есть, при входе получат 404 «семья не найдена».
- **Хвосты (не делал, правило 10):** в офлайне шапка Vue показывает «синхронизировано» — индикатор не
  знает о сети (экраны прошлых блоков, не SW). `\u0000` в `data` синка PostgreSQL `jsonb` отвергает → 500
  (тот же класс, что битый UTF-8; в ТЗ не входил).

## Итоги критика

Сессия критика 2026-09-24 (Opus 5.5, ultracode: три ревью-агента по срезам — перенос/БД,
прод-безопасность/сервер, фронт/PWA — плюс собственное чтение диффа; находки сверены с кодом).

- **Коммиты:** `42a3c19` бэкенд · `3142827` фронт · коммит доков.
- **Корректность — исправлено (с тестами, красные до правки):**
  - **Потеря правки во Vue** (движок синка MGV-19 + старый `finance.ts`): фоновый `pullHousehold`,
    вернувшийся во время синка, затирал документ копией сервера — при сбое push правка
    пропадала; правка, сделанная пока push в пути, затиралась ответом сервера (`status: idle`).
    Теперь: счётчики `localEdits`/`syncRuns` — pull не применяет устаревший ответ; правка во время
    push оставляет `dirty` с новой ревизией и уходит следующим кругом. Сбой фонового pull
    (истёкший вход) → `error`, а не «синхронизировано». Тесты: 4 сценария в `finance.test.ts`.
  - **Fail-fast в обход:** `APP_ENV` сравнивался строго (`Production`/пробел → dev-режим → моки
    с дефолтным секретом). Теперь регистр/пробелы не важны, а `server.FromEnv` (только Vercel)
    применяет прод-проверки всегда — забытый `APP_ENV` не поднимет функцию. `JWT_SECRET` из
    пробелов — отказ. Тесты: `config`, `api` (три значения `APP_ENV`).
  - **`testdb` на живой базе:** PG-тесты делают `DROP SCHEMA public CASCADE`; строка
    `TEST_DATABASE_URL` похожа на живые из `memory/secrets/`. Теперь `supabase` в строке → отказ.
  - `pwa-build.test.ts` пропускался при отсутствии `sw.js` — т.е. ровно при регрессии, которую
    ловит. Признак сборки — `index.html`.
- **Проверено и чисто:** одна транзакция `REPEATABLE READ`, сверка двусторонним `EXCEPT ALL` до
  `COMMIT` (не сравнивает таблицу саму с собой), `-dry-run` откатывает во всех путях, `back` пишет
  только `data/rev/updated_at`, отчёт без email и тел документов (кроме полей «данные целы» — по
  ТЗ); весь SQL вне `cmd/transfer` квалифицирован `app.`; 413 во всех ручках; 502 курса без
  `Cache-Control`, ошибки инициализации клиенту не утекают; SW — `/sw.js`, scope `/`, denylist
  `/api/`, регистрация есть (`registerSW.js`); `fx.ts` — любая ошибка → `null`.
- **Упрощено:** `cmd/transfer` — `queryStrings` вместо двух одинаковых циклов. Дублей `server` vs
  `cmd/server` нет.
- **Тесты добиты:** 4 гонки синка, `APP_ENV` регистр/пробелы, пустой секрет, функция без env при
  любом `APP_ENV`, удалённый пользователь Supabase в фикстуре переноса. Секции «Тесты» ТЗ
  MGV-15…18 покрыты полностью (сверено поимённо).
- **Отклонение, принятое без правки:** `back` отказывает по документам, которых нет в `public`, а
  не по пользователям/семьям (ТЗ). Эквивалентно: каждая семья Go и каждый вступивший получают
  документ, а пользователю без семьи возвращать нечего.
- **Живые доки:** README бэкенда (`APP_ENV`, защита `testdb`); `CUTOVER.md` — откат: «никто не
  правит до `back`» (иначе `back` перезапишет правку React, сверка не заметит); после
  переключения `forward` не запускать (`-replace` сотрёт правки Go).
- **Верификация:** `go build/vet/test ./...` + `./api/...` — PASS; PG-режим (embedded PG 16) с
  `binary_parameters=yes` и без — PASS (первый прогон после старта стенда один раз упал по
  таймауту миграции 30 с — флак стенда, повторы зелёные); `npm run build && npm test` — 21 файл,
  107 тестов PASS. **Браузер/preview не проверялись**: правки критика не запушены (push ветки —
  с согласия владельца) → CI на HEAD и синк двух устройств на preview — на приёмке.
- **Следующего блока нет** → готовность к клинапу: `CUTOVER.md` полон (точки ⛔, команды, откат,
  ID React-деплоя), секретов нет; бэклог закрывается после cutover, кроме хвоста «Уборка старого».
- **Хвосты в §4:** `\u0000`/суррогат → 500; офлайн-индикатор; FK-ошибка переноса при пропущенном
  пользователе с данными.

## Приёмка

Сессия приёмки 2026-09-24 (Opus 5.5, ultracode). **Вердикт: ✅ принято** (L-блок — не деплоится;
дальше каталожные ревью). Все критерии ТЗ MGV-15…19 выполнены; синк двух устройств на preview HEAD
`a83a1dc` владелец и Аруна подтвердили («всё да»). Одна находка — унаследованная от React, не возврат (ниже).

Согласия владельца в этой сессии: push ветки, оба `-dry-run` на живой базе, проверка preview вдвоём.

| Критерий | Где / чем | Итог |
|---|---|---|
| Go: `build`, `vet`, `test -count=1 ./...` + `./api/...` | локально | ✅ |
| Go PG-режим (`-p 1 -run Postgres`), DSN без и с `binary_parameters=yes` | embedded PG 16 (scratchpad) | ✅ 11 PG-тестов, 0 skip |
| Фронт: `npm ci && npm run build && npm test` (весь `e2e/` — регрессия блоков 3–5, синк двух клиентов, PWA-сборка) | локально | ✅ 22 файла, 111 тестов |
| CI `ci-backend`, `ci-frontend` на HEAD `a83a1dc` | GitHub Actions | ✅ оба |
| Preview `a83a1dc` (`dpl_5bUmxcu44AwCkAP4zZJ6KQHLWoF7`): `/api/health` → `db: connected`; `/api/fx-rate` → курс Нацбанка, CDN `HIT` (`s-maxage` Vercel срезает сам, в коде есть); F5 на `/`, `/capital`, `/budget/plan`, `/goals` → Vue; `/sw.js`, манифест `Family Finance`; тело > 1 МБ → 413; чужой вход → 401; `/api/nope` → 404 | curl с share-cookie | ✅ |
| Сверка «данные целы»: `transfer forward -replace -dry-run` на живой базе | Supabase, сессионная строка | ✅ все таблицы `OK`, `= app`, `private_docs` rev `=`, откачено (public rev 644 — React живёт) |
| Откат: `transfer back -dry-run` | Supabase | ✅ `OK`, откачено |
| ID React-деплоя для отката | Vercel `list_deployments target=production` | ✅ `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` — последний Production, `isRollbackCandidate`, = `CUTOVER.md` |
| React-прод не тронут | `family-finance-ff.vercel.app` | ✅ `#root`, `/api/health` → 404 |
| Вход старыми паролями, экраны = React, PWA офлайн, курс в форме | репетиция исполнителя (`8fbab4b`) с обоими участниками | ✅ (код входа/экранов/PWA после этого не менялся) |
| **Синк двух устройств на HEAD** (после правок критика в `finance.ts`): вход старыми паролями, экраны = React, правка в обе стороны без нажатий, одновременные разные правки, режим полёта | preview `a83a1dc`, владелец + Аруна | ✅ «всё да» |
| Курс в форме счёта | preview, владелец | ⚠️ подставляется, но только для первой выбранной валюты (ниже) |

- **Новый e2e-сценарий** `frontend/e2e/block6-sync-engine.test.ts` (4): весь путь движок → стор → `ApiClient`
  → `fetch` → сервер с ревизиями и 409 — правка партнёра приходит по `focus` без роста rev; своя
  правка при фоновом pull «в пути» не теряется и уходит вместе с правкой партнёра; истёкший вход → `error`.
  Мутационная проверка: откат защиты критика в `pullHousehold` → сценарий красный; убран слушатель
  `focus` → красный.
- **Грабли среды:** в `frontend/` висел `vite` dev-сервер прошлой сессии (держал бинарник rolldown,
  `npm ci` падал с EPERM) — остановлен. Слушатели движка на общем `window` переживают
  `resetSyncEngineForTests` — в тестах окно создавать на каждый тест.
- **Находка (не возврат):** форма нового счёта подставляет курс только в **пустое** поле
  (`frontend/src/views/Capital.vue:190-193`): выбрал EUR → 508,71, переключил на USD/RUB/CNY — остаётся
  508,71. API отдаёт курсы верно. React ведёт себя так же (`src/screens/Capital.tsx:240-243`) — порт точный,
  критерий MGV-17 выполнен. Риск: счёт в USD сохраняется по курсу EUR → неверная сумма в тенге. Хвост §4,
  передан в `/dir-review … frontend` на вердикт (кандидат в клинап до cutover: при смене валюты
  подставлять её курс, если человек не вписывал свой).
- Следующий шаг — `/dir-review migrate-go-vue 6 backend`.

## Итоги пост-приёмки (только L)

Клинап-сессия 2026-09-24 (Opus 5.5). **Прод переключён на Go + Vue**, Production `dpl_7oFLdkGH2mURZ6S4mbPjXFnEQnfx`
(`main` `1921ffb`). Отката не было.

- **Выполненные рекомендации ревью (вердикт: клинап)**:
  - backend **Н-1** (`c4b9857`): job `integration` — матрица `dsn_params: ['', '&binary_parameters=yes']`;
    CI на `0625a95` зелёный в обоих вариантах.
  - backend **Н-5** (`f983b57`): doc-комментарий `RunMigrations` — нужен пул из 2+ соединений.
  - backend **Н-6** (`f7fc4d6`): комментарий `ServerlessPool` без допущения «один запрос за раз».
  - frontend **Н-1** (`47925b7`): шрифты Onest/Golos Text в `frontend/index.html` + проверка в
    `pwa-build.test.ts` (мутационно: без правки — красный).
  - frontend **Н-2** (`6dd6dd2`): курс формы счёта следует за валютой, если не вписан руками —
    чистая `formRate` в `lib/fx.ts` + флаг `rateTouched` в `Capital.vue`; 4 теста.
  - frontend **Н-3** (`895818d`): `DEMO_TOKEN` и `isDemo` из `stores/auth.ts`.
  - frontend **Н-4** (`0625a95`): удалён `public/icons.svg`, убран `includeAssets`; прекэш 8 → 6 записей.
- **Отклонения от рекомендаций (с причиной)**:
  - frontend Н-2: тест не на форму, а на чистую функцию `formRate` — во фронте нет инфраструктуры
    DOM-тестов (только SSR-рендер), заводить её ради клинапа — новая зависимость. Интерактив проверил
    владелец на проде (смоук п.7).
  - frontend Н-4: удаление `includeAssets` дубль `favicon.svg` **не убрало** — его давали иконки
    манифеста (`includeManifestIcons` по умолчанию `true`). Добавлено `includeManifestIcons: false`
    (иконку и так берёт `globPatterns`); цель ревью достигнута.
  - frontend Н-7 (решение отдано клинапу): не закрыт — у React демо-режима не было, какой статус
    синка показывать в демо — продуктовый вопрос, а не клинап. Остаётся хвостом §4.
- **Верификация**: `npm run build` (vue-tsc + vite) ✅; `npm test` — 22 файла, 116 тестов ✅ (было 111:
  +1 шрифты, +4 `formRate`); `go build/vet/test -count=1 ./...` + `./api/...` ✅; CI `ci-backend`
  (test, integration ×2) и `ci-frontend` на `0625a95` ✅; preview `dpl_CxvvSAhgPNnervztLrjhp9oR1VaH` —
  шрифты в `index.html` ✅ (интерактив preview владелец открыть не смог — перенесён в смоук прода).
- **Cutover по `CUTOVER.md`** (каждая ⛔ — «да» владельца в сессии):
  - §0: `migrate` — «schema app is up to date»; `forward -replace -dry-run` — `OK`; React-деплой для
    отката — `dpl_AV2UGjCwhnNqmRe2HFTAr5WJ8QSV` (последний Production, `isRollbackCandidate`) = ранбук.
  - §2 финальная копия: users 4, households 1, members 2, household_docs 1, private_docs 2, invites 1 —
    все `OK`; `household_docs` public rev 655 `= app`; `private_docs` rev `=`; `result: OK — committed`.
  - §3 Production-env: `APP_ENV`, `DATABASE_URL` (пулер), `JWT_SECRET` — новый,
    `memory/secrets/vercel-jwt.md` → `PRODUCTION_JWT_SECRET`.
  - §4 merge `--no-ff` в `main` + push (`b3e0dd9..1921ffb`, вместе с 62 коммитами блоков 1–5).
  - §5 смоук: `/api/health` → `db: connected`; `/api/fx-rate` → курс Нацбанка; `/sw.js`, манифест,
    SPA-маршруты → 200; чужой вход → 401; `/api/nope` → 404; владелец на двух телефонах: PWA → Vue,
    вход старыми паролями, данные как в React, синк двух устройств, офлайн, шрифты, курс при смене
    валюты — ✅, кроме «Еда и быт» (ниже).
- **«Еда и быт» слетела на 0 (владелец ждал 100 000)** — не перенос: в `public` поле = 0 с 2026-09-20,
  копия точна. Причина — унаследованный от React (`kit.tsx` `NumFieldBlur`) коммит на каждый blur
  без изменений со свежим `updatedAt`: устройство со старым значением тапом по полю перебивает правку
  партнёра (LWW). Владелец: cutover ок, баг — хвостом §4; значение вписывает заново.
- **Наблюдение**: после копии React-клиент (ещё не обновлённый SW) дописал в `public` rev 655 → 657
  (13:07 UTC). Сверка `public` vs `app` по ключам — отличается только `categories` (правка «Еды» уже в
  Vue), т.е. записи React были пустыми ревизиями полного синка, данные не потеряны. В ранбук на
  будущее: окно закрывать только после обновления SW на обоих устройствах.
- **Хвосты §4**: backend Н-2 (` ` → 400) — уже был; frontend Н-5 → к «Уборке старого»;
  frontend Н-6 (`pullHousehold` после повторного входа), Н-7 (демо ходит на сервер), баг поля
  «Еда и быт» — новые строки.
- **`transfer forward` больше не запускать** — `-replace` сотрёт всё, что сделано в Go.

