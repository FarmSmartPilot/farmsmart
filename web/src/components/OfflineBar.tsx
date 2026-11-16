/* Offline use (wave U9). The service worker (public/sw.js, production builds only) keeps the app shell and the API
   answers for the fields a user opens: GET is network-first with a cache fallback, POST /compare and /money are kept
   by URL + a hash of the body. Each kept answer carries the time it was saved (x-fs-saved-at).
   - OfflineBar: "You're offline: showing results saved on {date}", shown while navigator.onLine is false. It is safe to
     mount in several places (only the first mounted copy draws).
   - SaveOffline: "Save this field for offline" fetches the field's main answers once, with the same request bodies the
     pages send, so the service worker keeps them. Nothing here makes up a value: offline pages show saved answers or
     say that a part did not load. */
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconDownload } from "../design";
import { useApp, useCompareBody } from "../store";
import { usePlan } from "../planStore";
import type { CompareBody } from "../api";
import { stateCode } from "../apiMoney";
import { cropsInPlay } from "../money";
import type { MoneyOption } from "../money";
import "../money.css";

/** Must match API_CACHE in public/sw.js. */
export const API_CACHE = "fs-api-v1";
const SAVED_HEADER = "x-fs-saved-at";

/* ---------------- online state ---------------- */

const subOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
export const useOnline = () =>
  useSyncExternalStore(
    subOnline,
    () => navigator.onLine,
    () => true,
  );

/* ---------------- what is saved ---------------- */

const swActive = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller && typeof caches !== "undefined";
const subController = (cb: () => void) => {
  const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
  if (!sw) return () => {};
  sw.addEventListener("controllerchange", cb);
  return () => sw.removeEventListener("controllerchange", cb);
};
/** True once the service worker controls this page (right after the first visit, thanks to clients.claim()). */
const useSwActive = () => useSyncExternalStore(subController, swActive, () => false);

/** Latest time any answer for this field (or, with no field, any answer) was saved by the service worker. */
export async function savedAt(fid: string | null): Promise<Date | null> {
  if (typeof caches === "undefined") return null;
  try {
    const c = await caches.open(API_CACHE);
    const keys = await c.keys();
    let best = 0;
    for (const k of keys) {
      const path = new URL(k.url).pathname;
      if (fid && !path.startsWith(`/api/fields/${fid}/`)) continue;
      const r = await c.match(k);
      const v = Date.parse(r?.headers.get(SAVED_HEADER) ?? "");
      if (Number.isFinite(v) && v > best) best = v;
    }
    return best ? new Date(best) : null;
  } catch {
    return null;
  }
}

function useSavedAt(fid: string | null, deps: unknown[] = []) {
  const [d, setD] = useState<Date | null>(null);
  useEffect(() => {
    let live = true;
    void savedAt(fid).then((x) => live && setD(x));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid, ...deps]);
  return d;
}

function useDateFmt() {
  const { i18n } = useTranslation();
  const loc = i18n.language === "es" ? "es" : "en-US";
  return (d: Date) => d.toLocaleString(loc, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------------- one bar on screen ---------------- */

let owners: number[] = [];
let nextOwner = 1;
const ownerSubs = new Set<() => void>();
const ping = () => ownerSubs.forEach((f) => f());

/** True for the first mounted copy only, so the bar can be mounted from several pages (and App) without doubling. */
function useFirstCopy() {
  const [id] = useState(() => nextOwner++);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    owners.push(id);
    ownerSubs.add(force);
    ping();
    return () => {
      owners = owners.filter((x) => x !== id);
      ownerSubs.delete(force);
      ping();
    };
  }, [id]);
  return owners[0] === id;
}

/** "You're offline: showing results saved on {date}" while the device has no connection. */
export default function OfflineBar() {
  const { t } = useTranslation();
  const online = useOnline();
  const first = useFirstCopy();
  const fid = useApp((s) => s.field?.id ?? null);
  const at = useSavedAt(fid, [online]);
  const fmt = useDateFmt();
  if (online || !first) return null;
  const text = at ? t("offline.bar", { date: fmt(at) }) : fid ? t("offline.bar_none") : t("offline.bar_nofield");
  return (
    <div
      role="status"
      data-testid="offline-bar"
      style={{
        position: "fixed",
        zIndex: 600,
        left: 12,
        right: 12,
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        margin: "0 auto",
        maxWidth: 560,
        padding: "10px 14px",
        borderRadius: 10,
        background: "var(--navy)",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1.4,
        boxShadow: "var(--shadow-3)",
      }}
    >
      {text}
    </div>
  );
}

/* ---------------- save a field ---------------- */

/** The bodies the pages send for this field: My field / Compare use the compare body; the plan and builder add the
    tested own options; the money page sends the plan body without `budgets`. Kept in step with useCompareBody,
    usePlanBody / withCustom (views/ActionPlan.tsx) and MoneyCalc, so the saved answers match the pages' requests. */
function useBodies(fid: string) {
  const compare = useCompareBody();
  const tested = usePlan((s) => s.plans[fid]?.tested ?? null);
  const plan: CompareBody & { custom?: unknown } = tested?.length ? { ...compare, custom: tested.map((c) => ({ name: c.name, sequence: c.sequence })) } : compare;
  const money: Record<string, unknown> = { ...plan };
  delete money.budgets;
  return { compare, plan, money };
}

type Got = { ok: boolean; skip?: boolean; json?: unknown };

async function get(url: string, init?: RequestInit): Promise<Got> {
  try {
    const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    // 404/405: the API does not offer this part for this field (or not yet); nothing to keep.
    if (r.status === 404 || r.status === 405) return { ok: true, skip: true };
    if (!r.ok) return { ok: false };
    return { ok: true, json: await r.json().catch(() => null) };
  } catch {
    return { ok: false };
  }
}

/** Fetch the field's main answers so the service worker keeps them. Returns how many were kept and how many failed. */
export async function saveFieldOffline(
  fid: string,
  bodies: { compare: unknown; plan: unknown; money: unknown },
  onProgress?: (done: number, n: number) => void,
): Promise<{ saved: number; failed: number }> {
  const f = `/api/fields/${fid}`;
  const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  const first: [string, RequestInit?][] = [
    [`${f}/report`],
    [`${f}/compare`, post(bodies.compare)],
    [`${f}/money`, post(bodies.money)],
    [`${f}/hls`],
  ];
  if (JSON.stringify(bodies.plan) !== JSON.stringify(bodies.compare)) first.push([`${f}/compare`, post(bodies.plan)]);
  const rest: string[] = [
    `${f}/nasa`,
    `${f}/ecostress`,
    `${f}/rainfall-years`,
    `${f}/wind`,
    `${f}/outlook`,
    `${f}/forecast-alerts`,
    `${f}/twins`,
    `${f}/nextmove`,
    `${f}/disease`,
    `${f}/peers`,
    "/api/kb/glossary",
    "/api/kb/sources",
    "/api/kb/crops",
    "/api/pilots",
    "/api/validation",
    "/api/validation/nasa",
  ];
  let n = first.length + rest.length;
  let done = 0;
  let saved = 0;
  let failed = 0;
  const tally = (g: Got) => {
    done += 1;
    if (!g.ok) failed += 1;
    else if (!g.skip) saved += 1;
    onProgress?.(done, n);
    return g;
  };
  onProgress?.(0, n);
  const [rep, cmp, money, hls] = await Promise.all(first.map(([u, i]) => get(u, i).then(tally)));
  await Promise.all(rest.map((u) => get(u).then(tally)));

  // Answers whose address depends on the first ones: the satellite grid shown first, the drought replay the page
  // opens with (2012, best option), and the market prices for the money page's crops.
  const more: string[] = [];
  const h = hls.json as { available?: boolean; grid_scene_id?: string | null } | null;
  if (h?.available && h.grid_scene_id) more.push(`${f}/hls/${encodeURIComponent(h.grid_scene_id)}/grid`);
  const cards = ((cmp.json as { cards?: { id: string; is_baseline?: boolean; best_for_you?: boolean }[] } | null)?.cards ?? []).filter((c) => !c.is_baseline);
  const alt = cards.find((c) => c.best_for_you)?.id ?? cards[0]?.id;
  if (alt) more.push(`${f}/replay?year=2012&alt=${encodeURIComponent(alt)}`);
  const r = rep.json as { statefips?: unknown; place?: { country_code?: string | null } | null } | null;
  const opts = (money.json as { options?: MoneyOption[] } | null)?.options ?? [];
  const crops = cropsInPlay(opts);
  if (r && crops.length) {
    // Same address as useMarketsQ in apiMoney.ts.
    const country = (r.place?.country_code ?? "").toUpperCase() || null;
    const state = country === "US" ? stateCode(r.statefips) : null;
    const q = new URLSearchParams();
    if (state) q.set("state", state);
    if (country) q.set("country", country);
    q.set("crops", crops.slice(0, 20).join(","));
    more.push(`/api/markets?${q.toString()}`);
  }
  n += more.length;
  await Promise.all(more.map((u) => get(u).then(tally)));

  // The page code for the steps not opened yet (the browser keeps these files through the service worker).
  await Promise.allSettled([
    import("../views/MoneyCalc"),
    import("../views/ActionPlan"),
    import("../views/DroughtReplay"),
    import("../views/ClimateTwins"),
    import("../views/StrategyCompare"),
    import("../views/SourcesMethods"),
  ]);
  return { saved, failed };
}

/** "Save this field for offline": on My field (step 2) and the money page. */
export function SaveOffline({ fid }: { fid: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const bodies = useBodies(fid);
  const [busy, setBusy] = useState<{ done: number; n: number } | null>(null);
  const [res, setRes] = useState<{ saved: number; failed: number } | null>(null);
  const [ver, setVer] = useState(0);
  const at = useSavedAt(fid, [ver]);
  const fmt = useDateFmt();
  const active = useSwActive();
  const run = async () => {
    setRes(null);
    setBusy({ done: 0, n: 1 });
    try {
      const r = await saveFieldOffline(fid, bodies, (done, n) => setBusy({ done, n }));
      setRes(r);
    } finally {
      setBusy(null);
      setVer((v) => v + 1);
    }
  };
  let status: string;
  if (busy) status = t("offline.saving", { done: busy.done, n: busy.n });
  else if (!active) status = t("offline.unsupported");
  else if (!online) status = at ? t("offline.saved_before", { date: fmt(at) }) : t("offline.need_online");
  else if (res && at) status = res.failed ? t("offline.saved_partial", { n: res.saved, failed: res.failed, date: fmt(at) }) : t("offline.saved", { n: res.saved, date: fmt(at) });
  else if (at) status = t("offline.saved_before", { date: fmt(at) });
  else status = t("offline.help");
  return (
    <div className="offline-save" data-testid="offline-save">
      <Button variant="secondary" icon={<IconDownload size={16} />} onClick={() => void run()} disabled={!!busy || !online || !active}>
        {at && !busy ? t("offline.resave") : t("offline.save")}
      </Button>
      <p className="fs-meta" role="status">
        {status}
      </p>
    </div>
  );
}
