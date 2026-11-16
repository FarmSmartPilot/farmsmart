/* Whole farm (wave U9): "Add to my farm" for a field, and the "One field | Whole farm" switch. */
import { useTranslation } from "react-i18next";
import { Button, IconCheck, IconMap, IconSprout, SegmentedToggle } from "../design";
import { useApp } from "../store";
import type { FieldSel } from "../store";
import { usePlan } from "../planStore";
import { useFarm, useInFarm, MAX_FARM_FIELDS } from "../farmStore";
import { useToast } from "./common";
import { cx } from "../lib";
import "../farm.css";

/**
 * Add a field to the farm (the open field by default). Once in, it says so and offers the whole-farm view.
 * `plan`: the option chosen on this page (null = keep the current rotation). `toggle`: an "In my farm" switch
 * (My fields rows) that also takes the field out again.
 */
export default function AddToFarm({
  field: given,
  plan = null,
  toggle,
  size = "sm",
  className,
}: {
  field?: FieldSel | null;
  plan?: string | null;
  toggle?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  const open = useApp((s) => s.field);
  const field = given ?? open;
  const inFarm = useInFarm(field?.id);
  const n = useFarm((s) => s.fields.length);
  const add = useFarm((s) => s.add);
  const remove = useFarm((s) => s.remove);
  const toast = useToast((s) => s.show);
  if (!field) return null;

  if (toggle)
    return (
      <label className={cx("farm-toggle", inFarm && "is-on", className)}>
        <input
          type="checkbox"
          checked={inFarm}
          disabled={!inFarm && n >= MAX_FARM_FIELDS}
          onChange={(e) => {
            if (e.target.checked) add(field, plan);
            else remove(field.id);
          }}
        />
        <span>{t("farm.in_farm")}</span>
      </label>
    );

  if (inFarm)
    return (
      <span className={cx("farm-added", className)}>
        <span className="farm-added__tag">
          <IconCheck size={14} /> {t("farm.in_farm")}
        </span>
        <button type="button" className="fs-link farm-added__go" onClick={() => usePlan.getState().open("farm")}>
          {t("farm.see_farm")}
        </button>
      </span>
    );

  return (
    <Button
      size={size === "sm" ? "sm" : undefined}
      variant="secondary"
      className={cx("farm-add", className)}
      disabled={n >= MAX_FARM_FIELDS}
      title={n >= MAX_FARM_FIELDS ? t("farm.full", { n: MAX_FARM_FIELDS }) : t("farm.add_help")}
      data-testid="add-to-farm"
      onClick={() => {
        if (add(field, plan)) {
          toast(t("farm.added_toast", { name: field.name, n: n + 1 }));
        }
      }}
    >
      + {t("farm.add")}
    </Button>
  );
}

/** "One field | Whole farm": the guided left panel, the expert top bar and the phone menu. */
export function FarmSwitch({ className, onPick }: { className?: string; onPick?: () => void }) {
  const { t } = useTranslation();
  const planView = usePlan((s) => s.planView);
  const field = useApp((s) => s.field);
  const mode = useApp((s) => s.mode);
  const n = useFarm((s) => s.fields.length);
  const value: "one" | "farm" = planView === "farm" ? "farm" : "one";
  return (
    <SegmentedToggle<"one" | "farm">
      label={t("farm.switch_label")}
      className={cx("farm-switch", className)}
      value={value}
      onChange={(v) => {
        onPick?.();
        if (v === value) return;
        if (v === "farm") usePlan.getState().open("farm");
        else if (field) useApp.getState().setView("studio");
        else if (mode === "simple") usePlan.getState().open("welcome");
        else useApp.getState().setView("home");
      }}
      options={[
        { value: "one", label: t("farm.switch_one") },
        { value: "farm", label: n ? t("farm.switch_farm_n", { n }) : t("farm.switch_farm") },
      ]}
    />
  );
}

/** Step 5 "What next?": keep the plan, add the next field (the map opens at this field), see the whole farm. */
export function FarmNextSteps({ plan = null }: { plan?: string | null }) {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const inFarm = useInFarm(field?.id);
  const n = useFarm((s) => s.fields.length);
  if (!field) return null;
  return (
    <section className="card-sec farm-next" aria-labelledby="farm-next-h" data-testid="farm-next">
      <h2 id="farm-next-h" className="fs-h2">
        {t("farm.next_h")}
      </h2>
      <ol className="farm-next__list">
        <li className="farm-next__item">
          <span className="farm-next__n" aria-hidden="true">1</span>
          <div>
            <h3 className="farm-next__h">{t("farm.next_keep_h")}</h3>
            <p className="farm-next__b">{t("farm.next_keep_b")}</p>
          </div>
        </li>
        <li className="farm-next__item">
          <span className="farm-next__n" aria-hidden="true">2</span>
          <div>
            <h3 className="farm-next__h">{t("farm.next_farm_h")}</h3>
            <p className="farm-next__b">{inFarm ? t("farm.next_farm_in", { count: n }) : t("farm.next_farm_out")}</p>
            <div className="fs-cluster farm-next__acts">
              {!inFarm ? <AddToFarm plan={plan} /> : null}
              <Button
                size="sm"
                variant={inFarm ? "primary" : "secondary"}
                icon={<IconMap size={16} />}
                data-testid="add-another-field"
                disabled={n >= MAX_FARM_FIELDS}
                onClick={() => useApp.getState().setView("home")}
              >
                {t("farm.next_add_another")}
              </Button>
            </div>
          </div>
        </li>
        <li className="farm-next__item">
          <span className="farm-next__n" aria-hidden="true">3</span>
          <div>
            <h3 className="farm-next__h">{t("farm.next_whole_h")}</h3>
            <p className="farm-next__b">{n ? t("farm.next_whole_b") : t("farm.next_whole_empty")}</p>
            <Button size="sm" variant="secondary" icon={<IconSprout size={16} />} disabled={!n} onClick={() => usePlan.getState().open("farm")}>
              {t("farm.next_whole_btn")}
              {n ? ` (${n})` : ""}
            </Button>
          </div>
        </li>
      </ol>
    </section>
  );
}
