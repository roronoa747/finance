# Блок 1 — Фундамент · сессии

**Цель блока:** у сервера есть клиент Claude, флаг ИИ у семьи, счётчик и лимит, а у владельца — список семей с
переключателем и расходом в админке; человек один раз даёт согласие (или выключает в настройках), политика честно
называет Claude. Функций ИИ ещё нет — блок готовит всё, на что опираются Блоки 2–4.

Сессии: исполнитель ✅ · критик ⬜ · ux ⬜ · приёмка ⬜ · ревью backend ⬜ · ревью frontend ⬜ · клинап ⬜

---

## Промпт исполнителя — уровень build · Opus 5.5 · effort high (ultrathink — L-блок)

```
/worker ИИ 1 ultrathink
```

Блок-специфика:

- Ветка `ai-block-1-foundation` от `main`. Push — с согласия владельца; прод не трогать (деплой — клинап).
- Задачи по порядку: AI-01 (**сначала** проверка платформы по документации — стоп и вопрос владельцу, если API
  недоступен из Кореи) → AI-02 → AI-03 → AI-04 → AI-05 → AI-06.
- Ключ: если владелец ещё не создал — работать на фейковом Claude (`httptest`), живой тест AI-01 пропустить и
  записать в Handoff; шаги владельцу (console.anthropic.com → API Keys → значение в `memory/secrets/anthropic.md`) — в
  финальном сообщении. В доки — только имя `ANTHROPIC_API_KEY`.
- Новая зависимость Go SDK — в **оба** `go.mod` (§6). Других библиотек не вводить.
- Стенд: Go с локальной БД (PG-тесты и миграция 000007 — `TEST_DATABASE_URL`, без Docker — initdb + lib/pq, см. память
  проекта) или моки Go на :8080; Vue на :5174. Браузер — 390 px обе темы: админка, настройки, лист согласия.
- Handoff по правилу 12 CLAUDE.md для админки, карточки «ИИ» и листа согласия.
- Следующий шаг — `/critic ИИ 1 ultracode`.

---

## Промпт критика — уровень review · Opus 5.5 · effort xhigh (ultracode — L-блок)

```
/critic ИИ 1 ultracode
```

Блок-специфика:

- Целенаправленно: ключ и содержимое запросов нигде не логируются и не в git (grep по диффу, логгер chi не пишет
  тела); прод без ключа валиден, все ИИ-пути → «выключено»; тест фиксирует состав исходящего тела клиента; не-админ
  получает 404 на всех админ-ручках; `ai_usage` каскадно удаляется с семьёй; месяц по Алматы; `ai-check` не пишет
  расход; согласие — в личном документе, не в общем.
- Упрощение: админ-проверка не размножилась по хендлерам; клиент `internal/ai` в стиле `fx`/`googleauth`.
- Доки: `backend/README.md` (env, раздел «ИИ»), DESIGN.md (`/settings`, `/admin`), §6 индекса — строка «После Блока 1».
- Актуализировать промпт исполнителя Блока 2 (факты: имена пакета/методов клиента, гейт, `stores/ai.ts`).
- Следующий шаг — `/ux ИИ 1`.

---

## Промпт `/ux` — уровень review · Opus 5.5 · effort xhigh

```
/ux ИИ 1
```

Блок-специфика:

- Экраны: `/admin` раздел «Семьи» (админ), `/settings` карточка «ИИ» (member семьи с ИИ), лист согласия (вызвать
  `ensureConsent` с консоли стенда); viewer и семья без ИИ — ничего нет. 390 px, обе темы.
- Тексты листа и карточки (Р-9) — финальные слова утверждает владелец артефактом «до | после»; механики
  («API», «токены») в тексте нет.
- Следующий шаг — `/accept ИИ 1 ultracode`.

---

## Промпт приёмки — уровень review · Opus 5.5 · effort xhigh (ultracode — L-блок)

```
/accept ИИ 1 ultracode
```

Блок-специфика:

- Реальная среда: Go с БД + Vue; миграция 000007 на копии схемы; админ включает ИИ семье → `/auth/me` у участника
  `ai: true`, у viewer карточки нет; лимит и расход видны (подставить строку `ai_usage` SQL-ом); «Проверить связь» с
  ключом — живой ответ (если ключа нет — зафиксировать, проверка уходит в смоук клинапа).
- Регрессия: весь `frontend/e2e/` + `npx vitest run`; `go test ./...` + PG-тесты; CI ветки зелёный.
- **L-блок: приёмка НЕ деплоит.** Следующий шаг — `/dir-review ИИ 1 backend`.

---

## Промпт ревью backend — уровень review · Opus 5.5 · effort xhigh

```
/dir-review ИИ 1 backend
```

- Каталог `backend/` (+ корневой `go.mod`, `vercel.json`): пакет `ai` рядом с `fx`/`googleauth`/`linkpreview`,
  таймауты против лимита функции, ретраи SDK, ошибки без содержимого, SQL списка семей, миграция и откат.
- Следующий шаг — `/dir-review ИИ 1 frontend`.

## Промпт ревью frontend — уровень review · Opus 5.5 · effort xhigh

```
/dir-review ИИ 1 frontend
```

- Каталог `frontend/`: `stores/ai.ts` и лист согласия (один экземпляр в оболочке), правило слияния `aiConsent`,
  админка на ките, токены цвета, дубли с существующими листами/тумблерами.
- Следующий шаг — `/cleanup ИИ 1`.

## Промпт клинапа — уровень build · Opus 5.5 · effort high

```
/cleanup ИИ 1
```

- Клинап-вердикты обоих ревью. **Деплой — с «да» владельца** (вопрос перечисляет, что уходит на прод, и откат):
  1. владелец кладёт `ANTHROPIC_API_KEY` в env Vercel (Production) — агент даёт шаги; без ключа деплой тоже можно, ИИ
     просто выключен;
  2. **прод-миграция 000007 — владелец** по готовой команде `cmd/migrate` (секрет прод-БД агенту не читать);
  3. merge `--no-ff` в `main` → push → Production; после — логи Vercel (нет 500).
- Смоук прода: админ `/admin` — список семей, включить ИИ семье владельца, «Проверить связь» (живой ответ **из
  `icn1`** — закрывает проверку Р-2); у участника `/auth/me` → `ai: true`, карточка «ИИ» в настройках; у семьи без
  флага — ничего.
- **Откат:** promote предыдущего Production (id — перечитать перед деплоем); убрать ключ из env — ИИ выключен везде;
  миграция обратима `DROP TABLE app.ai_usage; ALTER TABLE app.households DROP COLUMN ai_enabled;` (только если
  откатываем код).
- **Шаги владельцу (исполнитель, AI-06):** (1) console.anthropic.com → API Keys → создать ключ → значение в
  `memory/secrets/anthropic.md` (вне git) и в Vercel → Project → Settings → Environment Variables → `ANTHROPIC_API_KEY`,
  окружение **Production**; (2) там же в консоли Anthropic — Limits → месячный потолок расхода (общий для всех семей,
  Р-8); (3) прод-миграция 000007 — `cmd/migrate` по прямому подключению (порт 5432), команду даёт клинап.
- **Первый деплой с `functions` в `vercel.json`** (AI-01): проверить, что сборка Vercel приняла `api/index.go` с
  `maxDuration: 60` (Preview до Production, если владелец разрешит push ветки).
- 🏁 блока в §4, строка в `memory/STATE.md`. Следующий шаг — `/worker ИИ 2 ultrathink`.

---

## Handoff (заполняет исполнитель)

Исполнитель 2026-10-15, ветка `ai-block-1-foundation` от `main` `e1f4aeb`, не запушена.

- **Коммиты:** `c29583e` AI-01 · `6874668` AI-02 · `bc89666` AI-03 · `dc1e9c1` AI-04 · `df28b19` AI-05 · `5a6bf8e` AI-02
  (тест миграций 13 → 14 таблиц) · `f20af12` AI-06 · + коммит Handoff.
- **Проверка платформы (AI-01 п. 1, 2026-10-15, живые источники):**
  - API из Южной Кореи — **доступен**: «South Korea» в списке https://www.anthropic.com/supported-countries (список
    покрывает «our API and developer platform»).
  - Обучение — «By default, we will not use your inputs or outputs from our commercial products»
    (https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training); хранение по умолчанию — 30 дней
    (https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data).
  - Модели (https://platform.claude.com/docs/en/about-claude/models/overview): `claude-opus-5-5`, `claude-haiku-5-5`
    существуют, зрение — у всех текущих; structured outputs (`output_config.format`) — обе в списке
    (https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Цены
    (https://platform.claude.com/docs/en/about-claude/pricing): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50
    (до 100K промпта; выше — $0.50/$2.50) — совпало с ТЗ.
  - Vercel: с Fluid — дефолт и максимум 300 с (Hobby), 300/800 с (Pro) (https://vercel.com/docs/functions/limitations);
    **Go в списке рантаймов Fluid не назван** (https://vercel.com/docs/fluid-compute), а KB о таймаутах его называет;
    без Fluid Hobby был ≤ 60 с (changelog 2024-05-09). Тариф через MCP не виден (`get_project`/`get_team` без плана).
    **Решение:** явно `functions: {"api/index.go": {"maxDuration": 60}}` — допустимо на любом тарифе и в любом режиме;
    клиент — один дедлайн 45 с на весь вызов, запас 15 с.
- **Что сделано:**
  - AI-01 — пакет `internal/ai`: `New(key, baseURL)` (без ключа `nil`), `Call(ctx, Request, &out) (Usage, error)`,
    `Request{Model, System, Text, Image{MediaType, Data}, Schema, Effort, MaxTokens}`, ошибки `ErrRateLimited` /
    `ErrRefused` / `ErrFailed`; `CostMicros(Usage)` по таблице `price.go`. Конфиг: `AnthropicAPIKey`, `AIModelReview` /
    `Sellers` / `Wish`, `AIMonthlyLimit` (не в `ValidateProduction`). SDK `github.com/anthropics/anthropic-sdk-go` v1.81.0.
  - AI-02 — миграция `000007_ai.sql`; `repository.AIRepository` (`Enabled`, `SetEnabled`, `Used`, `AddUsage`, `Families`)
    + `MockAIRepo(households, users)`; `ai.MonthKey`, `ai.LimitReached`; `Repos.AI`; `/auth/me` → `ai`
    (`handlers.AIFlags`, nil без ключа); фронт `MeResponse.ai`, `authStore.ai`.
  - AI-03 — `handlers.AdminAIHandler`: `GET /api/admin/families`, `PUT /api/admin/families/{id}/ai`,
    `POST /api/admin/ai-check`; админ-проверка — общий `adminOnly` (и у `Metrics`).
  - AI-04 — `Admin.vue` раздел «Семьи»; `apiClient.adminFamilies / setFamilyAi / aiCheck`; `lib/money.usdFromMicros`.
  - AI-05 — `stores/ai.ts` (`available`, `consent`, `setConsent`, `ensureConsent`, `answer`, `sheetOpen`);
    `components/ai/AiConsentSheet.vue` (один, в `AppShell`); карточка «ИИ» в `Settings.vue`; `Privacy.vue`.
  - AI-06 — `e2e/ai-block1-foundation.test.ts`; доки: `backend/README.md` (env, раздел «ИИ»), DESIGN.md (`/settings`,
    `/admin`, §6).
- **Правило 12 по экранам:**
  - `/admin` «Семьи»: главное действие — тумблер ИИ **у каждой семьи** (в её строке); второстепенное — тихая «Проверить
    связь» (`ghost sm`) в шапке раздела. В подсказке: лимит на семью и потолок в консоли Anthropic; причина «Нет связи».
    Скрыто: расход у семей без ИИ и без трат; метрики ниже — как были.
  - Настройки, карточка «ИИ»: действие — тумблер «Помощник» у своего предмета; одна строка «Без имён · Anthropic»,
    три пункта «что уходит» — в «?». Видна только участнику семьи с ИИ.
  - Лист согласия: одна брендовая «Включить» во всю ширину (подтверждение в листе), «Не надо» — `ghost`; три строки с
    иконками, куда — одной строкой, подробности — ссылкой «Подробнее» → `/privacy`.
- **Отклонения от ТЗ:**
  - AI-01: таймаут — **один дедлайн контекста 45 с на весь вызов**, а не `WithRequestTimeout` на попытку: в SDK таймаут
    — на каждую попытку, с ретраем вызов мог бы идти 90 с > `maxDuration`.
  - AI-01: SDK попал в корневой `go.mod` коммитом AI-02 (`go mod tidy` держит только то, что импортирует `api/`; сервер
    стал импортировать `internal/ai` в AI-02).
  - AI-02: мок `MockAIRepo` — рядом с SQL в `ai_repo.go` (как `MockEventRepo` в `events_repo.go`), не в `mock_repo.go`.
    `AI_MONTHLY_LIMIT` ≤ 0 / не число → 30 — разбор в `config.positiveInt` (AI-01), не в репозитории.
  - AI-02: ошибка чтения флага в `/auth/me` → `ai: false` + лог, `/me` не падает (в ТЗ не сказано).
  - AI-03: `ai-check` — `max_tokens` 1024 (не «малый» в десятки): у Haiku 5.5 адаптивное мышление включено, малый
    потолок мог съесться мышлением → `max_tokens` → «failed»; платится только реальный вывод. PUT без `on` → 400.
  - AI-04: типы — в `types/api.ts` (как в ТЗ), хотя `AdminMetrics` живёт в `api/client.ts`. `usdFromMicros` не знает
    модель — «≈ —» для неизвестной модели (Р-14) не показывается (в ответе нет модели; расход такой модели = 0 → «$0»).
  - AI-05: `newerObject` получил необязательный параметр «поле времени» — `aiConsent` сливается по `at` (как в ТЗ), а не
    по `updatedAt`; прежние вызовы не менялись. Тип — `AiConsent` в `types/finance.ts`. `ensureConsent` без доступа →
    `false` без листа; повторный вызов при открытом листе ждёт тот же ответ; ушли с экрана с открытым листом → «нет».
- **Грабли среды:**
  - `python` висит (известно) — правки только Edit/node; `node -e` с CRLF-файлами — замены промахиваются, Edit надёжнее.
  - `cd X && cmd &` в Bash уводит `cd` в фоновую подоболочку — пути к бинарникам стенда только полные.
  - Первый прогон PG-тестов на свежем кластере: `TestPostgresMigrationsLiveInAppSchema` — таймаут 30 с на 000002,
    повтор — 1,5 с (медленный старт, не код).
  - `cmd/migrate` тест держит жёсткое число таблиц — при новой миграции +1 (пропустил в AI-02, нашёл в регрессии).
  - Стенд живёт между прогонами браузера — сценарий не должен ждать «не спрошено» на старте (согласие осталось с
    прошлого прогона); скрипт читает стартовое состояние с сервера.
  - На `/` у пустой семьи — экран первого запуска вне оболочки: стор `ai` там не создан; лист согласия — с `/settings`.
  - Стенд: Postgres 16 из `~/.embedded-postgres-go` (initdb в scratchpad, порт 54397), база `stand` отдельно от
    тестовой (PG-тесты стирают свою); SQL — свой `sqlrun.exe` (lib/pq); viewer — SQL-переносом членства.
- **Верификация:**
  - Go: `cd backend && go build ./... && go vet ./... && go test ./...` ✅; PG `go test -p 1 -count=1 -run Postgres ./...`
    ✅ (вкл. `TestPostgresAIFlagAndUsage`, `TestPostgresAIFamilies`, каскад `ai_usage`); корень `go vet ./api/... &&
    go test ./api/...` ✅. Живой тест `TestLiveCall` — ✅ (владелец положил ключ в
    `memory/secrets/anthropic.md` после Handoff; `AI_LIVE=1`, Haiku 5.5, 2,6 с); живой `POST /api/admin/ai-check` через
    `cmd/server` (моки) → `{ok: true, model: claude-haiku-5-5, ms: 1602}`, ключа в логе сервера нет. Ключ — рабочая
    область по умолчанию, без срока; кредиты API — $100 из плана Max владельца. Проверка **из `icn1`** — смоук клинапа.
  - Фронт: `npm run build` ✅, `npx vitest run` — **210 файлов, 2112 ✅ + 1 skip** (вместе с `e2e/`).
  - Миграция 000007: на чистой базе (PG-тесты) и на **существующей** — сервер из `main` (миграции 1–6) + семья →
    новый сервер накатил 000007, `ai_enabled = false`; с ключом и флагом `/auth/me` → `ai: true`, без ключа — `false`.
  - curl `cmd/server` + БД: список семей, PUT, `ai-check` без ключа → `no_key`, без токена 401; лог chi — только метод,
    путь, статус.
  - Браузер (Chrome 390 px, Go+Postgres :8080, Vue :5174): админка **10/10** (обе темы, переключение держится после
    перезагрузки и поднимает семью наверх, расход «7 запросов · ≈ $0.42», «Проверить связь» с фальшивым ключом →
    «Нет связи» + причина в «?», не-админ — «Нет такой страницы»); согласие **16/16** (карточка у участника, тумблер с
    сервера, перезагрузка держит, согласие в личном документе и не в общем, второй телефон того же человека — «вкл»,
    «?» с тремя пунктами, лист в обеих темах — «Включить» / «Не надо», семья без ИИ и viewer — карточки нет, ошибок
    консоли нет).
  - CI ветки — **не запущен**: ветка не запушена (push — с согласия владельца).

## Итоги критика

## Итоги `/ux`

## Приёмка

## Итоги пост-приёмки
