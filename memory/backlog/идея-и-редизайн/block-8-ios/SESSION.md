# Блок 8 — iOS · сессии

**Цель блока:** то же приложение на iPhone через Capacitor — вход Google и Apple, пуш через
APNs, выписка из «Файлов», — доведённое до TestFlight и выпуска в App Store; последний блок
инициативы.

Сессии: исполнитель ⬜ · критик ⬜ · приёмка ⬜ · ревью backend ⬜ · ревью frontend ⬜ · клинап ⬜

---

## Промпт исполнителя — уровень build · Opus 5 · effort high (ultrathink)

```
/worker идея-и-редизайн 8 ultrathink
```

Блок-специфика:

- **Сессия на Mac владельца**: клон репо, `git config core.hooksPath memory/process/hooks`,
  Node 24, Go, Xcode + CocoaPods; секреты (`GoogleService-Info.plist`, APNs `.p8`) —
  `memory/secrets/ios/` на Mac, в git не попадают.
- Ветка `b2c-block-8-ios` от `main`. Push — с согласия; прод не трогать (миграция `000008`,
  `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS` — клинап).
- Задачи: B2C-37 → B2C-38 (Go + оболочка) → B2C-39. Владелец заранее: Apple Developer, Firebase
  iOS-приложение, iOS OAuth-клиент Google — список в начале сессии.
- Верификация: веб — стандарт §6 (Mac: `npm test`, `go test`); оболочка — iPhone владельца.
- Следующий шаг — `/critic идея-и-редизайн 8 ultracode`.

**Факты кода после Блока 7** (заполняет критик Блока 7): —

---

## Промпт критика — уровень review · Opus 5 · effort xhigh (ultracode)

```
/critic идея-и-редизайн 8 ultracode
```

Блок-специфика:

- Auth: `oidc` общий код без регрессии Google (тесты обоих); relay-email не привязывается;
  `aud` = bundle id; Apple-кнопка только на iOS. Секреты не в git (`git ls-files` по `plist`,
  `.p8`). Веб не регрессировал.
- **Последний блок:** вместо промпта следующего блока — проверить готовность бэклога к закрытию
  (DoD BACKLOG-GUIDE): хвосты §4 с судьбой, живые доки, e2e, CI, `STATE.md`.
- Следующий шаг — `/accept идея-и-редизайн 8 ultracode`.

---

## Промпт приёмки — уровень review · Opus 5 · effort xhigh (ultracode)

```
/accept идея-и-редизайн 8 ultracode
```

Блок-специфика:

- Веб: регрессия `e2e/` + `npm test` + `go test` + PG; CI. iPhone: смоук TestFlight по
  `STORE.md` (оба iPhone, если есть; иначе — iPhone владельца + симулятор).
- **L-блок: приёмка НЕ деплоит и на ревью не отправляет.** Следующий шаг —
  `/dir-review идея-и-редизайн 8 backend`.

---

## Промпт ревью backend — уровень review · Opus 5 · effort xhigh

```
/dir-review идея-и-редизайн 8 backend
```

- Каталог `backend/`: `oidc`/`appleauth` против `googleauth`, миграция `000008`. Следующий —
  `/dir-review идея-и-редизайн 8 frontend`.

## Промпт ревью frontend — уровень review · Opus 5 · effort xhigh

```
/dir-review идея-и-редизайн 8 frontend
```

- Каталог `frontend/` (включая `ios/`, кроме `Pods/`): ветки платформ, дубли с Android,
  `Info.plist` тексты. Следующий — `/cleanup идея-и-редизайн 8`.

## Промпт клинапа — уровень build · Opus 5 · effort high

```
/cleanup идея-и-редизайн 8
```

- Клинап-вердикты; **деплой веб с «да» владельца**: ID деплоя → env `APPLE_CLIENT_IDS`,
  `GOOGLE_CLIENT_IDS` (iOS) → `cmd/migrate` (`000008`) → merge → push → смоук веб; затем
  **«Отправить на ревью» в App Store Connect** — отдельное «да»; после одобрения — выпуск
  (ручной, владелец). **Откат:** веб — promote; магазин — новая сборка.
- «Итоги пост-приёмки», 🏁. **Последний блок** — предложить владельцу закрыть бэклог по DoD
  (все 🏁, хвосты с судьбой, `STATE.md` — «Закрытые» и бесхозные хвосты, каталог →
  `memory/archive/`); следующий шаг после архива — бриф монетизации после данных об удержании
  (Р-17), отдельная инициатива.

---

## Handoff (заполняет исполнитель)

- **Коммиты:**
- **Что сделано:**
- **Отклонения от ТЗ:**
- **Грабли среды:**
- **Верификация:**

## Итоги критика

## Приёмка

## Итоги пост-приёмки (только L)
