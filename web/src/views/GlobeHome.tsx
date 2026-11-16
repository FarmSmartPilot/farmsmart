/* Globe Home: full-bleed globe with a zoom-aware drill-down (Planet → Country → State → County → Farm),
   "Find my farm", pilot quick-picks and recent fields. At Farm level the user picks or draws a field. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconMap, IconCheck, useIsNarrow, useMediaQuery, IconChevronDown } from "../design";
import { GlobeView, FlatMap, webglWeak } from "../mapBridge";
import type { MapHandle } from "../mapBridge";
import { useApp } from "../store";
import { pickPoint, FARM_HEIGHT } from "../fieldFlow";
import { api } from "../api";
import { SearchBox } from "../components/TopBar";
import { useGlobeDrill } from "../components/GlobeDrill";
import { openDemoMenu } from "../components/DemoMenu";


export default function GlobeHome() {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const dim = useApp((s) => s.dim);
  const field = useApp((s) => s.field);
  const saved = useApp((s) => s.savedFields);
  const selectField = useApp((s) => s.selectField);
  const flyTarget = useApp((s) => s.flyTarget);
  const reduced = useApp((s) => s.reducedMotion);
  const ref = useRef<MapHandle>(null);
  const [collapsed, setCollapsed] = useState(false);
  const weak = useMemo(() => webglWeak(), []);
  const flat = dim === "2d" || weak;
  const drill = useGlobeDrill(ref);
  // Below 900 px the card covers the globe's centre, so it folds as soon as the farmer starts zooming (State level).
  const coversCentre = useMediaQuery("(max-width: 899px)");
  // The left step panel (guided mode, ≥ 900 px) already shows the steps: no second strip on the card.
  const railShown = useApp((s) => s.mode) === "simple" && !coversCentre;
  const atFarm = drill.level === "farm" || drill.level === "county" || (coversCentre && drill.level === "state");
  // Coming down to County / Farm level folds the home card so the fields are visible (it can be reopened).
  useEffect(() => {
    if (atFarm) setCollapsed(true);
  }, [atFarm]);
  const busy = !!drill.selection || drill.drawing;
  const hideCard = narrow && busy;
  const step = busy || drill.level === "farm" ? 2 : 1;

  // Opening "Find your farm" with a field already chosen: start at that field, close enough to see its neighbours
  // (to add the next field), unless something just asked to fly elsewhere (search, Demo).
  useEffect(() => {
    const st = useApp.getState();
    const f = st.field;
    if (!f) return;
    if (st.flyTarget && Date.now() - st.flyTarget.key < 3000) return;
    const go = (lat: number, lon: number) => useApp.getState().set({ flyTarget: { lat, lon, height: FARM_HEIGHT * 2, key: Date.now() } });
    if (typeof f.lat === "number" && typeof f.lon === "number") return go(f.lat, f.lon);
    // A field opened from a link has no coordinates yet: take them from its report.
    let live = true;
    api.report(f.id).then(
      (r) => {
        if (live && r.centroid && useApp.getState().field?.id === f.id) go(r.centroid[1], r.centroid[0]);
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flyTarget) return;
    const dur = reduced ? 0 : 2.5;
    const id = setTimeout(
      () => ref.current?.flyTo({ lat: flyTarget.lat, lon: flyTarget.lon, bbox: flyTarget.bbox, height: flyTarget.height, duration: dur }),
      50,
    );
    // A searched point: once at Farm level, show the field there (pick card), never analyse it unasked.
    const pick = flyTarget.pick ? setTimeout(() => void ref.current?.pickAt?.(flyTarget.lat, flyTarget.lon), dur * 1000 + 400) : 0;
    return () => {
      clearTimeout(id);
      clearTimeout(pick);
    };
  }, [flyTarget, reduced]);

  const Map = flat ? FlatMap : GlobeView;
  const globe = (
    <>
      <div className="home__globe">
        <Map
          ref={ref}
          onPickPoint={(lat, lon) => void pickPoint(lat, lon)}
          {...drill.mapProps}
          fieldGeometry={drill.selection?.geometry ?? field?.geometry ?? null}
          autoRotate={!reduced && !flyTarget}
          ariaLabel={t("home.globe_label")}
        />
      </div>
      {drill.overlay}
    </>
  );

  // Guided mode with the left step panel: a normal page (step heading, the globe in a panel, a "Your field" card,
  // and what happens next). Expert mode and small screens keep the full-screen globe below.
  if (railShown) {
    const coords = field && typeof field.lat === "number" && typeof field.lon === "number" ? `${field.lat.toFixed(4)}, ${field.lon.toFixed(4)}` : null;
    return (
      <div className="ghome">
        <header className="guided__head">
          <p className="guided__count">{t("steps.n_of", { n: 1, m: 5 })}</p>
          <h1 id="home-h1" className="guided__title">
            {t("ghome.title")}
          </h1>
          <p className="guided__intro">{t("ghome.intro")}</p>
        </header>
        <div className="ghome__grid">
          <div className="home home--card-collapsed ghome__stage" data-tour="home-card">
            {globe}
          </div>
          <aside className="ghome__side" aria-labelledby="ghome-side-h">
            <section className="panel ghome__card">
              <p className="fs-overline" id="ghome-side-h">
                {t("ghome.your_field")}
              </p>
              {field ? (
                <>
                  <h2 className="ghome__field">{field.name}</h2>
                  {coords ? <p className="fs-meta">{coords}</p> : null}
                  <Button block onClick={() => useApp.getState().setView("studio")}>
                    {t("ghome.continue")} →
                  </Button>
                  <p className="fs-meta ghome__or">{t("ghome.or_other")}</p>
                </>
              ) : (
                <>
                  <h2 className="ghome__field">{t("ghome.none")}</h2>
                  <p className="fs-meta">{t("ghome.none_hint")}</p>
                </>
              )}
              <SearchBox big />
              <p className="fs-meta home__hint">{t("home.click_hint")}</p>
              <div className="home__samples">
                <span className="fs-meta">{t("demomenu.home_hint")}</span>
                <Button variant="secondary" size="sm" pill onClick={openDemoMenu}>
                  {t("demomenu.home_btn")}
                </Button>
              </div>
              <ul className="home__ticks ghome__ticks">
                <li>
                  <IconCheck size={14} /> {t("home.tick1")}
                </li>
                <li>
                  <IconCheck size={14} /> {t("home.tick2")}
                </li>
                <li>
                  <IconCheck size={14} /> {t("home.tick3")}
                </li>
              </ul>
            </section>
            {saved.length ? (
              <section className="panel ghome__card">
                <p className="fs-overline">{t("home.recent")}</p>
                {saved.slice(0, 4).map((f) => (
                  <button key={f.id} type="button" className="recent" onClick={() => selectField(f)}>
                    <span className="recent__thumb" aria-hidden="true">
                      <IconMap size={18} />
                    </span>
                    <span className="recent__name">{f.name}</span>
                    <span className="fs-link">{t("home.open")}</span>
                  </button>
                ))}
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={`home${collapsed || hideCard ? " home--card-collapsed" : ""}`}>
      {globe}
      <section className={`home__card${collapsed ? " is-collapsed" : ""}`} aria-labelledby="home-h1" data-tour="home-card" hidden={hideCard}>
        {railShown ? null : (
        <ol className="home-steps" aria-label={t("drill.steps_label")}>
          {[1, 2, 3].map((n) => (
            <li key={n} className={n === step ? "is-current" : n < step ? "is-done" : undefined} aria-current={n === step ? "step" : undefined}>
              <span aria-hidden="true">{n}</span>
              {t(`drill.step${n}`)}
            </li>
          ))}
        </ol>
        )}
        <div className="home__card-head">
          <p className="fs-overline">{t("home.overline")}</p>
          <Button variant="ghost" size="sm" className="tap44" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)} iconAfter={<IconChevronDown size={14} />}>
            {collapsed ? t("common.show") : t("common.hide")}
          </Button>
        </div>
        <h1 id="home-h1" className="home__h1">
          {t("home.h1_a")} <span className="home__accent">{t("home.h1_b")}</span> {t("home.h1_c")}
        </h1>
        {!collapsed ? (
          <>
            <p className="home__lead">{t("home.lead")}</p>
            <SearchBox big />
            <p className="fs-meta home__hint">{t("home.click_hint")}</p>
            <div className="home__samples">
              <span className="fs-meta">{t("demomenu.home_hint")}</span>
              <Button variant="secondary" size="sm" pill onClick={openDemoMenu}>
                {t("demomenu.home_btn")}
              </Button>
            </div>
            {saved.length ? (
              <div className="fs-stack" style={{ ["--gap" as string]: "8px" }}>
                <div className="fs-overline">{t("home.recent")}</div>
                {saved.slice(0, 3).map((f) => (
                  <button key={f.id} type="button" className="recent" onClick={() => selectField(f)}>
                    <span className="recent__thumb" aria-hidden="true">
                      <IconMap size={18} />
                    </span>
                    <span className="recent__name">{f.name}</span>
                    <span className="fs-link">{t("home.open")}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="home__ticks">
              <li>
                <IconCheck size={14} /> {t("home.tick1")}
              </li>
              <li>
                <IconCheck size={14} /> {t("home.tick2")}
              </li>
              <li>
                <IconCheck size={14} /> {t("home.tick3")}
              </li>
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
