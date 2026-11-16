/* Shared helpers for the FarmSmart e2e suite. Selectors use visible English text (i18n en.json). */
import { expect, type Page } from "@playwright/test";

export const CARD_SECTIONS = ["Why suggested", "Evidence", "Benefits", "Trade-offs & risks", "Information gaps", "Check locally", "Try it small"];

/** Clean browser state. Simple mode is the guided path (one step per page); the older specs test the all-in-one
    Field Studio, so they start in Expert unless asked otherwise. */
export async function freshStart(page: Page, mode: "simple" | "expert" = "expert") {
  await page.goto("/");
  await page.evaluate((m) => {
    try {
      localStorage.clear();
      if (m === "expert") localStorage.setItem("fieldshift-app", JSON.stringify({ state: { mode: "expert" }, version: 0 }));
    } catch {
      /* ignore */
    }
  }, mode);
  await page.goto("/");
}

/** Open a pilot from the Globe Home quick-picks; waits for Field Studio. */
export async function openPilot(page: Page, label: string | RegExp) {
  // Sample farms live in the Demo menu (top right).
  const menu = page.getByRole("group", { name: "Demo and sample farms" });
  const btn = (typeof label === "string"
    ? menu.locator(".demomenu__item").filter({ has: page.getByText(label, { exact: true }) })
    : menu.getByRole("button", { name: label })
  ).first();
  await expect(async () => {
    if (!(await btn.isVisible())) await page.locator('[data-tour="demo"]').first().click();
    await expect(btn).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // The first click can be lost while the globe initialises (software WebGL on the CI box): retry once.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await btn.isVisible().catch(() => false))) await page.locator('[data-tour="demo"]').first().click();
    await btn.click();
    try {
      await expect(page).toHaveURL(/#\/studio\//, { timeout: 15_000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(`[openPilot] click not registered (attempt ${attempt + 1}); retrying`);
    }
  }
}

/** Desktop: click a view in the sub-nav. Mobile: open the menu sheet first. */
export async function goView(page: Page, name: string, mobile = false) {
  if (mobile) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name, exact: true }).click();
    // close the sheet if still open
    const close = page.getByRole("button", { name: "Close" });
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  } else {
    const nav = page.getByRole("navigation", { name: "Views" });
    const tab = nav.getByRole("button", { name, exact: true });
    // Below 1280 px the less-used views sit under "More ▾".
    if (!(await tab.isVisible().catch(() => false))) await nav.getByRole("button", { name: /^More/ }).click();
    await tab.click();
  }
}

export async function setMode(page: Page, mode: "Simple" | "Expert", mobile = false) {
  if (mobile) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("radio", { name: mode }).click();
    await page.getByRole("button", { name: "Close" }).first().click();
  } else {
    await page.getByRole("radiogroup", { name: "Detail level" }).getByRole("radio", { name: mode }).click();
  }
}

/** Strategy Compare: assert baseline + >=2 alternatives, each with the 7 non-empty sections. */
export async function assertCompareCards(page: Page, min = 3) {
  const cols = page.locator("article.cmp-col");
  await expect(cols.first()).toBeVisible({ timeout: 90_000 });
  const n = await cols.count();
  expect(n, "cards shown on Strategy Compare").toBeGreaterThanOrEqual(min);
  await expect(page.locator("article.cmp-col .fs-overline", { hasText: /^Current$/ }), "baseline card present").toHaveCount(1);
  for (let i = 0; i < n; i++) {
    const col = cols.nth(i);
    const det = col.locator("details.cmp-col__more");
    if (!(await det.getAttribute("open").then((v) => v !== null))) await det.locator("summary").click();
    const blocks = col.locator(".sdetail section.sblock");
    await expect(blocks.first()).toBeVisible();
    const titles = (await blocks.locator("h4.sblock__h").allTextContents()).map((x) => x.trim());
    for (const s of CARD_SECTIONS) {
      const idx = titles.indexOf(s);
      expect(idx, `card ${i} has section "${s}" (found: ${titles.join(" | ")})`).toBeGreaterThanOrEqual(0);
      const body = ((await blocks.nth(idx).textContent()) ?? "").replace(s, "").trim();
      expect(body.length, `card ${i} section "${s}" non-empty`).toBeGreaterThan(3);
    }
  }
  return n;
}

export function attachTiming(name: string, ms: number) {
  console.log(`[timing] ${name}: ${(ms / 1000).toFixed(1)} s`);
}
