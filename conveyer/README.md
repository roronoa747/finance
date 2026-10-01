# template_memory — процессный фреймворк для проектов

Эталонный подход к ведению проекта через бэклоги с LLM-сессиями (Claude Code).
Извлечён из практики arealapp (`platform/docs`), критически переработан
(разбор — `memory/process/RATIONALE.md`). Стек по умолчанию: Go + Vue 3 SPA; от стека
зависят только команды верификации.

## Состав

```
CLAUDE.md                  # правила для Claude в этом проекте (входная точка)
.gitignore                 # .DS_Store + memory/secrets/ (кроме README)
.claude/commands/          # slash-команды ролей: /brief /backlog /worker /critic
                           #   /accept /dir-review /cleanup — запуск сессий конвейера
memory/                    # «память» проекта — единый каталог, копируется целиком
├── process/               # фреймворк (гайды, шаблоны, хук)
│   ├── PROCESS.md         # чистая логика: инварианты, роли, режимы S/M/L
│   ├── BRIEF-GUIDE.md     # этап брифа: вопросы до полной ясности
│   ├── BACKLOG-GUIDE.md   # ведение бэклога: артефакты, протокол сессий
│   ├── RATIONALE.md       # критический разбор исходного подхода
│   ├── MODELS.md          # роль → модель/эффорт (сменный листок)
│   ├── CLAUDE-CODE.md     # интеграция с примитивами Claude Code (hooks, plan mode…)
│   ├── hooks/pre-commit   # гвард секретов (git config core.hooksPath memory/process/hooks)
│   ├── templates/         # шаблоны: brief, 00-backlog, task, SESSION, REVIEW, STATE,
│   │                      #   ci-go.yml, ci-web.yml (GitHub Actions)
│   └── example/avatar-upload/  # заполненный сквозной пример (бриф → бэклог → Handoff)
├── STATE.md               # статус проекта (пока пуст)
├── backlog/               # активные бэклоги будущего проекта
├── archive/               # закрытые бэклоги
├── decisions/             # журнал изменённых решений
└── secrets/               # локальные секреты — НЕ в git (инвариант 11)
```

## Быстрый старт нового проекта из шаблона (основной путь)

В ПУСТОМ корне нового проекта запустить `claude` и набрать:

```
/init-memory
```

(команда установлена на уровне пользователя, `~/.claude/commands/init-memory.md`;
путь к шаблону можно передать аргументом). Она скопирует фреймворк (без
`memory/process/example/` и этого README), сделает `git init` + включит хук секретов и
закоммитит. Затем перезапустить сессию (подхватится CLAUDE.md) и — `/brief <слаг>
<идея>`.

Без команды — то же самое промптом: «инициализируй проект из шаблона
`~/Projects/template_memory`: скопируй CLAUDE.md, .gitignore, .claude/commands/,
memory/process/ без example/, скелет memory/; git init; git config core.hooksPath
memory/process/hooks; первый коммит».

Сам шаблон при этом не меняется — он переиспользуется для каждого нового проекта;
улучшения процесса вносить сюда, в эталон.

## Как начать проект в этом каталоге

1. `git init` (если ещё не сделан) — доки и бэклоги живут в git наравне с кодом —
   и сразу `git config core.hooksPath memory/process/hooks` (включает гвард секретов;
   `.gitignore` уже настроен: `memory/secrets/` в git не попадает).
2. Владелец описывает первый блок работ и запускает `/brief <слаг> <описание>`
   (или свободно — Claude сам начнёт интервью по CLAUDE.md).
3. Бриф-интервью (`memory/process/BRIEF-GUIDE.md`) — раунды уточняющих вопросов до
   полной ясности → резюме → подтверждение владельца.
4. `/backlog <слаг>` строит бэклог; дальше конвейер идёт командами:
   `/worker → /critic → /accept` на блок (L-блоки: + `/dir-review`, `/cleanup`),
   каждая — в свежей сессии. Первый бэклог проекта заводит CI из
   `memory/process/templates/ci-*.yml`.

## Как перенести фреймворк в другой проект

Проще всего скопировать каталог целиком (`cp -R template_memory <новый-проект>`)
и удалить `memory/process/example/`. Поштучно: `CLAUDE.md`, `.gitignore`,
`.claude/commands/` (slash-команды), `memory/process/` (включая `hooks/`) и скелет
`memory/` (STATE.md + пустые backlog/archive/decisions + secrets/README.md).
В новом репо включить хук: `git config core.hooksPath memory/process/hooks`.
`MODELS.md` при переносе сверить с актуальным поколением моделей.
