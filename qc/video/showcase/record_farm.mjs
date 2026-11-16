// Whole-farm 30-second video (v2): one field at a time -> add to the farm -> the 3-field sample farm, stress test,
// Find the best plan. Starts from a farm with Boone + Hamilton (state_two_fields.json) so Story County is really added.
// FarmSmart 30-second showcase, true 3840x2160: the page runs in slow motion (S times slower: CSS animations via
// the DevTools animation rate, JS animations via a slowed performance.now, and every scripted action), while full
// 4K screenshots are taken back to back. Frame times are divided by S, so playback is normal speed.
// Title cards, captions and the cursor are overlays; every screen and number is the real app with real data.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../web/package.json"));
const { chromium } = require("playwright");

const ROOT = process.env.FS_VIDEO_DIR || join(HERE, "work"); // frames + timeline (git-ignored)
const FR = `${ROOT}/frames`;
const BASE = "http://localhost:5173/";
const F = "b96d39c7a833"; // Story County, Iowa pilot
const W = 1536, H = 864, DSF = 2.5;
const S = 5; // slow-motion factor

rmSync(FR, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(FR, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force-color-profile=srgb", "--hide-scrollbars"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, locale: "en-US", storageState: join(HERE, "state_two_fields.json") });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));

const MARK = `<svg viewBox="7.5 12 40 40" width="100%" height="100%"><path d="M20 12.5H42Q45 12.5 45 15.5V41.5Q45 51.5 35 51.5H13Q10 51.5 10 48.5V22.5Q10 12.5 20 12.5Z" fill="#2c6a48"/><g transform="translate(15 19.5) scale(1.0416667)" fill="none" stroke="#ddf3aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></g></svg>`;

async function installOverlays() {
  await page.evaluate(([MARK, S]) => {
    if (document.getElementById("v-layer")) return;
    window.__S = S;
    const css = document.createElement("style");
    css.textContent = `
#v-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:Inter,system-ui,sans-serif}
#v-cap{position:absolute;left:50%;bottom:34px;transform:translate(-50%,14px);opacity:0;transition:opacity .4s ease,transform .4s ease;
  background:rgba(20,48,33,.94);color:#fff;border-radius:16px;padding:14px 30px 16px;max-width:1100px;text-align:center;
  box-shadow:0 14px 40px rgba(0,0,0,.28)}
#v-cap.on{opacity:1;transform:translate(-50%,0)}
#v-cap .k{font:700 12.5px/1 "DM Sans",Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#ddf3aa;margin-bottom:8px}
#v-cap .t{font:650 27px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.01em;white-space:nowrap}
#v-card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;opacity:0;
  transition:opacity .6s ease;background:radial-gradient(1200px 700px at 50% 42%,#2a5b3e 0%,#1a3a28 55%,#10251a 100%);color:#fff}
#v-card.on{opacity:1}
#v-card .lock{display:flex;align-items:center;gap:22px;transform:translateY(12px) scale(.98);transition:transform 1.2s cubic-bezier(.2,.7,.2,1)}
#v-card.on .lock{transform:none}
#v-card .mk{width:112px;height:112px;filter:drop-shadow(0 10px 30px rgba(0,0,0,.35))}
#v-card .wm{font:800 92px/1 Manrope,Inter,sans-serif;letter-spacing:-.045em}
#v-card .wm span{font-weight:500}
#v-card .tag{font:600 19px/1 "DM Sans",Inter,sans-serif;letter-spacing:.22em;color:#b9d79a;text-transform:uppercase;margin-top:-4px}
#v-card .sub{font:500 21px/1.45 Inter,sans-serif;color:rgba(255,255,255,.88);text-align:center;max-width:1000px;margin-top:22px}
#v-curtain{position:absolute;inset:0;background:#f4f6f3;opacity:0;transition:opacity .22s ease}
#v-curtain.on{opacity:1}
#v-wm{position:absolute;right:14px;bottom:10px;font:600 11px/1 Inter,sans-serif;color:rgba(255,255,255,.95);background:rgba(20,48,33,.72);
  padding:5px 9px;border-radius:7px}
#v-cur{position:absolute;left:0;top:0;width:28px;height:28px;opacity:0;transition:opacity .25s;will-change:transform}
#v-cur.on{opacity:1}
.v-rip{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #2c6a48;background:rgba(221,243,170,.5);
  animation:vrip .5s ease-out forwards}
@keyframes vrip{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}`;
    document.head.appendChild(css);
    const L = document.createElement("div");
    L.id = "v-layer";
    L.innerHTML = `<div id="v-curtain"></div><div id="v-cap"><div class="k"></div><div class="t"></div></div>
      <div id="v-cur"><svg viewBox="0 0 26 26" width="28" height="28"><path d="M3 2l18 10.2-7.6 1.6 4.4 8.3-3.3 1.7-4.4-8.4-5.6 5.4z" fill="#fff" stroke="#14301f" stroke-width="1.7" stroke-linejoin="round"/></svg></div>
      <div id="v-card"></div><div id="v-wm">Real app · real data · SI-assisted recording · music generated with SI</div>`;
    document.body.appendChild(L);
    const cur = L.querySelector("#v-cur");
    window.addEventListener("mousemove", (e) => { cur.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div"); r.className = "v-rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      L.appendChild(r); setTimeout(() => r.remove(), 700 * S);
    }, true);
    window.__MARK = MARK;
  }, [MARK, S]);
}

// ---------- clock: video seconds ----------
let T0 = 0;
const now = () => (Date.now() - T0) / 1000 / S;
const sleep = (videoMs) => page.waitForTimeout(videoMs * S);
const capLog = [];
let capOpen = null;

async function caption(kicker, text) {
  if (capOpen) { capOpen.end = now(); capLog.push(capOpen); capOpen = null; }
  await page.evaluate(([k, t]) => {
    const c = document.getElementById("v-cap");
    c.classList.remove("on");
    setTimeout(() => { c.querySelector(".k").textContent = k; c.querySelector(".t").textContent = t; if (t) c.classList.add("on"); }, 220 * window.__S);
  }, [kicker, text]);
  if (text) capOpen = { start: now() + 0.25, text };
}
async function card(html) {
  await page.evaluate((h) => {
    const c = document.getElementById("v-card");
    if (h) { c.innerHTML = h.replaceAll("{{MARK}}", window.__MARK); requestAnimationFrame(() => c.classList.add("on")); }
    else c.classList.remove("on");
  }, html);
}
const lockup = (sub = "") => `<div class="lock"><div class="mk">{{MARK}}</div><div><div class="wm">Farm<span>Smart</span></div></div></div>
  <div class="tag">Smarter choices. Better seasons.</div>${sub}`;
async function curtain(on) { await page.evaluate((o) => document.getElementById("v-curtain").classList.toggle("on", o), on); await sleep(240); }
async function cursor(on) { await page.evaluate((o) => document.getElementById("v-cur").classList.toggle("on", o), on); }

let mx = W * 0.62, my = H * 0.55;
async function moveTo(x, y, ms = 600) {
  const n = Math.max(10, Math.round((ms * S) / 40));
  const x0 = mx, y0 = my;
  for (let i = 1; i <= n; i++) {
    const p = i / n, e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await page.waitForTimeout((ms * S) / n);
  }
  mx = x; my = y;
}
async function clickOn(loc, { ms = 500, pause = 80 } = {}) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box");
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, ms);
  await sleep(pause);
  await page.mouse.down(); await sleep(70); await page.mouse.up();
}
// eased scroll of the page's main scroller (in-page clock is already slowed)
async function scrollBy(dy, ms = 1800) {
  await page.evaluate(([dy, ms]) => new Promise((res) => {
    let el = null, best = 0;
    for (const e of [document.scrollingElement, ...document.querySelectorAll("main, div")]) {
      if (!e) continue;
      const ok = e.scrollHeight - e.clientHeight > 40 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      if (ok && e.clientHeight * e.clientWidth > best) { best = e.clientHeight * e.clientWidth; el = e; }
    }
    if (!el) return res(null);
    const y0 = el.scrollTop, t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      el.scrollTop = y0 + dy * e;
      if (p < 1) requestAnimationFrame(step); else res(true);
    };
    requestAnimationFrame(step);
  }), [dy, ms]);
}
async function scrollTo(y, ms = 900) {
  await page.evaluate(([y, ms]) => new Promise((res) => {
    const el = document.scrollingElement, y0 = el.scrollTop, t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      el.scrollTop = y0 + (y - y0) * e;
      if (p < 1) requestAnimationFrame(step); else res(true);
    };
    requestAnimationFrame(step);
  }), [y, ms]);
}
async function go(hash, waitSel, extra = 300) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  if (waitSel) await page.waitForSelector(waitSel, { timeout: 20000 }).catch(() => console.log("no", waitSel));
  await sleep(extra);
}
async function step(name, fn) {
  try { await fn(); console.log(`ok   ${now().toFixed(1)}s  ${name}`); }
  catch (e) { console.log(`FAIL ${now().toFixed(1)}s  ${name}: ${e.message.split("\n")[0]}`); }
}

// ---------- warm-up (not recorded): farm = Boone + Hamilton; Story opened via the Demo pilot ----------
await page.goto(BASE + "#/welcome");
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /^demo/i }).first().click();
await page.waitForTimeout(800);
await page.locator(".demomenu__item").filter({ hasText: /^Story County, Iowa(?!.*continuous)/ }).first().click();
await page.waitForTimeout(5000);
for (const h of [`#/compare/${F}`, `#/money/${F}`, "#/farm", `#/compare/${F}`, `#/studio/${F}`]) {
  await page.evaluate((x) => { location.hash = x; }, h);
  await page.waitForTimeout(4500);
}
console.log("rail:", await page.locator(".rail__farmswitch").innerText().catch(() => "?"));
await page.evaluate(() => document.scrollingElement.scrollTo(0, 0));
await installOverlays();
await page.evaluate(() => document.fonts.ready);
page.setDefaultTimeout(6000 * S);
await card(lockup(`<div class="sub">A decision tool for farms with many fields<br/><span style="font-size:17px;opacity:.8">NASA Space Apps 2026 · Adapting Farms with NASA Data</span></div>`));
await page.waitForTimeout(1500);

// ---------- slow motion on ----------
const cdp = await ctx.newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / S });
await page.evaluate((S) => {
  const real = performance.now.bind(performance);
  const b = real();
  performance.now = () => b + (real() - b) / S;
}, S);

// ---------- capture loop ----------
const shots = [];
const writes = [];
let capturing = true;
const loop = (async () => {
  while (capturing) {
    const a = Date.now();
    const buf = await page.screenshot({ type: "jpeg", quality: 94, animations: "allow", caret: "initial", scale: "device" });
    const b = Date.now();
    const i = shots.length;
    shots.push({ i, t: ((a + b) / 2 - T0) / 1000 / S });
    writes.push(writeFile(`${FR}/${String(i).padStart(6, "0")}.jpg`, buf));
  }
})();
T0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = now(); };

// ===== INTRO (title card) =====
mark("intro");
await sleep(1500);

// ===== ONE FIELD AT A TIME =====
mark("beat_in");
await card("");
await step("F1 field", async () => {
  await caption("One field at a time", "One field: soil, crop history and NASA weather");
  await sleep(300); await scrollBy(300, 1700); await sleep(400);
});
await page.mouse.move(mx, my);
await cursor(true);
await step("F2 compare", async () => {
  await clickOn(page.locator(".rail").getByText("Compare options", { exact: true }).first(), { ms: 380, pause: 40 });
  await page.waitForSelector(".ocards").catch(() => {});
  await caption("One field at a time", "Rank its rotations by what matters to you");
  await sleep(1900);
});
await step("F3 add", async () => {
  await caption("Most farms have many fields", "Add each field to your farm, one at a time");
  await clickOn(page.locator(".options").getByTestId("add-to-farm"), { ms: 500, pause: 60 });
  await sleep(1700);
});

// ===== WHOLE FARM =====
mark("lift");
await step("W1 switch", async () => {
  await clickOn(page.locator(".rail__farmswitch [role=radio]", { hasText: "Whole farm" }), { ms: 500, pause: 40 });
  await page.waitForSelector("[data-tile]").catch(() => {});
  await page.getByTestId("farm-sort").selectOption("acres").catch(() => {});
  await caption("Whole farm", "Three fields in central Iowa, seen as one farm");
  await sleep(250); await scrollTo(270, 900); await sleep(1300);
});
await step("W2 numbers", async () => {
  await caption("Whole farm", "Typical year $154,300 · bad year (1 in 10) $89,800");
  await moveTo(700, 380, 600);
  await sleep(1700);
});
await step("W3 stress", async () => {
  await caption("Stress test on", "Test a bad stretch: driest years, prices 20 % lower");
  const sel = page.locator(".farm-stressbar select");
  const b = await sel.boundingBox();
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, 500);
  await sleep(150);
  await sel.selectOption("both");
  await sleep(1900);
});
await step("W4 optimise", async () => {
  mark("accent_pre");
  await caption("Find the best plan", "Which crops on which field? FarmSmart searches");
  await scrollTo(963, 900);
  await sleep(150);
  await clickOn(page.getByTestId("farm-optimize"), { ms: 450, pause: 60 });
  await page.getByTestId("farm-opt-result").waitFor().catch(() => {});
  mark("accent");
  await sleep(300);
  await caption("Find the best plan", "Change one field: farm score 6.8 → 8.1, less risk");
  await sleep(2600);
});
await step("W5 apply", async () => {
  await caption("Stress test on", "More profit and less risk across the whole farm");
  await clickOn(page.getByTestId("farm-apply"), { ms: 450, pause: 60 });
  await sleep(350);
  await scrollTo(270, 900);
  await sleep(1700);
});
await caption("", "");
await cursor(false);

// ===== END CARD =====
mark("drums_out_pre");
mark("resolve");
await card(lockup(`<div class="sub">Plan the whole farm, one field at a time.<br/>Built on NASA, USDA and NOAA data. You make the call.</div>`));
await sleep(2600);
mark("end");
if (capOpen) { capOpen.end = now(); capLog.push(capOpen); }
capturing = false;
await loop;
await Promise.all(writes);
const dts = shots.slice(1).map((s, k) => s.t - shots[k].t);
writeFileSync(`${ROOT}/timeline.json`, JSON.stringify({ t0Wall: 0, endWall: now(), marks, captions: capLog,
  frames: shots.map((s) => ({ i: s.i, ts: s.t, w: W * DSF, h: H * DSF })) }));
console.log("frames", shots.length, "video", now().toFixed(1), "s, effective fps", (shots.length / now()).toFixed(1), "max gap", Math.max(...dts).toFixed(3));
await browser.close();
