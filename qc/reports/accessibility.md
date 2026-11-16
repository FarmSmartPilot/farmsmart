# Accessibility (axe-core) report

Run: `qc/e2e/run.sh axe.spec.ts` (Chromium; @axe-core/playwright; tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa).
Views: Field Studio (mobile: Options tab too), Strategy Compare (all full cards opened), Climate Twins, Drought Replay 2012, Alerts, Sources & Methods. Sizes 1440×900 and 390×844. Field: Story County, Iowa pilot.

## Result after fixes (2026-11-14)

| Size | Field Studio | Compare | Twins | Replay | Alerts | Sources |
|---|---|---|---|---|---|---|
| 1440×900 | clean | clean | clean | clean | clean | clean |
| 390×844 | clean | clean | clean | clean | clean | clean |

No violations of any impact level remain on these views. Raw output: `axe_desktop.json`, `axe_mobile.json`, `axe_run.log`.

## Before fixes

| Rule (impact) | Desktop nodes | Mobile nodes | Cause |
|---|---|---|---|
| color-contrast (serious) | 199 | 126 | `--ink-3` #6B7A8C (4.38:1 on white, less on #F6F8FA); sky #2F7FB5 links (4.35 / 4.08:1); confidence chips (high 4.35, low 4.06, medium 4.1:1 on tints); white "SI" on #1E8E4E (4.17:1 at 7.5–8.5 px); white crop labels on soybean green (3.0:1) |
| label-content-name-mismatch (serious) | 18 | 8 | SI dots' accessible name did not contain the visible "SI"; crop-history year tiles' name did not start with the visible text |
| scrollable-region-focusable (serious) | 1 | 1 | Season-timeline scroller; NASA validation tables |

## Fixes (palette identity kept: only text-bearing variants darkened)

- `design/tokens.css`: new `--sky-text` #276B9A (5.7:1) for sky text and links, while `--sky` #2F7FB5 stays for fills and charts. `--ink-3` changed from #6B7A8C to #5E6D7F. `--conf-high` is now `--field-strong` #24653F (6.0:1). `--conf-med` changed from #9A6A12 to #845A0D (5.3:1). `--conf-low` is now #A63B2F (5.3:1). `--crop-rye` changed to #287A6A and `--crop-sorghum` to #A9592F, so white labels pass.
- **SI dot.** The new `--si-dot` #1A8046 fills the SI dot and the SI button. It is the same hue as #1E8E4E but about 10% darker, and gives 4.98:1 with white. `--si` #1E8E4E is kept as the brand token.
  - **Justification:** at the 7.5–8.5 px size the brief requires, white letters on #1E8E4E (4.17:1) cannot meet WCAG AA, even in bold. The brief also requires WCAG 2.2 AA with no serious axe issues.
  - **Sign-off needed:** the orchestrator or design owner must approve this deviation from the literal #1E8E4E.
- `design/components.css`, `design/base.css`, `app.css`: `color: var(--sky)` changed to `var(--sky-text)` (7 places). `.fs-dot--si` and `.fs-btn--si` use `--si-dot`. `.ytile__yr` opacity changed from .9 to 1.
- `lib.ts` `cropInk`: white only on dark crop fills; navy on soybean, the hashed extra colours and unknown gray.
- `design/Provenance.tsx`: the SI button name now starts with "SI:". `views/MyField.tsx`: the year-tile name starts with its visible text (WCAG 2.5.3).
- `views/SeasonTimeline.tsx`, `components/NasaBlocks.tsx`: scrollable regions get `tabIndex=0`, `role=region` and a label.
- `design/Popover.tsx` (e2e finding): the focus trap now activates only after the popover is positioned. Before, focus stayed outside, so Esc did not close "Why not others?" and Tab was not contained.

- `app.css`: citation links get a minimum height of 24 px. Once the external-link icon was put back on the same line as the citation (a spacing fix), axe flagged 12 `target-size` hits on Sources & Methods. The minimum height clears them.

## Not covered
- Globe Home and the Cesium/MapLibre canvases (WebGL) were not scanned. axe cannot check contrast on imagery, so map labels over imagery need a manual check.
- Real WebKit could not run on this PC because Smart App Control blocks the Playwright WebKit DLLs. The mobile scan uses Chromium at 390×844.
- Full keyboard-only walkthrough: only the Popover Esc/focus was tested.
