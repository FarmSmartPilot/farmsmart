/* Separate config for the visual review screenshots (review.spec.ts), so the regular suite never runs them. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /review\.spec\.ts/,
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../reports/e2e-artifacts-review",
  use: { baseURL: process.env.FS_BASE ?? "http://localhost:5173", ...devices["Desktop Chrome"] },
});
