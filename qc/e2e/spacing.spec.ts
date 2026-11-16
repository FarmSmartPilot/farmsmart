/* Spacing audit: screenshots at 5 sizes × 5 views + DOM checks (overflow, clipping, off-screen, tap targets on mobile). */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { freshStart, openPilot } from "./helpers";

const FIELD = "b96d39c7a833";
const SIZES = [
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  // Tablet and the desktop app's side pane (UX round 1, item 7).
  { w: 820, h: 1180 },
  { w: 960, h: 900 },
  { w: 1024, h: 768 },
];
const VIEWS = [
  { id: "home", name: "globe-home" },
  { id: "studio", name: "field-studio" },
  { id: "compare", name: "strategy-compare" },
  { id: "twins", name: "climate-twins" },
  { id: "replay", name: "drought-replay" },
];
const SHOTS = "../qc/screenshots";

async function audit(page: Page, mobile: boolean) {
  return page.evaluate((mobile) => {
    const vw = window.innerWidth;
    const out = { hscroll: document.documentElement.scrollWidth - vw, offscreen: [] as string[], clipped: [] as string[], small: [] as string[], overlaps: [] as string[] };
    const desc = (el: Element) => {
      const c = (el.getAttribute("class") || "").split(" ").filter(Boolean).slice(0, 2).join(".");
      const tx = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${c ? "." + c : ""} “${tx}”`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(el) || el.closest(".fs-visually-hidden, .skip-link, canvas, svg, .cesium-viewer, .maplibregl-map, [aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      // off-screen horizontally (not inside a horizontal scroller)
      if ((r.right > vw + 1 || r.left < -1) && !el.closest(".table-scroll, .tl-body, [style*='overflow'], .nasa-table-scroll, .viewnav, .layer-chips, .cmp-cols, .home__pilots")) {
        let p = el.parentElement, scroller = false;
        while (p) { const ox = getComputedStyle(p).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden") { scroller = true; break; } p = p.parentElement; }
        if (!scroller) out.offscreen.push(desc(el));
      }
      // clipped text: leaf text elements with overflow hidden and content wider than box, without ellipsis
      const s = getComputedStyle(el);
      if (el.children.length === 0 && (el.textContent || "").trim().length > 2 && (s.overflow === "hidden" || s.overflowX === "hidden") && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== "ellipsis")
        out.clipped.push(desc(el));
      if (mobile && el.matches("button, a[href], input:not([type=hidden]), select, [role=button], [role=radio], [role=tab], summary")) {
        if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio") {
          const lab = el.closest("label");
          if (lab) { const lr = lab.getBoundingClientRect(); if (lr.height >= 44 || lr.width >= 44 && lr.height >= 40) continue; }
        }
        let w = r.width, h = r.height;
        for (const pse of ["::before", "::after"]) {
          const ps = getComputedStyle(el, pse);
          if (ps.content !== "none" && ps.position === "absolute") { w = Math.max(w, parseFloat(ps.width) || 0); h = Math.max(h, parseFloat(ps.height) || 0); }
        }
        const hit = getComputedStyle(el).getPropertyValue("--hit");
        if (hit) { const v = parseFloat(hit); if (v) { w = Math.max(w, v); h = Math.max(h, v); } }
        if (w < 44 - 0.5 || h < 44 - 0.5) {
          // inline text links inside paragraphs are exempt (WCAG 2.5.8 inline exception)
          const inline = el.tagName === "A" && el.closest("p, li") && getComputedStyle(el).display === "inline";
          if (!inline) out.small.push(`${desc(el)} ${Math.round(w)}×${Math.round(h)}`);
        }
      }
    }
    // overlapping text labels: compare leaf text boxes inside the same panel
    const leaves = Array.from(document.querySelectorAll("main h1, main h2, main h3, main h4, main p, main button, main label, main .fs-overline, main .fs-meta"))
      .filter((e) => visible(e) && !e.closest("svg, canvas, .fs-popover, [aria-hidden=true], .maplibregl-map, .cesium-viewer, .map-wrap, .home__globe, .fs-tour"))
      .slice(0, 600);
    // Visible part of each box: clip by every ancestor that scrolls or hides overflow (scrolled-away rows are not overlaps).
    const clipRect = (e: Element) => {
      const r = e.getBoundingClientRect();
      let L = r.left, T = r.top, R = r.right, B = r.bottom;
      for (let p = e.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.overflowX !== "visible" || st.overflowY !== "visible") {
          const q = p.getBoundingClientRect();
          L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
        }
        if (st.position === "fixed" || st.position === "sticky") break;
      }
      return { left: L, top: T, right: R, bottom: B };
    };
    // Elements under a sticky/fixed bar are covered, not overlapping: only compare elements that are on top at their centre.
    const onTop = (e: Element, r: { left: number; top: number; right: number; bottom: number }) => {
      if (r.right <= r.left || r.bottom <= r.top) return false;
      const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      if (y < 0 || y > window.innerHeight) return true; // below the fold: cannot hit-test, keep
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
    };
    const rects = leaves.map((e) => clipRect(e));
    const keep = leaves.map((e, i) => onTop(e, rects[i]));
    for (let i = 0; i < leaves.length; i++)
      for (let j = i + 1; j < leaves.length; j++) {
        if (!keep[i] || !keep[j]) continue;
        if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 4 && oy > 4) out.overlaps.push(`${desc(leaves[i])} ⟷ ${desc(leaves[j])}`);
      }
    out.offscreen = [...new Set(out.offscreen)].slice(0, 15);
    out.clipped = [...new Set(out.clipped)].slice(0, 15);
    out.small = [...new Set(out.small)].slice(0, 40);
    out.overlaps = [...new Set(out.overlaps)].slice(0, 15);
    return out;
  }, mobile);
}

test("spacing audit", async ({ browser }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const results: Record<string, unknown> = {};
  for (const s of SIZES) {
    const mobile = s.w < 768;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      baseURL: process.env.FS_BASE ?? "http://localhost:5173",
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
    });
    const page = await ctx.newPage();
    await freshStart(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/${s.w}x${s.h}_globe-home.png` });
    results[`${s.w}x${s.h} globe-home`] = await audit(page, mobile);
    await openPilot(page, "Story County, Iowa");
    await page.getByRole("button", { name: /See rotation options/ }).first().click();
    await page.waitForTimeout(1500);
    for (const v of VIEWS.slice(1)) {
      await page.evaluate(([vid, f]) => (location.hash = `#/${vid}/${f}`), [v.id, FIELD]);
      if (v.id === "studio" && mobile) {
        await page.getByRole("navigation", { name: "Field Studio sections" }).getByRole("button", { name: "Options" }).click();
      }
      if (v.id === "compare") await expect(page.locator("article.cmp-col").first()).toBeVisible({ timeout: 60_000 });
      if (v.id === "twins") await expect(page.getByText(/models agree|Novel climate/).first()).toBeVisible({ timeout: 90_000 });
      if (v.id === "replay") await expect(page.getByRole("img", { name: /Soil water through the year/ })).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/${s.w}x${s.h}_${v.name}.png`, fullPage: v.id !== "studio" || mobile });
      results[`${s.w}x${s.h} ${v.name}`] = await audit(page, mobile);
      fs.writeFileSync("../qc/reports/spacing_audit.json", JSON.stringify(results, null, 2));
    }
    await ctx.close();
  }
  for (const [k, v] of Object.entries(results)) {
    const r = v as { hscroll: number; offscreen: string[]; clipped: string[]; small: string[]; overlaps: string[] };
    console.log(`${k}: hscroll=${r.hscroll} offscreen=${r.offscreen.length} clipped=${r.clipped.length} small=${r.small.length} overlaps=${r.overlaps.length}`);
  }
});
