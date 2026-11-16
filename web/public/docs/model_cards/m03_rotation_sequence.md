# Model card: M3, rotation sequence ("what usually comes next")

**Kind:** SI (statistical learning): first- and second-order Markov chain with back-off.
**Code:** `fieldshift/models/m03_sequence.py` · API `/api/fields/{id}/nextmove`

## Purpose
Show what farmers around a field usually plant next, given the field's last two crops. It sits next to the optimizer's "smart next" option. It describes habit, not suitability, and the UI says so.

## Data
- USDA NASS Crop Sequence Boundaries, 2024 edition. Each field's polygon carries a 2017–2024 Cropland Data Layer crop code.
- We use every field in a ~0.4° × 0.4° window (≈35 × 45 km) around the target field. A field is kept if at least 6 of its 8 years are crop classes.
- Licence: public domain (USDA).

## Features and method
- Context is the previous two crop codes, falling back to the previous one, then to the area's crop mix, when a two-crop context has fewer than 20 examples.
- Output: the top 5 next crops with probabilities.

## Validation (held-out year)
Trained on 2017→2023 transitions and tested on predicting the 2024 crop for every field in the window.

| Area | Fields | Top-1 | Top-3 | Baseline: same as last year | Baseline: most common crop |
|---|---|---|---|---|---|
| Story County, IA | 6,272 | **0.752** | **0.976** | 0.278 | 0.493 |
| Finney County, KS | 7,972 | **0.495** | **0.738** | 0.218 | 0.267 |

The model beats both baselines in both areas.

## Known failure modes
- It learns habit. Patterns that are common locally can still be poor choices for soil or water.
- CDL class errors (e.g. double crops, small grains vs. grass) carry into the transitions.
- It cannot see cover crops, which CDL does not map.
- US only (CSB). Outside the US the card says "not available".
- Rare crops have few examples, so their probabilities are noisy.

## Uncertainty
Probabilities are empirical frequencies. The order used (2nd, 1st or marginal) is shown with every prediction.
