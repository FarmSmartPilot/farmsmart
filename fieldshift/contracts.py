"""Shared data objects for FarmSmart (frozen after Wave A).

These Pydantic models are the single source of truth. `python -m fieldshift.cli export-contracts`
writes JSON Schemas to contracts/*.schema.json for the web client.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]
Availability = Literal["supported", "partial", "not_available"]


class EvidenceRecord(BaseModel):
    """Provenance for any displayed value (powers the satellite-button pop-over)."""
    id: str
    source: str                      # e.g. "NASA POWER"
    product: str                     # e.g. "POWER Daily AG T2M"
    version: Optional[str] = None
    is_nasa: bool = False
    observation_start: Optional[date] = None
    observation_end: Optional[date] = None
    publication_time: Optional[datetime] = None
    retrieval_time: datetime
    footprint: str                   # e.g. "point 42.03,-93.47 (0.5°x0.625° grid cell)"
    native_res: str                  # "≈50 km", "30 m", "county"
    effective_res: str
    units: Optional[str] = None
    qa_flags: list[str] = []
    transformation: Optional[str] = None
    licence: str
    citation: str
    url: Optional[str] = None
    lineage: list[str] = []


class Measured(BaseModel):
    """A single number with its evidence and scale label."""
    value: Optional[float]
    units: str
    evidence_id: str
    scale_label: Optional[str] = None   # "regional value (≈50 km)"
    note: Optional[str] = None


class ConfidenceInfo(BaseModel):
    level: Confidence
    reasons: list[str]
    interval_coverage: Optional[float] = None


class ModelPrediction(BaseModel):
    model_id: str                    # "M2"
    model_name: str
    model_version: str
    kind: Literal["si", "rules", "process"]
    target: str
    spatial_support: str
    information_cutoff: date
    horizon: Optional[str] = None
    estimate: Optional[float] = None
    p10: Optional[float] = None
    p50: Optional[float] = None
    p90: Optional[float] = None
    units: Optional[str] = None
    top_drivers: list[str] = []
    uncertainty_method: Optional[str] = None
    applicability: Optional[str] = None
    confidence: ConfidenceInfo
    model_card: Optional[str] = None


class CropYear(BaseModel):
    year: int
    crop_id: Optional[str]
    crop_name: str
    source: Literal["CDL", "AAFC", "farmer", "M4", "unknown"]
    share: Optional[float] = None    # fraction of field pixels
    confirmed: bool = False


class FieldConstraints(BaseModel):
    water: Literal["rainfed", "irrigated"] = "rainfed"
    irrigation_mm: Optional[float] = None
    equipment: list[str] = ["row_crop_planter", "grain_drill", "combine"]
    livestock: bool = False
    markets: list[str] = []
    wont_grow: list[str] = []


class FieldProfile(BaseModel):
    id: str
    name: str
    geometry: dict[str, Any]         # GeoJSON Polygon/MultiPolygon
    area_ha: float
    centroid: tuple[float, float]    # lon, lat
    country: Optional[str] = None
    admin1: Optional[str] = None
    admin2: Optional[str] = None
    region_codes: dict[str, str] = {}
    timezone: Optional[str] = None
    pilot: Optional[str] = None
    mode: Literal["field", "regional"] = "field"
    crop_history: list[CropYear] = []
    constraints: FieldConstraints = FieldConstraints()
    priorities: list[str] = ["soil_cover", "water", "profit", "erosion", "workload"]
    confirmed: dict[str, Any] = {}
    version: int = 1


class CropDefinition(BaseModel):
    id: str
    name: str
    family: str
    role: list[str]                  # cash, cover, forage, legume, deep_root
    season: Literal["summer", "winter", "cover", "perennial"]
    gdd_base_c: float
    gdd_required: float
    min_frost_free_days: int
    water_need_mm: tuple[float, float]
    kc: dict[str, float]             # ini, mid, end (FAO-56)
    stage_days: dict[str, int]       # ini, dev, mid, late
    c_factor_growing: float          # RUSLE cover factor while growing
    residue_cover_after: float       # fraction cover after harvest
    n_fixing: bool
    n_need_kg_ha: float
    n_credit_kg_ha: float
    equipment: list[str]
    references: list[str]


class RotationScenario(BaseModel):
    id: str
    name: str
    family: str                      # baseline | fill_gap | extend | water_wise | forage | market | pest_break
    is_baseline: bool
    sequence: list[list[str]]        # per year: crops (cash + covers)
    events: list[dict[str, Any]] = []
    assumptions: dict[str, Any] = {}
    indicators: dict[str, Any] = {}  # raw outputs with p10/p50/p90
    score: Optional[float] = None
    rank: Optional[int] = None
    pareto: bool = False
    reasons: list[str] = []
    rule_flags: list[dict[str, Any]] = []
    review_items: list[str] = []


class ExclusionReason(BaseModel):
    crop_id: str
    crop_name: str
    stage: Literal["hard_constraint", "suitability", "rules", "user"]
    reason: str
    evidence_ids: list[str] = []


class CoverageItem(BaseModel):
    layer: str
    status: Availability
    note: str


class AnalysisJob(BaseModel):
    id: str
    field_id: str
    field_version: int
    period: str
    status: Literal["queued", "running", "done", "failed"]
    progress: float = 0.0
    step: str = ""
    source_versions: dict[str, str] = {}
    model_versions: dict[str, str] = {}
    failures: list[str] = []
    result_manifest: list[str] = []


ALL_CONTRACTS = [EvidenceRecord, Measured, ConfidenceInfo, ModelPrediction, CropYear,
                 FieldConstraints, FieldProfile, CropDefinition, RotationScenario,
                 ExclusionReason, CoverageItem, AnalysisJob]
