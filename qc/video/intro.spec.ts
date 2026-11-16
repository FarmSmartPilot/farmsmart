/* 10-second intro video: a real screen recording of FarmSmart (no generated imagery), with short captions and a
   small "SI-assisted screen recording" mark, as the project's SI-use rules ask. Output: qc/video/out/*.webm,
   converted to docs/demo/field_shift_intro_10s.mp4 by qc/video/make_intro.sh. */
import { test } from "@playwright/test";

const FIELD = "b96d39c7a833";

async function caption(page: import("@playwright/test").Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("fs-video-cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "fs-video-cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:99999;padding:14px 26px;border-radius:14px;" +
        "background:rgba(8,24,42,.88);color:#fff;font:700 28px/1.25 Inter,system-ui,sans-serif;max-width:80%;text-align:center;" +
        "box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .25s";
      document.body.appendChild(el);
      const mark = document.createElement("div");
      mark.textContent = "SI-assisted screen recording · real app, real data";
      mark.style.cssText =
        "position:fixed;right:12px;bottom:10px;z-index:99999;padding:3px 8px;border-radius:6px;background:rgba(8,24,42,.7);" +
        "color:#fff;font:600 12px Inter,system-ui,sans-serif";
      document.body.appendChild(mark);
    }
    el.textContent = t;
  }, text);
}

test("intro video", async ({ page }) => {
  test.setTimeout(180_000);
  const t0 = Date.now(); // the recording starts with the page
  // Warm the app (and its caches) before the visible part, so the 10 seconds are not spent loading.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "fieldshift-app",
      JSON.stringify({ state: { mode: "simple", savedFields: [{ id: "b96d39c7a833", name: "Story County, Iowa", lat: 42.1112, lon: -93.4693 }] }, version: 0 }),
    );
  });
  for (const h of ["#/welcome", `#/studio/${FIELD}`, `#/compare/${FIELD}`, `#/money/${FIELD}`]) {
    await page.goto(`/${h}`);
    await page.waitForTimeout(2500);
  }
  // --- recorded part (the clip is cut to the last ~10 s by make_intro.sh) ---
  await page.goto("/#/welcome");
  await page.waitForSelector(".wel-hero");
  await caption(page, "FarmSmart: test your next crop rotation before you plant it");
  await page.waitForTimeout(300);
  // where the 10-second clip starts, in seconds from the start of the recording (read by make_intro.sh)
  require("node:fs").writeFileSync(require("node:path").join(__dirname, "out", "start.txt"), String((Date.now() - t0) / 1000 - 0.2));
  await page.waitForTimeout(2300);
  await page.goto(`/#/studio/${FIELD}`);
  await page.waitForSelector(".guided--s2");
  await caption(page, "Your field: soil, crop history and 35 years of NASA weather");
  await page.waitForTimeout(2400);
  await page.goto(`/#/compare/${FIELD}`);
  await page.waitForSelector(".ocards");
  await caption(page, "Rotations ranked by what matters to you, tested in every past year");
  await page.waitForTimeout(2600);
  await page.goto(`/#/money/${FIELD}`);
  await page.waitForTimeout(800);
  await caption(page, "Money and risk in plain words. Free, open data.");
  await page.waitForTimeout(2000);
});
