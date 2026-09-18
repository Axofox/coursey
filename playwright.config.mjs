// End-to-end tests run the real frontend against the in-memory mock API
// (scripts/mock-server.mjs), so they need no database and are deterministic.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  fullyParallel: false,
  workers: 1, // one shared dev server + database; specs reset it between tests
  workers: 1, // one shared database — specs reset it between tests
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
    command: "TEST_HOOKS=1 node scripts/dev-server.mjs",
    url: "http://localhost:8765/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
