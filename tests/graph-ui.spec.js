import { expect, test } from "@playwright/test";

const env = [
  "QDRANT_PROXY_URL=https://proxy.test",
  "LLM_PROVIDER=openrouter",
  "LLM_MODEL=openai/gpt-4.1-mini"
].join("\n");

function installQdrantProxyMock(page) {
  const collections = new Map();

  function store(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  store("task-graph-nodes");
  store("task-graph-edges");
  store("task-graph-logs");

  page.route("https://proxy.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const collectionMatch = path.match(/^\/collections\/([^/]+)$/);
    const pointsMatch = path.match(/^\/collections\/([^/]+)\/points$/);
    const pointMatch = path.match(/^\/collections\/([^/]+)\/points\/([^/]+)$/);
    const scrollMatch = path.match(/^\/collections\/([^/]+)\/points\/scroll$/);
    const deleteMatch = path.match(/^\/collections\/([^/]+)\/points\/delete$/);

    if (collectionMatch && (method === "GET" || method === "PUT")) {
      store(collectionMatch[1]);
      await route.fulfill({ json: { result: true } });
      return;
    }

    if (pointsMatch && method === "PUT") {
      const body = await request.postDataJSON();
      const items = store(pointsMatch[1]);
      for (const point of body.points || []) {
        items.set(String(point.id), point.payload);
      }
      await route.fulfill({ json: { result: { status: "ok" } } });
      return;
    }

    if (pointMatch && method === "DELETE") {
      store(pointMatch[1]).delete(decodeURIComponent(pointMatch[2]));
      await route.fulfill({ json: { result: { status: "ok" } } });
      return;
    }

    if (scrollMatch && method === "POST") {
      const items = Array.from(store(scrollMatch[1]).entries()).map(([id, payload]) => ({ id, payload }));
      await route.fulfill({ json: { result: { points: items } } });
      return;
    }

    if (deleteMatch && method === "POST") {
      const body = await request.postDataJSON();
      for (const id of body.points || []) {
        store(deleteMatch[1]).delete(String(id));
      }
      await route.fulfill({ json: { result: { status: "ok" } } });
      return;
    }

    await route.fulfill({ status: 404, body: "not mocked" });
  });

  return collections;
}

async function openApp(page) {
  const collections = installQdrantProxyMock(page);
  await page.addInitScript((value) => localStorage.setItem("vt_env", value), env);
  await page.goto("/codex.html");
  await expect(page.locator("#settings-modal")).toBeHidden();
  await expect(page.locator("#task-list")).toBeAttached();
  return collections;
}

test("uses Qdrant proxy collections instead of browser database", async ({ page }) => {
  const collections = await openApp(page);

  const hasIndexedDbUsage = await page.evaluate(() => document.documentElement.outerHTML.includes("indexedDB"));
  expect(hasIndexedDbUsage).toBe(false);

  await page.locator("#quick-add-input").fill("Запустить новый интерфейс");
  await page.locator("#btn-quick-add").click();
  await expect(page.locator("[data-node-id]").filter({ hasText: "Запустить новый интерфейс" })).toBeVisible();

  expect(collections.get("task-graph-nodes").size).toBe(1);
  expect(collections.get("task-graph-edges").size).toBe(0);
  expect(collections.get("task-graph-logs").size).toBeGreaterThan(0);
});

test("renders blockers, tree, detail card and focus alternatives from Qdrant graph", async ({ page }) => {
  const collections = await openApp(page);
  collections.get("task-graph-nodes").set("root", {
    id: "root",
    title: "Собрать релиз",
    done: false,
    focus: false,
    created_at: "2026-06-26T00:00:00.000Z",
    updated_at: "2026-06-26T00:00:00.000Z"
  });
  collections.get("task-graph-nodes").set("focused", {
    id: "focused",
    title: "Проверить блокеры",
    done: false,
    focus: true,
    created_at: "2026-06-26T00:01:00.000Z",
    updated_at: "2026-06-26T00:01:00.000Z"
  });
  collections.get("task-graph-nodes").set("option", {
    id: "option",
    title: "Отложенный вариант",
    done: false,
    focus: false,
    created_at: "2026-06-26T00:02:00.000Z",
    updated_at: "2026-06-26T00:02:00.000Z"
  });
  collections.get("task-graph-edges").set("e1", { id: "e1", src: "root", dst: "focused", order: 0 });
  collections.get("task-graph-edges").set("e2", { id: "e2", src: "root", dst: "option", order: 1 });

  await page.reload();
  await page.locator("#view-tree").click();
  await expect(page.locator("[data-node-id='root']")).toBeVisible();
  await page.locator("[agent-action-id='node:root']").click();
  await expect(page.locator("#detail-title")).toHaveText("Собрать релиз");
  await expect(page.locator("#detail-grid")).toContainText("Проверить блокеры");
  await expect(page.locator("#detail-grid")).toContainText("Отложенный вариант");

  await page.locator("#detail-close").click();
  await expect(page.locator("[data-node-id='focused']")).toBeVisible();
  await expect(page.locator("[data-node-id='option']")).toBeVisible();
});

test("moves nodes through Qdrant edge rewrites with cycle guard", async ({ page }) => {
  const collections = await openApp(page);
  collections.get("task-graph-nodes").set("a", {
    id: "a",
    title: "A",
    done: false,
    focus: false,
    created_at: "2026-06-26T00:00:00.000Z",
    updated_at: "2026-06-26T00:00:00.000Z"
  });
  collections.get("task-graph-nodes").set("b", {
    id: "b",
    title: "B",
    done: false,
    focus: false,
    created_at: "2026-06-26T00:01:00.000Z",
    updated_at: "2026-06-26T00:01:00.000Z"
  });

  await page.reload();
  await page.locator("[agent-action-id='move:b']").click();
  await page.locator("[agent-action-id='drop:a']").click();
  await expect.poll(async () => collections.get("task-graph-edges").size).toBe(1);
  const edge = Array.from(collections.get("task-graph-edges").values())[0];
  expect(edge.src).toBe("a");
  expect(edge.dst).toBe("b");
});
