// End-to-end tests run the real frontend against the in-memory mock API
// (scripts/mock-server.mjs), so they need no database and are deterministic.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8765",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /e2e[\\/](catalog|course)\.spec\.mjs$/ },
  ],
  webServer: {
    command: "node scripts/mock-server.mjs",
    url: "http://localhost:8765/api/stats",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
