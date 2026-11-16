/* Global shell: top bar (search, saved fields, Simple/Expert, 3D/2D, export, Demo), view sub-nav, footer. */
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  SegmentedToggle,
  IconSearch,
  IconChevronDown,
  IconDownload,
  Icon2D,
  Icon3D,
  IconBell,
  IconMap,
  IconClose,
  IconLoader,
  BottomSheet,
  useIsNarrow,
  useMediaQuery,
} from "../design";
import { api } from "../api";
import type { SearchResult } from "../api";
import { useApp } from "../store";
import type { View } from "../store";
import { usePlan } from "../planStore";
import type { PlanView } from "../planStore";
import { goToPoint, goToResult, parseLatLon } from "../fieldFlow";
import { useToast } from "./common";
import { cx, scenarioLabel } from "../lib";
import { BrandName, LogoMark } from "./Logo";
import DemoMenu from "./DemoMenu";
import { SignInButton } from "./SignIn";
import { FarmSwitch } from "./AddToFarm";

/* ---------------- search ---------------- */

export function SearchBox({ big, autoFocus, onDone }: { big?: boolean; autoFocus?: boolean; onDone?: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const phone = useIsNarrow();

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const res = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 10 * 60_000,
    retry: 0,
  });
  const results: SearchResult[] = res.data?.results ?? [];

  const choose = (r: SearchResult) => {
    setOpen(false);
    setQ(r.label);
    goToResult(r);
    onDone?.();
  };

  const submit = () => {
    const ll = parseLatLon(q);
    if (ll) {
      setOpen(false);
      goToPoint(ll.lat, ll.lon);
      onDone?.();
      return;
    }
    if (results[active]) choose(results[active]);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && debounced.length >= 2;
  return (
    <div className={cx("search", big && "search--big")} data-tour="search">
      <form
        role="search"
        className="search__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <IconSearch size={16} className="search__icon" />
        <input
          ref={inputRef}
          type="search"
          className="search__input"
          value={q}
          autoFocus={autoFocus}
          placeholder={big && phone ? t("search.placeholder_short") : t("search.placeholder")}
          aria-label={t("search.label")}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        {res.isFetching ? <IconLoader size={16} className="fs-spin search__spin" /> : null}
        {big ? (
          <Button type="submit" className="search__go">
            {t("home.find_my_farm")}
          </Button>
        ) : null}
      </form>
      {showList ? (
        <ul id={listId} role="listbox" className="search__list" aria-label={t("search.results")}>
          {res.isError ? <li className="search__empty">{t("search.error")}</li> : null}
          {!res.isFetching && !res.isError && results.length === 0 ? (
            <li className="search__empty">{parseLatLon(q) ? t("search.press_enter") : t("search.none")}</li>
          ) : null}
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx("search__opt", i === active && "is-active")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              <span className="search__kind">{t(`search.kind.${r.kind}`, { defaultValue: r.kind })}</span>
              <span className="search__label">{r.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------------- saved fields ---------------- */

function SavedFields() {
  const { t } = useTranslation();
  const saved = useApp((s) => s.savedFields);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    // Move focus into the list so keyboard users land on the first saved field.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(".menu__pop button")?.focus());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <div className="menu" ref={ref}>
      <Button ref={btn} variant="ghost" iconAfter={<IconChevronDown size={14} />} aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)}>
        {t("top.saved")}
        {saved.length ? <span className="menu__count">{saved.length}</span> : null}
      </Button>
      {open ? (
        <div
          id={popId}
          className="menu__pop"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <SavedFieldsList onPick={() => setOpen(false)} bare />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- export ---------------- */

export async function exportReport(fieldId: string | undefined, t: (k: string) => string) {
  const toast = useToast.getState().show;
  if (!fieldId) {
    toast(t("export.need_field"));
    return;
  }
  // The PDF is built on the server and takes a few seconds: say so straight away.
  toast(t("export.preparing"), "info", 60_000);
  try {
    const r = await fetch(`/api/fields/${fieldId}/report.pdf`);
    if (r.status === 404 || r.status === 405) {
      toast(t("export.not_yet"));
      return;
    }
    if (!r.ok) throw new Error(r.statusText);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farmsmart-${fieldId}.pdf`;
    a.click();
    toast(t("export.done"));
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) {
    toast(`${t("export.failed")} ${e instanceof Error ? e.message : ""}`, "error");
  }
}

/* ---------------- top bar ---------------- */

export function TopBar({ onDemo }: { onDemo: () => void }) {
  const { t } = useTranslation();
  const mode = useApp((s) => s.mode);
  const dim = useApp((s) => s.dim);
  const set = useApp((s) => s.set);
  const setView = useApp((s) => s.setView);
  const field = useApp((s) => s.field);
  const view = useApp((s) => s.view);
  const planView = usePlan((s) => s.planView);
  const narrow = useIsNarrow();
  const tablet = useMediaQuery("(max-width: 1099px)");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Guided (Simple) field pages carry the place search under the map on step 2; the top bar keeps it on the globe
  // home and in Expert mode.
  const showSearch = mode === "expert" || (view === "home" && !planView);

  if (narrow || tablet) {
    return (
      <header className={cx("topbar topbar--compact", view === "home" && !planView && "topbar--over-globe")}>
        <button type="button" className="wordmark brand" onClick={() => setView("home")} title={t("top.home")}>
          <LogoMark size={28} />
          <BrandName className="brand__name" />
        </button>
        <div className="fs-spacer" />
        {showSearch ? (
          <Button variant="ghost" className="fs-btn--icon tap44" aria-label={t("search.label")} onClick={() => setSearchOpen(true)} icon={<IconSearch size={20} />} />
        ) : null}
        <Button variant="ghost" className="fs-btn--icon tap44" aria-label={t("top.menu")} aria-haspopup="dialog" onClick={() => setMenuOpen(true)} data-tour="menu" icon={<IconChevronDown size={20} />} />
        <DemoMenu onDemo={onDemo} />
        <BottomSheet open={searchOpen} onClose={() => setSearchOpen(false)} title={t("search.label")}>
          <SearchBox autoFocus onDone={() => setSearchOpen(false)} />
        </BottomSheet>
        <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t("top.menu")}>
          <div className="fs-stack" style={{ ["--gap" as string]: "16px" }}>
            <div className="menu-signin">
              <SignInButton />
            </div>
            <FarmSwitch onPick={() => setMenuOpen(false)} />
            <SegmentedToggle
              label={t("top.detail")}
              value={mode}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: "simple", label: t("top.simple") },
                { value: "expert", label: t("top.expert") },
              ]}
            />
            <SegmentedToggle
              label={t("top.dim")}
              value={dim}
              onChange={(v) => set({ dim: v })}
              options={[
                { value: "3d", label: "3D", icon: <Icon3D size={16} /> },
                { value: "2d", label: "2D", icon: <Icon2D size={16} /> },
              ]}
            />
            <ViewNav vertical onPick={() => setMenuOpen(false)} />
            <SavedFieldsList onPick={() => setMenuOpen(false)} />
            <Button variant="secondary" block icon={<IconDownload size={16} />} onClick={() => void exportReport(field?.id, t)}>
              {t("top.export")}
            </Button>
          </div>
        </BottomSheet>
      </header>
    );
  }

  return (
    <header className={cx("topbar", view === "home" && !planView && "topbar--over-globe")}>
      <button type="button" className="wordmark brand" onClick={() => setView("home")} title={t("top.home")}>
        <LogoMark size={34} />
        <span className="brand__text">
          <BrandName className="brand__name" />
          <span className="brand__tag">{t("brand.tag")}</span>
        </span>
      </button>
      {showSearch ? <SearchBox /> : null}
      <div className="fs-spacer" />
      {mode === "expert" ? <FarmSwitch className="topbar__farmswitch" /> : null}
      <SignInButton />
      <SavedFields />
      <SegmentedToggle
        label={t("top.detail")}
        value={mode}
        onChange={(v) => set({ mode: v })}
        options={[
          { value: "simple", label: t("top.simple") },
          { value: "expert", label: t("top.expert") },
        ]}
        className="seg-mode"
      />
      <SegmentedToggle
        label={t("top.dim")}
        value={dim}
        onChange={(v) => set({ dim: v })}
        options={[
          { value: "3d", label: "3D", ariaLabel: t("top.dim3") },
          { value: "2d", label: "2D", ariaLabel: t("top.dim2") },
        ]}
      />
      <Button variant="secondary" icon={<IconDownload size={16} />} onClick={() => void exportReport(field?.id, t)} data-tour="export">
        {t("top.export")}
      </Button>
      <DemoMenu onDemo={onDemo} />
    </header>
  );
}

/** Saved (recently opened) fields: kept in localStorage through the store's never-throwing storage. */
function SavedFieldsList({ onPick, bare }: { onPick: () => void; bare?: boolean }) {
  const { t } = useTranslation();
  const saved = useApp((s) => s.savedFields);
  const current = useApp((s) => s.field?.id);
  const selectField = useApp((s) => s.selectField);
  const set = useApp((s) => s.set);
  return (
    <div className="fs-stack" style={{ ["--gap" as string]: bare ? "2px" : "8px" }}>
      {bare ? null : <div className="fs-overline">{t("top.saved")}</div>}
      {saved.length === 0 ? <p className={bare ? "menu__empty" : "fs-meta"}>{t("top.saved_empty")}</p> : null}
      {saved.length ? (
        <ul className="saved-list" aria-label={t("top.saved")}>
          {saved.map((f) => (
            <li key={f.id} className="saved-list__row">
              <button
                type="button"
                className="menu__item saved-list__open"
                aria-current={current === f.id ? "true" : undefined}
                onClick={() => {
                  onPick();
                  selectField(f);
                }}
              >
                <IconMap size={16} />
                <span>{f.name}</span>
              </button>
              <button
                type="button"
                className="saved-list__x"
                aria-label={t("top.saved_remove", { name: f.name })}
                onClick={() => set({ savedFields: useApp.getState().savedFields.filter((x) => x.id !== f.id) })}
              >
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------------- view nav ---------------- */

/** Store views plus the plan views routed by planStore (Plan, Build your own, Saved plans, How well does it work?). */
export type NavId = View | PlanView;

export const VIEWS: { id: NavId; key: string; expert?: boolean; tour?: string; plan?: boolean }[] = [
  { id: "studio", key: "nav.studio" },
  { id: "compare", key: "nav.compare", tour: "nav-compare" },
  { id: "nextmove", key: "nav.nextmove", expert: true, tour: "nav-nextmove" },
  { id: "wheel", key: "nav.wheel" },
  { id: "replay", key: "nav.replay", tour: "nav-replay" },
  { id: "twins", key: "nav.twins", tour: "nav-twins" },
  { id: "plan", key: "pnav.plan", tour: "nav-plan", plan: true },
  { id: "builder", key: "pnav.builder", tour: "nav-builder", plan: true },
  { id: "money", key: "money.nav", tour: "nav-money", plan: true },
  { id: "saved", key: "pnav.saved", tour: "nav-saved", plan: true },
  { id: "region", key: "nav.region", tour: "nav-region" },
  { id: "alerts", key: "nav.alerts", tour: "nav-alerts" },
  { id: "validation", key: "pnav.validation", tour: "nav-validation", plan: true },
  { id: "sources", key: "nav.sources" },
];

/** Shown as tabs at every width; the rest go under "More ▾" when the sub-nav is narrow (< 1280 px). */
const PRIMARY_NARROW: NavId[] = ["studio", "compare", "wheel", "replay", "twins"];
/** At 1280 px and wider every view is a tab (with Plan) except these, which sit under "More ▾". */
const MORE_WIDE: NavId[] = ["builder", "money", "saved", "validation"];

const isPlanView = (id: NavId): id is PlanView => VIEWS.some((v) => v.id === id && v.plan);

export function ViewNav({ vertical, onPick }: { vertical?: boolean; onPick?: () => void }) {
  const { t } = useTranslation();
  const storeView = useApp((s) => s.view);
  const planView = usePlan((s) => s.planView);
  const view: NavId = planView ?? storeView;
  const mode = useApp((s) => s.mode);
  const setView = useApp((s) => s.setView);
  const openPlan = usePlan((s) => s.open);
  const narrow = useMediaQuery("(max-width: 1279px)") && !vertical;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreId = useId();
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => moreRef.current?.querySelector<HTMLButtonElement>(".viewnav__more-pop button")?.focus());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);
  const views = VIEWS.filter((v) => !v.expert || mode === "expert");
  const inMore = (id: NavId) => (vertical ? false : narrow ? !PRIMARY_NARROW.includes(id) : MORE_WIDE.includes(id));
  const main = views.filter((v) => !inMore(v.id));
  const rest = views.filter((v) => inMore(v.id));
  const tab = (v: (typeof VIEWS)[number], inMenu = false) => (
    <button
      key={v.id}
      type="button"
      className={cx(inMenu ? "menu__item" : "viewnav__tab", view === v.id && "is-active")}
      aria-current={view === v.id ? "page" : undefined}
      data-tour={v.tour}
      onClick={() => {
        if (isPlanView(v.id)) openPlan(v.id);
        else setView(v.id);
        setMoreOpen(false);
        onPick?.();
      }}
    >
      {v.id === "alerts" ? <IconBell size={14} /> : null}
      {t(v.key)}
    </button>
  );
  const restActive = rest.find((v) => v.id === view);
  return (
    <nav aria-label={t("nav.label")} className={cx("viewnav", vertical && "viewnav--vertical", rest.length > 0 && "viewnav--more")}>
      {main.map((v) => tab(v))}
      {rest.length ? (
        <div className="viewnav__more" ref={moreRef} onKeyDown={(e) => e.key === "Escape" && setMoreOpen(false)}>
          <button
            type="button"
            className={cx("viewnav__tab", restActive && "is-active")}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            data-tour="nav-more"
            onClick={() => setMoreOpen((o) => !o)}
          >
            {restActive ? t(restActive.key) : t("nav.more")} <IconChevronDown size={14} />
          </button>
          {moreOpen ? (
            <div id={moreId} className="menu__pop viewnav__more-pop">
              {rest.map((v) => tab(v, true))}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

export function SubNav() {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const scenario = useApp((s) => s.scenario);
  const set = useApp((s) => s.set);
  return (
    <div className="subnav">
      <div className="subnav__field">
        <span className="fs-overline">{t("nav.field")}</span>
        <strong title={field?.name}>{field?.name ?? t("nav.no_field")}</strong>
        {scenario !== "normal" ? (
          <span className="fs-chip fs-chip--wheat">
            {t("scenario.active", { s: scenarioLabel(scenario, t, i18n.language) })}
            <button type="button" className="chip-x" aria-label={t("scenario.reset")} onClick={() => set({ scenario: "normal" })}>
              <IconClose size={12} />
            </button>
          </span>
        ) : null}
      </div>
      <ViewNav />
    </div>
  );
}

export function Footer() {
  const { t } = useTranslation();
  const setView = useApp((s) => s.setView);
  return (
    <footer className="footer">
      <span>
        {t("footer.credit")} ·{" "}
        <button type="button" className="fs-link footer__link" onClick={() => setView("sources")}>
          {t("footer.sources")}
        </button>
      </span>
      <span className="footer__right">{t("footer.no_endorse")}</span>
    </footer>
  );
}
