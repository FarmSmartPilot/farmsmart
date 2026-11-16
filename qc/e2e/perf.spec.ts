/* Browser performance at 1440×900 (Chromium): first globe render, cached pilot → cards, compare re-run. */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import { freshStart } from "./helpers";

test("performance", async ({ page }) => {
  const res: Record<string, number | string | null> = {};
  let globeMs: number | null = null;
  page.on("console", (m) => {
    const x = /\[GlobeView\] first globe render (\d+) ms/.exec(m.text());
    if (x) globeMs = Number(x[1]);
  });
  const tNav = Date.now();
  await freshStart(page);
  await expect.poll(() => globeMs, { timeout: 60_000 }).not.toBeNull();
  res.globe_first_render_ms_logged = globeMs;
  res.home_to_globe_wall_ms = Date.now() - tNav;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp ? fcp.startTime : null };
  });
  res.dom_content_loaded_ms = Math.round(nav.dcl);
  res.load_ms = Math.round(nav.load);
  res.first_contentful_paint_ms = nav.fcp === null ? null : Math.round(nav.fcp);

  // Cached pilot: click → Field Studio report visible → compare cards visible
  // Sample farms are in the Demo menu.
  const pb = page.locator(".demomenu__item").filter({ has: page.getByText("Story County, Iowa", { exact: true }) });
  // The click can be lost while software WebGL renders the globe: retry until the menu is open.
  await expect(async () => {
    if (!(await pb.isVisible())) await page.locator('[data-tour="demo"]').first().click();
    await expect(pb).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // In-page timing (excludes Playwright's actionability waits while software-rendered WebGL hogs the main thread).
  res.in_page_click_to_studio_ms = await page.evaluate(async () => {
    const b = [...document.querySelectorAll(".demomenu__item")].find((x) => x.querySelector(".demomenu__name")?.textContent?.trim() === "Story County, Iowa") as HTMLButtonElement;
    const t = performance.now();
    b.click();
    const inDom = () => document.querySelector("#opt-h") !== null;
    while (!inDom()) await new Promise((r) => setTimeout(r, 10));
    const tDom = performance.now() - t;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(Math.max(tDom, performance.now() - t));
  });
  await page.goto("about:blank");
  await page.goto("/");
  await expect(async () => {
    if (!(await pb.isVisible())) await page.locator('[data-tour="demo"]').first().click();
    await expect(pb).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const t0 = Date.now();
  await pb.click();
  await expect(page).toHaveURL(/#\/studio\//, { timeout: 60_000 });
  res.pilot_click_to_studio_url_ms = Date.now() - t0;
  await expect(page.getByRole("heading", { name: /rotation options/i })).toBeVisible();
  res.pilot_click_to_studio_ms = Date.now() - t0;
  await page.getByRole("radiogroup", { name: /view/i }).getByRole("radio", { name: "Area Report" }).click();
  await expect(page.locator("ul.coverage li").first()).toBeVisible({ timeout: 30_000 });
  res.pilot_click_to_area_report_ms = Date.now() - t0;
  const t1 = Date.now();
  await page.getByRole("button", { name: /See rotation options/ }).first().click();
  await expect(page.locator(".ocards > *").nth(2)).toBeVisible({ timeout: 60_000 });
  res.compare_click_to_cards_ms = Date.now() - t1; // compare now runs on load: this is the click-to-visible time
  res.pilot_click_to_cards_total_ms = Date.now() - t0;

  // Re-run: move a priority (▼ on the first chip) → options re-rank
  const t2 = Date.now();
  const respP = page.waitForResponse((r) => r.url().includes("/compare") && r.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: /^Move .* down|down/i }).first().click();
  await respP;
  await expect(page.locator(".panel__scroll[aria-busy='true']")).toHaveCount(0, { timeout: 60_000 });
  res.priority_change_rerun_ms = Date.now() - t2;

  fs.mkdirSync("../qc/reports", { recursive: true });
  fs.writeFileSync("../qc/reports/perf_browser.json", JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
});
