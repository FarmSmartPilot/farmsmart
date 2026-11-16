/* Playwright config for the intro video recording (qc/video/intro.spec.ts). */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /intro\.spec\.ts/,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./out",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.FS_BASE ?? "http://localhost:5173",
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
  },
});
