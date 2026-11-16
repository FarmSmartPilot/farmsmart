/* Demo menu (top right): start the guided tour, or open one of the sample farms (the pilot fields).
   The sample farms used to sit on the home card; they belong with the demo, not with "find your farm". */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconChevronDown, IconPlay, IconSprout } from "../design";
import { usePilotsQ } from "../api";
import { useApp } from "../store";
import { openPilot, pickPoint } from "../fieldFlow";
import { usePlan } from "../planStore";
import { loadSampleFarm } from "../sampleFarm";
import { useToast } from "./common";

/** Other parts of the page (e.g. the home card's hint) can open this menu. */
export const openDemoMenu = () => window.dispatchEvent(new CustomEvent("fs:open-demo-menu"));

export default function DemoMenu({ onDemo }: { onDemo: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pilots = usePilotsQ();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const list = pilots.data?.pilots ?? [];
  const [farmBusy, setFarmBusy] = useState<{ n: number; m: number } | null>(null);
  const toast = useToast((s) => s.show);
  const sampleFarm = async () => {
    setOpen(false);
    usePlan.getState().open("farm");
    setFarmBusy({ n: 0, m: 3 });
    const failed = await loadSampleFarm(t("field.unnamed"), (n, m) => setFarmBusy({ n, m }));
    setFarmBusy(null);
    if (failed.length) toast(t("farm.sample_failed", { list: failed.join(", ") }));
  };

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("fs:open-demo-menu", onOpen);
    return () => window.removeEventListener("fs:open-demo-menu", onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(".demomenu__pop button")?.focus());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="demomenu" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <Button
        variant="secondary"
        pill
        icon={<IconPlay size={14} />}
        iconAfter={<IconChevronDown size={14} />}
        aria-expanded={open}
        aria-controls={id}
        data-tour="demo"
        onClick={() => setOpen((o) => !o)}
      >
        {t("demomenu.button")}
      </Button>
      {open ? (
        <div id={id} className="menu__pop demomenu__pop" role="group" aria-label={t("demomenu.label")}>
          <button
            type="button"
            className="demomenu__tour"
            onClick={() => {
              setOpen(false);
              onDemo();
            }}
          >
            <IconPlay size={16} />
            <span>
              <strong>{t("demomenu.tour")}</strong>
              <small>{t("demomenu.tour_hint")}</small>
            </span>
          </button>
          <button
            type="button"
            className="demomenu__tour"
            data-testid="demo-sample-farm"
            disabled={!!farmBusy}
            onClick={() => void sampleFarm()}
          >
            <IconSprout size={16} />
            <span>
              <strong>{farmBusy ? t("farm.demo_farm_busy", { n: farmBusy.n, m: farmBusy.m }) : t("farm.demo_farm")}</strong>
              <small>{t("farm.demo_farm_hint")}</small>
            </span>
          </button>
          <p className="fs-overline demomenu__head">{t("demomenu.samples")}</p>
          <p className="demomenu__hint">{t("demomenu.samples_hint")}</p>
          <div className="demomenu__list" data-tour="pilots">
            {list.map((p) => (
              <button
                key={p.field_id ?? p.label}
                type="button"
                className="menu__item demomenu__item"
                title={p.note}
                onClick={() => {
                  setOpen(false);
                  if (p.lat !== undefined && p.lon !== undefined) useApp.getState().set({ flyTarget: { lat: p.lat, lon: p.lon, key: Date.now() } });
                  if (p.field_id) openPilot(p);
                  else if (p.lat !== undefined && p.lon !== undefined) void pickPoint(p.lat, p.lon);
                }}
              >
                <span className="demomenu__name">{p.label}</span>
                {p.note ? <span className="demomenu__note">{p.note}</span> : null}
              </button>
            ))}
            {!list.length ? <p className="demomenu__hint">{pilots.isLoading ? t("demomenu.loading") : t("demomenu.none")}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
