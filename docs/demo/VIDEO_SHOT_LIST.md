# 30-second video: shot list

**Format:** 30 s, 1920×1080, English subtitles burned in plus an `.srt` file. No voice-over is needed. Use royalty-free music or none: no copyrighted audio.

**Rules:**
- **Record from the real app only**, using screen capture of the running FarmSmart (local or the public URL).
- No mock-ups, no edited numbers, and no NASA logos or insignia. Mission names in plain text are fine.
- If any frame or element is SI-generated (for example a generated background or voice), it must carry a visible **"SI-generated"** watermark for its whole time on screen, and the SI disclosure must list it. The plan below uses none.
- Every number in a subtitle is read from the cited file. Re-check it against the screen on recording day.
- Say "SI", never "AI".

**Recording setup:**
- Metric units, English, default priority order, Simple mode.
- Reduced motion **off**, so the globe fly-to and the arc animate.
- Hide the cursor when it is not needed.
- Story County field `b96d39c7a833`. Garden City, Kansas dryland field `b20f28194396`.

| # | Time | Shot (what to record) | Subtitle (English) | Numbers and source |
|---|---|---|---|---|
| 1 | 0:00–0:05 | **Orbit → field.** Globe Home spinning. Pick "Story County, Iowa" from the pilot list. The fly-to ends on the field, the outline draws, and Field Studio opens. | "Farmers face shifting heat, rain and water. FarmSmart starts from your field." | none |
| 2 | 0:05–0:10 | **The NASA climate pulse.** The Area Report: zoom on "Trends 1991–2025", then on the monthly temperature and rain chart. | "35 years of NASA POWER weather: this field is warming about 0.5 °C per decade." | +0.49 °C/decade (likely 0.14–0.85), n = 35 years, p = 0.016 (`data/precomputed/context_b96d39c7a833.json` → `climate.trends.tmean`) |
| 3 | 0:10–0:15 | **Bare soil meets wind and rain.** The season timeline: red hatched bare weeks under the shaded windy and heavy-rain columns. Hold on the summary line, then highlight the cover-crop row going solid. | "Bare soil overlaps the windiest weeks: 6.5 weeks now, 0 with a rye + vetch cover." | Overlap 6.5 → 0 weeks; current rotation 10.5 bare weeks/yr (`compare_b96d39c7a833.json` → `cards[].timeline`) |
| 4 | 0:15–0:20 | **Three strategies with confidence.** The rotation options column: three cards with petals, match bars and confidence chips. Then the "ordering is uncertain" note. | "Your rotation vs two alternatives: trade-offs, risks, and how sure we are." | Match 44 / 75 / 69; confidence High / High / Low; top option wins 40% of 300 perturbations → "ordering is uncertain" (`compare_b96d39c7a833.json` → `cards`, `ranking`) |
| 5 | 0:20–0:25 | **Climate Twins arc.** The Climate Twins view, SSP2-4.5: the gold arc flies from the field to the analog. Hold on "6 of 6 models agree". | "By the 2040s, this climate looks like today's near Bellevue, Missouri. 6 of 6 models agree." | Analog 250 km away, 6/6 models, not novel (`data/precomputed/twins_story_ia.json`) |
| 6a | 0:25–0:28 | **Same flow at another pilot.** Garden City, Kansas (dryland): quick cut from the globe to the timeline summary. | "Same tool in dryland Kansas: 5 bare + windy weeks → 0 with a rye cover." | Overlap 5.0 → 0 with "Winter wheat–Grain sorghum–Fallow + cereal rye"; that option wins 95% of perturbations (`compare_b20f28194396.json`) |
| 6b | 0:28–0:30 | **End card** (plain text on navy, no logos): "FarmSmart · NASA Space Apps 2026 · Adapting Farms with NASA Data", the public URL, and "Data: NASA POWER, MODIS, NEX-GDDP-CMIP6, USDA and others. No NASA endorsement implied." | "US first, built for the world. FarmSmart supports your judgment; it does not replace it." | none |

**Pilot choice for shot 6.** The brief asks for Punjab. Punjab has no precomputed comparison yet, and rotation recommendations are switched off outside the US pilots. So shot 6 uses Garden City, Kansas, which has a real compare and Climate Twins run. Swap in Punjab only if its compare runs end to end before recording, and re-read its numbers then.

**Note for shot 2.** The brief calls this "the 25-year NASA pulse", meaning SMAP, IMERG and ECOSTRESS sparklines. That ribbon does not exist yet. The shot shows NASA POWER 1991–2025 normals and trends, so the subtitle says "35 years of NASA POWER". Do not caption it as SMAP or ECOSTRESS.

## Subtitle file (`field_shift_30s.srt`)

```
1
00:00:00,000 --> 00:00:05,000
Farmers face shifting heat, rain and water. FarmSmart starts from your field.

2
00:00:05,000 --> 00:00:10,000
35 years of NASA POWER weather: this field is warming about 0.5 °C per decade.

3
00:00:10,000 --> 00:00:15,000
Bare soil overlaps the windiest weeks: 6.5 weeks now, 0 with a rye + vetch cover.

4
00:00:15,000 --> 00:00:20,000
Your rotation vs two alternatives: trade-offs, risks, and how sure we are.

5
00:00:20,000 --> 00:00:25,000
By the 2040s, this climate looks like today's near Bellevue, Missouri. 6 of 6 models agree.

6
00:00:25,000 --> 00:00:28,000
Same tool in dryland Kansas: 5 bare + windy weeks → 0 with a rye cover.

7
00:00:28,000 --> 00:00:30,000
US first, built for the world. FarmSmart supports your judgment; it does not replace it.
```
