/* Repeat the core path (open pilot → cards → twins) for the non-Iowa pilots and check honest coverage flags. */
import { test, expect } from "@playwright/test";
import { freshStart, openPilot, goView, assertCompareCards, attachTiming } from "./helpers";

const PILOTS = [
  { label: "Garden City, Kansas (dryland)", expectFlags: /Partial|Not available/ },
  { label: "Near Regina, Saskatchewan", expectFlags: /Partial|Not available/ },
  { label: "Near Ludhiana, Punjab (India)", expectFlags: /Partial|Not available/ },
];

for (const p of PILOTS) {
  test(`core path: ${p.label}`, async ({ page }) => {
    const t0 = Date.now();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await freshStart(page);
    await openPilot(page, p.label);

    // Area Report coverage panel shows honest partial / not-available flags
    await page.getByRole("radiogroup", { name: /view/i }).getByRole("radio", { name: "Area Report" }).click();
    const cov = page.locator("ul.coverage li");
    await expect(cov.first()).toBeVisible({ timeout: 60_000 });
    const flags = await page.locator("ul.coverage li.cov--partial, ul.coverage li.cov--unavailable").allTextContents();
    console.log(`${p.label} coverage flags:\n  - ${flags.join("\n  - ")}`);
    expect(flags.length, "at least one honest partial/unavailable coverage flag").toBeGreaterThan(0);

    // Cards
    await page.getByRole("button", { name: /See rotation options/ }).first().click();
    await expect(page.locator(".ocards").first()).toBeVisible({ timeout: 90_000 });
    await goView(page, "Compare");
    const cols = page.locator("article.cmp-col");
    await expect(cols.first()).toBeVisible({ timeout: 90_000 });
    const n = await cols.count();
    if (n >= 3) {
      await assertCompareCards(page);
    } else {
      // Fewer than two alternatives: brief requires naming the binding constraint + adjustments.
      console.log(`${p.label}: only ${n} cards; checking binding-constraint banner`);
      await goView(page, "Field Studio");
      await expect(page.getByText("Fewer than two alternatives fit")).toBeVisible({ timeout: 30_000 });
      await goView(page, "Compare");
      const det = cols.first().locator("details.cmp-col__more");
      await assertCompareCards(page, 2);
    }
    const noCosts = await page.getByText("Costs and prices not connected for this region").count();
    console.log(`${p.label}: cards=${n}, no-costs note shown=${noCosts > 0}`);

    // Climate Twins
    await goView(page, "Climate Twins");
    await expect(page.getByText(/models agree|Novel climate/).first()).toBeVisible({ timeout: 120_000 });
    attachTiming(`core path ${p.label}`, Date.now() - t0);
    expect(errors).toEqual([]);
  });
}
