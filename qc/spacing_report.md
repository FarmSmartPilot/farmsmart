# Spacing audit

Run: `qc/e2e/run.sh spacing.spec.ts` (Chromium). Mobile sizes use a touch context (`isMobile`, `hasTouch`, iPhone Safari user agent), so `(pointer: coarse)` rules apply.

- **Screenshots:** `qc/screenshots/<W>x<H>_<view>.png`, 25 in total. The 5 views (Globe Home, Field Studio, Strategy Compare, Climate Twins, Drought Replay) are each taken at 1280×800, 1440×900, 1920×1080, 390×844 and 430×932.
- **Raw DOM results:** `qc/reports/spacing_audit.json`.
- **WebGL canvases:** the globe and map render blank in screenshots; this is expected.

## DOM checks (final run)

| Check | Method | 1280 | 1440 | 1920 | 390 | 430 |
|---|---|---|---|---|---|---|
| Horizontal page scroll | `scrollWidth − innerWidth` | 0 | 0 | 0 | 0 | 0 |
| Elements off-screen (outside any scroller) | bounding box vs viewport | 0 | 0 | 0 | 0 | 0 |
| Clipped text (overflow hidden, no ellipsis) | `scrollWidth > clientWidth` on leaf text | 0 | 0 | 0 | 0 | 0 |
| Overlapping labels | visible, clipped boxes of headings, paragraphs, buttons and labels; hit-tested so that content under a sticky bar does not count | 0 | 0 | 0 | 0 | 0 |
| Tap targets < 44 px (mobile) | box, `::before`/`::after` hit areas and `--hit` | n/a | n/a | n/a | 1 residual (see below) + inline glossary terms | same |

### First run (before fixes) found
- **Mobile tap targets under 44 px:**
  - the wordmark (27 px);
  - "why not others?" (20 px);
  - footer "Sources & Methods" (17 px);
  - option-card title buttons (19–38 px);
  - "Find my farm" (40 px);
  - `<select>` and range inputs (32 px);
  - Strategy Compare `<summary>` rows (21–32 px);
  - confidence-chip hit area (41 px, because the inset is measured inside the 1.5 px border).
- **Strategy Compare:** the "Best for you" tag pushed the best card's title and score down 34 px, so headings and scores did not line up across the three columns.
- **Citation lists:** the external-link icon wrapped onto its own line, leaving an orphaned "↗" under each citation (Strategy Compare evidence and Sources & Methods).
- **False positives the first detector reported:** "overlaps" between rows of the scrolled MY FIELD column and between elements under the sticky compare footer. The detector now clips each box by its scrolling ancestors and hit-tests it.

## Fixes made (all CSS in `web/src/app.css`, appended under "QC spacing fixes")
1. `.cites a svg` is inline (no orphaned icon). `.cites a` has a minimum height of 24 px (this also keeps WCAG 2.2 target-size).
2. `.cmp-col` is `position: relative`, and `.cmp-col > .best-tag--top` is absolute on the card border. Titles, scores and bars now line up across the columns.
3. `@media (pointer: coarse)`:
   - the wordmark, "why not others?", the footer link and option-card titles are now 44 px tall (inline-flex);
   - big search "Find my farm", `select`, `label select`, `.rp select` and `input[type=range]` are now 44 px;
   - Compare and assumptions `<summary>` rows get 12 px block padding;
   - the confidence-chip `::before` is now inset −12 px, giving a 45 px hit area.

## Residuals (accepted, with reasons)
- **Inline glossary terms** (`button.fs-term`: GDD, ET₀, NDVI, RUSLE, P10/P50/P90 and so on) are 20–24 px tall. They sit inside sentences and table headers. WCAG 2.5.8 exempts inline targets, and enlarging them would break the line rhythm. The brief's ≥44 px rule is for the data and SI buttons, and those pass: `.fs-dot` has a 44 px invisible hit area on touch.
- **Third-party map attribution logo link** (59×11 px) on Globe Home and Climate Twins. It is part of the legally required attribution and is styled by the map library, not by FarmSmart.
- **Mobile Field Studio, Options tab:** the collapsed "Area Report" `<details>` shows no disclosure chevron, so it does not look tappable (`studio-m__page .m-report`). This is a design call; it is not changed here.
- **1440×900 Season Timeline:** the long row label "Corn ×2–Soybean + …" is cut at the column edge. The full name is in the row's table version ("Show as table").

Verdict: **clean at all five widths** apart from the residuals above.
