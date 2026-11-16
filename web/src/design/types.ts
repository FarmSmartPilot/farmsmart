/* Shared design-system types. These mirror the evidence / SI records the API returns.
   If contracts/ later freezes a schema, align field names here. */

/** One data-provenance record, shown behind a DataButton. */
export interface Evidence {
  /** Agency or provider, e.g. "NASA GES DISC", "USDA NASS". */
  source: string;
  /** Product short name, e.g. "SMAP L4 Soil Moisture (SPL4SMGP)". */
  product: string;
  version?: string;
  /** ISO dates. */
  observation_start?: string;
  observation_end?: string;
  /** Native pixel / grid size, e.g. "9 km". */
  native_res?: string;
  /** Scale actually used for this value, e.g. "≈50 km regional value". */
  effective_res?: string;
  /** Where the value was taken, e.g. "9 km cell containing field centroid". */
  footprint?: string;
  qa_flags?: string[];
  licence?: string;
  citation?: string;
  url?: string;
  is_nasa: boolean;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Confidence {
  level: ConfidenceLevel;
  reasons: string[];
  /** Optional "what would raise confidence" action text. */
  raise?: string;
}

/** si = trained statistical/ML model; rules = expert rules; process = crop/water process model. */
export type ModelKind = "si" | "rules" | "process";

export interface Driver {
  name: string;
  /** Effect on this output. */
  direction?: "up" | "down" | "mixed";
  note?: string;
}

/** One model-output record, shown behind an SIButton. */
export interface SIRecord {
  model_name: string;
  kind: ModelKind;
  version?: string;
  top_drivers: Driver[];
  confidence: Confidence;
  /** ISO date: latest data the model saw. */
  information_cutoff?: string;
  model_card_url?: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** Optional longer note or example. */
  example?: string;
}

export type GlossaryMap = Record<string, GlossaryEntry>;
