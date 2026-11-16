/* axe-core WCAG 2.2 AA scan of the main views at desktop (1440×900) and iPhone width (390×844). */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "node:fs";
import { freshStart, openPilot } from "./helpers";

const FIELD = "b96d39c7a833";
const VIEWS = [
  { id: "studio", name: "Field Studio" },
  { id: "compare", name: "Strategy Compare" },
  { id: "twins", name: "Climate Twins" },
  { id: "replay", name: "Drought Replay" },
  { id: "alerts", name: "Alerts" },
  { id: "sources", name: "Sources & Methods" },
];
const SIZES = [
  { tag: "desktop", w: 1440, h: 900 },
  { tag: "mobile", w: 390, h: 844 },
];

type Row = { size: string; view: string; id: string; impact: string; help: string; nodes: number; targets: string[]; detail: string[] };
const rows: Row[] = [];

async function settle(page: Page, id: string) {
  await page.waitForTimeout(800);
  if (id === "compare") await expect(page.locator("article.cmp-col").first()).toBeVisible({ timeout: 60_000 });
  if (id === "twins") await expect(page.getByText(/models agree|Novel climate/).first()).toBeVisible({ timeout: 90_000 });
  if (id === "replay") await expect(page.getByRole("img", { name: /Soil water through the year/ })).toBeVisible({ timeout: 60_000 });
  if (id === "studio") await expect(page.locator(".ocards, .mtabs").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
}

for (const s of SIZES) {
  test(`axe ${s.tag}`, async ({ page }) => {
    test.setTimeout(400_000);
    await page.setViewportSize({ width: s.w, height: s.h });
    await freshStart(page);
    await openPilot(page, "Story County, Iowa");
    await page.getByRole("button", { name: /See rotation options/ }).first().click();
    await page.waitForTimeout(1500);
    for (const v of VIEWS) {
      await page.evaluate(([vid, f]) => (location.hash = `#/${vid}/${f}`), [v.id, FIELD]);
      await settle(page, v.id);
      if (s.tag === "mobile" && v.id === "studio") {
        // scan the Options tab too (cards live there on mobile)
        await page.getByRole("navigation", { name: "Field Studio sections" }).getByRole("button", { name: "Options" }).click();
        await page.waitForTimeout(1000);
      }
      if (v.id === "compare") {
        // open every full card so its content is scanned
        const closed = page.locator("details.cmp-col__more:not([open]) > summary");
        for (let k = 0; k < 6 && (await closed.count()) > 0; k++) await closed.first().click();
      }
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      for (const vi of res.violations) {
        rows.push({
          size: s.tag,
          view: v.name,
          id: vi.id,
          impact: vi.impact ?? "?",
          help: vi.help,
          nodes: vi.nodes.length,
          targets: vi.nodes.slice(0, vi.id === "color-contrast" ? 400 : 6).map((n) => n.target.join(" ")),
          detail: vi.nodes.slice(0, vi.id === "color-contrast" ? 400 : 4).map((n) => (n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 200)),
        });
      }
      fs.mkdirSync("../qc/reports", { recursive: true });
      fs.writeFileSync(`../qc/reports/axe_${s.tag}.json`, JSON.stringify(rows.filter((r) => r.size === s.tag), null, 2));
      console.log(`${s.tag} ${v.name}: ${res.violations.map((x) => `${x.id}(${x.impact},${x.nodes.length})`).join(", ") || "clean"}`);
    }
    const out = `../qc/reports/axe_${s.tag}.json`;
    fs.mkdirSync("../qc/reports", { recursive: true });
    fs.writeFileSync(out, JSON.stringify(rows.filter((r) => r.size === s.tag), null, 2));
    const bad = rows.filter((r) => r.size === s.tag && (r.impact === "serious" || r.impact === "critical"));
    expect(bad.map((b) => `${b.view}: ${b.id} ×${b.nodes}`), "no serious/critical axe issues").toEqual([]);
  });
}
