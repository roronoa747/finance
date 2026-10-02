# B2C-65 — Go: ручка «фото по ссылке» `POST /api/photos/preview` (бэкенд)

Блок 12 · MVP · Репо/каталог: `backend/` (+ корневой `go.mod`) · Зависит от: — · Роли: только member

## Контекст (что уже есть)

- Р-60, Р-69: сервер открывает страницу товара и берёт главную картинку и название; цену вводит пользователь;
  только `https`, запрет внутренних адресов (SSRF), таймауты, лимиты; картинка дальше проходит сжатие на клиенте и
  обычную загрузку в `app.photos` (B2C-66). Ревью `backend`.
- Роутер — `NewRouter(cfg, database, repos, tokenService, fxClient)` (`backend/server/server.go` ~88), защищённая группа
  с `auth.Middleware` ~125, фото — `POST /api/photos`, `GET/DELETE /api/photos/{id}` ~144–146
  (`internal/handlers/photos.go`, `NewPhotoHandler`, лимит 512 КБ, только webp/jpeg с проверкой сигнатуры).
- Роль — `member(w, r)` (`internal/handlers/statements.go` ~74: не member → 403 «forbidden: only members can change
  data»), ответы — `respondJSON` (`handlers/auth.go` ~198), `errorJSON` (`statements.go` ~69).
- Единственный внешний клиент — `internal/fx/fx.go` (`Client{HTTP *http.Client; BaseURL; …}`, `NewClient()` с
  `Timeout: 4 * time.Second`); тесты — `httptest.NewServer` и подмена `BaseURL`. Помощников SSRF нет.
- Зависимости: `backend/go.mod` — chi, cors, jwt, uuid, pq, x/crypto; корневой модуль `finance-vercel` — `replace
  finance-backend => ./backend`, новая зависимость бэкенда — и в корневой `go.mod`/`go.sum` (§6). `golang.org/x/net`
  нет — разрешено добавить ради `x/net/html` (разбор страницы).
- Vercel: функция одна (`api/index.go`), тело ответа ≤ 4,5 МБ, внешние вызовы — с таймаутом заметно ниже лимита
  функции (§6 «Грабли»).

## Задача

1. Пакет `internal/linkpreview`: `Fetch(ctx, rawURL) (Preview{Title, ImageType, Image []byte}, error)`.
   - URL: только `https`, без логина/пароля в URL, порт 443 (или пусто), длина ≤ 2048.
   - SSRF: свой `net.Dialer` с `Control`, который отказывает IP loopback, private (10/8, 172.16/12, 192.168/16),
     link-local (169.254/16, fe80::/10), CGNAT 100.64/10, ULA fc00::/7, multicast, unspecified, метаданные облака —
     проверка **после разрешения имени, на каждом соединении** (редиректы тоже); `CheckRedirect` — ≤ 3, только `https`.
   - Страница: общий таймаут ≤ 6 с, читать ≤ 1 МБ (`io.LimitReader`), только `text/html`; картинка — `og:image`, иначе
     `twitter:image`, иначе `link rel=image_src`; относительный адрес — от адреса страницы; название — `og:title`,
     иначе `<title>`, обрезка до 120 символов, пробелы нормализованы.
   - Картинка: тот же клиент, ≤ 2 МБ, тип по сигнатуре (`http.DetectContentType`) — только jpeg/png/webp (не svg).
   - `User-Agent` — обычный браузерный; ошибки — типизированные (`ErrBadURL`, `ErrBlocked`, `ErrNoImage`,
     `ErrTooLarge`, `ErrUpstream`).
2. Ручка `POST /api/photos/preview` `{ "url": "…" }` (только member, тело ≤ 4 КБ) → `200 { title, imageType, image
   (base64) }`; плохой URL / заблокировано → 400; нет картинки → 422 `no image`; слишком большая / страница
   недоступна / таймаут → 422 с кодом причины. Ничего не пишет в базу. В логи — домен, не полный URL.
3. Зависимость `golang.org/x/net` — в `backend/go.mod` и корневой `go.mod`/`go.sum`.

## Тесты

- `linkpreview`: блокировка каждого класса адресов (таблица IP v4/v6), имя, разрешающееся во внутренний адрес,
  редирект на `http` и на внутренний адрес, > 3 редиректов, лимит страницы и картинки, svg отклонён, относительный
  `og:image`, нет картинки, `<title>` вместо `og:title`. Сервер страниц — `httptest.NewTLSServer`; чтобы тест дошёл
  до него, проверка адресов подменяется только в тестах (неэкспортируемое поле), а сама проверка тестируется
  отдельно.
- Ручка: viewer → 403, без токена → 401, member → 200 на тестовом сервере; плохое тело → 400.

## Критерии приёмки

- `cd backend && go build ./... && go test ./...`; корневой модуль собирается (`go build ./...` из корня); CI ✅.
- Ручная проверка на стенде (Go локально): ссылка Kaspi на товар → картинка и название; если Kaspi отдаёт без
  `og:image` или блокирует ботов — факт в Handoff (клиент покажет «загрузите своё»).

## Вне скоупа

- Цена товара (Р-60), кэш превью, лимит запросов на пользователя (хвост, если ревью `backend` попросит).
