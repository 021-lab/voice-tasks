import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4313",
    browserName: "chromium"
  },
  webServer: {
    command: "PORT=4313 node tests/server.mjs",
    url: "http://127.0.0.1:4313/health",
    reuseExistingServer: false,
    timeout: 30000
  }
});
