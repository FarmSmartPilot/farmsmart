import { useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { useStableId } from "./hooks";
import { IconAlert, IconBan, IconClock, IconEyeOff, IconInfo, IconLoader, IconPlay } from "./Icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------------- Button ---------------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "si";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  iconAfter?: ReactNode;
  block?: boolean;
  pill?: boolean;
  /** React 19: ref is a plain prop (used to anchor popovers). */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", size = "md", icon, iconAfter, block, pill, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("fs-btn", `fs-btn--${variant}`, size !== "md" && `fs-btn--${size}`, block && "fs-btn--block", pill && "fs-btn--pill", className)}
      {...rest}
    >
      {icon}
      {children}
      {iconAfter}
    </button>
  );
}

/* ---------------- DemoButton ---------------- */

export function DemoButton(props: Omit<ButtonProps, "children" | "variant" | "pill" | "icon">) {
  return (
    <Button variant="secondary" pill icon={<IconPlay size={14} />} aria-label="Start guided demo" {...props}>
      Demo
    </Button>
  );
}

/* ---------------- Chip ---------------- */

export type ChipTone = "neutral" | "nasa" | "field" | "wheat" | "alert" | "soil" | "purple" | "outline";

export interface ChipProps {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  /** When given, the chip becomes a toggle button (aria-pressed). */
  onClick?: () => void;
  pressed?: boolean;
  /** Trailing slot, e.g. a DataButton. Rendered outside the button so buttons never nest. */
  trailing?: ReactNode;
  className?: string;
}

export function Chip({ tone = "neutral", icon, children, onClick, pressed, trailing, className }: ChipProps) {
  const cls = cx("fs-chip", tone !== "neutral" && `fs-chip--${tone}`, className);
  if (onClick) {
    return (
      <span className="fs-chip-wrap">
        <button type="button" className={cls} aria-pressed={pressed} onClick={onClick}>
          {icon}
          {children}
        </button>
        {trailing}
      </span>
    );
  }
  return (
    <span className={cls}>
      {icon}
      {children}
      {trailing}
    </span>
  );
}

/* ---------------- SegmentedToggle ---------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Accessible name when the label is icon-only. */
  ariaLabel?: string;
}

export interface SegmentedToggleProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible group name, e.g. "Detail level". */
  label: string;
  className?: string;
}

/** Radio group styled as a segmented control. Arrow keys move and select. */
export function SegmentedToggle<T extends string>({ options, value, onChange, label, className }: SegmentedToggleProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % options.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + options.length) % options.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = options.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx("fs-segmented", className)}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            tabIndex={checked ? 0 : -1}
            className="fs-segmented__opt"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="fs-row" style={{ "--gap": "6px" } as CSSProperties}>
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled selected id. */
  value?: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
}

/** WAI-ARIA tabs with automatic activation (arrow keys, Home, End). */
export function Tabs({ tabs, value, onChange, label, className }: TabsProps) {
  const base = useStableId("tabs");
  const [inner, setInner] = useState(tabs[0]?.id);
  const selected = value ?? inner;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    select(tabs[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className={cx("fs-tabs", className)}>
      <div role="tablist" aria-label={label} className="fs-tabs__list">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${base}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === selected ? 0 : -1}
            className="fs-tabs__tab"
            data-tab-id={t.id}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          id={`${base}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== selected}
          tabIndex={0}
          className="fs-tabs__panel"
        >
          {t.id === selected ? t.content : null}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Card ---------------- */

export interface CardProps {
  overline?: ReactNode;
  title?: ReactNode;
  /** Right side of the header, e.g. a DataButton / SIButton / link. */
  actions?: ReactNode;
  selected?: boolean;
  flush?: boolean;
  as?: "section" | "article" | "div";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  id?: string;
}

export function Card({ overline, title, actions, selected, flush, as = "section", className, style, children, id }: CardProps) {
  const Tag = as;
  const titleId = useStableId("card");
  return (
    <Tag
      id={id}
      className={cx("fs-card", selected && "fs-card--selected", flush && "fs-card--flush", className)}
      style={style}
      aria-labelledby={title && as !== "div" ? titleId : undefined}
    >
      {overline || title || actions ? (
        <header className="fs-card__header">
          <div className="fs-stack" style={{ "--gap": "2px", flex: 1, minWidth: 0 } as CSSProperties}>
            {overline ? <div className="fs-overline">{overline}</div> : null}
            {title ? (
              <h2 id={titleId} className="fs-title">
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? <div className="fs-row">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/* ---------------- StatusBanner ---------------- */

export type BannerKind = "loading" | "partial" | "no-observation" | "unsupported" | "stale" | "error";

const BANNER_ICON: Record<BannerKind, ReactNode> = {
  loading: <IconLoader size={18} className="fs-spin" />,
  partial: <IconAlert size={18} />,
  "no-observation": <IconEyeOff size={18} />,
  unsupported: <IconBan size={18} />,
  stale: <IconClock size={18} />,
  error: <IconAlert size={18} />,
};

const BANNER_DEFAULT_TITLE: Record<BannerKind, string> = {
  loading: "Loading",
  partial: "Some data is missing",
  "no-observation": "No observation here",
  unsupported: "Not supported yet",
  stale: "This data may be out of date",
  error: "Something went wrong",
};

export interface StatusBannerProps {
  kind: BannerKind;
  title?: ReactNode;
  children?: ReactNode;
  /** e.g. a "Continue with available data" button. */
  action?: ReactNode;
  className?: string;
}

/** Distinct, non-blocking state message. The user can always continue with the evidence available. */
export function StatusBanner({ kind, title, children, action, className }: StatusBannerProps) {
  const urgent = kind === "error";
  return (
    <div
      className={cx("fs-banner", `fs-banner--${kind}`, className)}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-busy={kind === "loading" || undefined}
    >
      <span className="fs-banner__icon">{BANNER_ICON[kind]}</span>
      <div className="fs-stack" style={{ "--gap": "2px", flex: 1 } as CSSProperties}>
        <div className="fs-banner__title">{title ?? BANNER_DEFAULT_TITLE[kind]}</div>
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="fs-banner__action">{action}</div> : null}
    </div>
  );
}

/* ---------------- Skeleton ---------------- */

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  /** Render N text-like lines instead of one block. */
  lines?: number;
  label?: string;
}

export function Skeleton({ width = "100%", height = 14, radius, lines, label = "Loading" }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="fs-stack" style={{ "--gap": "8px" } as CSSProperties} role="status" aria-label={label}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="fs-skeleton" style={{ width: i === lines - 1 ? "60%" : width, height, borderRadius: radius }} />
        ))}
      </div>
    );
  }
  return <span className="fs-skeleton" role="status" aria-label={label} style={{ width, height, borderRadius: radius }} />;
}

/* ---------------- Hint (tooltip-free) ---------------- */

export interface HintProps {
  /** Short label for the toggle, e.g. "What is this?" */
  label?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** Inline disclosure that replaces hover tooltips: tap/click/Enter shows the hint in the flow. */
export function Hint({ label = "What is this?", children, defaultOpen = false }: HintProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useStableId("hint");
  return (
    <span className="fs-hint">
      <button type="button" className="fs-hint__btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <IconInfo size={14} />
        <span>{label}</span>
      </button>
      <span id={id} className="fs-hint__body" hidden={!open}>
        {children}
      </span>
    </span>
  );
}

/* ---------------- MatchBar ---------------- */

export interface MatchBarProps {
  /** 0–100. */
  value: number;
  label?: string;
  /** Slot after the percentage, e.g. an SIButton. */
  trailing?: ReactNode;
  /** Bar width in px (default fills). */
  width?: number | string;
}

export function MatchBar({ value, label = "Match to your priorities", trailing, width }: MatchBarProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="fs-match">
      <span className="fs-match__label">{label}</span>
      <div
        className="fs-match__track"
        style={{ width }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-valuetext={`${v}%`}
      >
        <div className="fs-match__fill" style={{ width: `${v}%` }} />
      </div>
      <span className="fs-match__pct">{v}%</span>
      {trailing}
    </div>
  );
}
