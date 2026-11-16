import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap, useIsNarrow, useReducedMotion, useStableId } from "./hooks";
import { IconChevronLeft, IconChevronRight, IconClose } from "./Icons";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TourStep {
  /** CSS selector of the element to spotlight. Missing or not found → card is centered. */
  target?: string;
  title: ReactNode;
  body: ReactNode;
  placement?: TourPlacement;
  /** Runs before the step is shown, e.g. switch a tab or fly the map. Awaited. */
  onEnter?: () => void | Promise<void>;
}

export interface TourProps {
  steps: TourStep[];
  open: boolean;
  onClose: (reason: "finish" | "skip") => void;
  /** Start index when opened (default 0). */
  startAt?: number;
  /** Accessible name for the dialog. */
  label?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const GAP = 12;
const MARGIN = 12;
const CARD_W = 340;

function measure(selector?: string): Rect | null {
  if (!selector) return null;
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    return null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/**
 * Guided-demo overlay: dims the page, cuts a spotlight around each step's target,
 * shows a step card with Back / Next / Skip and progress dots.
 * Keys: → next, ← back, Esc skip. Respects reduced motion.
 */
export function Tour({ steps, open, onClose, startAt = 0, label = "Guided demo" }: TourProps) {
  const [index, setIndex] = useState(startAt);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [cardPos, setCardPos] = useState<CSSProperties>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const narrow = useIsNarrow();
  const id = useStableId("tour");
  const step = steps[index];
  const last = index === steps.length - 1;
  // Read steps through a ref so a parent re-creating the array does not re-run onEnter.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(0, startAt), steps.length - 1));
  }, [open, startAt, steps.length]);

  // Run onEnter, scroll target into view, then measure.
  useEffect(() => {
    const step = stepsRef.current[index];
    if (!open || !step) return;
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        await step.onEnter?.();
      } catch {
        /* a failing onEnter must not break the tour */
      }
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const el = step.target ? safeQuery(step.target) : null;
      el?.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
      if (!reduced && el) await new Promise((r) => setTimeout(r, 320));
      if (cancelled) return;
      setRect(measure(step.target));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, index, reduced]);

  // Keep spotlight in sync with layout changes.
  useEffect(() => {
    if (!open || !ready) return;
    const update = () => setRect(measure(stepsRef.current[index]?.target));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, ready, index]);

  // Position the step card.
  useLayoutEffect(() => {
    if (!open || !ready) return;
    const card = cardRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw0 = Math.min(CARD_W, vw - MARGIN * 2);
    // Measure the card at the width it will have: measured unconstrained it is shorter, and a card placed
    // "above" the target then slid down over it.
    if (card) card.style.width = narrow ? `${vw - MARGIN * 2}px` : `${cw0}px`;
    const ch = card?.offsetHeight ?? 200;
    if (narrow) {
      // Phones: the card is a full-width strip at the bottom, or at the top when the target sits low
      // (e.g. the field sheet), whichever hides less of the target.
      if (rect) {
        const top = Math.max(0, rect.top);
        const bottom = Math.min(vh, rect.top + rect.height);
        const hideBottom = Math.max(0, bottom - Math.max(top, vh - ch - MARGIN));
        const hideTop = Math.max(0, Math.min(bottom, MARGIN + ch) - top);
        if (hideBottom > hideTop) {
          setCardPos({ left: MARGIN, right: MARGIN, top: MARGIN, width: "auto" });
          return;
        }
      }
      setCardPos({ left: MARGIN, right: MARGIN, bottom: MARGIN, width: "auto" });
      return;
    }
    const cw = cw0;
    const placement = stepsRef.current[index]?.placement ?? "bottom";
    if (!rect || placement === "center") {
      setCardPos({ width: cw, left: (vw - cw) / 2, top: Math.max(MARGIN, (vh - ch) / 2) });
      return;
    }
    const fits: Record<Exclude<TourPlacement, "center">, boolean> = {
      bottom: rect.top + rect.height + GAP + ch <= vh - MARGIN,
      top: rect.top - GAP - ch >= MARGIN,
      right: rect.left + rect.width + GAP + cw <= vw - MARGIN,
      left: rect.left - GAP - cw >= MARGIN,
    };
    const order: (keyof typeof fits)[] = [placement, "bottom", "top", "right", "left"];
    const side = order.find((s) => fits[s]);
    let top: number;
    let left: number;
    switch (side) {
      case "bottom":
        top = rect.top + rect.height + GAP;
        left = rect.left + rect.width / 2 - cw / 2;
        break;
      case "top":
        top = rect.top - GAP - ch;
        left = rect.left + rect.width / 2 - cw / 2;
        break;
      case "right":
        left = rect.left + rect.width + GAP;
        top = rect.top + rect.height / 2 - ch / 2;
        break;
      case "left":
        left = rect.left - GAP - cw;
        top = rect.top + rect.height / 2 - ch / 2;
        break;
      default:
        // Target fills the screen: pin the card to the bottom-right corner over it.
        left = vw - cw - MARGIN * 2;
        top = vh - ch - MARGIN * 2;
    }
    left = Math.min(Math.max(MARGIN, left), vw - cw - MARGIN);
    top = Math.min(Math.max(MARGIN, top), vh - ch - MARGIN);
    setCardPos({ width: cw, left, top });
  }, [open, ready, rect, narrow, index]);

  const next = useCallback(() => {
    if (last) onClose("finish");
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [last, onClose, steps.length]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const skip = useCallback(() => onClose("skip"), [onClose]);

  useFocusTrap(cardRef, open && ready, skip, { restoreFocus: true, initialFocus: "container" });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Escape") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, skip]);

  // Re-focus the card on each step so screen readers announce it.
  useEffect(() => {
    if (open && ready) cardRef.current?.focus({ preventScroll: true });
  }, [open, ready, index]);

  if (!open || !step) return null;

  const spot: CSSProperties = rect
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : { top: "50%", left: "50%", width: 0, height: 0 };

  return createPortal(
    <div className={`fs-tour${reduced ? " fs-tour--still" : ""}`} data-ready={ready}>
      <div className="fs-tour__catcher" aria-hidden="true" />
      <div className="fs-tour__spot" style={spot} aria-hidden="true" data-empty={!rect} />
      <div
        ref={cardRef}
        className="fs-tour__card"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
        style={{ ...cardPos, visibility: ready ? "visible" : "hidden" }}
      >
        <div className="fs-row">
          <span className="fs-overline">
            {label} · {index + 1} of {steps.length}
          </span>
          <span className="fs-spacer" />
          <button type="button" className="fs-popover__close" onClick={skip} aria-label="Skip demo">
            <IconClose size={16} />
          </button>
        </div>
        <h2 className="fs-title fs-tour__title" aria-live="polite">
          {step.title}
        </h2>
        <div id={`${id}-body`} className="fs-tour__body">
          {step.body}
        </div>
        <div className="fs-tour__dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className="fs-tour__dot" data-active={i === index} data-done={i < index} />
          ))}
        </div>
        <div className="fs-row fs-tour__actions">
          <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={skip}>
            Skip
          </button>
          <span className="fs-spacer" />
          <button type="button" className="fs-btn fs-btn--secondary fs-btn--sm" onClick={back} disabled={index === 0}>
            <IconChevronLeft size={14} /> Back
          </button>
          <button type="button" className="fs-btn fs-btn--primary fs-btn--sm" onClick={next}>
            {last ? "Finish" : "Next"} {last ? null : <IconChevronRight size={14} />}
          </button>
        </div>
        <p className="fs-visually-hidden">Use the left and right arrow keys to move between steps. Press Escape to leave the demo.</p>
      </div>
    </div>,
    document.body,
  );
}

function safeQuery(sel: string): Element | null {
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}
