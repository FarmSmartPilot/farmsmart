/* "What farms around you grow" (wave U9): GET /api/fields/{fid}/peers. USDA Cropland Data Layer (US) or AAFC Annual
   Crop Inventory (Canada), 30 m pixels in a 10 km box around the field: per-pixel rotation types over 6 years, what
   followed each crop, how shares changed, and this field's own type. A data value with a gray source button, never an
   SI output, and never evidence that a switch pays (the API's own note says so and is shown as is). */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DataButton, IconCheck, Skeleton } from "../design";
import type { Evidence } from "../design";
import { ApiError } from "../api";
import "../money.css";

interface Labelled {
  label_en?: string | null;
  label_es?: string | null;
}
interface MixItem extends Labelled {
  crop: string;
  share: number;
}
interface Transition {
  from: string;
  to: string;
  share_of_from: number;
  pixels: number;
  from_label_en?: string;
  from_label_es?: string;
  to_label_en?: string;
  to_label_es?: string;
}
interface RotType extends Labelled {
  id: string;
  share: number;
}
interface Change extends Labelled {
  crop: string;
  share_recent: number;
  share_before: number;
  delta: number;
}
interface SeqYear extends Labelled {
  year: number;
  crop: string;
  share_of_field?: number;
}
export interface PeersData {
  available: boolean;
  reason?: string | null;
  reason_es?: string | null;
  country?: string;
  source?: string;
  url?: string;
  citation?: string;
  licence?: string;
  years?: number[];
  mix?: { year: number; items: MixItem[] }[];
  transitions?: Transition[];
  transition_years?: string[];
  rotation_types?: RotType[];
  rotation_years?: number[];
  rotation_rules?: string;
  changes?: Change[];
  changes_basis?: { before: number[]; recent: number[] } | null;
  this_field_type?: string | null;
  this_field_note?: string | null;
  this_field_note_es?: string | null;
  this_field_sequence?: SeqYear[];
  note?: string;
  note_es?: string;
  scale?: string;
  scale_es?: string;
  caveats?: string[];
  caveats_es?: string[];
}

async function getPeers(fid: string): Promise<PeersData | null> {
  const res = await fetch(`/api/fields/${fid}/peers`);
  // An API without the peers route (older build): the panel is simply not shown.
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.json() as Promise<PeersData>;
}

export const usePeersQ = (fid: string | null) =>
  useQuery({ queryKey: ["peers", fid], queryFn: () => getPeers(fid!), enabled: !!fid, staleTime: Infinity, retry: 1 });

/** Short form of a label for sentences: "Continuous corn (corn 5 or 6 of 6 years)" -> "continuous corn". */
const short = (s: string) => s.split(" (")[0];

export default function PeersPanel({ fid }: { fid: string }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const q = usePeersQ(fid);
  const pctF = new Intl.NumberFormat(es ? "es" : "en-US", { style: "percent", maximumFractionDigits: 0 });
  const pct = (v: number) => pctF.format(v);
  const pct1 = (v: number) => new Intl.NumberFormat(es ? "es" : "en-US", { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v);
  const lab = (x: Labelled | undefined | null, fallback = "") => (x ? (es && x.label_es) || x.label_en || fallback : fallback);
  const d = q.data;
  if (q.data === null) return null;

  const evidence: Evidence | null =
    d && d.available
      ? {
          source: d.source ?? (d.country === "ca" ? "AAFC Annual Crop Inventory" : "USDA NASS Cropland Data Layer"),
          product: t("peers.product"),
          observation_start: d.years?.length ? String(d.years[0]) : undefined,
          observation_end: d.years?.length ? String(d.years[d.years.length - 1]) : undefined,
          native_res: "30 m",
          effective_res: (es && d.scale_es) || d.scale || undefined,
          citation: d.citation,
          licence: d.licence,
          url: d.url,
          is_nasa: false,
        }
      : null;

  let body;
  if (q.isLoading) {
    body = (
      <>
        <p className="fs-meta">{t("peers.loading")}</p>
        <Skeleton lines={3} />
      </>
    );
  } else if (q.isError || !d) {
    body = <p className="fs-meta">{t("peers.failed")}</p>;
  } else if (!d.available) {
    body = <p className="fs-meta">{t("peers.unavail", { reason: (es && d.reason_es) || d.reason || "—" })}</p>;
  } else {
    // Headline: the main rotation types over the last 6 years (else the latest year's crop mix).
    const rot = (d.rotation_types ?? []).filter((r) => r.share >= 0.05).sort((a, b) => b.share - a.share).slice(0, 3);
    const ry = d.rotation_years ?? [];
    const lastMix = d.mix?.[d.mix.length - 1];
    const head = rot.length && ry.length
      ? t("peers.head", { y0: ry[0], y1: ry[ry.length - 1], list: rot.map((r) => `${pct(r.share)} ${short(lab(r, r.id)).toLowerCase()}`).join(", ") })
      : lastMix
        ? t("peers.head_mix", { y: lastMix.year, list: lastMix.items.filter((i) => i.share >= 0.05).slice(0, 3).map((i) => `${pct(i.share)} ${lab(i, i.crop).toLowerCase()}`).join(", ") })
        : null;

    // This field's own type, and how common that type is around it.
    const mine = d.this_field_type ? (d.rotation_types ?? []).find((r) => r.id === d.this_field_type) : undefined;
    const mineText = mine
      ? mine.share > 0
        ? t("peers.this_like", { type: short(lab(mine, mine.id)).toLowerCase(), p: pct(mine.share) })
        : t("peers.this", { type: short(lab(mine, mine.id)).toLowerCase() })
      : (es && d.this_field_note_es) || d.this_field_note || null;

    // What followed the two biggest crops (pooled year pairs), up to three next crops each.
    const tr = d.transitions ?? [];
    const fromPx = new Map<string, number>();
    for (const x of tr) fromPx.set(x.from, (fromPx.get(x.from) ?? 0) + x.pixels);
    const froms = [...fromPx.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
    const afterLines = froms.map((c) => {
      const rows = tr.filter((x) => x.from === c && x.share_of_from >= 0.05).sort((a, b) => b.share_of_from - a.share_of_from).slice(0, 3);
      const from = (es && rows[0]?.from_label_es) || rows[0]?.from_label_en || c;
      const list = rows.map((x) => `${(es && x.to_label_es) || x.to_label_en || x.to} ${pct(x.share_of_from)}`).join(", ");
      return { key: c, text: t("peers.after", { from, list }) };
    });
    const ty = d.transition_years ?? [];
    const ty0 = ty[0]?.split("-")[0];
    const ty1 = ty[ty.length - 1]?.split("-")[1];

    const ch = (d.changes ?? []).filter((c) => Math.abs(c.delta) >= 0.01).slice(0, 3);
    const cb = d.changes_basis;
    const seq = d.this_field_sequence ?? [];
    const caveats = (es && d.caveats_es?.length ? d.caveats_es : d.caveats) ?? [];

    body = (
      <>
        {head ? (
          <p className="peers__head" data-testid="peers-head">
            {head}
          </p>
        ) : null}
        {mineText ? (
          <p className="peers__mine" data-testid="peers-mine">
            {mineText}
          </p>
        ) : null}
        {seq.length ? (
          <ol className="peers__seq" aria-label={t("peers.this_seq")}>
            {seq.map((s) => (
              <li key={s.year}>
                <span className="fs-meta">{s.year}</span> {lab(s, s.crop)}
              </li>
            ))}
          </ol>
        ) : null}
        {afterLines.length && ty0 && ty1 ? (
          <div className="peers__block">
            <p className="peers__h">{t("peers.after_h", { y0: ty0, y1: ty1 })}</p>
            <ul className="mini-list" data-testid="peers-after">
              {afterLines.map((l) => (
                <li key={l.key}>{l.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {cb ? (
          <div className="peers__block">
            <p className="peers__h">{t("peers.changes_h", { b0: cb.before[0], b1: cb.before[cb.before.length - 1], r0: cb.recent[0], r1: cb.recent[cb.recent.length - 1] })}</p>
            {ch.length ? (
              <ul className="mini-list" data-testid="peers-changes">
                {ch.map((c) => (
                  <li key={c.crop}>{t("peers.change", { crop: lab(c, c.crop), a: pct1(c.share_before), b: pct1(c.share_recent) })}</li>
                ))}
              </ul>
            ) : (
              <p className="fs-meta">{t("peers.no_change")}</p>
            )}
          </div>
        ) : null}
        <p className="money-note peers__note" data-testid="peers-note">
          {(es && d.note_es) || d.note}
        </p>
        <details className="peers__more">
          <summary>{t("peers.more")}</summary>
          <ul className="mini-list">
            {caveats.map((c) => (
              <li key={c} className="fs-meta">
                {c}
              </li>
            ))}
          </ul>
          {!es && d.rotation_rules ? (
            <p className="fs-meta">
              {t("peers.rules")}: {d.rotation_rules}
            </p>
          ) : null}
          {d.citation ? <p className="fs-meta">{d.citation}</p> : null}
        </details>
      </>
    );
  }

  return (
    <div className="fact peers" data-testid="peers">
      <span className="fact__check" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      <div className="fact__body">
        <div className="fact__label">
          {t("peers.h")}
          {evidence ? <DataButton evidence={evidence} describes={t("peers.h")} /> : null}
        </div>
        <div className="fact__value peers__body">{body}</div>
      </div>
    </div>
  );
}
