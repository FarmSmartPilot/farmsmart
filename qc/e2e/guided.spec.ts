/* Guided path (Simple mode, the default): Story County field → steps 2–5 with Next, at the desktop side-pane width
   and on a phone. Each step page has its heading, nothing scrolls sideways, and axe finds no serious issues. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshStart, openPilot, attachTiming } from "./helpers";

const SIZES = [
  { tag: "960", w: 960, h: 900 },
  { tag: "1440", w: 1440, h: 900 },
  { tag: "390", w: 390, h: 844 },
];
const STEPS = [
  { n: 2, title: "Check your field." },
  { n: 3, title: "Compare your options." },
  { n: 4, title: "Test it against real weather." },
  { n: 5, title: "Make it your plan." },
];

for (const s of SIZES) {
  test(`guided path ${s.tag}`, async ({ page }) => {
    test.setTimeout(240_000);
    const t0 = Date.now();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: s.w, height: s.h });
    await freshStart(page, "simple");
    await openPilot(page, "Story County, Iowa");
    for (const st of STEPS) {
      await expect(page.getByRole("heading", { level: 1, name: st.title })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(`Step ${st.n} of 5`).first()).toBeVisible();
      if (st.n === 2) await expect(page.locator('[data-tour="crop-history"]')).toBeVisible({ timeout: 30_000 });
      if (st.n === 3) {
        await expect(page.locator('[data-tour="priorities"]')).toBeVisible();
        await expect(page.locator(".ocards > *").nth(2)).toBeVisible({ timeout: 60_000 });
      }
      if (st.n === 4) await expect(page.locator(".rp-kpis")).toBeVisible({ timeout: 60_000 });
      if (st.n === 5) await expect(page.locator(".plan-stages")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(600);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `no sideways scroll on step ${st.n} at ${s.w}px`).toBeLessThanOrEqual(s.w + 1);
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), `axe step ${st.n} at ${s.w}px`).toEqual([]);
      if (st.n < 5) await page.getByRole("button", { name: new RegExp(`^Next: `) }).click();
    }
    // Back goes one step back.
    await page.getByRole("button", { name: /^← Back: Test the weather/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Test it against real weather." })).toBeVisible({ timeout: 30_000 });
    expect(errors, "no page errors").toEqual([]);
    attachTiming(`guided path ${s.tag}`, Date.now() - t0);
  });
}
