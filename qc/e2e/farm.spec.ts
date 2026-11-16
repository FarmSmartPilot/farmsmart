/* Whole farm (wave U9): the sample farm (three real cropland fields in central Iowa) on #/farm, the KPI strip with
   real numbers, the fields list, crop mix, profit range, diversification, the plan search with Apply / Undo, and
   "Add to my farm" on Compare plus the "One field | Whole farm" switch. Desktop 1440 and iPhone width 390.
   Screenshots go to qc/screenshots/farm/. No sideways scroll and no serious axe issues on the farm page. */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { freshStart, openPilot } from "./helpers";

const SHOTS = path.resolve(__dirname, "../screenshots/farm");

async function loadSample(page: Page) {
  await page.goto("/#/farm");
  await expect(page.getByRole("heading", { level: 1, name: "Your whole farm" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Add fields: open a field and press Add to my farm" })).toBeVisible();
  await page.getByTestId("farm-sample").click();
  // Three field tiles, then every one worked out (the first time on a server can take minutes).
  await expect(page.locator("[data-tile]")).toHaveCount(3, { timeout: 600_000 });
  await expect(page.locator(".farm-busy")).toHaveCount(0, { timeout: 600_000 });
  await expect(page.locator('[data-k="typical"]')).toHaveText(/\$\d/, { timeout: 60_000 });
}

async function showTable(page: Page) {
  await page.getByRole("radiogroup", { name: "Show fields as" }).getByRole("radio", { name: "Table" }).click();
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "no sideways scroll").toBeLessThanOrEqual(1);
}

test("whole farm: sample farm, KPIs, plan search (desktop)", async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, "simple");
  await loadSample(page);
  await expect(page.locator(".farm-sample-tag")).toHaveText(/Sample farm \(real fields, public data\)/);

  // KPI strip: fields, acres, typical, bad year, chance of a losing year, diversification bonus.
  const k = (id: string) => page.locator(`[data-k="${id}"]`);
  await expect(k("fields")).toHaveText("3");
  await expect(k("acres")).toHaveText(/^\d[\d,]*$/);
  for (const id of ["typical", "bad", "div"]) await expect(k(id)).toHaveText(/\$\d/);
  await expect(k("ploss")).toHaveText(/\d+ %/);
  const kp: Record<string, string> = {};
  for (const id of ["fields", "acres", "typical", "bad", "ploss", "div"]) kp[id] = ((await k(id).textContent()) ?? "").trim();
  console.log(`[farm] KPIs ${JSON.stringify(kp)}`);
  console.log(`[farm] diversification: ${(await page.locator(".farm-div__lead").textContent())?.trim()}`);
  console.log(`[farm] correlation: ${(await page.locator(".farm-div p.fs-meta").first().textContent())?.trim()}`);
  // Provenance: a green SI button on the farm result, a navy (NASA) and a gray (USDA) data button.
  await expect(page.locator(".farm-kpis .fs-dot--si")).toHaveCount(1);
  await expect(page.locator(".farm-kpis .fs-dot--nasa")).toHaveCount(1);
  await expect(page.locator(".farm-kpis .fs-dot--other")).toHaveCount(1);

  // Farm score (1-10) with its parts and an SI button; a score on every field tile.
  const score = page.getByTestId("farm-score");
  await expect(score.locator(".fsc-badge--lg")).toHaveText(/^\d+\.\d\/10$/);
  await expect(score.locator(".fs-dot--si")).toHaveCount(1);
  await expect(score.locator(".fsc-sub")).toHaveCount(3);
  console.log(`[farm] score: ${(await score.innerText()).replace(/\s+/g, " ").slice(0, 220)}`);
  await expect(page.locator("[data-tile] .fsc-badge")).toHaveCount(3);
  // Weight sliders: soil & water to the top and profit to zero changes the weights; Back to Balanced restores them.
  const s0 = (await score.locator(".fsc-badge--lg").textContent())?.trim();
  await score.getByTestId("score-adjust").click();
  await score.getByTestId("score-w-soil").focus();
  await page.keyboard.press("End");
  await score.getByTestId("score-w-profit").focus();
  await page.keyboard.press("Home");
  await expect(score.locator('[data-k="score-weights"]')).toContainText("Your own weights: profit 0 %");
  console.log(`[farm] own weights: ${(await score.locator('[data-k="score-weights"]').textContent())?.trim()} -> score ${(await score.locator(".fsc-badge--lg").textContent())?.trim()} (was ${s0})`);
  await score.getByTestId("score-w-reset").click();
  await expect(score.locator('[data-k="score-weights"]')).toContainText("Weighted for Balanced: profit 35 %");
  await expect(score.locator(".fsc-badge--lg")).toHaveText(s0 ?? "");
  // Drill into a field: its options with field and farm scores; picking one changes the farm, picking back restores it.
  await page.locator("[data-tile] .ftile__btn").first().click();
  const drawer = page.getByTestId("farm-drawer");
  await expect(drawer.getByRole("dialog")).toBeVisible();
  const dopts = drawer.getByTestId("farm-drawer-opt");
  console.log(`[farm] drawer options: ${(await dopts.allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).join(" | ")}`);
  if ((await dopts.count()) > 1) {
    const t0 = (await k("typical").textContent())?.trim();
    const on = await dopts.evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-checked") === "true"));
    const other = on === 0 ? 1 : 0;
    await dopts.nth(other).click();
    await expect(dopts.nth(other)).toHaveAttribute("aria-checked", "true");
    await expect(k("typical")).not.toHaveText(t0 ?? "", { timeout: 5_000 });
    await dopts.nth(on).click();
    await expect(k("typical")).toHaveText(t0 ?? "");
  }
  await page.screenshot({ path: path.join(SHOTS, "farm-desktop-drawer.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // Fields table: name, acres, current rotation, plan, typical and bad year per field.
  await showTable(page);
  const rows = page.locator("tbody tr[data-field]");
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const r = rows.nth(i);
    console.log(`[farm] field ${i + 1}: ${(await r.innerText()).replace(/\s+/g, " ").trim()}`);
    await expect(r.locator("td.num").nth(1)).toHaveText(/\$\d/);
  }
  // Crop mix: five years of stacked bars; profit range; cash flow (five rows); soil and water.
  await expect(page.locator(".farm-mix__row")).toHaveCount(5);
  await expect(page.locator(".farm-range__row")).toHaveCount(1);
  await expect(page.locator(".farm-cash tbody tr")).toHaveCount(5);
  await expect(page.locator(".farm-soil__item")).toHaveCount(4);
  await page.screenshot({ path: path.join(SHOTS, "farm-desktop-1440.png"), fullPage: true });

  // Plan search: balanced, then the safest; result with an SI button, Apply and Undo.
  await page.getByTestId("farm-optimize").click();
  const res = page.getByTestId("farm-opt-result");
  await expect(res).toBeVisible({ timeout: 30_000 });
  await expect(res.locator(".fs-dot--si")).toHaveCount(1);
  console.log(`[farm] optimizer (balanced): ${(await res.locator(".farm-opt__title").textContent())?.trim()}`);
  for (const li of await res.locator(".farm-reasons li").all()) console.log(`[farm]   ${(await li.innerText()).replace(/\s+/g, " ").trim()}`);
  const deltas = res.locator(".farm-delta");
  if (await deltas.count()) console.log(`[farm]   deltas: ${(await deltas.allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).join(" | ")}`);
  if (await res.locator(".farm-opt__beat").count()) console.log(`[farm]   ${(await res.locator(".farm-opt__beat").textContent())?.trim()}`);
  await page.locator(".farm-opt").screenshot({ path: path.join(SHOTS, "farm-optimizer-desktop.png") });

  for (const risk of ["Most money", "Safest"]) {
    await page.getByRole("radiogroup", { name: "What matters most" }).getByRole("radio", { name: risk }).click();
    await expect(res).toBeVisible();
    console.log(`[farm] optimizer (${risk}): ${(await res.locator(".farm-opt__title").textContent())?.trim()} | ${(await res.locator(".farm-reasons li.is-changed").allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).join(" / ")}`);
  }
  await page.getByRole("radiogroup", { name: "What matters most" }).getByRole("radio", { name: "Balanced" }).click();
  // A limit on one crop's share: the suggestion keeps every year within it (or says it cannot).
  await page.getByLabel("Most of the farm one crop may take").selectOption("0.7");
  await expect(res).toBeVisible();
  console.log(`[farm] optimizer (balanced, max 70 % one crop): ${(await res.locator(".farm-opt__title").textContent())?.trim()} | ${(await res.locator(".farm-reasons li.is-changed").allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).join(" / ")}`);
  if (!(await res.locator(".money-note").count())) {
    const deltasCap = (await res.locator(".farm-delta").allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).join(" | ");
    console.log(`[farm]   deltas: ${deltasCap}`);
  }
  await page.getByLabel("Most of the farm one crop may take").selectOption("");

  const apply = page.getByTestId("farm-apply");
  if (await apply.count()) {
    const before = (await k("typical").textContent())?.trim();
    await apply.click();
    await expect(page.locator(".farm-applied")).toContainText("The suggested plan is now your plan.");
    await expect(page.locator(".farm-range__row")).toHaveCount(2);
    console.log(`[farm] after apply: typical ${before} -> ${(await k("typical").textContent())?.trim()}, bad ${(await k("bad").textContent())?.trim()}`);
    await page.screenshot({ path: path.join(SHOTS, "farm-desktop-applied.png"), fullPage: true });
    await page.locator(".farm-applied").getByRole("button", { name: "Undo" }).click();
    await expect(k("typical")).toHaveText(before ?? "");
  }

  // Changing one field's plan changes the farm.
  const t0 = (await k("typical").textContent())?.trim();
  const sel = page.locator('select[data-testid^="farm-plan-"]').first();
  const opts = await sel.locator("option:not([disabled])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  if (opts.length > 1) {
    await sel.selectOption(opts[1]);
    await expect(k("typical")).not.toHaveText(t0 ?? "", { timeout: 5_000 });
    await sel.selectOption(opts[0]);
    await expect(k("typical")).toHaveText(t0 ?? "");
  }

  // Spanish.
  await page.evaluate(() => {
    const raw = localStorage.getItem("fieldshift-app");
    const o = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    o.state.lang = "es";
    localStorage.setItem("fieldshift-app", JSON.stringify(o));
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Toda su finca" })).toBeVisible({ timeout: 30_000 });
  await expect(k("typical")).toHaveText(/\$\d/, { timeout: 120_000 });
  await page.screenshot({ path: path.join(SHOTS, "farm-desktop-es.png"), fullPage: false });

  await noSideScroll(page);
  const axe = await new AxeBuilder({ page }).include(".farm").analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of serious) console.log(`[farm] axe ${v.id}: ${v.nodes.length} node(s) ${v.nodes[0]?.target}`);
  expect(serious, "no serious axe issues").toHaveLength(0);
  expect(errors, "no page errors").toEqual([]);
});

test("whole farm: Add to my farm on Compare, switch and My fields toggle", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, "simple");
  await openPilot(page, "Story County, Iowa");
  await page.getByRole("button", { name: /^Next: / }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare your options." })).toBeVisible({ timeout: 60_000 });
  // The switch at the top of the guided panel.
  const sw = page.locator(".rail").getByRole("radiogroup", { name: "Look at one field or the whole farm" });
  await expect(sw.getByRole("radio", { name: "One field" })).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("add-to-farm").first().click();
  await expect(page.locator(".farm-added__tag").first()).toHaveText(/In my farm/);
  await expect(sw.getByRole("radio", { name: "Whole farm (1)" })).toBeVisible();
  await sw.getByRole("radio", { name: "Whole farm (1)" }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.locator("[data-tile]")).toHaveCount(1);
  await expect(page.locator('[data-k="typical"]')).toHaveText(/\$\d/, { timeout: 120_000 });
  await expect(page.locator('[data-k="div"]')).toHaveText("—");
  // Back to one field.
  await sw.getByRole("radio", { name: "One field" }).click();
  await expect(page).toHaveURL(/#\/studio\//);
  // My fields: the "In my farm" toggle takes it out again.
  await page.goto("/#/fields");
  const toggle = page.locator(".myfields__item").first().getByLabel("In my farm");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(sw.getByRole("radio", { name: "Whole farm" })).toBeVisible();
  expect(errors, "no page errors").toEqual([]);
});

test.describe("iPhone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test("whole farm at 390 px", async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await freshStart(page, "simple");
    await loadSample(page);
    await expect(page.locator("[data-tile]")).toHaveCount(3);
    await expect(page.getByTestId("farm-score")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: path.join(SHOTS, "farm-iphone-390.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "farm-iphone-390-top.png"), fullPage: false });
    await page.getByTestId("farm-optimize").click();
    await expect(page.getByTestId("farm-opt-result")).toBeVisible({ timeout: 30_000 });
    await noSideScroll(page);
    await page.locator(".farm-opt").screenshot({ path: path.join(SHOTS, "farm-iphone-390-optimizer.png") });
    // The switch is in the phone menu.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("radiogroup", { name: "Look at one field or the whole farm" }).getByRole("radio", { name: "Whole farm (3)" })).toHaveAttribute("aria-checked", "true");
    expect(errors, "no page errors").toEqual([]);
  });
});

test("step 5 what next, Add another field opens the map at the field, Demo sample farm", async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page, "simple");
  await openPilot(page, "Story County, Iowa");
  await page.evaluate(() => (location.hash = "#/plan/b96d39c7a833"));
  const next = page.getByTestId("farm-next");
  await expect(next.getByRole("heading", { name: "What next?" })).toBeVisible({ timeout: 60_000 });
  await next.getByTestId("add-to-farm").click();
  await expect(next).toContainText("This field is in your farm");
  await next.getByTestId("add-another-field").click();
  await expect(page.getByRole("heading", { level: 1, name: "Find your farm." })).toBeVisible({ timeout: 30_000 });
  // The Demo menu fills the whole farm with the three sample fields (the Story field is already in, so it stays once).
  await page.getByRole("button", { name: "Demo" }).click();
  await page.getByTestId("demo-sample-farm").click();
  await expect(page.getByRole("heading", { level: 1, name: "Your whole farm" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-tile]")).toHaveCount(3, { timeout: 600_000 });
});
