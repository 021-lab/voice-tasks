# Qdrant MCP Worker

Cloudflare Worker, который:

- хранит `QDRANT_URL` и `QDRANT_KEY` в secrets/env,
- отдаёт текстовую спецификацию в корне MCP endpoint,
- отдаёт тестовую HTML-страницу,
- принимает запрос на запись точки в Qdrant и умеет проверить, что точка реально записалась.

## Локальный запуск

```bash
cd /Users/AIDev/Codex/Voice-list/cloudflare/qdrant-mcp-worker
npm install
QDRANT_URL="https://..." QDRANT_KEY="..." npm run dev
```

Проверки:

```bash
curl http://127.0.0.1:4311/health
open http://127.0.0.1:4311/MCP/qdrant/user/MKhTjoZZXAlWGdyb3FYfIPZT3AYv4TQIc4ualUY9/test
```

## Прод-деплой

Текущая среда не авторизована в Cloudflare, поэтому нужен интерактивный логин:

```bash
npx wrangler login
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_KEY
npx wrangler deploy
```

После этого в Cloudflare нужно назначить route/custom domain:

`toolbox.smileme.ai/MCP/qdrant/user/MKhTjoZZXAlWGdyb3FYfIPZT3AYv4TQIc4ualUY9/*`
