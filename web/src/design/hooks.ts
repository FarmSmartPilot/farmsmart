import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** Subscribes to a CSS media query. SSR-safe (false until mounted). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export const NARROW_QUERY = "(max-width: 639px)";
export const useIsNarrow = () => useMediaQuery(NARROW_QUERY);

/** True when the OS asks for reduced motion OR <html data-motion="reduce"> is set by the app setting. */
export function useReducedMotion(): boolean {
  const os = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [attr, setAttr] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce",
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setAttr(el.dataset.motion === "reduce"));
    obs.observe(el, { attributes: true, attributeFilter: ["data-motion"] });
    return () => obs.disconnect();
  }, []);
  return os || attr;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}

/**
 * Light focus trap: moves focus into `ref` when active, keeps Tab cycling inside,
 * calls onEscape on Esc, and restores focus to the previously focused element on deactivate.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  opts: { restoreFocus?: boolean; initialFocus?: "first" | "container" } = {},
): void {
  const { restoreFocus = true, initialFocus = "container" } = opts;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = focusables(root)[0];
    if (initialFocus === "first" && first) first.focus();
    else root.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === root)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (restoreFocus && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // onEscape deliberately excluded: callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref, restoreFocus, initialFocus]);
}

let idCounter = 0;
/** Stable unique id prefix (React's useId produces ':' which is awkward in CSS selectors). */
export function useStableId(prefix = "fs"): string {
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}
