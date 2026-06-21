# Voice Task List PWA

PWA-приложение на одном HTML-файле для iOS Safari. Любое долгое нажатие немедленно запускает PTT-запись голосовой команды. Команды обрабатываются цепочкой модулей: Поиск/Добавь → Приём → Извлечение → Хранилище. Задачи хранятся в Qdrant Cloud. Все межмодульные передачи логируются.

---

## Блокеры ✅ решено

| # | Проблема | Решение |
|---|---|---|
| 1 | CORS при fetch к Qdrant из браузера | `allowed_origins: ["*"]` в Qdrant Cloud |
| 2 | Qdrant Point ID | `TaskId = crypto.randomUUID()` — один UUID везде |
| 3 | Хранение секретов | Settings overlay принимает `.env`-текст → `localStorage['vt_env']` |
| 4 | PTT на iOS | `recognition.start()` на `touchstart`; `touchend` < 200ms → abort |
| 5 | HTTPS | GitHub Pages |
| 6 | interim_results iOS | Graceful degradation: показывать если доступен, иначе «Запись...» |
| 7 | Qdrant collections | Auto-create при первом `op:'add'` (PUT /collections если 404) |

---

## Настройка (первый запуск)

Открыть приложение → нажать шестерёнку → вставить в textarea:

```
QDRANT_URL=https://xxx.qdrant.io
QDRANT_KEY=abc123
LLM_PROVIDER=openrouter
LLM_KEY=sk-or-...
LLM_MODEL=anthropic/claude-haiku-4-5-20251001
```

Сохранить. Данные хранятся в `localStorage['vt_env']`. При следующем открытии вводить не нужно.

---

## Архитектура

```
index.html
├── [HTML + CSS]
└── [JS-модули inline]
    ├── settingsModule   — .env textarea → localStorage → window.__cfg
    ├── storageModule    — единственная точка доступа к данным (QdrantBackend)
    ├── searchModule     — PTT на «Найди/Добавь» → add или search (контекст-свободно)
    ├── receiveModule    — PTT на задаче → ContextInput (контекстно)
    ├── extractModule    — regex-парсер команд над существующей задачей
    ├── cloudModule      — LLM-фоллбэк когда regex не справился
    ├── logModule        — лог всех межмодульных передач + голосовые комментарии
    └── undoModule       — один уровень undo (снапшот TaskItem[])
```

### Хранилище данных

| Что | Где |
|---|---|
| Задачи (`TaskItem[]`) | Qdrant collection `tasks` |
| Лог (`LogEntry[]`) | Qdrant collection `log` |
| Secrets / настройки | `localStorage['vt_env']` |

### Типы данных

```ts
type Status = 'сегодня' | 'фокус' | 'жду' | 'архив' | 'сделано' | 'отложено' | 'делегирована'

interface TaskItem {
  id:     string   // UUID (crypto.randomUUID())
  title:  string
  status: Status   // дефолт: 'сегодня'
  tags:   string[] // дефолт: []
}
```

### PTT-логика

- `touchstart` → `recognition.start()` немедленно
- `touchend` < 200ms → `recognition.abort()` (короткий тап)
- `touchend` ≥ 200ms → финализировать транскрипт

### searchModule (контекст-свободный)

Кнопка «Найди/Добавь»:
- `добавь / создай / новая задача ...` → `Patch { op:'add' }` → storageModule
- иначе → `SearchQuery` → storageModule → render(filtered)
- нераспознано → cloudModule

### receiveModule + extractModule (контекстный)

PTT на задаче → транскрипт → regex:
- `удали` → `Patch { op:'delete' }`
- `в архив` → `Patch { op:'update', status:'архив' }`
- `это [слово]` → статус (если в STATUSES) или тег
- `это не [слово]` → `_removeTags` или сброс статуса → 'сегодня'
- нераспознано → cloudModule(transcript, taskId)

---

## Деплой

GitHub Pages: `Settings → Pages → branch: claude/voice-task-list-pwa-gpqcvk, / (root)`

URL: `https://021-lab.github.io/voice-tasks/`
