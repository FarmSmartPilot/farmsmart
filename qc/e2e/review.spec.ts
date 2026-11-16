/* Visual review: every page of the guided path and the tools, at desktop and phone width, as full-page screenshots
   in qc/screenshots/review/. Not part of the regular suite (run it by name). */
import { test } from "@playwright/test";
import { freshStart, openPilot } from "./helpers";

const FIELD = "b96d39c7a833";
const PAGES: { id: string; hash: string; wait?: string }[] = [
  { id: "01-welcome", hash: "#/welcome", wait: ".wel-hero" },
  { id: "02-find-farm", hash: "#/", wait: ".ghome, .home" },
  { id: "03-check-field", hash: `#/studio/${FIELD}`, wait: ".guided--s2" },
  { id: "04-compare", hash: `#/compare/${FIELD}`, wait: ".ocards" },
  { id: "05-money", hash: `#/money/${FIELD}`, wait: ".money, .guided" },
  { id: "06-replay", hash: `#/replay/${FIELD}`, wait: ".rp-kpis" },
  { id: "07-plan", hash: `#/plan/${FIELD}`, wait: ".plan-stages" },
  { id: "08-twins", hash: `#/twins/${FIELD}`, wait: ".twin-card" },
  { id: "09-builder", hash: `#/builder/${FIELD}` },
  { id: "10-saved", hash: "#/saved" },
  { id: "11-alerts", hash: `#/alerts/${FIELD}` },
  { id: "12-validation", hash: "#/validation" },
  { id: "13-sources", hash: `#/sources/${FIELD}` },
  { id: "14-season", hash: `#/wheel/${FIELD}` },
  { id: "15-my-fields", hash: "#/fields" },
];
const SIZES = [
  { tag: "1440", w: 1440, h: 900 },
  { tag: "390", w: 390, h: 844 },
];

for (const s of SIZES) {
  test(`review screenshots ${s.tag}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: s.w, height: s.h });
    await freshStart(page, "simple");
    await openPilot(page, "Story County, Iowa");
    for (const p of PAGES) {
      await page.evaluate((h) => (location.hash = h), p.hash);
      if (p.wait) await page.locator(p.wait).first().waitFor({ timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `../qc/screenshots/review/${s.tag}_${p.id}.png`, fullPage: true });
    }
  });
}
