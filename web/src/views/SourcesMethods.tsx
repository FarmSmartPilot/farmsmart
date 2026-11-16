/* Sources & Methods: every dataset (from the docs + this field's evidence), citations from /api/kb/sources,
   satellite-vs-ground validation, model cards and the "what this app never claims" list. */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton, StatusBanner, IconExternal } from "../design";
import { usePilotsQ, useReportQ, useSourcesQ, useValidationQ } from "../api";
import { NasaValidationSection } from "../components/NasaBlocks";
import { useApp } from "../store";
import { Ev, QueryState, Reminder } from "../components/common";
import { nice } from "../lib";

const MODEL_CARDS = ["m03_rotation_sequence.md", "m07_climate_twins.md", "m08_price_profit.md"];

/** Tiny Markdown renderer for our own docs: headings, paragraphs, bullet lists, pipe tables, **bold**, `code`. */
function inline(s: string): ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s|)]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(p))
      return (
        <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="fs-link break">
          {p}
        </a>
      );
    return p;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^#{1,4} /.test(l)) {
      const lvl = l.match(/^#+/)![0].length;
      const Tag = (lvl <= 1 ? "h2" : lvl === 2 ? "h3" : "h4") as "h2";
      out.push(
        <Tag key={i} className={lvl <= 2 ? "fs-h2" : "h4"}>
          {inline(l.replace(/^#+ /, ""))}
        </Tag>,
      );
      i++;
    } else if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, "|")));
        i++;
      }
      out.push(
        <div className="table-scroll" key={`t${i}`} tabIndex={0}>
          <table className="fs-table compact md-table">
            <thead>
              <tr>{rows[0]?.map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(1).map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*[-*] /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ""));
      out.push(
        <ul key={`u${i}`} className="bul">
          {items.map((x, k) => (
            <li key={k}>{inline(x)}</li>
          ))}
        </ul>,
      );
    } else if (l.trim()) {
      out.push(<p key={i}>{inline(l)}</p>);
      i++;
    } else i++;
  }
  return <div className="md">{out}</div>;
}

function useText(url: string) {
  const [s, setS] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    let off = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then((text) => !off && setS({ text }))
      .catch((e) => !off && setS({ error: String(e) }));
    return () => {
      off = true;
    };
  }, [url]);
  return s;
}

function ModelCard({ file }: { file: string }) {
  const s = useText(`/docs/model_cards/${file}`);
  return (
    <details className="card-sec">
      <summary className="fs-title">{file.replace(".md", "").replace(/_/g, " ")}</summary>
      {s.text ? <Markdown text={s.text} /> : s.error ? <StatusBanner kind="error">{s.error}</StatusBanner> : <Skeleton lines={3} />}
    </details>
  );
}

export default function SourcesMethods() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const report = useReportQ(field?.id ?? null);
  const src = useSourcesQ();
  const val = useValidationQ();
  const pilots = usePilotsQ();
  const ds = useText("/docs/DATA_SOURCES.md");
  const [filter, setFilter] = useState("");
  const cites = useMemo(
    () => Object.entries(src.data ?? {}).filter(([k, v]) => !filter || `${k} ${v.cite}`.toLowerCase().includes(filter.toLowerCase())),
    [src.data, filter],
  );
  const never = t("sources.never", { returnObjects: true }) as string[];

  return (
    <div className="page page--narrowish">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("sources.title")}</h1>
          <p className="fs-meta">{t("sources.sub")}</p>
        </div>
      </header>

      <section className="card-sec callout--alert" aria-labelledby="never-h">
        <h2 id="never-h" className="fs-h2">
          {t("sources.never_h")}
        </h2>
        <ul className="bul">
          {never.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      {report.data ? (
        <section className="card-sec" aria-labelledby="fev-h">
          <h2 id="fev-h" className="fs-h2">
            {t("sources.this_field", { name: field?.name })}
          </h2>
          <ul className="reasons">
            {Object.values(report.data.evidence).map((e) => (
              <li key={e.id ?? e.product}>
                <strong>
                  {e.product} <Ev ev={e} describes={e.product} />
                </strong>
                <span>
                  {e.source} · {e.effective_res ?? e.native_res} · {[e.observation_start, e.observation_end].filter(Boolean).join(" – ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card-sec" aria-labelledby="val-h">
        <h2 id="val-h" className="fs-h2">
          {t("sources.validation")}
        </h2>
        <p className="fs-meta">{t("sources.validation_help")}</p>
        {val.isLoading ? <Skeleton lines={3} /> : null}
        {val.error ? <QueryState error={val.error} what={t("sources.validation")} /> : null}
        {val.data?.sites?.length ? (
          <div className="table-scroll" tabIndex={0}>
            <table className="fs-table compact">
              <thead>
                <tr>
                  <th scope="col">{t("sources.site")}</th>
                  <th scope="col">{t("sources.tmax")}</th>
                  <th scope="col">{t("sources.tmin")}</th>
                  <th scope="col">{t("sources.p_month")}</th>
                  <th scope="col">{t("sources.p_day")}</th>
                  <th scope="col">{t("sources.heavy")}</th>
                </tr>
              </thead>
              <tbody>
                {val.data.sites.map((s) => (
                  <tr key={s.station}>
                    <th scope="row">
                      {s.pilot}
                      <div className="fs-meta">
                        {s.station_name} · {s.period?.join(" – ")}
                      </div>
                    </th>
                    <td>{s.tmax_daily ? t("sources.rbias", { r: nice(s.tmax_daily.r, lang), b: nice(s.tmax_daily.bias, lang), u: "°C" }) : "—"}</td>
                    <td>{s.tmin_daily ? t("sources.rbias", { r: nice(s.tmin_daily.r, lang), b: nice(s.tmin_daily.bias, lang), u: "°C" }) : "—"}</td>
                    <td>{s.precip_monthly ? t("sources.rbias", { r: nice(s.precip_monthly.r, lang), b: nice(s.precip_monthly.bias, lang), u: "mm" }) : "—"}</td>
                    <td>{s.precip_daily ? t("sources.rbias", { r: nice(s.precip_daily.r, lang), b: nice(s.precip_daily.bias, lang), u: "mm" }) : "—"}</td>
                    <td>{s.heavy_rain_days ? t("sources.hits", { a: Math.round(s.heavy_rain_days.hit_rate_same_day * 100), b: Math.round(s.heavy_rain_days.hit_rate_within_1_day * 100), n: s.heavy_rain_days.station_events }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <NasaValidationSection pilots={pilots.data?.pilots ?? []} />

      <section className="card-sec" aria-labelledby="mc-h">
        <h2 id="mc-h" className="fs-h2">
          {t("sources.model_cards")}
        </h2>
        <p className="fs-meta">{t("sources.model_cards_help")}</p>
        {MODEL_CARDS.map((f) => (
          <ModelCard key={f} file={f} />
        ))}
      </section>

      <section className="card-sec" aria-labelledby="cite-h">
        <h2 id="cite-h" className="fs-h2">
          {t("sources.citations")}
        </h2>
        <label className="field-l">
          <span>{t("sources.filter")}</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {src.isLoading ? <Skeleton lines={4} /> : null}
        {src.error ? <QueryState error={src.error} what={t("sources.citations")} /> : null}
        <ol className="cites">
          {cites.map(([k, v]) => (
            <li key={k} id={`src-${k}`}>
              {v.url && /^https?:/.test(v.url) ? (
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="fs-link">
                  {v.cite} <IconExternal size={12} />
                </a>
              ) : (
                v.cite
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="card-sec" aria-labelledby="ds-h">
        <h2 id="ds-h" className="fs-h2">
          {t("sources.datasets")}
        </h2>
        {ds.text ? <Markdown text={ds.text} /> : ds.error ? <StatusBanner kind="error">{ds.error}</StatusBanner> : <Skeleton lines={6} />}
      </section>
      <Reminder />
    </div>
  );
}
