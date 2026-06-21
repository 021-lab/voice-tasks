# Implementation Plan: Voice Task List PWA

Иерархический список задач для кодера. Единственный выходной файл — `index.html`.

---

## 0. Подготовка

- [ ] 0.1 Убедиться, что Qdrant Cloud кластер запущен и CORS настроен (`allowed_origins: ["*"]`)
- [ ] 0.2 Проверить, что GitHub Pages включён на ветке `claude/voice-task-list-pwa-gpqcvk`

---

## 1. Каркас HTML + CSS

- [ ] 1.1 `<meta name="viewport">` + `<meta name="theme-color">` + PWA-иконка через data-URI
- [ ] 1.2 CSS-переменные: `--bg`, `--surface`, `--accent`, `--done`, `--danger`, `--tag`, `--warn`
- [ ] 1.3 Базовый layout: `header` (бренд + кнопка шестерёнки + кнопка «Найди/Добавь») + `#task-list` + `#log-panel` (скрыт по умолчанию)
- [ ] 1.4 Кнопки: «Найди/Добавь», «Undo», вкладки «Задачи» / «Лог»
- [ ] 1.5 PTT-оверлей: пульсирующий микрофон + поле транскрипта (скрыт по умолчанию)
- [ ] 1.6 Toast-уведомления: позиция bottom-center, auto-hide 3s
- [ ] 1.7 Settings-модалка: overlay + `<textarea rows=8>` + кнопка «Сохранить»

---

## 2. `settingsModule`

- [ ] 2.1 При `DOMContentLoaded`: читать `localStorage.getItem('vt_env')`
  - [ ] 2.1a Если пусто → открыть модалку автоматически
  - [ ] 2.1b Если есть → `parseEnv(raw)` → `window.__cfg`
- [ ] 2.2 `parseEnv(raw)`: построчный split по `=`, trim, возвращает объект
  ```
  { qdrantUrl, qdrantKey, llmProvider, llmKey, llmModel }
  ```
- [ ] 2.3 Кнопка «Сохранить» в модалке:
  - [ ] 2.3a `localStorage.setItem('vt_env', textarea.value)`
  - [ ] 2.3b `window.__cfg = parseEnv(textarea.value)`
  - [ ] 2.3c Закрыть модалку → toast «Настройки сохранены»
- [ ] 2.4 Открытие модалки (шестерёнка): загрузить `localStorage.getItem('vt_env')` в textarea

---

## 3. `storageModule` + `QdrantBackend`

### 3.1 QdrantBackend — базовые операции

- [ ] 3.1.1 `_req(method, path, body)` — базовый fetch к Qdrant (URL + key из `window.__cfg`)
- [ ] 3.1.2 `_ensureCollection(name)` — PUT `/collections/{name}` если 404; vectors: `{size:1, distance:'Cosine'}`
- [ ] 3.1.3 `savePatch(patch)`:
  - [ ] `op:'add'` → `id = crypto.randomUUID()` → PUT `/collections/tasks/points` (upsert)
  - [ ] `op:'update'` — GET point → merge поля → upsert
  - [ ] `op:'delete'` → DELETE `/collections/tasks/points` (by id)
- [ ] 3.1.4 `query(SearchQuery)` → POST `/collections/tasks/points/scroll` с фильтром по `status` / `tags` / текстовый поиск по `title` (must-match)
- [ ] 3.1.5 `saveLog(entry)` → upsert в collection `log`
- [ ] 3.1.6 `getLogs()` → scroll по `log`, сортировка по `ts` desc
- [ ] 3.1.7 `updateLogComment(id, comment)` → GET point → merge `comment` → upsert

### 3.2 `storageModule` — обёртка

- [ ] 3.2.1 Экспортировать `Storage.patch(patch)`, `Storage.query(q)`, `Storage.log.*`
- [ ] 3.2.2 Валидация входящих Patch (проверять обязательные поля)
- [ ] 3.2.3 Перехват ошибок сети → `StorageResult { ok:false, error }`

---

## 4. `logModule`

- [ ] 4.1 `LOG.emit(from, to, data)` — записать `LogEntry` в Qdrant + в память (`window.__logCache`)
- [ ] 4.2 Рендер лога: каждая запись — строка `[from→to] JSON.stringify(data)` + `comment` если есть
- [ ] 4.3 Кнопка «Очистить лог»: удалить все points из collection `log` + `window.__logCache = []`
- [ ] 4.4 Кнопка «Копировать»: `navigator.clipboard.writeText(JSON.stringify(window.__logCache))`
- [ ] 4.5 Долгое нажатие на элемент лога → запустить `receiveModule` с `elementType:'log'`

---

## 5. `receiveModule` (PTT на задаче / элементе лога)

- [ ] 5.1 На каждом `[data-task-id]` и `[data-log-id]`: навесить `touchstart` / `touchend`
- [ ] 5.2 `touchstart` → `recognition.start()` немедленно + запустить таймер 200ms
- [ ] 5.3 `touchend` < 200ms → `recognition.abort()` + кратковременная визуальная подсветка
- [ ] 5.4 `touchend` ≥ 200ms → ждать `recognition.onend` → получить финальный транскрипт
- [ ] 5.5 Показывать PTT-оверлей с промежуточным транскриптом (если iOS даёт interim, иначе «Запись...»)
- [ ] 5.6 По получении транскрипта → `extractModule.handle({ taskId, transcript })`

---

## 6. `extractModule` (парсинг команд на задаче)

- [ ] 6.1 Константа `STATUSES = ['сегодня','фокус','жду','архив','сделано','отложено','делегирована']`
- [ ] 6.2 Regex-правила (проверять в порядке):
  - [ ] 6.2.1 `/^удали/` → `Patch { op:'delete' }`
  - [ ] 6.2.2 `/^в архив/` → `Patch { op:'update', status:'архив' }`
  - [ ] 6.2.3 `/(измени|переименуй)\s+(.+)/` → `Patch { op:'update', title: $2 }`
  - [ ] 6.2.4 `/^это не (.+)/` → если $1 в STATUSES → статус 'сегодня'; иначе → `_removeTags:[$1]`
  - [ ] 6.2.5 `/^это (.+)/` → если $1 в STATUSES → `status:$1`; иначе → `tags:[$1]` (merge)
- [ ] 6.3 Если regex не сработал → `cloudModule.extract(transcript, taskId)` → `Patch`
- [ ] 6.4 Передать `Patch` → `Storage.patch(patch)` → обновить render

---

## 7. `searchModule` (PTT на кнопке «Найди/Добавь»)

- [ ] 7.1 `touchstart` на кнопке → `recognition.start()` + PTT-оверлей
- [ ] 7.2 `touchend` → ждать `recognition.onend` → финальный транскрипт
- [ ] 7.3 Regex add: `/^(добавь|создай|новая задача)\s+(.+)/i` → `Patch { op:'add', task:{ title:$2 } }` → Storage → render
- [ ] 7.4 Regex search: `/найди?\s*(.*)/i` → распарсить статус + теги из текста → `SearchQuery` → Storage → render(filtered)
- [ ] 7.5 Нераспознано → `cloudModule.interpret(transcript)` → возвращает `Patch | SearchQuery`
- [ ] 7.6 Toast на ошибку / пустой результат

---

## 8. `cloudModule` (LLM-фоллбэк)

- [ ] 8.1 Проверить `window.__cfg.llmKey`; если пусто → toast «Нет LLM-ключа» и return
- [ ] 8.2 Системный промпт: список всех задач + схема команд + STATUSES
- [ ] 8.3 Запрос к провайдеру (`openrouter` / `anthropic` / `openai`) через fetch
- [ ] 8.4 Парсинг JSON-ответа → `Patch` или `SearchQuery`
- [ ] 8.5 Обработка ошибки сети → toast «нет сети, LLM недоступен»

---

## 9. `undoModule`

- [ ] 9.1 `undoModule.snapshot(tasks)` — сохранить `TaskItem[]` в `window.__undoSnapshot`
  - вызывать перед каждым `Storage.patch()`
- [ ] 9.2 Кнопка «Undo» (`touchend` < 200ms):
  - [ ] 9.2.1 Если снапшот есть → for each task upsert в Qdrant (полная перезапись)
  - [ ] 9.2.2 `LOG.emit('undo', 'storage', { restored: snapshot })` 
  - [ ] 9.2.3 render(snapshot); `window.__undoSnapshot = null`
  - [ ] 9.2.4 Если снапшота нет → toast «Нечего отменять»

---

## 10. Рендер и UX

- [ ] 10.1 `render(tasks)` — пересоздать `#task-list` из массива; каждый элемент:
  - [ ] Цвет / иконка по `status`
  - [ ] Теги как пилюли
  - [ ] `data-task-id` атрибут
- [ ] 10.2 При старте: `Storage.query({})` → `render(allTasks)` + `logModule.loadLogs()`
- [ ] 10.3 Визуальная подсветка 0.5s при коротком тапе на задаче
- [ ] 10.4 Переключение вкладок «Задачи» / «Лог» (скрывать/показывать панели)
- [ ] 10.5 PTT-оверлей: появляется при старте записи, исчезает при `recognition.onend`

---

## 11. Деплой и проверка

- [ ] 11.1 `git add index.html && git commit && git push`
- [ ] 11.2 GitHub Pages: `Settings → Pages → branch: claude/voice-task-list-pwa-gpqcvk, / (root)`
- [ ] 11.3 Открыть `https://021-lab.github.io/voice-tasks/` на iPhone Safari
- [ ] 11.4 Пройти сценарий из `TESTING.md`
- [ ] 11.5 «Поделиться» → «На экран Home» → убедиться что открывается без адресной строки
