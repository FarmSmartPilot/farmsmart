/* Lazy bridge to the globe-map agent's components (web/src/map/index.ts).
   import.meta.glob keeps the shell compiling even if the map module is missing; small SVG fallbacks
   stand in until it loads, or if it fails. */
import { Component, Suspense, lazy, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode, Ref } from "react";
import { geoGraticule10, geoMercator, geoOrthographic, geoPath } from "d3";
import type { FieldMapProps, FlatMapProps, GlobeViewProps, MapHandle, WindRoseData } from "./map/types";
import { useWindQ } from "./api";

export type { MapHandle, LayerId, GlobeArc, TerrainZone, FieldMeta } from "./map/types";

type WithRef<P> = P & { ref?: Ref<MapHandle> };

const loaders = import.meta.glob("./map/index.ts");
const load = loaders["./map/index.ts"] as undefined | (() => Promise<Record<string, unknown>>);

function lazyNamed<P extends object>(name: string, fallback: ComponentType<P>) {
  return lazy(async () => {
    if (!load) return { default: fallback };
    try {
      const m = await load();
      const C = m[name] as ComponentType<P> | undefined;
      return { default: C ?? fallback };
    } catch (e) {
      console.warn(`[map] ${name} failed to load, using fallback`, e);
      return { default: fallback };
    }
  });
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[map] component crashed, using fallback", e);
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

/* ---------------- fallbacks ---------------- */

function geomOf(g: FieldMapProps["fieldGeometry"]): GeoJSON.Geometry | null {
  if (!g) return null;
  return (g as GeoJSON.Feature).type === "Feature" ? (g as GeoJSON.Feature).geometry : (g as GeoJSON.Geometry);
}

function FallbackGlobe({ onPickPoint, fieldGeometry, arcs, ariaLabel, className, ref }: WithRef<GlobeViewProps>) {
  const [rot, setRot] = useState<[number, number]>([96, -38]);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; r: [number, number]; moved: boolean } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useImperativeHandle(ref, () => ({ flyTo: (t) => setRot([-t.lon, -t.lat]), resetNorth: () => undefined }), []);
  const proj = useMemo(
    () => geoOrthographic().scale(Math.min(size.w, size.h) * 0.42).translate([size.w / 2, size.h / 2]).rotate([rot[0], rot[1]]).clipAngle(90),
    [size, rot],
  );
  const path = geoPath(proj);
  const g = geomOf(fieldGeometry);
  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0 }} role="application" aria-label={ariaLabel ?? "Globe"}>
      <svg
        width={size.w}
        height={size.h}
        style={{ display: "block", cursor: "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, r: rot, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setRot([d.r[0] + dx * 0.3, Math.max(-80, Math.min(80, d.r[1] - dy * 0.3))]);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && onPickPoint) {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const ll = proj.invert?.([e.clientX - r.left, e.clientY - r.top]);
            if (ll && Number.isFinite(ll[0])) onPickPoint(ll[1], ll[0]);
          }
        }}
      >
        <defs>
          <radialGradient id="fb-sea" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#1d4f7c" />
            <stop offset="100%" stopColor="#0b2340" />
          </radialGradient>
        </defs>
        <path d={path({ type: "Sphere" }) ?? ""} fill="url(#fb-sea)" stroke="#3b6a94" />
        <path d={path(geoGraticule10()) ?? ""} fill="none" stroke="rgba(255,255,255,.14)" />
        {g ? <path d={path(g as GeoJSON.GeoJsonObject as never) ?? ""} fill="rgba(242,194,48,.35)" stroke="#F2C230" strokeWidth={3} /> : null}
        {(arcs ?? []).map((a, i) => (
          <path
            key={i}
            d={path({ type: "LineString", coordinates: [[a.from.lon, a.from.lat], [a.to.lon, a.to.lat]] }) ?? ""}
            fill="none"
            stroke={a.color ?? "#6B4FA0"}
            strokeWidth={a.width ?? 3}
            strokeDasharray={a.dashed ? "6 4" : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

function FallbackFieldMap({ fieldGeometry, fieldName, terrainZones, activeLayers, ariaLabel, className }: FieldMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = geomOf(fieldGeometry);
  const proj = useMemo(() => {
    const p = geoMercator();
    if (g) p.fitExtent([[40, 40], [size.w - 40, size.h - 80]], g as never);
    return p;
  }, [g, size]);
  const path = geoPath(proj);
  const showZones = activeLayers?.includes("erosion_zones");
  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0, background: "#dfe7dc" }} role="img" aria-label={ariaLabel ?? `Map of ${fieldName ?? "field"}`}>
      <svg width={size.w} height={size.h} style={{ display: "block" }}>
        {g ? <path d={path(g as never) ?? ""} fill="rgba(46,125,79,.18)" stroke="#F2C230" strokeWidth={3} /> : null}
        {showZones
          ? (terrainZones ?? []).map((z, i) => {
              const xy = proj([z[0], z[1]]);
              if (!xy) return null;
              const s = z[2];
              return <circle key={i} cx={xy[0]} cy={xy[1]} r={2.5} fill={s > 5 ? "#C2483A" : s > 2 ? "#C8902A" : "rgba(46,125,79,.35)"} />;
            })
          : null}
      </svg>
    </div>
  );
}

/** Small SVG wind rose from /api/fields/{id}/wind (used if the map module has none). */
function FallbackWindRose({ fieldId, data: given, size = 112 }: { fieldId?: string | null; data?: WindRoseData; size?: number }) {
  const q = useWindQ(given ? null : fieldId ?? null);
  const data = given ?? (q.data as WindRoseData | undefined);
  if (!data) return <div style={{ width: size, height: size }} aria-hidden="true" />;
  const totals = data.freq.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1e-6);
  const R = size / 2 - 10;
  const c = size / 2;
  const n = data.sectors;
  const colors = ["#cfe0ee", "#8fb8d8", "#2F7FB5", "#1b5a87", "#0E2A47"];
  const wedges: ReactNode[] = [];
  data.freq.forEach((bins, s) => {
    let acc = 0;
    const a0 = ((s - 0.4) / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((s + 0.4) / n) * 2 * Math.PI - Math.PI / 2;
    bins.forEach((f, b) => {
      const r0 = (acc / max) * R;
      acc += f;
      const r1 = (acc / max) * R;
      if (r1 - r0 < 0.2) return;
      const p = `M${c + r0 * Math.cos(a0)},${c + r0 * Math.sin(a0)} L${c + r1 * Math.cos(a0)},${c + r1 * Math.sin(a0)} A${r1},${r1} 0 0 1 ${c + r1 * Math.cos(a1)},${c + r1 * Math.sin(a1)} L${c + r0 * Math.cos(a1)},${c + r0 * Math.sin(a1)} Z`;
      wedges.push(<path key={`${s}-${b}`} d={p} fill={colors[b] ?? "#0E2A47"} />);
    });
  });
  return (
    <svg width={size} height={size} role="img" aria-label="Wind rose: share of hours by direction and speed">
      <circle cx={c} cy={c} r={R} fill="none" stroke="#c9d3de" />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="#e1e7ee" />
      {wedges}
      <text x={c} y={9} textAnchor="middle" fontSize={9} fill="#4A5B6E">N</text>
    </svg>
  );
}

/* ---------------- lazy exports ---------------- */

const LGlobe = lazyNamed<WithRef<GlobeViewProps>>("GlobeView", FallbackGlobe);
const LFlat = lazyNamed<WithRef<FlatMapProps>>("FlatMap", FallbackGlobe as ComponentType<WithRef<FlatMapProps>>);
const LField = lazyNamed<WithRef<FieldMapProps>>("FieldMap", FallbackFieldMap);
const LWind = lazyNamed<{ fieldId?: string | null; data?: WindRoseData; size?: number; months?: number[] }>("WindRose", FallbackWindRose);

const Loading = () => <div className="map-loading" aria-hidden="true" />;

export function GlobeView(p: WithRef<GlobeViewProps>) {
  return (
    <Boundary fallback={<FallbackGlobe {...p} />}>
      <Suspense fallback={<Loading />}>
        <LGlobe {...p} />
      </Suspense>
    </Boundary>
  );
}
export function FlatMap(p: WithRef<FlatMapProps>) {
  return (
    <Boundary fallback={<FallbackGlobe {...p} />}>
      <Suspense fallback={<Loading />}>
        <LFlat {...p} />
      </Suspense>
    </Boundary>
  );
}
export function FieldMap(p: WithRef<FieldMapProps>) {
  return (
    <Boundary fallback={<FallbackFieldMap {...p} />}>
      <Suspense fallback={<Loading />}>
        <LField {...p} />
      </Suspense>
    </Boundary>
  );
}
export function WindRose(p: { fieldId?: string | null; data?: WindRoseData; size?: number; months?: number[] }) {
  return (
    <Boundary fallback={<FallbackWindRose {...p} />}>
      <Suspense fallback={<div style={{ width: p.size ?? 112, height: p.size ?? 112 }} />}>
        <LWind {...p} />
      </Suspense>
    </Boundary>
  );
}

/** Rough WebGL capability check for choosing FlatMap on weak devices. */
export function webglWeak(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return true;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    return max < 4096;
  } catch {
    return true;
  }
}
