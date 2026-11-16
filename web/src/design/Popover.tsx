import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap, useIsNarrow, useStableId } from "./hooks";
import { IconClose } from "./Icons";

/* ---------------- BottomSheet ---------------- */

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Optional id used for aria-labelledby on the title. */
  id?: string;
}

/** Modal sheet anchored to the bottom of the viewport. Used for popovers on phones. */
export function BottomSheet({ open, onClose, title, children, id }: BottomSheetProps) {
  const autoId = useStableId("sheet");
  const titleId = `${id ?? autoId}-title`;
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fs-sheet-root">
      <div className="fs-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="fs-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="fs-sheet__grip" aria-hidden="true" />
        <div className="fs-sheet__header">
          <h2 id={titleId} className="fs-title">
            {title}
          </h2>
          <button type="button" className="fs-btn fs-btn--ghost fs-btn--icon fs-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        <div className="fs-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Popover ---------------- */

export type Placement = "bottom" | "top" | "right" | "left";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element the popover points at (usually the trigger button). */
  anchorRef: RefObject<HTMLElement | null>;
  title: ReactNode;
  children: ReactNode;
  placement?: Placement;
  /** Width in px on desktop (default 320). */
  width?: number;
  id?: string;
}

const GAP = 8;
const MARGIN = 8;

/**
 * Anchored, non-modal dialog. Esc and click-outside close it; Tab stays inside while open
 * and focus returns to the trigger on close. Below 640px it renders as a BottomSheet.
 */
export function Popover({ open, onClose, anchorRef, title, children, placement = "bottom", width = 320, id }: PopoverProps) {
  const narrow = useIsNarrow();
  const autoId = useStableId("pop");
  const baseId = id ?? autoId;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Placement; maxH?: number } | null>(null);

  const place = useCallback(() => {
    const a = anchorRef.current;
    const p = ref.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const pw = p.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // scrollHeight = natural height even when a previous maxHeight clamps the box.
    const ph = Math.min(p.scrollHeight + 2, Math.min(vh * 0.7, 560));
    const fits: Record<Placement, boolean> = {
      bottom: r.bottom + GAP + ph <= vh - MARGIN,
      top: r.top - GAP - ph >= MARGIN,
      right: r.right + GAP + pw <= vw - MARGIN,
      left: r.left - GAP - pw >= MARGIN,
    };
    const order: Placement[] = [placement, "bottom", "top", "right", "left"];
    const found = order.find((s) => fits[s]);
    const roomBelow = vh - r.bottom - GAP - MARGIN;
    const roomAbove = r.top - GAP - MARGIN;
    // Nothing fits: use the roomier vertical side and let the panel scroll.
    const side: Placement = found ?? (roomBelow >= roomAbove ? "bottom" : "top");
    const maxH = found ? undefined : Math.max(120, side === "bottom" ? roomBelow : roomAbove);
    const h = maxH !== undefined ? Math.min(ph, maxH) : ph;
    let top = 0;
    let left = 0;
    if (side === "bottom" || side === "top") {
      top = side === "bottom" ? r.bottom + GAP : r.top - GAP - h;
      left = r.left + r.width / 2 - pw / 2;
    } else {
      left = side === "right" ? r.right + GAP : r.left - GAP - pw;
      top = r.top + r.height / 2 - h / 2;
    }
    left = Math.min(Math.max(MARGIN, left), vw - pw - MARGIN);
    if (side === "left" || side === "right") top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - h - MARGIN));
    setPos({ top, left, side, maxH });
  }, [anchorRef, placement]);

  useLayoutEffect(() => {
    if (!open || narrow) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, narrow, place]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open || narrow) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, narrow, onClose, anchorRef]);

  // Activate once positioned: focusing the panel while it is still visibility:hidden silently fails,
  // which left keyboard users outside the popover (Esc and Tab-trap did nothing).
  useFocusTrap(ref, open && !narrow && pos !== null, onClose);

  if (!open) return null;
  if (narrow) {
    return (
      <BottomSheet open onClose={onClose} title={title} id={baseId}>
        {children}
      </BottomSheet>
    );
  }
  return createPortal(
    <div
      ref={ref}
      id={baseId}
      className="fs-popover"
      data-side={pos?.side ?? placement}
      role="dialog"
      aria-labelledby={`${baseId}-title`}
      tabIndex={-1}
      style={{
        width,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxH,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="fs-popover__header">
        <h2 id={`${baseId}-title`} className="fs-popover__title">
          {title}
        </h2>
        <button type="button" className="fs-popover__close" onClick={onClose} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <div className="fs-popover__body">{children}</div>
    </div>,
    document.body,
  );
}

/** Convenience: state + ref for a trigger that toggles a popover. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { anchorRef, open, setOpen, close, toggle };
}
