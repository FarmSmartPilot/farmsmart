// Full-page screenshots of the whole-farm dashboard (sample farm), the field drill-in and a phone view.
// Usage (from web/): node ../qc/e2e/farm_shots.mjs [baseURL]   → qc/screenshots/farm/u10_*.png
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.cwd(), "../qc/screenshots/farm"); // run from web/
const base = process.argv[2] ?? "http://localhost:5173";

const browser = await chromium.launch();
for (const vp of [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(`${base}/#/welcome`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("fieldshift-app", JSON.stringify({ state: { mode: "simple" }, version: 0 }));
  });
  await page.goto(`${base}/#/farm`);
  await page.getByTestId("farm-sample").click();
  await page.locator("[data-tile]").first().waitFor({ timeout: 600_000 });
  await page.locator(".farm-busy").waitFor({ state: "detached", timeout: 600_000 }).catch(() => {});
  await page.getByTestId("farm-score").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, `u10_farm_${vp.tag}.png`), fullPage: true });
  await page.locator("[data-tile] .ftile__btn").first().click();
  await page.getByTestId("farm-drawer").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `u10_drawer_${vp.tag}.png`) });
  await page.close();
}
await browser.close();
console.log("shots done");
