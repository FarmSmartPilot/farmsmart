/* Time the guided Demo tour start-to-finish (machine speed: click Next as soon as each step is ready). */
import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers";
import * as fs from "node:fs";

test("demo tour timing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await freshStart(page, "simple");
  const t0 = Date.now();
  await page.locator('[data-tour="demo"]').first().click();
  await page.getByRole("button", { name: /Start the guided tour/ }).click();
  const rows: { i: number; title: string; ms: number; target: boolean }[] = [];
  let last = Date.now();
  for (let i = 0; i < 30; i++) {
    const tour = page.locator('.fs-tour[data-ready="true"]');
    await expect(tour).toBeVisible({ timeout: 60_000 });
    const title = (await page.locator(".fs-tour__title").textContent())?.trim() ?? "";
    const target = (await page.locator(".fs-tour__spot").getAttribute("data-empty")) !== "true";
    const now = Date.now();
    rows.push({ i: i + 1, title, ms: now - last, target });
    last = now;
    const fin = page.locator(".fs-tour__card").getByRole("button", { name: "Finish" });
    if (await fin.isVisible()) {
      await fin.click();
      break;
    }
    await page.locator(".fs-tour__card").getByRole("button", { name: /^Next/ }).click();
  }
  await expect(page.locator(".fs-tour")).toHaveCount(0, { timeout: 10_000 });
  const total = Date.now() - t0;
  const lines = rows.map((r) => `| ${r.i} | ${r.title} | ${(r.ms / 1000).toFixed(1)} | ${r.target ? "yes" : "NO"} |`);
  const md = [`Demo tour: ${rows.length} steps, ${(total / 1000).toFixed(1)} s at machine speed (step ready → Next immediately).`, "", "| # | Step | s to ready | target found |", "|---|---|---|---|", ...lines].join("\n");
  fs.mkdirSync("../qc/reports", { recursive: true });
  fs.writeFileSync("../qc/reports/demo_tour_timing.md", md + "\n");
  console.log(md);
  expect(rows.length).toBeGreaterThanOrEqual(10);
  expect(rows.filter((r) => !r.target).map((r) => r.title), "every step spotlights its target").toEqual([]);
  expect(errors).toEqual([]);
});
