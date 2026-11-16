/* Shared helpers: unit formatting, crop colours, indicator metadata and provenance adapters.
   Formatting only converts and rounds API values; it never creates numbers. */
import type { TFunction } from "i18next";
import type { Evidence, SIRecord, GlossaryMap } from "./design";
import type { ApiConfidence, ApiEvidence, CardData, CompareResult, Quant } from "./api";
import type { Units } from "./store";

/* ---------------- numbers & units ---------------- */

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmt(v: number | null | undefined, digits = 0, lang = "en"): string {
  if (!isNum(v)) return "—";
  return v.toLocaleString(lang === "es" ? "es" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Significant-figure style rounding that reads naturally (1.6, 13, 860). */
export function nice(v: number | null | undefined, lang = "en"): string {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : 2;
  return fmt(v, d, lang);
}

export type UnitKind = "mm" | "t_ha" | "ha" | "c" | "c_delta" | "usd_ac" | "kg_ha" | "m" | "ms" | "days" | "weeks" | "pct" | "index" | "t_c_ha" | "passes" | "none";

/** Convert a metric API value to the chosen unit system. Returns [value, unit label]. */
export function conv(v: number | null | undefined, kind: UnitKind, units: Units): [number | null, string] {
  if (!isNum(v)) return [null, unitLabel(kind, units)];
  if (units === "imperial") {
    switch (kind) {
      case "mm": return [v / 25.4, "in"];
      case "t_ha": return [v * 0.4461, "tons/ac"];
      case "t_c_ha": return [v * 0.4461, "tons C/ac/yr"];
      case "ha": return [v * 2.4711, "ac"];
      case "c": return [v * 1.8 + 32, "°F"];
      case "c_delta": return [v * 1.8, "°F"];
      case "kg_ha": return [v * 0.8922, "lb/ac"];
      case "m": return [v * 3.2808, "ft"];
      case "ms": return [v * 2.2369, "mph"];
      default: break;
    }
  }
  return [v, unitLabel(kind, units)];
}

export function unitLabel(kind: UnitKind, units: Units): string {
  const imp = units === "imperial";
  switch (kind) {
    case "mm": return imp ? "in" : "mm";
    case "t_ha": return imp ? "tons/ac" : "t/ha";
    case "t_c_ha": return imp ? "tons C/ac/yr" : "t C/ha/yr";
    case "ha": return imp ? "ac" : "ha";
    case "c": return imp ? "°F" : "°C";
    case "c_delta": return imp ? "°F" : "°C";
    case "kg_ha": return imp ? "lb/ac" : "kg/ha";
    case "m": return imp ? "ft" : "m";
    case "ms": return imp ? "mph" : "m/s";
    case "usd_ac": return "$/ac";
    case "days": return "days";
    case "weeks": return "weeks";
    case "pct": return "%";
    case "passes": return "passes/yr";
    default: return "";
  }
}

export function fmtU(v: number | null | undefined, kind: UnitKind, units: Units, lang = "en", digits?: number): string {
  const [x, u] = conv(v, kind, units);
  if (x === null) return "—";
  const s = digits === undefined ? nice(x, lang) : fmt(x, digits, lang);
  return u ? `${s} ${u}` : s;
}

/** Day of year → "Apr 25". */
export function doyLabel(doy: number | null | undefined, lang = "en"): string {
  if (!isNum(doy)) return "—";
  const d = new Date(Date.UTC(2021, 0, 1) + (doy - 1) * 86400000);
  return d.toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function monthShort(m: number, lang = "en"): string {
  return new Date(Date.UTC(2021, m - 1, 15)).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", timeZone: "UTC" });
}

/** Week index (0–51) → month label of that week's middle day. */
export function weekMonth(w: number, lang = "en"): string {
  const doy = Math.floor(((w % 52) + 0.5) * 7) + 1;
  return doyLabel(doy, lang).split(" ")[0];
}

export function ordinal(n: number, lang = "en"): string {
  const r = Math.round(n);
  if (lang === "es") return `${r}.º`;
  const s = ["th", "st", "nd", "rd"];
  const v = r % 100;
  return r + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ---------------- crops ---------------- */

const CROP_VAR: Record<string, string> = {
  corn: "--crop-corn",
  soybean: "--crop-soybean",
  winter_wheat: "--crop-wheat",
  spring_wheat: "--crop-wheat",
  durum: "--crop-wheat",
  wheat: "--crop-wheat",
  oats: "--crop-oats",
  oats_winterkill: "--crop-oats",
  cereal_rye: "--crop-rye",
  rye: "--crop-rye",
  red_clover: "--crop-clover",
  clover: "--crop-clover",
  hairy_vetch: "--crop-clover",
  alfalfa: "--crop-alfalfa",
  sorghum: "--crop-sorghum",
};
const EXTRA = ["#7C8FA6", "#9C7AB8", "#6FA8A0", "#B58C5A", "#8DA24E", "#C47E8F"];

export function cropColor(id: string | null | undefined): string {
  if (!id) return "var(--line-strong)";
  const v = CROP_VAR[id];
  if (v) return `var(${v})`;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

/** Text colour that stays readable on a crop fill. */
export function cropInk(id: string | null | undefined): string {
  // White only on the dark fills (≥ 4.5:1); navy on light fills, the hashed EXTRA colours and the unknown gray.
  return id && ["cereal_rye", "rye", "red_clover", "clover", "hairy_vetch", "alfalfa", "sorghum"].includes(id) ? "#fff" : "var(--ink)";
}

/* ---------------- indicators ---------------- */

export interface IndicatorMeta {
  key: string;
  dir: 1 | -1;
  unit: UnitKind;
  glossary?: string;
  /** i18n key for the label. */
  label: string;
}

/** Raw indicators shown beside the score. Directions match the backend ranker. */
export const INDICATORS: IndicatorMeta[] = [
  { key: "soil_cover", dir: 1, unit: "days", label: "ind.soil_cover" },
  { key: "erosion_water", dir: -1, unit: "t_ha", glossary: "rusle", label: "ind.erosion_water" },
  { key: "wind_exposure", dir: -1, unit: "index", label: "ind.wind_exposure" },
  { key: "water_use", dir: -1, unit: "mm", glossary: "et", label: "ind.water_use" },
  { key: "yield_index", dir: 1, unit: "pct", label: "ind.yield_index" },
  { key: "profit_p50", dir: 1, unit: "usd_ac", label: "ind.profit_p50" },
  { key: "soc_trend", dir: 1, unit: "t_c_ha", label: "ind.soc_trend" },
  { key: "n_balance", dir: 1, unit: "kg_ha", label: "ind.n_balance" },
  { key: "dry_year_regret", dir: -1, unit: "pct", label: "ind.dry_year_regret" },
  { key: "workload", dir: -1, unit: "passes", label: "ind.workload" },
];

export const PETAL_KEYS = ["soil_cover", "erosion_water", "wind_exposure", "water_use", "soc_trend", "profit_p50", "workload"];

/** Normalise one indicator across all simulated cards (P50), 1 = best among the options compared. */
export function normalize(all: CardData[], key: string, dir: 1 | -1, card: CardData): number | null {
  const vals = all.map((c) => c.indicators[key]?.p50).filter(isNum);
  const v = card.indicators[key]?.p50;
  if (!isNum(v) || vals.length === 0) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi - lo < 1e-9) return 0.5;
  const t = (v - lo) / (hi - lo);
  return dir === 1 ? t : 1 - t;
}

export function quant(card: CardData, key: string): Quant | undefined {
  return card.indicators[key];
}

/* ---------------- provenance adapters ---------------- */

const u = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v);

export function toEvidence(e: ApiEvidence | undefined | null): Evidence | null {
  if (!e) return null;
  return {
    source: e.source,
    product: e.product,
    version: u(e.version),
    observation_start: u(e.observation_start),
    observation_end: u(e.observation_end),
    native_res: u(e.native_res),
    effective_res: u(e.effective_res),
    footprint: u(e.footprint),
    qa_flags: [...(e.qa_flags ?? []), ...(e.note ? [e.note] : []), ...(e.transformation ? [`Method: ${e.transformation}`] : [])],
    licence: u(e.licence),
    citation: u(e.citation),
    url: u(e.url),
    is_nasa: !!e.is_nasa,
  };
}

export function toConfidence(c: ApiConfidence | undefined, raise?: string) {
  return { level: c?.level ?? "low", reasons: c?.reasons?.length ? c.reasons : ["No confidence details returned"], raise };
}

/** SI record for a rotation card (process model + ranker), with drivers from the card's own deltas. */
export function cardSI(card: CardData, cmp: CompareResult | undefined, t: (k: string) => string): SIRecord {
  const contrib = cmp?.ranking?.contributions?.[card.id];
  const drivers = contrib
    ? contrib.slice(0, 4).map((d) => ({ name: d.label, direction: (d.value ?? 0) >= 0 ? ("up" as const) : ("down" as const) }))
    : Object.entries(cmp?.weights ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, w]) => ({ name: t(`ind.${k}`) !== `ind.${k}` ? t(`ind.${k}`) : k, direction: "mixed" as const, note: `${Math.round(w * 100)}% weight` }));
  return {
    model_name: card.model?.name ?? "FarmSmart process simulator + rotation ranker",
    kind: card.model?.kind ?? "process",
    version: card.model?.id,
    top_drivers: drivers,
    confidence: toConfidence(card.confidence, card.information_gaps?.[0]),
    information_cutoff: cmp?.weather_years ? `${cmp.weather_years.last}-12-31` : undefined,
    model_card_url: "#/sources",
  };
}

export function rulesSI(conf: ApiConfidence | undefined, drivers: string[], name = "FarmSmart agronomy rules engine"): SIRecord {
  return {
    model_name: name,
    kind: "rules",
    top_drivers: drivers.slice(0, 4).map((d) => ({ name: d })),
    confidence: toConfidence(conf ?? { level: "medium", reasons: ["Rules come from published extension guides; local conditions vary"] }),
    model_card_url: "#/sources",
  };
}

/** Build a GlossaryMap from the API in the chosen language. */
export function glossaryMap(terms: { id: string; term_en: string; term_es: string; en: string; es: string }[] | undefined, lang: string): GlossaryMap {
  const m: GlossaryMap = {};
  for (const x of terms ?? []) m[x.id] = { term: lang === "es" ? x.term_es : x.term_en, definition: lang === "es" ? x.es : x.en };
  return m;
}

/** Plain-words p-value. */
export function pWords(p: number, t: (k: string) => string): string {
  if (!isNum(p)) return "";
  if (p < 0.01) return t("trend.p_strong");
  if (p < 0.05) return t("trend.p_clear");
  if (p < 0.1) return t("trend.p_weak");
  return t("trend.p_none");
}

/** "in N of M weather years" from quantiles: P10/P50/P90 mark 10%/50%/90% of n years. */
export function yearsAtOrBelow(q: Quant, pct: 10 | 50 | 90): string {
  return `${Math.round((q.n * pct) / 100)} / ${q.n}`;
}

export type TFn = (key: string, opts?: Record<string, unknown>) => string;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Human label for a scenario: preset name, or "rain −20 %, +1.5 °C, crop prices 20 % lower" for the custom form. */
export function scenarioLabel(s: string | null | undefined, t: TFunction, lang = "en"): string {
  if (!s || s === "normal") return t("scenario.normal");
  if (s.startsWith("custom:")) {
    const kv = Object.fromEntries(
      s
        .slice(7)
        .split(",")
        .map((x) => x.split("="))
        .filter((x) => x.length === 2),
    );
    const num = (v: unknown) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    const r = num(kv.rain);
    const tc = num(kv.temp);
    const p = num(kv.price);
    const sign = (v: number) => (v > 0 ? "+" : "−");
    // Only the parts that change: "rain −10 %", "+2 °C", "crop prices 20 % lower", or any mix.
    const parts: string[] = [];
    if (r) parts.push(t("scen.rain_part", { v: `${sign(r)}${Math.abs(r).toLocaleString(lang)}` }));
    if (tc) parts.push(`${sign(tc)}${Math.abs(tc).toLocaleString(lang, { maximumFractionDigits: 1 })} °C`);
    if (p) parts.push(t(p < 0 ? "scen.price_lower" : "scen.price_higher", { v: Math.abs(p).toLocaleString(lang) }));
    return parts.join(", ") || t("scenario.normal");
  }
  return t(`scenario.${s}`);
}

/* ---------------- plain-word rotation names ---------------- */

/**
 * "Corn ×2–Soybean + cereal rye" → "Corn, corn, then soybean, with a cereal rye cover crop".
 * Only rewrites the engine's compact notation (× repeats, en-dash sequence, "+ covers"); other names pass through.
 */
/** Spanish crop names for the engine's short English names (rotation labels). */
const CROP_ES: Record<string, string> = {
  corn: "maíz", soybean: "soya", "winter wheat": "trigo de invierno", "spring wheat": "trigo de primavera",
  "durum wheat": "trigo duro", wheat: "trigo", oats: "avena", barley: "cebada", sorghum: "sorgo", "grain sorghum": "sorgo",
  sunflower: "girasol", canola: "canola", "field pea": "arveja", pea: "arveja", lentil: "lenteja", chickpea: "garbanzo",
  "dry bean": "frijol", "dry edible bean": "frijol", alfalfa: "alfalfa", "red clover": "trébol rojo", cotton: "algodón",
  rice: "arroz", "proso millet": "mijo proso", millet: "mijo", safflower: "cártamo", flax: "lino", "sugar beet": "remolacha azucarera",
  "processing tomato": "tomate para industria", triticale: "triticale", "cereal rye": "centeno", rye: "centeno",
  "crimson clover": "trébol encarnado", "hairy vetch": "veza vellosa", radish: "rábano", camelina: "camelina",
  "winter camelina": "camelina de invierno", cowpea: "caupí", "sunn hemp": "crotalaria", fallow: "barbecho",
};
const cropEs = (name: string) => {
  const k = name.trim().toLowerCase().replace(/\s*\(.*\)$/, "");
  return CROP_ES[k] ?? name;
};

export function plainRotation(label: string | null | undefined, lang = "en"): string {
  if (!label) return label ?? "";
  const es = lang === "es";
  const [seqRaw, coverRaw] = label.split(" + ");
  const parts = seqRaw.split("–").map((s) => s.trim()).filter(Boolean);
  // Not the compact notation (e.g. "Continuous corn", "Your current rotation"): leave as is.
  if (parts.length < 2 && !/ ×\d/.test(seqRaw) && !coverRaw) return label;
  const crops: string[] = [];
  for (const p of parts) {
    const m = p.match(/^(.*?) ×(\d+)$/);
    const name = es ? cropEs(m ? m[1] : p) : m ? m[1] : p;
    const n = m ? Math.min(6, Number(m[2])) : 1;
    for (let i = 0; i < n; i++) crops.push(name);
  }
  const words = crops.map((c, i) => (i === 0 ? c.charAt(0).toUpperCase() + c.slice(1) : c.toLowerCase()));
  const then = es ? "y luego" : "then";
  let seq = words[0] ?? seqRaw;
  if (words.length === 2) seq = `${words[0]}, ${then} ${words[1]}`;
  else if (words.length > 2) seq = `${words.slice(0, -1).join(", ")}, ${then} ${words[words.length - 1]}`;
  if (!coverRaw) return seq;
  const covers = coverRaw.split(",").map((s) => (es ? cropEs(s.trim()) : s.trim())).filter(Boolean);
  const and = es ? " y " : " and ";
  const list = covers.length > 1 ? `${covers.slice(0, -1).join(", ")}${and}${covers[covers.length - 1]}` : covers[0];
  if (es) return `${seq}, con cobertura de ${list}`;
  return `${seq}, with ${covers.length > 1 ? "" : "a "}${list} cover crop${covers.length > 1 ? "s" : ""}`;
}

/** The compare result with every rotation name in plain words (display only; ids are untouched). */
export function plainCompare(d: CompareResult, lang = "en"): CompareResult {
  const card = (c: CardData): CardData => {
    const out = { ...c, name: plainRotation(c.name, lang), rotation_label: plainRotation(c.rotation_label, lang) };
    if (lang !== "es") return out;
    // Rule messages in Spanish (wave U9): the flags carry message_es, and the trade-offs list repeats flag messages.
    const es = new Map((c.flags ?? []).filter((f) => f.message_es).map((f) => [f.message, f.message_es!]));
    if (!es.size) return out;
    return {
      ...out,
      flags: c.flags.map((f) => (f.message_es ? { ...f, message: f.message_es } : f)),
      tradeoffs_risks: (c.tradeoffs_risks ?? []).map((x) => es.get(x) ?? x),
      benefits: (c.benefits ?? []).map((x) => es.get(x) ?? x),
      why: (c.why ?? []).map((x) => es.get(x) ?? x),
      evidence: (c.evidence ?? []).map((x) => (es.has(x.text) ? { ...x, text: es.get(x.text)! } : x)),
    };
  };
  return {
    ...d,
    cards: (d.cards ?? []).map(card),
    all_cards: (d.all_cards ?? []).map(card),
    excluded_candidates: d.excluded_candidates?.map((x) => ({ ...x, name: plainRotation(x.name, lang) })),
    baseline_detection: d.baseline_detection ? { ...d.baseline_detection, label: plainRotation(d.baseline_detection.label, lang) } : d.baseline_detection,
  };
}
