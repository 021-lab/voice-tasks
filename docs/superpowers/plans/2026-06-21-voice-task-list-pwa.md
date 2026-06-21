# Voice Task List PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать с нуля рабочее PWA-приложение в одном `index.html`, которое соответствует спецификации в `README.md` и использует Qdrant Cloud, голосовой ввод и логирование модулей.

**Architecture:** Весь интерфейс, стили и JavaScript живут в одном HTML-файле. JavaScript организован как набор inline-модулей: `settingsModule`, `storageModule`, `searchModule`, `receiveModule`, `extractModule`, `cloudModule`, `logModule`, `undoModule`, плюс общий слой рендера и небольшие утилиты.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Web Speech API, Qdrant REST API, `localStorage`.

---

### Task 1: Создать новый `index.html`

**Files:**
- Create: `index.html`
- Reference: `README.md`
- Reference: `IMPLEMENTATION.md`

- [ ] Сделать каркас приложения: header, вкладки, список задач, панель лога, PTT overlay, toast, settings modal.
- [ ] Описать inline-модули и их контракты так, чтобы логика соответствовала спецификации, а код оставался читаемым в одном файле.
- [ ] Реализовать UX для long-press PTT на общей кнопке, задачах и логах.

### Task 2: Реализовать данные и команды

**Files:**
- Create: `index.html`
- Reference: `README.md`
- Reference: `IMPLEMENTATION.md`

- [ ] Реализовать `settingsModule` для `.env`-ввода и `window.__cfg`.
- [ ] Реализовать `QdrantBackend` и `storageModule` с авто-созданием коллекций `tasks` и `log`.
- [ ] Реализовать `extractModule`, `searchModule`, `cloudModule`, `logModule`, `undoModule`.

### Task 3: Проверка соответствия и подготовка к ревью

**Files:**
- Modify: `index.html`
- Reference: `TESTING.md`

- [ ] Сверить готовый файл со сценариями и контрактами из документации, не запуская самостоятельные тесты без команды пользователя.
- [ ] Запустить специальный review-скилл для кода и устранить найденные критичные замечания.
- [ ] Подготовить деплой-артефакт и дождаться отдельной команды пользователя на проверку страницы по адресу.
