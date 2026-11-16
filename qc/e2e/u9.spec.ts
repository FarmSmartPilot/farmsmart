/* Wave U9 notes UI (F2), Story County pilot:
   - Welcome leads with the farmer's questions (earn, bad year, what to plant, pests and disease), each with a live
     answer, the whole-farm view, and one sourced line on farmers' top worries.
   - Money page: the headline names what is counted (gross margin vs net profit after all costs), the evidence line
     (seasons × price years), "What's counted", and how insurance losses avoid double counting.
   - Alerts: the SMS placeholder is disabled and says nothing is stored or sent.
   - Offline (production build only, e.g. FS_BASE=http://localhost:5176 from `vite preview`): "Save this field for
     offline" on step 2, then offline the money page still shows its answer and the offline bar names the save date.
   Screenshots go to qc/screenshots/u9/. */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "path";
import { freshStart } from "./helpers";

const FID = "b96d39c7a833";
const SHOTS = path.join(__dirname, "..", "screenshots", "u9");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function simple(page: Page, hash: string) {
  await freshStart(page, "simple");
  await page.goto(`/${hash}`);
}

test("welcome leads with the farmer's questions and the whole farm", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await simple(page, "#/welcome");
  const qs = page.getByTestId("welcome-questions");
  await expect(qs).toBeVisible({ timeout: 60_000 });
  const cards = qs.locator("article.wel-question");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0).locator("h3")).toHaveText("How much could I earn, after costs?");
  await expect(cards.nth(1).locator("h3")).toHaveText("What happens in a bad year?");
  await expect(cards.nth(2).locator("h3")).toHaveText("So what should I plant?");
  await expect(cards.nth(3).locator("h3")).toHaveText("Will it cut pests and disease?");
  // Live answers from the Story County field (compare + money endpoints), not typed numbers.
  await expect(cards.nth(0).locator(".wel-question__ex")).toContainText(/about \$\d/, { timeout: 90_000 });
  await expect(cards.nth(0).locator(".wel-question__ex2")).toContainText(/Operating costs counted, per acre: .*\$\d+/, { timeout: 90_000 });
  await expect(cards.nth(1).locator(".wel-question__ex")).toContainText(/\$\d/);
  await expect(cards.nth(2).locator(".wel-question__ex")).toContainText(/\d+ rotations tested/);
  await expect(cards.nth(3).locator(".wel-question__ex")).toContainText(/\d+% of crop changes/);
  // One sourced line on farmers' worries, with gray (non-NASA) source buttons; no survey ranking claimed.
  await expect(qs.locator(".wel-worries")).toContainText("Input costs and weather are farmers' top worries");
  await expect(qs.locator(".wel-worries button")).toHaveCount(2);
  await expect(page.getByTestId("welcome-farm")).toContainText("Plan all your fields together");
  for (const x of await cards.locator(".wel-question__ex").allTextContents()) console.log(`[welcome] ${x}`);
  await shot(page, "welcome-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards.nth(0)).toBeVisible();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);
  await shot(page, "welcome-390");
  expect(errors).toEqual([]);
});

test("money page: gross margin vs net profit, evidence, what's counted, no double counting", async ({ page }) => {
  test.setTimeout(240_000);
  await simple(page, `#/money/${FID}`);
  const head = page.getByTestId("money-headline");
  await expect(head).toHaveText("Profit after operating costs (gross margin)", { timeout: 120_000 });
  await expect(page.locator("article.money-col").first()).toBeVisible({ timeout: 120_000 });
  const ev = page.getByTestId("money-evidence");
  await expect(ev).toHaveText(/^Based on \d+ real (growing seasons|weather sequences) .*× \d+ price years \(\d{4}–\d{4}\)( = \d+ combinations per option)?\.$/);
  console.log(`[money] ${await ev.textContent()}`);

  const counted = page.getByTestId("money-counted");
  await counted.locator("summary").click();
  await expect(counted).toContainText("Operating costs");
  await expect(counted).toContainText(/Seed/);
  await expect(counted).toContainText("Not counted now: fixed costs");

  const loss = page.getByTestId("money-lossnote");
  await loss.locator("summary").click();
  await expect(loss).toContainText("Drought, heat and frost during the season are already in the");
  await expect(loss).toContainText("nothing is counted twice");
  await shot(page, "money-gross-1440");

  // Fixed costs on: the headline says net profit after all costs, and the fixed-cost lines are listed.
  await page.locator("summary", { hasText: "Show cost details" }).click();
  await page.getByRole("checkbox", { name: /Include fixed costs/ }).check();
  await expect(head).toHaveText("Net profit after all costs");
  await expect(counted).toContainText(/Land/);
  await shot(page, "money-net-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);
  await head.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "money-net-390.png") });
});

test("alerts: SMS placeholder is disabled and stores nothing", async ({ page }) => {
  await simple(page, `#/alerts/${FID}`);
  const sms = page.getByTestId("sms-soon");
  await expect(sms).toContainText("Text message (SMS) alerts: coming soon", { timeout: 60_000 });
  await expect(sms.getByRole("textbox", { name: "Mobile phone number" })).toBeDisabled();
  await expect(sms).toContainText("no phone number is stored or sent");
  await sms.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "alerts-sms-1440.png") });
});

test("offline: save a field, then open it without a connection (production build)", async ({ page, context, baseURL }) => {
  test.setTimeout(300_000);
  await simple(page, `#/studio/${FID}`);
  const prod = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const r = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 15_000))]);
    return r;
  });
  test.skip(!prod, `No service worker at ${baseURL}: run against a production build (vite preview).`);
  // The first visit installs the worker; it takes control at once (clients.claim).
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);

  const save = page.getByTestId("offline-save");
  await expect(save.getByRole("button", { name: /Save this field for offline|Save again/ })).toBeEnabled({ timeout: 90_000 });
  await save.getByRole("button").click();
  await expect(save.locator("p")).toHaveText(/^Saved (for offline on|\d+ results for offline on)/, { timeout: 180_000 });
  console.log(`[offline] ${await save.locator("p").textContent()}`);
  await save.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "offline-saved-1440.png") });

  // No connection: reload the money page. The answer comes from the saved copy, and the bar says when it was saved.
  await context.setOffline(true);
  await page.goto(`/#/money/${FID}`);
  await page.reload();
  const bar = page.getByTestId("offline-bar");
  await expect(bar).toHaveText(/^You're offline: showing results saved on .+\.$/, { timeout: 60_000 });
  await expect(page.getByTestId("money-headline")).toHaveText("Profit after operating costs (gross margin)", { timeout: 60_000 });
  await expect(page.locator("article.money-col").first().locator('[data-k="typical"]')).toHaveText(/\$\d/, { timeout: 60_000 });
  console.log(`[offline] ${await bar.textContent()}`);
  await page.screenshot({ path: path.join(SHOTS, "offline-money-1440.png") });

  // Step 2 (My field) also opens from the saved answers.
  await page.goto(`/#/studio/${FID}`);
  await expect(page.locator(".myfield__name")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".facts-list")).toBeVisible({ timeout: 60_000 });
  await expect(bar).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "offline-step2-1440.png") });

  // iPhone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/money/${FID}`);
  await expect(page.getByTestId("money-headline")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOTS, "offline-money-390.png") });
  await context.setOffline(false);
});

/* Part 2a: "What farms around you grow" on step 2 (USDA CDL around the Story County field), in English and Spanish,
   and the plain "not available here" for a field outside CDL / ACI coverage. */
test("peers: what farms around you grow, on step 2", async ({ page }) => {
  test.setTimeout(180_000);
  await simple(page, `#/studio/${FID}`);
  const p = page.getByTestId("peers");
  await expect(p.getByTestId("peers-head")).toHaveText(/^Around your field \(≈5 km\), \d{4}–\d{4}, cropland was: \d+% corn and soybean only, \d+% continuous corn/, { timeout: 120_000 });
  await expect(p.getByTestId("peers-mine")).toHaveText(/^Your field in the map: corn and soybean only, like \d+% of the cropland around you\.$/);
  await expect(p.getByTestId("peers-after")).toContainText(/After Corn: Soybeans \d+%/);
  await expect(p.getByTestId("peers-note")).toHaveText("What cropland within ≈5 km did (USDA CDL satellite classification, 30 m). Not proof that a switch pays.");
  // Gray (non-NASA) source button, and no SI badge in this block.
  await expect(p.getByRole("button", { name: /^Data source: Crop map within ≈5 km/ })).toBeVisible();
  await expect(p.getByRole("button", { name: /\(NASA\)/ })).toHaveCount(0);
  await expect(p.locator(".fs-si, [data-si]")).toHaveCount(0);
  for (const id of ["peers-head", "peers-mine", "peers-after"]) console.log(`[peers] ${(await p.getByTestId(id).textContent())?.trim()}`);
  await p.scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "peers-story-1440.png") });

  // Spanish.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("fieldshift-app") ?? "{}");
    localStorage.setItem("fieldshift-app", JSON.stringify({ ...raw, state: { ...(raw.state ?? {}), lang: "es" } }));
  });
  await page.reload();
  await expect(page.getByTestId("peers-head")).toHaveText(/^Alrededor de su lote \(≈5 km\), \d{4}–\d{4}, la tierra de cultivo fue: \d+\s?% solo maíz y soya/, { timeout: 120_000 });
  await expect(page.getByTestId("peers-note")).toContainText("No prueba que un cambio sea rentable.");
  await page.getByTestId("peers").screenshot({ path: path.join(SHOTS, "peers-story-es-1440.png") });

  // iPhone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("peers").scrollIntoViewIfNeeded();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(SHOTS, "peers-story-es-390.png") });
});

test("peers: outside crop-map coverage says so plainly", async ({ page }) => {
  await simple(page, "#/studio/5dac81dfbd56");
  await expect(page.getByTestId("peers")).toContainText(/^What farms around you grow\s*Not available here: Crop patterns around the field come from/, { timeout: 120_000 });
  await page.getByTestId("peers").screenshot({ path: path.join(SHOTS, "peers-unavailable-1440.png") });
});

/* Part 2b: real yields (USDA NASS), ISU budgets with "Use these numbers", storm events (NOAA), disease weather. */
test("money page: real yields, ISU budgets, storms and disease weather", async ({ page }) => {
  test.setTimeout(240_000);
  await simple(page, `#/money/${FID}`);
  await expect(page.locator("article.money-col").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("money-evidence")).toHaveText(/^Based on 30 real weather sequences \(starting 1991–2020, weather from 1991–20\d\d\) × \d+ price years \(\d{4}–\d{4}\) = \d+ combinations per option\.$/);

  // Real yields: county average with the trend, never the field's yield.
  const yh = page.getByTestId("money-yh").first();
  await expect(yh.locator("summary")).toHaveText(/^Real yields in Story County, 2000–20\d\d \(USDA\) · trend [\d.]+ bu\/ac in 20\d\d$/);
  await yh.locator("summary").click();
  await expect(yh).toContainText("County average, not your field");
  await expect(yh.locator('[data-k="yh-compare"]')).toHaveText(/^The yield in use here \([\d.]+ bu\/ac\) is (\d+% (above|below) that trend|close to that trend)/);
  console.log(`[money] ${(await yh.locator('[data-k="yh-compare"]').textContent())?.trim()}`);
  await yh.screenshot({ path: path.join(SHOTS, "money-yield-history.png") });

  // ISU budgets: "Use these numbers" fills the corn cost lines; crop insurance is in the operating total.
  await page.locator("summary", { hasText: "Show cost details" }).click();
  const bm = page.getByTestId("money-bm").first();
  await expect(bm).toContainText("Corn: published budgets (Iowa State University, 2026)");
  await expect(bm.locator("tbody tr")).toHaveCount(4);
  await bm.getByRole("button", { name: "Use these numbers: Corn following soybeans", exact: true }).click();
  await expect(bm.locator('[data-k="bm-msg"]')).toContainText(/In use: Corn following soybeans, operating costs \$483\.6\d an acre/);
  await expect(bm.locator('[data-k="bm-msg"]')).toContainText(/crop insurance \$17\.10/);
  await expect(page.getByRole("spinbutton", { name: /^Corn: Operating costs/ })).toHaveValue("483.6");
  await bm.locator("xpath=..").locator("summary", { hasText: /^Cost lines/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Corn: Seed" })).toHaveValue("113.7");
  console.log(`[money] ${(await bm.locator('[data-k="bm-msg"]').textContent())?.trim()}`);
  await bm.screenshot({ path: path.join(SHOTS, "money-isu-budgets.png") });

  // Storms (NOAA) and disease weather in "What can go wrong here".
  const st = page.getByTestId("money-storms");
  await expect(st).toContainText(/^Storms reported in Story County \(1996–20\d\d, NOAA\)/);
  await expect(st).toContainText(/Hail: in \d+ of \d+ years/);
  await expect(st).toContainText("not your field's losses");
  const dz = page.locator(".money-haz").getByTestId("disease");
  await expect(dz).toContainText(/weather that favoured tar spot/, { timeout: 120_000 });
  await expect(dz.locator('[data-k="saturated"]').first()).toContainText("does not separate one summer from another");
  await st.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "money-storms-disease-1440.png") });
});

test("step 2: disease weather with SI and NASA buttons, rotation hosts; outside the Midwest says so", async ({ page }) => {
  test.setTimeout(240_000);
  await simple(page, `#/studio/${FID}`);
  const dz = page.getByTestId("disease");
  await expect(dz.locator('[data-model="tar_spot"] [data-k="typical"]')).toHaveText(/^In a typical summer, \d+% of days from July 1 to August 15 had weather that favoured tar spot/, { timeout: 120_000 });
  // Gray leaf spot saturates: the API's note, and the model's mean score instead of "high every year".
  await expect(dz.locator('[data-model="gray_leaf_spot"] [data-k="saturated"]')).toContainText("does not separate one summer from another");
  await expect(dz.locator('[data-model="gray_leaf_spot"]')).toContainText("The model's average score");
  await expect(dz).not.toContainText("mean_prob");
  // Rainfed field: the irrigated white-mold variants are hidden.
  await expect(dz.locator('[data-model^="white_mold_irrigated"]')).toHaveCount(0);
  await expect(dz.locator('[data-model="white_mold_dryland"]')).toHaveCount(1);
  await expect(dz.getByTestId("disease-note")).toContainText("It does not mean the disease is present, and it is not a yield-loss number.");
  await expect(dz.getByTestId("disease-hosts")).toContainText("White mold");
  await expect(dz.getByRole("button", { name: /^SI/ })).toHaveCount(1);
  await expect(dz.getByRole("button", { name: /\(NASA\)/ })).toHaveCount(1);
  for (const m of await dz.locator(".dz-model__line").allTextContents()) console.log(`[disease] ${m}`);
  await dz.scrollIntoViewIfNeeded();
  await dz.screenshot({ path: path.join(SHOTS, "disease-story-1440.png") });

  await page.goto("/#/studio/5dac81dfbd56");
  await page.reload();
  await expect(page.getByTestId("disease")).toContainText(/Not available here: These disease weather models were built and tested for the US Midwest/, { timeout: 120_000 });
});

test("Spanish: disease panel and rule messages from the API in Spanish", async ({ page }) => {
  test.setTimeout(240_000);
  await simple(page, `#/studio/${FID}`);
  await expect(page.getByTestId("disease")).toBeVisible({ timeout: 120_000 });
  // Set the language just before reloading (the app saves its own state on navigation).
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("fieldshift-app") ?? "{}");
    localStorage.setItem("fieldshift-app", JSON.stringify({ ...raw, state: { ...(raw.state ?? {}), lang: "es" } }));
  });
  await page.reload();
  await expect(page.getByTestId("disease")).toContainText(/tuvieron clima que favoreció/, { timeout: 120_000 });
  await page.getByTestId("disease").screenshot({ path: path.join(SHOTS, "disease-story-es.png") });
  await page.goto(`/#/compare/${FID}`);
  await page.reload();
  // Open the first option's details: its risks list the rules' messages, now in Spanish.
  await page.locator("article h3 button").first().click({ timeout: 120_000 });
  await expect(page.getByText(/el más seco de cada 5/).first()).toBeAttached({ timeout: 60_000 });
  await expect(page.getByText("In a dry year (driest 1 in 5)", { exact: false })).toHaveCount(0);
});
