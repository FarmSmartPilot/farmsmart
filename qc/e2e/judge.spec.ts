/* Brief §8 judge path, desktop Chromium 1440×900. */
import { test, expect } from "@playwright/test";
import { freshStart, openPilot, goView, setMode, assertCompareCards, attachTiming } from "./helpers";

test("judge path: Story County, Iowa", async ({ page }) => {
  const t0 = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await freshStart(page);

  // 1. Search works (API geocoder), then open the pilot field
  const search = page.getByRole("combobox").first().or(page.getByLabel(/search/i).first());
  await search.fill("Story County, Iowa");
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await openPilot(page, "Story County, Iowa");

  // 2. Field Studio loads
  await expect(page.getByText("MY PRIORITIES", { exact: false }).or(page.getByText("My priorities")).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /rotation options/i })).toBeVisible();

  // 3. Rotation options appear on their own (compare runs on load), with plain-word names
  await expect(page.locator(".ocards").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ocard__title", { hasText: "×" }), "no '×2' notation in card titles").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change priorities" })).toBeVisible();
  const ocards = await page.locator(".ocards > *").count();
  expect(ocards, "option cards in Field Studio").toBeGreaterThanOrEqual(3);
  await goView(page, "Compare");
  const n = await assertCompareCards(page);
  console.log(`compare cards: ${n}`);

  // 4. Why not others?
  await page.getByRole("button", { name: /why not others/i }).first().click();
  await expect(page.getByRole("heading", { name: "Rotations left out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crops that do not fit here" })).toBeVisible();
  const active = await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  console.log(`why-not popover has focus: ${active}`);
  await page.keyboard.press("Escape");
  const escClosed = await page.getByRole("dialog", { name: "Why not others?" }).isHidden();
  console.log(`why-not popover closes on Escape: ${escClosed}`);
  if (!escClosed) await page.getByRole("dialog", { name: "Why not others?" }).getByRole("button", { name: "Close" }).click();

  // 5. Expert + Next Move
  await setMode(page, "Expert");
  await goView(page, "Next Move");
  await expect(page.locator("h1").first()).toContainText(/Next Move|next/i, { timeout: 60_000 });
  await expect(page.locator("svg[role=img]").first()).toBeVisible({ timeout: 60_000 });

  // 6. Drought Replay 2012
  await goView(page, "Drought Replay");
  await page.getByRole("group", { name: "Pick a year" }).getByRole("button", { name: "2012" }).click();
  await expect(page.getByRole("img", { name: /Soil water through the year/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/In 2012, modelled erosion was/)).toBeVisible();

  // 7. Climate Twins
  await goView(page, "Climate Twins");
  await expect(page.getByText(/models agree|Novel climate/).first()).toBeVisible({ timeout: 90_000 });

  // 8. Subscribe to an alert (no SMTP: local outbox)
  await goView(page, "Alerts");
  await page.getByLabel("Email", { exact: true }).fill("farmer@example.com");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByText(/Subscribed|Check your email to confirm|Saved\./).first()).toBeVisible({ timeout: 30_000 });

  // 9. Export the PDF
  const dl = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Export report" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);
  const p = await d.path();
  const fs = await import("node:fs");
  const head = fs.readFileSync(p!).subarray(0, 5).toString();
  expect(head).toBe("%PDF-");

  const ms = Date.now() - t0;
  attachTiming("judge path total", ms);
  expect(ms, "judge path under 2 minutes").toBeLessThan(120_000);
  expect(errors, "no uncaught page errors").toEqual([]);
});
