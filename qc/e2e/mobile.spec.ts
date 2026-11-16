/* iPhone (WebKit, 390×844 portrait): core path in the tabbed Field Studio layout. */
import { test, expect } from "@playwright/test";
import { freshStart, openPilot, goView, setMode, attachTiming, CARD_SECTIONS } from "./helpers";

test("iPhone core path: Story County, Iowa", async ({ page }) => {
  const t0 = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await freshStart(page);
  await openPilot(page, "Story County, Iowa");

  // Tabbed layout: Map · Options · Timeline · My Field
  const tabs = page.getByRole("navigation", { name: "Field Studio sections" });
  await expect(tabs).toBeVisible();
  for (const name of ["Map", "Options", "Timeline", "My Field"]) await expect(tabs.getByRole("button", { name })).toBeVisible();

  // From the map sheet → Options tab with cards (compare already ran on load)
  await page.getByRole("button", { name: /See rotation options/ }).first().click();
  await expect(page.locator(".ocards").first()).toBeVisible({ timeout: 90_000 });
  const n = await page.locator(".ocards > *").count();
  expect(n).toBeGreaterThanOrEqual(3);

  // Strategy Compare: 7 sections per card
  await goView(page, "Compare", true);
  const cols = page.locator("article.cmp-col");
  await expect(cols.first()).toBeVisible({ timeout: 60_000 });
  expect(await cols.count()).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < (await cols.count()); i++) {
    const det = cols.nth(i).locator("details.cmp-col__more");
    if ((await det.getAttribute("open")) === null) await det.locator("summary").click();
    const titles = (await cols.nth(i).locator(".sdetail h4.sblock__h").allTextContents()).map((x) => x.trim());
    for (const s of CARD_SECTIONS) expect(titles, `mobile card ${i}`).toContain(s);
  }

  // Why not others? (bottom sheet on mobile)
  await page.getByRole("button", { name: /why not others/i }).first().click();
  await expect(page.getByRole("heading", { name: "Rotations left out" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();

  // Expert + Next Move
  await setMode(page, "Expert", true);
  await goView(page, "Next Move", true);
  await expect(page.locator("svg[role=img]").first()).toBeVisible({ timeout: 60_000 });

  // Replay 2012
  await goView(page, "Drought Replay", true);
  await page.getByRole("group", { name: "Pick a year" }).getByRole("button", { name: "2012" }).click();
  await expect(page.getByText(/In 2012, modelled erosion was/)).toBeVisible({ timeout: 60_000 });

  // Twins
  await goView(page, "Climate Twins", true);
  await expect(page.getByText(/models agree|Novel climate/).first()).toBeVisible({ timeout: 90_000 });

  // Alerts
  await goView(page, "Alerts", true);
  await page.getByLabel("Email", { exact: true }).fill("farmer@example.com");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByText(/Check your email to confirm|Subscribed/).first()).toBeVisible({ timeout: 30_000 });

  // Export from the menu sheet
  await page.getByRole("button", { name: "Menu" }).click();
  const dl = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Export report" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);

  // No horizontal page scroll in portrait
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(1);
  attachTiming("iPhone core path", Date.now() - t0);
  expect(errors).toEqual([]);
});
