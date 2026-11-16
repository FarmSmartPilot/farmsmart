/* Component gallery for the FarmSmart design system.
   Every value on this page is a SAMPLE prop for layout review. None of it is a result. */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Button,
  Card,
  Chip,
  ConfidenceChip,
  DataButton,
  DemoButton,
  GlossaryTerm,
  Hint,
  MatchBar,
  PetalChart,
  SegmentedToggle,
  SIButton,
  Skeleton,
  StatusBanner,
  Tabs,
  Tour,
  BottomSheet,
  usePopover,
  Popover,
} from "./index";
import * as I from "./Icons";
import type { Evidence, GlossaryMap, SIRecord, PetalIndicator, TourStep } from "./index";

/* ---------- sample props (gallery only) ---------- */

const SAMPLE_NASA: Evidence = {
  source: "NASA GES DISC",
  product: "GPM IMERG Final Precipitation L3 (sample record)",
  version: "07",
  observation_start: "2024-03-01",
  observation_end: "2024-04-30",
  native_res: "0.1° (≈10 km)",
  effective_res: "regional value (≈10 km)",
  footprint: "Grid cell containing the field centre",
  qa_flags: ["Sample record for the component gallery"],
  licence: "Open data, no restrictions",
  citation: "Huffman et al., GPM IMERG Final Precipitation L3 V07",
  url: "https://gpm.nasa.gov/data/imerg",
  is_nasa: true,
};

const SAMPLE_OTHER: Evidence = {
  source: "USDA NRCS",
  product: "SSURGO soil survey (sample record)",
  observation_start: "2023-10-01",
  native_res: "map units, 1:12,000–1:24,000",
  effective_res: "dominant map unit in field",
  qa_flags: [],
  licence: "Public domain",
  citation: "Soil Survey Staff, NRCS, USDA. SSURGO database.",
  url: "https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo",
  is_nasa: false,
};

const SAMPLE_SI: SIRecord = {
  model_name: "Rotation ranker (sample record)",
  kind: "si",
  version: "0.0",
  top_drivers: [
    { name: "Bare-soil weeks in windy season", direction: "down" },
    { name: "Slope class", direction: "down" },
    { name: "Cover crop fit for the frost-free window", direction: "up" },
  ],
  confidence: {
    level: "medium",
    reasons: ["Few local yield records", "Cloudy imagery in June"],
    raise: "A soil test would raise confidence →",
  },
  information_cutoff: "2026-10-31",
  model_card_url: "#model-card",
};

const SAMPLE_RULES: SIRecord = {
  model_name: "Agronomy rules (sample record)",
  kind: "rules",
  top_drivers: [{ name: "Herbicide carry-over window", direction: "mixed" }],
  confidence: { level: "high", reasons: ["Rule based on published extension guidance"] },
};

const GLOSSARY: GlossaryMap = {
  ndvi: {
    term: "NDVI",
    definition: "A satellite measure of how green plants look. Higher means more green leaves. It does not measure yield.",
  },
  et: {
    term: "ET (evapotranspiration)",
    definition: "Water that leaves the field as vapour, from soil and from plant leaves.",
  },
  p10: {
    term: "P10 / P50 / P90",
    definition: "In 10 out of 100 seasons the value is below P10. P50 is the middle. In 90 out of 100 seasons it is below P90.",
    example: "Think of P10 as a bad year and P90 as a good year.",
  },
};

const PETALS: PetalIndicator[] = [
  { key: "soil", label: "Soil", value0to1: 0.8, color: "var(--soil)" },
  { key: "water", label: "Water", value0to1: 0.55, color: "var(--sky)" },
  { key: "erosion", label: "Erosion", value0to1: 0.9, color: "var(--field)" },
  { key: "income", label: "Income", value0to1: 0.45, color: "var(--wheat)" },
  { key: "pests", label: "Pests", value0to1: null, color: "var(--purple)" },
];

const CROPS = ["corn", "soybean", "wheat", "oats", "rye", "clover", "alfalfa", "sorghum"] as const;

/* ---------- layout helpers ---------- */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="fs-card" aria-labelledby={`${id}-h`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
      <h2 id={`${id}-h`} className="fs-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

const row = { "--gap": "12px" } as CSSProperties;

/* ---------- page ---------- */

export default function Showcase() {
  const [mode, setMode] = useState<"simple" | "expert">("simple");
  const [dim, setDim] = useState<"2d" | "3d">("3d");
  const [layers, setLayers] = useState<Record<string, boolean>>({ Wind: true });
  const [sheet, setSheet] = useState(false);
  const [tour, setTour] = useState(false);
  const pop = usePopover();

  const steps: TourStep[] = [
    { target: "#sc-demo", title: "Guided demo", body: "This button starts a walk through the key features. You can leave at any time with Esc." },
    { target: "#sc-provenance", title: "Where every number comes from", body: "Tap a navy button for NASA data, a gray one for other sources, and the green SI button to see how an estimate was made.", placement: "right" },
    { target: "#sc-option", title: "Rotation options", body: "Each option shows a trade-off petal, a match to your priorities and a confidence chip.", placement: "left" },
    { target: "#sc-banners", title: "Honest states", body: "When data is missing or old, the app says so and you can keep going with what is there." },
    { target: "#does-not-exist", title: "Missing target", body: "If a step's target is not on the page, the card is centered instead." },
  ];

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px 64px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 24 }}>
      <header className="fs-row" style={{ flexWrap: "wrap", ...row }}>
        <div className="fs-stack" style={{ "--gap": "4px", flex: 1, minWidth: 240 } as CSSProperties}>
          <span className="fs-overline">FarmSmart · design system</span>
          <h1 className="fs-h1">Component gallery</h1>
        </div>
        <span id="sc-demo">
          <DemoButton onClick={() => setTour(true)} />
        </span>
      </header>

      <StatusBanner kind="partial" title="Gallery only: sample values">
        Everything below uses sample props to show layout and behaviour. None of these numbers are results for any field.
      </StatusBanner>

      <Section id="sc-tokens" title="Colour tokens">
        <div className="fs-cluster" style={row}>
          {["navy", "field", "si", "wheat", "sky", "soil", "alert", "purple", "surface"].map((t) => (
            <Swatch key={t} name={t} color={`var(--${t})`} />
          ))}
        </div>
        <h3 className="fs-overline">Crops</h3>
        <div className="fs-cluster" style={row}>
          {CROPS.map((c) => (
            <Swatch key={c} name={c} color={`var(--crop-${c})`} />
          ))}
          <div className="fs-stack" style={{ "--gap": "4px" } as CSSProperties}>
            <span className="fs-hatch-bare" style={{ width: 56, height: 32, borderRadius: 6 }} />
            <span className="fs-meta">bare soil</span>
          </div>
        </div>
        <h3 className="fs-overline">Okabe-Ito categorical</h3>
        <div className="fs-cluster" style={row}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <Swatch key={n} name={`cat-${n}`} color={`var(--cat-${n})`} />
          ))}
        </div>
        <h3 className="fs-overline">Label over imagery</h3>
        <div
          style={{
            height: 96,
            borderRadius: 12,
            padding: 12,
            background: "linear-gradient(120deg,#5d7a3a,#c9b37e 40%,#2f5b2b 70%,#e8dcc0)",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <span className="fs-on-imagery">Field 12</span>
          <span className="fs-on-imagery fs-on-imagery--light">Imagery stamp · sample</span>
        </div>
      </Section>

      <Section id="sc-buttons" title="Buttons, chips, toggles">
        <div className="fs-cluster" style={row}>
          <Button iconAfter={<I.IconChevronRight size={16} />}>Compare rotations</Button>
          <Button variant="secondary" icon={<I.IconDownload size={16} />}>
            Export report
          </Button>
          <Button variant="ghost" icon={<I.IconLayers size={16} />}>
            Layers
          </Button>
          <Button variant="si">Stress-test weather years</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="fs-cluster" style={row}>
          <SegmentedToggle
            label="Detail level"
            value={mode}
            onChange={setMode}
            options={[
              { value: "simple", label: "Simple" },
              { value: "expert", label: "Expert" },
            ]}
          />
          <SegmentedToggle
            label="Map view"
            value={dim}
            onChange={setDim}
            options={[
              { value: "2d", label: "2D", icon: <I.Icon2D size={16} /> },
              { value: "3d", label: "3D", icon: <I.Icon3D size={16} /> },
            ]}
          />
        </div>
        <div className="fs-cluster" style={row}>
          {(["Cover", "Wind", "Rain", "Soil moisture", "Heat", "Soils"] as const).map((l) => (
            <Chip key={l} pressed={!!layers[l]} onClick={() => setLayers((s) => ({ ...s, [l]: !s[l] }))}>
              {l}
            </Chip>
          ))}
        </div>
        <div className="fs-cluster" style={row}>
          <Chip tone="nasa" trailing={<DataButton evidence={SAMPLE_NASA} />}>
            IMERG rain
          </Chip>
          <Chip trailing={<DataButton evidence={SAMPLE_OTHER} />}>SSURGO soil</Chip>
          <Chip tone="field" icon={<I.IconCheck size={12} />}>
            Best for you
          </Chip>
          <Chip tone="wheat">Caution</Chip>
          <Chip tone="alert">Windy weeks</Chip>
          <Chip tone="soil">Stop erosion</Chip>
          <Chip tone="purple">2040s projection</Chip>
          <Chip tone="outline">Outline</Chip>
        </div>
      </Section>

      <Section id="sc-provenance" title="Provenance buttons, confidence and glossary">
        <p>
          Rainfall, Mar–Apr: <strong>— mm</strong> <DataButton evidence={SAMPLE_NASA} describes="rainfall" /> · Soil:{" "}
          <strong>silty clay loam</strong> <DataButton evidence={SAMPLE_OTHER} describes="soil texture" /> · Ranked by{" "}
          <SIButton record={SAMPLE_SI} describes="rotation ranking" /> · Rule check <SIButton record={SAMPLE_RULES} />
        </p>
        <div className="fs-cluster" style={row}>
          <ConfidenceChip confidence={{ level: "high", reasons: ["Sample reason: long local record"] }} />
          <ConfidenceChip confidence={SAMPLE_SI.confidence} />
          <ConfidenceChip confidence={{ level: "low", reasons: ["Sample reason: no field observations"], raise: "Confirming your crop history would raise confidence →" }} />
        </div>
        <p>
          Plain-language definitions: <GlossaryTerm term="ndvi" definitions={GLOSSARY} />, <GlossaryTerm term="et" definitions={GLOSSARY}>ET</GlossaryTerm> and{" "}
          <GlossaryTerm term="p10" definitions={GLOSSARY}>P10/P90</GlossaryTerm>.{" "}
          <Hint label="Why no hover tips?">Hover does not exist on phones, so every hint opens with a tap or the keyboard.</Hint>
        </p>
      </Section>

      <Section id="sc-charts" title="Option card: petal chart and match bar">
        <div className="fs-cluster" style={{ "--gap": "24px", alignItems: "flex-start" } as CSSProperties}>
          <Card
            id="sc-option"
            as="article"
            selected
            title="A · + cereal rye cover"
            actions={<Chip tone="field">Best for you</Chip>}
            style={{ width: 340, maxWidth: "100%" }}
          >
            <div className="fs-row" style={row}>
              <PetalChart indicators={PETALS} size={72} title="Sample trade-offs for option A" />
              <div className="fs-stack" style={{ "--gap": "8px", flex: 1 } as CSSProperties}>
                <em className="fs-meta">fills both bare windows (sample)</em>
                <MatchBar value={72} label="Match" trailing={<SIButton record={SAMPLE_SI} describes="match" />} />
                <div className="fs-row">
                  <ConfidenceChip confidence={SAMPLE_SI.confidence} />
                </div>
              </div>
            </div>
          </Card>
          <PetalChart indicators={PETALS} size={240} title="Sample trade-offs, large with labels" />
        </div>
      </Section>

      <Section id="sc-tabs" title="Tabs and card">
        <Tabs
          label="Field Studio views"
          tabs={[
            { id: "map", label: "Map", content: <p>Map panel content.</p> },
            { id: "options", label: "Options", content: <p>Options panel content.</p> },
            { id: "timeline", label: "Timeline", content: <p>Timeline panel content.</p> },
            { id: "field", label: "My Field", content: <p>My Field panel content.</p> },
          ]}
        />
      </Section>

      <Section id="sc-banners" title="States">
        <StatusBanner kind="loading" title="Loading soil moisture…">You can keep working while this loads.</StatusBanner>
        <StatusBanner kind="partial" action={<Button size="sm" variant="secondary">Continue anyway</Button>}>
          Heat data is missing for this field. Confidence is lower.
        </StatusBanner>
        <StatusBanner kind="no-observation">Clouds covered this field on every pass this month.</StatusBanner>
        <StatusBanner kind="unsupported" title="This crop is not supported yet">You can still see weather and soil evidence.</StatusBanner>
        <StatusBanner kind="stale">Last update was more than 10 days ago.</StatusBanner>
        <StatusBanner kind="error">The data service did not answer. Try again in a minute.</StatusBanner>
        <div className="fs-stack" style={{ maxWidth: 360 }}>
          <Skeleton height={20} width="50%" />
          <Skeleton lines={3} />
          <Skeleton height={120} radius={12} />
        </div>
      </Section>

      <Section id="sc-overlays" title="Popover and bottom sheet">
        <div className="fs-cluster" style={row}>
          <Button variant="secondary" ref={pop.anchorRef} onClick={pop.toggle} aria-expanded={pop.open} aria-haspopup="dialog">
            Open popover
          </Button>
          <Popover open={pop.open} onClose={pop.close} anchorRef={pop.anchorRef} title="Popover">
            <p>Esc or a click outside closes it. Below 640px wide it becomes a bottom sheet.</p>
          </Popover>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open bottom sheet
          </Button>
          <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Bottom sheet">
            <p>Used on phones in place of side panels and popovers.</p>
          </BottomSheet>
        </div>
      </Section>

      <Section id="sc-icons" title="Icons">
        <div className="fs-cluster" style={{ "--gap": "16px" } as CSSProperties}>
          {Object.entries(I)
            .filter(([k]) => k.startsWith("Icon"))
            .map(([k, Comp]) => (
              <div key={k} className="fs-stack" style={{ "--gap": "4px", alignItems: "center", width: 72 } as CSSProperties}>
                <Comp size={24} />
                <span className="fs-meta" style={{ fontSize: 11 }}>
                  {k.replace("Icon", "")}
                </span>
              </div>
            ))}
        </div>
      </Section>

      <footer className="fs-meta">
        FarmSmart supports your judgment. It does not replace it, or local expertise. No NASA endorsement is implied.
      </footer>

      <Tour steps={steps} open={tour} onClose={() => setTour(false)} />
    </main>
  );
}

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <div className="fs-stack" style={{ "--gap": "4px" } as CSSProperties}>
      <span style={{ width: 56, height: 32, borderRadius: 6, background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
      <span className="fs-meta">{name}</span>
    </div>
  );
}
