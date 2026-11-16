# FarmSmart: design system

Code: `web/src/design/` (owner: design agent). It has no extra dependencies: React 19, plus `d3` for the petal chart only.
Gallery: `web/src/design/Showcase.tsx` (default export). Mount it on any route to review components. Its values are sample props, not results.

```ts
import { DataButton, SIButton, ConfidenceChip, Tour, DemoButton } from "@/design"; // or "../design"
```

Importing `web/src/design/index.ts` loads `tokens.css`, `base.css` (reset, body, utilities) and `components.css`. Import it once, near the app root. Inter loads from Google Fonts in `web/index.html`, and the system font stack is the fallback.

## Tokens (`tokens.css`)

| Group | Tokens |
|---|---|
| Brand | `--navy #0E2A47` (text, NASA data button) · `--field #2E7D4F` (primary, good) · `--si #1E8E4E` (SI button only) · `--wheat #C8902A` · `--sky #2F7FB5` (water, links) · `--soil #8A5A3B` · `--alert #C2483A` (risk, bare soil, low confidence) · `--purple #6B4FA0` (climate futures only) · `--surface #F6F8FA` · `--card #FFF` |
| Tints | `--field-tint` `--wheat-tint` `--sky-tint` `--alert-tint` `--soil-tint` `--purple-tint` `--navy-tint` |
| Ink | `--ink` · `--ink-2 #4A5B6E` · `--ink-3 #6B7A8C` (darkened for AA) · `--line` · `--line-strong` · `--track` · `--other-data #6F7D8C` (gray data button) |
| Categorical | `--cat-1..8` Okabe-Ito. For continuous data, use viridis or cividis from d3-scale-chromatic. |
| Crops | `--crop-corn #D9A53A` · `-soybean #5FA36A` · `-wheat #C9B37E` · `-oats #B9A270` · `-rye #2F8C7A` · `-clover #A3568A` · `-alfalfa #2E6B3E` · `-sorghum #B4613A` · fallow/bare = class `.fs-hatch-bare` (red 45° hatch on alert tint) |
| Confidence | `--conf-high/-tint` (field) · `--conf-med/-tint` (#9A6A12 text on wheat tint) · `--conf-low/-tint` (alert) |
| Spacing | `--s1 4` · `--s2 8` · `--s3 12` · `--s4 16` · `--s5 20` · `--s6 24` · `--s8 32` · `--s10 40` · `--s12 48` (px; the number is the multiple of 4) |
| Radii | `--r-xs 4` · `--r-sm 6` · `--r-md 8` · `--r-lg 12` (cards) · `--r-xl 16` (sheets) · `--r-pill` |
| Shadows | `--shadow-1` (cards) · `--shadow-2` · `--shadow-3` (popovers, sheets) |
| Type | `--font` Inter/system · `--fs-meta 12` · `--fs-body 14` · `--fs-title 16` · `--fs-h2 20` · `--fs-h1 24` · `--fs-kpi 32` · `--fs-kpi-lg 40`. Below 640px: meta 13, body **16**, title 17. |
| Focus | `--focus-ring` (white + sky double ring) on every `:focus-visible` |
| Touch | `--tap-min` is 32px on fine pointers and **44px** on `pointer: coarse` |
| Motion | `--dur-fast/--dur/--dur-slow` drop to 0 under `prefers-reduced-motion` **or** `<html data-motion="reduce">` (the app's reduced-motion setting) |
| Imagery labels | `.fs-on-imagery` (dark plate, white text, shadow) · `.fs-on-imagery--light` |

Utilities in `base.css`: `.fs-stack` `.fs-row` `.fs-cluster` (set `--gap` to change spacing), `.fs-visually-hidden`, `.fs-card`, `.fs-chip--*`, `.fs-btn--primary|secondary|ghost|si|sm|lg|block|pill|icon`, `.fs-segmented`, `.fs-tabs__*`, `.fs-table`, `.fs-skeleton`, `.fs-banner--loading|partial|no-observation|unsupported|stale|error`, `.fs-overline`, `.fs-kpi`, `.fs-link`.

## Components

| Component | Key props | Notes |
|---|---|---|
| `DataButton` | `evidence: Evidence`, `describes?`, `placement?` | 14px dot (16px on phones), with an invisible hit area of 24px on desktop and 44px on touch. Navy with a white satellite = `is_nasa`; gray = other source. `aria-label="Data source: <product> (NASA), for <describes>"`. The popover shows the version, observed range, native resolution, resolution used, footprint, quality notes, licence, citation and link. |
| `SIButton` | `record: SIRecord`, `describes?` | Green #1E8E4E dot with "SI". The popover "How this estimate works" shows the model, kind (`si` → "SI model", `rules` → "rules", `process` → "process model"), information cutoff, top drivers (▲▼●), confidence and reasons, the support-not-replace line and the model card link. |
| `ConfidenceChip` | `confidence: {level, reasons, raise?}`, `interactive?` | The shape and the word carry the level, not color alone: ● High, ◆ Medium, △ Low. Click shows the reasons and "what would raise confidence". |
| `GlossaryTerm` | `term`, `definitions: GlossaryMap`, `children?` | Dotted underline button with a definition popover. It does not fetch; the caller passes the map (EN or ES). |
| `Popover` / `usePopover()` | `open`, `onClose`, `anchorRef`, `title`, `placement`, `width` | Fixed-position and auto-flipping. Esc, click outside and the close button all close it. Tab stays inside, and focus returns to the trigger. **Below 640px it becomes a `BottomSheet`.** |
| `BottomSheet` | `open`, `onClose`, `title` | Modal, with a 44px close button and safe-area padding. It locks body scroll. |
| `Button` | `variant: primary/secondary/ghost/si`, `size`, `icon`, `iconAfter`, `block`, `pill`, `ref` | — |
| `DemoButton` | button props | "Demo" pill with a play icon. Put it top-right in the shell. |
| `Chip` | `tone`, `icon`, `onClick`+`pressed` (toggle), `trailing` | `trailing` sits outside the toggle button, so a DataButton never nests in a button. |
| `SegmentedToggle<T>` | `options`, `value`, `onChange`, `label` | `radiogroup` that arrow keys, Home and End move through. Use it for Simple/Expert and 2D/3D. |
| `Tabs` | `tabs[{id,label,content}]`, `value?`, `onChange?`, `label` | ARIA tabs with automatic activation. Each tab button has `data-tab-id` so a Tour can target it. |
| `Card` | `overline`, `title`, `actions`, `selected`, `flush`, `as` | `selected` = field tint plus a 2px field border (the recommended option). |
| `StatusBanner` | `kind`, `title?`, `action?` | Kinds: loading / partial / no-observation / unsupported / stale / error, each with its own icon and color. Uses `role=status` (`alert` for error). It never blocks: offer "Continue with available data". |
| `Skeleton` | `width`, `height`, `radius`, `lines` | Shimmer stops under reduced motion. |
| `Hint` | `label`, `children` | Inline disclosure that **replaces hover tooltips**. |
| `PetalChart` | `indicators[{key,label,value0to1,color?}]`, `size`, `title`, `showLabels?` | d3 arcs on a sqrt radius scale. A faint outer petal marks the maximum; `null` = unknown (dashed outline). A visually hidden table comes with it. |
| `MatchBar` | `value 0–100`, `label`, `trailing` (put an SIButton here) | `role=meter`. |
| `Tour` | `steps[{target, title, body, placement?, onEnter?}]`, `open`, `onClose(reason)` | Spotlight cutout, step card, Back / Next / Skip, progress dots, ← → Esc. `onEnter` is awaited (switch a tab, fly the map). A missing target gives a centered card. Below 640px the card docks to the bottom. Respects reduced motion. |
| Icons | `IconSatellite` `IconPlay` `IconSearch` `IconLayers` `IconWind` `IconRain` `IconFrost` `IconHeat` `IconDrought` `IconSprout` `IconAlert` `IconCheck` `IconInfo` `IconDownload` `IconUpload` `IconBell` `IconGlobe` `IconMap` `Icon2D` `Icon3D` `IconCompass` `IconPolygon` `IconClose` `IconChevron*` `IconExternal` `IconClock` `IconBan` `IconEyeOff` `IconLoader` | `size`, `title` (when set, the icon is announced; otherwise it is decorative). |
| Hooks | `useIsNarrow`, `useMediaQuery`, `useReducedMotion`, `useFocusTrap` | — |

Types are in `types.ts`: `Evidence`, `SIRecord`, `Confidence`, `Driver`, `ModelKind`, `GlossaryMap`. Align them with `contracts/` once it is frozen.

## Usage rules

1. **Every displayed value gets a provenance dot**, placed directly after the number, label or chart title (not at the end of the row):
   - `DataButton` for observed or derived data;
   - `SIButton` for anything a model, rule set or process model produced or ranked;
   - a value that is both data and model output gets both, data first.
   - For a chart, put the dots after the chart title, not on each mark.
2. **One SI dot per output, not per decoration.** Match and confidence on the same card share one SIButton (put it on the MatchBar).
3. **No NASA insignia anywhere.** The satellite glyph is neutral; the words "NASA data" appear only inside the popover. The footer says "No NASA endorsement is implied."
4. **Never "AI"**: write "SI" in UI, aria-labels, docs and comments.
5. **Coarse values say their scale**, e.g. `effective_res: "regional value (≈50 km)"`.
6. **Confidence is never color alone**: always the shape plus the word, and always reasons on click.
7. **No hover-only interactions.** Use `Hint`, `Popover` or `GlossaryTerm` (tap, click or Enter).
8. **States are honest and non-blocking**: use the matching `StatusBanner`, lower confidence, and let the user continue.
9. **Bare soil is always `.fs-hatch-bare`** plus a text label, never a solid color.
10. **Purple means climate futures only.**
11. **Copy tone: grade 8.** Short sentences and everyday words, with numbers before adjectives. Explain jargon with `GlossaryTerm` (ET, NDVI, soil moisture anomaly, GDD, frost risk, water balance, RUSLE, P10/P50/P90). Say "may", "about" and "in 15 of 20 seasons" instead of hiding uncertainty.

### "Supports, not replaces" reminder (use in the SI popover, Compare footer and PDF)

| | Text |
|---|---|
| EN | FarmSmart supports your judgment. It does not replace it, or local expertise. |
| ES | FarmSmart apoya su criterio. No lo reemplaza, ni reemplaza el conocimiento local. |
| EN (short, chip) | Check locally before you decide. |
| ES (short, chip) | Verifique localmente antes de decidir. |

### Guided demo

Put `<DemoButton>` top-right in the shell, and give it to `<Tour steps>`. Each step targets a stable selector, such as `[data-tour="rotation-options"]`. Use `onEnter` to switch tabs or move the map before the spotlight is measured. Keep the body text to one or two grade-8 sentences per step.
