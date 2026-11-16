# Space Apps submission checklist

The story agent checked this against the repository on 2026-11-14; rows 4, 6 and 13 were re-checked by the orchestrator later that day. Status key: ✅ verified in the repo · ⚠️ partial or not verifiable from the repo · ❌ not done.

The story agent had no shell, so git history and GitHub visibility were **not** checked. Run the commands in the "How to re-check" column before submitting.

| # | Requirement | Status | Evidence | How to re-check / what is left |
|---|---|---|---|---|
| 1 | **Public project link, no login** | ❌ | `Dockerfile` and `render.yaml` deploy the **API only**. There is no static-site config for `web/` (Vercel, Netlify, Render static or similar), and no public URL is recorded yet. The app has no login screen. | Deploy the API (Render blueprint). Deploy `web/dist` with the API base URL set. Open the URL in a private window and walk the demo path. Paste the URL into README and the end card. |
| 2 | **Repo public, no secrets** | ⚠️ | `.gitignore` lists `.env`, `.env.*` (with `!.env.example`), `.netrc` and `*.pem`. `.env` exists locally and is ignored. `.env.example` holds only empty keys. A grep for token patterns (`eyJ…`, `sk-ant-`, `AKIA…`, `re_…`) outside ignored folders found **no hits**. `render.yaml` uses `sync: false` for `EARTHDATA_TOKEN`. | Run `git ls-files .env` (must print nothing), `git log --all -p -S "EARTHDATA_TOKEN=" -- . ":!.env.example"` (must show no value) and `git log --all --stat \| findstr /i ".env"`. Then set the GitHub repo to Public. |
| 3 | **Video ≤30 s with English subtitles, or deck ≤7 slides** | ⚠️ | Made: 30.0 s, 4K 24 fps, burned-in English captions plus `docs/demo/farmsmart_30s.en.srt` (build: `qc/video/showcase/`; file kept out of git, 62 MB). Earlier plan: `docs/demo/VIDEO_SHOT_LIST.md` (6 shots, 30 s, `.srt` text included). Backup: `docs/demo/DECK_OUTLINE.md` (7 slides). | Record from the real app, burn in the subtitles, host externally, and add the link to the submission. Build the deck from real screenshots. |
| 4 | **SI disclosure** | ✅ | `docs/SI_USE_DISCLOSURE.md` exists; README links it. The M10 row points to `qc/reports/calibration_m10.md` / `.png`, which exist. | Re-read it once the last model change lands. |
| 5 | **Watermark SI-generated media** | ✅ | Policy in `SI_USE_DISCLOSURE.md` §1 and in the shot list. No SI-generated images or video exist in the repo or the demo plan. | If any SI-generated frame or image is added, put a visible "SI-generated" mark on it and list it in the disclosure. |
| 6 | **No NASA logos or insignia** | ✅ | A grep for "NASA logo", "meatball", "insignia" and "worm logo" found only rule text. No logo assets exist in `web/public` or `web/src`. Data buttons use a neutral satellite glyph (`web/src/design/Icons.tsx`). The footer and PDF say "No NASA endorsement is implied". The favicon is a FarmSmart mark (navy tile with field rows). | Check the video end card and slides by eye. |
| 7 | **"SI" not "AI" in the UI** | ✅ | `web/src/i18n/en.json` and `es.json` have **0 hits** for `AI`, `A.I.` or `IA`. Across `web/src` there are 0 hits. The only repo hits outside rule text are `"AI"` in `web/public/data/admin0.geojson` and `places.json`, which is the ISO country code for Anguilla. That is data, not a UI string. | Re-run `\b(AI\|IA)\b` on `web/src` after the last frontend commit. |
| 8 | **Data citations** | ✅ | `docs/DATA_SOURCES.md` (role, version, licence, citation); `docs/LICENSES.md` (attribution strings); in-app Sources & Methods with citations and a filter; per-value data buttons; footer credit line; model cards cite their data. | Make sure the SMAP / IMERG / GRACE-FO / HLS entries match what actually ships. |
| 9 | **Licence** | ✅ | `LICENSE` (MIT). `docs/LICENSES.md` now states code MIT, knowledge base CC BY 4.0, and data per source. README states the same. | none |
| 10 | English text in the submission | ✅ | All docs are in English; the UI defaults to English (Spanish optional). | none |
| 11 | Team confirmed; no minors' names, faces or voices | ⏳ | Not in the repo. | Fill in slide 7 and the project page. |
| 12 | Requirements trace | ✅ | `docs/REQUIREMENTS_TRACE.md` (honest ✅/⚠️/❌ per item) | Update it when SMAP/IMERG/GRACE/HLS land. |
| 13 | Demo path rehearsed | ⚠️ | `docs/demo/DEMO_SCRIPT.md` and the in-app 13-step Demo (checked at 5 widths, `qc/reports/demo_tour_timing.md`). Drought Replay 2012/2017/2023 is precomputed for the pilots; NAIP imagery is pre-cached around the US pilots (`scripts/prewarm_naip.py`). | Rehearse on the deployed URL. |

**Submit order (target about 22:30 Sunday):**
1. Deploy.
2. Check the URL in a private window.
3. Make the repo public.
4. Run the secret checks (row 2).
5. Upload the video.
6. Fill in the project page: what, who, how, NASA data used, space-agency partner data, listing only what actually ships (check `docs/DATA_SOURCES.md`), SI disclosure link.
7. Submit.
