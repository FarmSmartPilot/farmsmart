/* FarmSmart e2e + QC config. Run from web/:  npx playwright test -c ../qc/e2e
   Assumes API on :8000 and Vite on :5173 are already running (start.ps1). */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "../reports/e2e_results.json" }]],
  outputDir: "../reports/e2e-artifacts",
  use: {
    baseURL: process.env.FS_BASE ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop-chromium", testMatch: /(judge|pilots|demo|axe|perf|spacing|guided|money|farm|u9)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Intended: real WebKit. On this PC Windows Smart App Control blocks Playwright's WebKit DLLs
    // (launch exit 0xC0E90002), so the same specs also run in Chromium with iPhone emulation.
    { name: "iphone-webkit", testMatch: /(mobile|axe-mobile)\.spec\.ts/, use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    {
      name: "iphone-chromium-emulated",
      testMatch: /(mobile|axe-mobile)\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 }, defaultBrowserType: undefined },
    },
  ],
});
