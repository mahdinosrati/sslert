import { defineConfig } from "@playwright/test";

// UI-only coverage with deterministic API fixtures; no Docker/database required.
export default defineConfig({
  testDir: "./e2e-i18n",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: process.env.SSLERT_BROWSER_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
  },
});
