/* Money calculator (wave U6), Story County: open it from guided step 3, three option columns each with typical /
   bad / good and the plain risk sentences, editing the corn price changes the result, and "Drought years" re-runs on
   the driest weather sequences. No sideways scroll and no serious axe issues.
   Wave U8: the place search sits under the map on step 2 (not in the top bar), the Prices panel shows a plain headline
   per crop, the "plan with" price choice changes the result, each switch has a payback sentence and a year-by-year
   table, and NOAA's season outlook is under "What can go wrong here". */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshStart, openPilot, attachTiming } from "./helpers";

test("money calculator from guided step 3 (Story County)", async ({ page }) => {
  test.setTimeout(240_000);
  const t0 = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await freshStart(page, "simple");
  await openPilot(page, "Story County, Iowa");
  await expect(page.getByRole("heading", { level: 1, name: "Check your field." })).toBeVisible({ timeout: 60_000 });
  // Step 2: "Wrong place? Search for your farm" under the map; no search in the top bar on guided field pages.
  const under = page.locator(".guided-search");
  await expect(under).toContainText("Wrong place? Search for your farm");
  await expect(under.getByRole("combobox")).toBeVisible();
  await expect(page.locator(".topbar .search")).toHaveCount(0);
  await page.getByRole("button", { name: /^Next: / }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare your options." })).toBeVisible({ timeout: 60_000 });

  // Step 3: "Work out the money →" under the options.
  const go = page.locator(".guided-money").getByRole("button", { name: /^Work out the money/ });
  await expect(go).toBeVisible({ timeout: 60_000 });
  await go.click();
  await expect(page).toHaveURL(/#\/money\//);
  await expect(page.getByRole("heading", { level: 1, name: /Work out the money|Money: revenue, costs and risk/ })).toBeVisible({ timeout: 30_000 });

  // Three option columns (current + best for you + next), each with typical, bad and good years and risk sentences.
  const cols = page.locator("article.money-col");
  await expect(cols).toHaveCount(3, { timeout: 120_000 });
  for (let i = 0; i < 3; i++) {
    const col = cols.nth(i);
    for (const k of ["typical", "bad", "good"]) await expect(col.locator(`[data-k="${k}"]`)).toHaveText(/\$\d/);
    await expect(col.locator(".money-lead")).toContainText("Typical year");
    await expect(col.locator(".money-risk li").first()).toHaveText(/^Chance of losing money in a year/);
  }
  await expect(cols.nth(0)).toContainText("Current");
  await expect(page.locator(".money-risk li", { hasText: /beat what you grow now|Beats what you grow now/i }).first()).toBeVisible();

  // Each switch says when it pays back (or that it does not), in one plain sentence.
  for (let i = 1; i < 3; i++)
    await expect(cols.nth(i).locator('[data-k="payback"]')).toHaveText(/^(Pays back by year \d+|Does not pay back within \d+ years|Earns (more|less) than staying put)/);
  await page.locator("summary", { hasText: "Show the switch year by year" }).click();
  await expect(page.locator(".cf").first().locator('[data-k="cf-sentence"]')).toHaveText(/in a typical year\.$/);
  await expect(page.locator(".cf__table").first().locator("tbody tr")).toHaveCount(5);
  console.log(`[money] payback: ${(await cols.nth(1).locator('[data-k="payback"]').textContent())?.trim()}`);

  // Prices: a plain headline per crop (USDA NASS price received + the WASDE forecast).
  const head = page.locator(".mk-head").first();
  await expect(head).toHaveText(/^Corn in Iowa: \$\d+\.\d\d\/bu in \w+ \d{4}/, { timeout: 30_000 });
  await expect(page.locator(".mk-head").first()).toContainText("USDA forecast, not a promise");
  console.log(`[money] markets: ${(await head.textContent())?.trim()}`);

  // "Plan with" (price basis) changes the result: latest month instead of USDA typical, then back.
  const typical = cols.nth(0).locator('[data-k="typical"]');
  const t0b = (await typical.textContent())?.trim();
  const basis = page.getByLabel("Corn: plan with");
  await basis.selectOption("latest");
  await expect(typical).not.toHaveText(t0b ?? "", { timeout: 5_000 });
  console.log(`[money] typical with latest corn price: ${t0b} -> ${(await typical.textContent())?.trim()}`);
  await basis.selectOption("usda");
  await expect(typical).toHaveText(t0b ?? "", { timeout: 5_000 });

  // NOAA season outlook under "What can go wrong here" (US field).
  await expect(page.locator('.money-haz [data-k="outlook"]')).toHaveText(/^NOAA's outlook for .+: /, { timeout: 30_000 });

  // Editing the corn price changes the result.
  const before = (await typical.textContent())?.trim();
  const price = page.getByLabel(/^Corn: Price/);
  await expect(price).toBeVisible();
  const p0 = Number(await price.inputValue());
  expect(p0, "USDA corn price filled in").toBeGreaterThan(0);
  await price.fill(String(Math.round((p0 + 1) * 100) / 100));
  await expect(typical).not.toHaveText(before ?? "", { timeout: 5_000 });
  const after = (await typical.textContent())?.trim();
  console.log(`[money] current rotation typical: ${before} -> ${after} after corn price ${p0} -> ${p0 + 1}`);

  // Drought years: only the driest 20 % of weather sequences.
  const status = page.locator(".money-stress__note");
  await page.getByText("Test bad years", { exact: true }).click();
  await page.getByRole("button", { name: "Drought years", exact: true }).click();
  await expect(page.getByRole("button", { name: "Drought years", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(status).toContainText("driest 20 %");
  await expect(page.locator(".money-stress-on")).toContainText("Drought years");
  await expect(typical).toHaveText(/\$\d/);
  console.log(`[money] drought typical: ${(await typical.textContent())?.trim()}`);

  // Layout and accessibility.
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw, "no sideways scroll").toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), "axe on Money").toEqual([]);

  // Back to Compare options.
  await page.getByRole("button", { name: /Back to Compare options/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare your options." })).toBeVisible({ timeout: 30_000 });
  expect(errors, "no page errors").toEqual([]);
  attachTiming("money calculator", Date.now() - t0);
});
