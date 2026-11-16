import type { ReactNode } from "react";
import { Popover, usePopover } from "./Popover";
import type { Placement } from "./Popover";
import { IconAlert, IconExternal, IconSatellite } from "./Icons";
import type { Confidence, ConfidenceLevel, Evidence, GlossaryMap, ModelKind, SIRecord } from "./types";

/* ---------------- helpers ---------------- */

function fmtDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtRange(a?: string, b?: string): string | undefined {
  const s = fmtDate(a);
  const e = fmtDate(b);
  if (s && e) return s === e ? s : `${s} – ${e}`;
  return s ?? e;
}

function Meta({ rows }: { rows: [string, ReactNode | undefined][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  return (
    <dl className="fs-meta-grid">
      {shown.map(([k, v]) => (
        <div key={k} className="fs-meta-grid__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- DataButton ---------------- */

export interface DataButtonProps {
  evidence: Evidence;
  placement?: Placement;
  /** Extra words for the aria-label, e.g. what value it explains ("rainfall, last 30 days"). */
  describes?: string;
  className?: string;
}

/**
 * Tiny round provenance button. Navy + white satellite = NASA data; gray + satellite = other source.
 * Place directly after the number, label or chart title it explains.
 */
export function DataButton({ evidence, placement, describes, className }: DataButtonProps) {
  const p = usePopover();
  const label = `Data source: ${evidence.product}${evidence.is_nasa ? " (NASA)" : ""}${describes ? `, for ${describes}` : ""}`;
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={`fs-dot ${evidence.is_nasa ? "fs-dot--nasa" : "fs-dot--other"} ${className ?? ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        <IconSatellite size={10} strokeWidth={2.4} />
      </button>
      <Popover open={p.open} onClose={p.close} anchorRef={p.anchorRef} title={evidence.product} placement={placement}>
        <p className="fs-pop-kicker">
          <span className={`fs-dot fs-dot--static ${evidence.is_nasa ? "fs-dot--nasa" : "fs-dot--other"}`} aria-hidden="true">
            <IconSatellite size={10} strokeWidth={2.4} />
          </span>
          {evidence.is_nasa ? "NASA data" : "Other data source"} · {evidence.source}
        </p>
        <Meta
          rows={[
            ["Version", evidence.version],
            ["Observed", fmtRange(evidence.observation_start, evidence.observation_end)],
            ["Native resolution", evidence.native_res],
            ["Used at", evidence.effective_res],
            ["Footprint", evidence.footprint],
            [
              "Quality notes",
              evidence.qa_flags && evidence.qa_flags.length > 0 ? (
                <ul className="fs-pop-list">
                  {evidence.qa_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                "None reported"
              ),
            ],
            ["Licence", evidence.licence],
            ["Citation", evidence.citation],
          ]}
        />
        {evidence.url ? (
          <a className="fs-link fs-pop-link" href={evidence.url} target="_blank" rel="noreferrer noopener">
            Open source <IconExternal size={14} />
          </a>
        ) : null}
      </Popover>
    </>
  );
}

/* ---------------- Confidence ---------------- */

const CONF_LABEL: Record<ConfidenceLevel, string> = { high: "High", medium: "Medium", low: "Low" };

/** Shape encodes level so it never relies on color alone: ● high, ◆ medium, ▲ low. */
export function ConfidenceShape({ level, size = 10 }: { level: ConfidenceLevel; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false" className="fs-conf-shape">
      {level === "high" ? <circle cx="5" cy="5" r="4.5" fill="currentColor" /> : null}
      {level === "medium" ? <path d="M5 .5 9.5 5 5 9.5.5 5z" fill="currentColor" /> : null}
      {level === "low" ? <path d="M5 1 9.5 9h-9z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /> : null}
    </svg>
  );
}

function ConfidenceBody({ confidence }: { confidence: Confidence }) {
  return (
    <>
      {confidence.reasons.length > 0 ? (
        <ul className="fs-pop-list">
          {confidence.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="fs-muted">No reasons were recorded.</p>
      )}
      {confidence.raise ? <p className="fs-pop-raise">{confidence.raise}</p> : null}
    </>
  );
}

export interface ConfidenceChipProps {
  confidence: Confidence;
  /** Set false to render a static (non-interactive) chip, e.g. inside another popover. */
  interactive?: boolean;
  placement?: Placement;
}

export function ConfidenceChip({ confidence, interactive = true, placement }: ConfidenceChipProps) {
  const p = usePopover();
  const text = `Confidence: ${CONF_LABEL[confidence.level]}`;
  const cls = `fs-conf fs-conf--${confidence.level}`;
  if (!interactive) {
    return (
      <span className={cls}>
        <ConfidenceShape level={confidence.level} />
        {text}
      </span>
    );
  }
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={`${cls} fs-conf--btn`}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
        aria-label={`${text}. Show reasons`}
      >
        <ConfidenceShape level={confidence.level} />
        {text}
      </button>
      <Popover open={p.open} onClose={p.close} anchorRef={p.anchorRef} title={`Why ${CONF_LABEL[confidence.level].toLowerCase()} confidence?`} placement={placement} width={280}>
        <ConfidenceBody confidence={confidence} />
      </Popover>
    </>
  );
}

/* ---------------- SIButton ---------------- */

/** Honest label for what produced the output. */
export const MODEL_KIND_LABEL: Record<ModelKind, string> = {
  si: "SI model (trained on data)",
  rules: "rules (expert agronomy rules, not trained)",
  process: "process model (crop and water physics)",
};

export interface SIButtonProps {
  record: SIRecord;
  placement?: Placement;
  /** What output it explains, for the aria-label. */
  describes?: string;
  className?: string;
}

/** Tiny round green "SI" button. Place next to any output an SI model, rule set or process model produced. */
export function SIButton({ record, placement, describes, className }: SIButtonProps) {
  const p = usePopover();
  const kindShort = record.kind === "si" ? "SI model" : record.kind === "rules" ? "rules" : "process model";
  // Starts with the visible letters "SI" so speech-input users can say "click SI" (WCAG 2.5.3).
  const label = `SI: how this estimate works: ${record.model_name} (${kindShort})${describes ? `, for ${describes}` : ""}`;
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={`fs-dot fs-dot--si ${className ?? ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        <span aria-hidden="true">SI</span>
      </button>
      <Popover open={p.open} onClose={p.close} anchorRef={p.anchorRef} title="How this estimate works" placement={placement} width={340}>
        <Meta
          rows={[
            ["Model", `${record.model_name}${record.version ? ` · v${record.version}` : ""}`],
            ["Kind", MODEL_KIND_LABEL[record.kind]],
            ["Information cutoff", fmtDate(record.information_cutoff)],
          ]}
        />
        {record.top_drivers.length > 0 ? (
          <>
            <h3 className="fs-overline fs-pop-h">Top drivers</h3>
            <ol className="fs-pop-drivers">
              {record.top_drivers.map((d) => (
                <li key={d.name}>
                  <span className="fs-pop-drivers__arrow" aria-hidden="true">
                    {d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "●"}
                  </span>
                  <span>
                    {d.name}
                    {d.direction ? <span className="fs-visually-hidden"> ({d.direction === "mixed" ? "mixed effect" : `pushes ${d.direction}`})</span> : null}
                    {d.note ? <span className="fs-meta"> · {d.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <h3 className="fs-overline fs-pop-h">Confidence</h3>
        <ConfidenceChip confidence={record.confidence} interactive={false} />
        <ConfidenceBody confidence={record.confidence} />
        <p className="fs-pop-support">
          <IconAlert size={14} /> This supports your judgment. It does not replace it, or local expertise.
        </p>
        {record.model_card_url ? (
          <a className="fs-link fs-pop-link" href={record.model_card_url}>
            Model card <IconExternal size={14} />
          </a>
        ) : null}
      </Popover>
    </>
  );
}

/* ---------------- GlossaryTerm ---------------- */

export interface GlossaryTermProps {
  /** Key into `definitions`. */
  term: string;
  definitions: GlossaryMap;
  /** Visible text; defaults to the entry's term. */
  children?: ReactNode;
}

/** Jargon with a dotted underline; click or Enter opens a plain-language definition. */
export function GlossaryTerm({ term, definitions, children }: GlossaryTermProps) {
  const p = usePopover();
  const entry = definitions[term];
  if (!entry) return <>{children ?? term}</>;
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className="fs-term"
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
        aria-label={`${typeof children === "string" ? children : entry.term}: show definition`}
      >
        {children ?? entry.term}
      </button>
      <Popover open={p.open} onClose={p.close} anchorRef={p.anchorRef} title={entry.term} width={280}>
        <p>{entry.definition}</p>
        {entry.example ? <p className="fs-meta fs-pop-example">{entry.example}</p> : null}
      </Popover>
    </>
  );
}
