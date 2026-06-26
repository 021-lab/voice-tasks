# Voice Task List PWA

PWA на одном HTML-файле для iOS Safari. Любое долгое нажатие на любой элемент страницы немедленно запускает PTT-запись голосовой команды. Команды обрабатываются цепочкой строго разделённых модулей. Задачи с 7 статусами и тегами хранятся в Qdrant Cloud. Все межмодульные передачи логируются; к каждой записи лога можно добавить голосовой комментарий.

---

## Блокеры ✅ решено

| # | Проблема | Решение |
|---|---|---|
| 1 | CORS при fetch к Qdrant из браузера | `allowed_origins: ["*"]` в Qdrant Cloud |
| 2 | Qdrant Point ID | `TaskId = crypto.randomUUID()` — один UUID везде: point id, payload, контракты |
| 3 | Хранение секретов | Settings overlay принимает `.env`-текст → `localStorage['vt_env']` → `window.__cfg` |
| 4 | PTT на iOS | `recognition.start()` на `touchstart`; `touchend` < 200 ms → abort |
| 5 | HTTPS для Web Speech API | GitHub Pages |
| 6 | `interim_results` на iOS Safari | Graceful degradation: показывать если доступен, иначе «Запись…» |
| 7 | Qdrant collections | Auto-create при первом `op:'add'` (PUT /collections если 404, затем повтор) |

---

## Настройка (первый запуск)

При отсутствии `localStorage['vt_env']` модальное окно открывается автоматически.  
Нажать шестерёнку → вставить в `<textarea>`:

```
QDRANT_PROXY_URL=https://toolbox.smileme.ai/MCP/qdrant2/user/...
LLM_PROVIDER=openrouter
LLM_KEY=sk-or-...
LLM_MODEL=anthropic/claude-haiku-4-5-20251001
```

Сохранить → `localStorage.setItem('vt_env', raw)` + парсинг в `window.__cfg`. При следующем открытии вводить не нужно.

---

## Архитектура

```
index.html
├── [HTML + CSS]
└── [JS-модули inline]
    ├── settingsModule   — .env textarea → localStorage['vt_env'] → window.__cfg
    ├── storageModule    — единственная точка доступа к данным (делегирует в StorageBackend)
    ├── searchModule     — PTT на «Найди/Добавь»: add или search (контекст-свободно)
    ├── receiveModule    — PTT на задаче/элементе лога → ContextInput (контекстно)
    ├── extractModule    — regex-парсер команд над существующей задачей
    ├── cloudModule      — LLM-фоллбэк когда regex не справился
    ├── logModule        — лог межмодульных передач + голосовые комментарии
    └── undoModule       — один уровень undo (снапшот TaskItem[])
```

---

## Хранилище данных

| Что | Где |
|---|---|
| Задачи / узлы | Qdrant proxy collection `task-graph-nodes` |
| Связи parent → child | Qdrant proxy collection `task-graph-edges` |
| Лог | Qdrant proxy collection `task-graph-logs` |
| Secrets / настройки | `localStorage['vt_env']` |

Qdrant Point ID = UUID клиента (`crypto.randomUUID()`), хранится и как Qdrant point id, и в `payload.id`. Векторное поле — заглушка `[0.0]` (dim=1); при добавлении семантического поиска заменяется реальным вектором без изменения схемы.

### StorageBackend (интерфейс)

Весь `storageModule` работает через Qdrant proxy из `QDRANT_PROXY_URL`. Локальный backend для задач не используется.

```
v1: QdrantProxyBackend — REST API через Cloudflare/Qdrant proxy
```

---

## Типы данных

```ts
type TaskId = string  // crypto.randomUUID()

type Status =
  | 'сегодня' | 'фокус' | 'жду' | 'архив'
  | 'сделано' | 'отложено' | 'делегирована'
// дефолт при создании: 'сегодня'

interface TaskItem {
  id:     TaskId
  title:  string
  status: Status
  tags:   string[]  // дефолт: []
}

interface LogEntry {
  id:      string   // UUID
  ts:      number   // Date.now()
  from:    string   // имя модуля-отправителя
  to:      string   // имя модуля-получателя
  data:    unknown  // Patch | SearchQuery | ContextInput | StorageResult
  comment: string   // '' по умолчанию, заполняется голосом
}
```

---

## Каталог операций Patch

`storageModule` принимает только эти формы:

```ts
// Добавить задачу (id генерируется клиентом)
{ op: 'add',    task: { title: string; status?: Status; tags?: string[] } }

// Обновить название
{ op: 'update', task: { id: TaskId; title: string } }

// Обновить статус
{ op: 'update', task: { id: TaskId; status: Status } }

// Добавить теги (merge, не replace)
{ op: 'update', task: { id: TaskId; tags: string[] } }

// Убрать конкретные теги
{ op: 'update', task: { id: TaskId; _removeTags: string[] } }

// Удалить задачу
{ op: 'delete', task: { id: TaskId } }
```

Валидация в `storageModule`: `op:'add'` — `title` обязателен; `op:'update'` — `id` обязателен, `tags` merge к существующим, `_removeTags` — вычитание.

---

## Межмодульные контракты

Все вызовы проходят через `LOG.emit(from, to, data)` перед передачей.

```ts
// A. receiveModule → extractModule
interface ContextInput {
  elementType: 'task' | 'log'
  taskId:      string | null
  transcript:  string
}

// B. searchModule → storageModule
interface SearchQuery {
  text?:   string
  status?: Status
  tags?:   string[]
}

// C. extractModule / searchModule → storageModule
interface Patch {
  op:   'add' | 'update' | 'delete'
  task: Partial<TaskItem>
}

// D. storageModule → вызывающий модуль
interface StorageResult {
  ok:      boolean
  task?:   TaskItem
  tasks?:  TaskItem[]
  error?:  string
}
```

---

## Модули: детальное описание

### settingsModule
- При старте: читает `localStorage['vt_env']` → `parseEnv()` → `window.__cfg`
- Если `vt_env` отсутствует → модальное окно открывается автоматически
- Textarea при открытии: показывает сохранённый `.env`-текст
- При сохранении: `localStorage.setItem('vt_env', raw)` + обновляет `window.__cfg`

### searchModule (контекст-свободный)

ПTT на кнопку «Найди/Добавь» — пользователь не выбирает задачу:

| Транскрипт | Действие |
|---|---|
| `добавь / создай / новая задача …` | `Patch { op:'add' }` → storageModule → render |
| иначе | `SearchQuery { text?, status?, tags? }` → storageModule → render(filtered) |
| нераспознано | `cloudModule` → возвращает `Patch` или `SearchQuery` |

### receiveModule (контекстный)

PTT на конкретной задаче или элементе лога:
- `touchstart` → `recognition.start()` немедленно
- `touchend` < 200 ms → `recognition.abort()` + кратковременная визуальная подсветка
- `touchend` ≥ 200 ms → ждать `recognition.onend` → передать `ContextInput` в `extractModule`
- Оверлей записи: пульсирующий микрофон + промежуточный транскрипт (если iOS даёт interim, иначе «Запись…»)

### extractModule (команды над существующей задачей)

Получает `ContextInput` с известным `taskId`:

| Паттерн | Patch |
|---|---|
| `удали` | `{ op:'delete' }` |
| `в архив` | `{ op:'update', status:'архив' }` |
| `измени / переименуй …` | `{ op:'update', title }` |
| `это [слово]` | статус если в STATUSES, иначе тег (merge) |
| `это не [слово]` | `_removeTags` или сброс статуса → 'сегодня' |
| нераспознано | `cloudModule(transcript, taskId)` → `Patch` |

### storageModule
- Единственная точка записи/чтения данных; делегирует в `QdrantBackend`
- Credentials читает из `window.__cfg`
- Перед каждым `Patch` сохраняет снапшот для `undoModule`
- Возвращает `StorageResult { ok, task?, tasks?, error? }`
- Сетевая ошибка → `ok: false, error` → toast пользователю

### logModule
- `LOG.emit(from, to, data)` — записывает `LogEntry` в Qdrant `log` + в память
- Вкладка «Лог»: каждая запись — строка `[from→to] JSON(data)` + комментарий
- Кнопки: «Очистить лог», «Копировать» (в буфер)
- Долгое нажатие на запись лога → PTT через `receiveModule` → транскрипт сохраняется как `LogEntry.comment`

### undoModule
- Перед каждым `Patch` → `storageModule`: сохраняет снапшот `TaskItem[]` в памяти (один уровень)
- Кнопка «Undo» (короткий тап): перезаписывает все задачи из снапшота → render
- `LOG.emit('undo', 'storage', { restored: snapshot })`

### cloudModule
- Вызывается из `extractModule` или `searchModule` при провале локального парсера
- Проверяет `window.__cfg.llmKey`; нет ключа → toast «нет LLM-ключа»
- Системный промпт: список всех задач + схема команд + STATUSES
- Запрос к провайдеру (`openrouter` / `anthropic` / `openai`) через `fetch`
- Парсит JSON-ответ → `Patch` или `SearchQuery`
- Сетевая ошибка → toast «нет сети, LLM недоступен»

---

## UX-поведение

| Жест | Элемент | Действие |
|---|---|---|
| Короткий тап | Задача | Цветовая подсветка 0.5 s (без команды) |
| Короткий тап | Кнопка «Undo» | Отменить последнее изменение |
| Короткий тап | Шестерёнка | Открыть модальное окно настроек |
| Долгое нажатие | Кнопка «Найди/Добавь» | PTT: добавить задачу или найти |
| Долгое нажатие | Задача | PTT: команда над этой задачей |
| Долгое нажатие | Элемент лога | PTT: голосовой комментарий к записи |

PTT-детектор: `touchstart` запускает запись немедленно + таймер 200 ms; если `touchend` раньше — это короткий тап (`recognition.abort()`), если позже — `touchend` останавливает запись (`recognition.stop()`).

---

## Флоу данных

### Контекстная команда (PTT на задаче)

```
touchstart на задаче 'abc-uuid'
  └─► receiveModule — recognition.start() немедленно
        ├─ оверлей: пульсирующий микрофон + interim-транскрипт
        └─ [touchend ≥ 200ms] → recognition.onend
              └─► LOG.emit('receive', 'extract', ContextInput)
                    └─► extractModule
                          ├─ regex: «это фокус» → «фокус» ∈ STATUSES
                          │   → Patch { op:'update', task:{ id, status:'фокус' } }
                          └─► LOG.emit('extract', 'storage', Patch)
                                └─► storageModule → QdrantBackend.upsert()
                                      └─► StorageResult { ok:true }
                                            └─► render()
```

### Контекст-свободная команда (PTT на кнопке)

```
touchstart на «Найди/Добавь»
  └─► searchModule — recognition.start()
        └─ [touchend] → transcript: «добавь позвонить врачу»
              ├─ regex add match
              └─► LOG.emit('search', 'storage', Patch{op:'add'})
                    └─► storageModule → QdrantBackend.upsert()
                          └─► render(newTask)
```

```
touchstart на «Найди/Добавь»
  └─► searchModule — recognition.start()
        └─ [touchend] → transcript: «найди сделанные с тегом дом»
              ├─ regex search match → SearchQuery { status:'сделано', tags:['дом'] }
              └─► LOG.emit('search', 'storage', SearchQuery)
                    └─► storageModule.query() → QdrantBackend.scroll(filter)
                          └─► TaskItem[] → render(filtered)
```

---

## Деплой

GitHub Pages: `Settings → Pages → Source: branch claude/voice-task-list-pwa-gpqcvk, / (root)`

URL: `https://021-lab.github.io/voice-tasks/`

> Web Speech API требует `https://` — без него PTT на iOS не работает.
