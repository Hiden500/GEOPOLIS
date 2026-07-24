# Actions log — Iraq/Kirkuk seam advisory (with skill)

## Recommendation (headline)

**Gap-first (`absorb_slivers_until_stable` in `scripts/map/build/geometry_cleanup.py`), NOT a `buffer()`-based fill.**

Reason in one line: Kirkuk and its Iraq/Kurdistan neighbours are all raw,
already-existing polygons from the same source file (`game_map.json`)
processed inside the same continent builder (`build_asia_1946.py`) — exactly
the case the skill documents gap-first for, and exactly the case buffer was
tried and removed for (2026-07-19-e, `docs/DECISIONS.md`): join-style
"pimples", a hand-tuned radius, no convergence guarantee, and inflation in
every direction that risks new overlaps with the tripoint-heavy neighbours
around Kirkuk (Kurdistan/Arbil, Kurdistan/As-Sulaymaniyah, Iraq/Sala ad-Din,
Ninawa, Diyala all meet within a few km of each other).

## What I read, in order

1. **`.claude/skills/map-geometry-qa/SKILL.md`** — did not exist in this
   worktree's checked-out branch (worktree HEAD `a2b9768`, dated 2026-07-23,
   predates the skill). Confirmed via `git log --all --oneline` +
   `git merge-base --is-ancestor d3ae48a main` (YES) / `...HEAD` (NO) that the
   skill (and the whole map-geometry-cleanup line, including the Kirkuk carve
   itself) lives on `main` (tip `d3ae48a`, a merge of
   `claude/1946-map-geometry-cleanup`) but not on this worktree's stale
   branch point. Read the full ~1187-line file via `git show main:.claude/
   skills/map-geometry-qa/SKILL.md` (no branch switch, no merge — read-only
   `git show`, since a linked worktree shares the same object database as
   `main`). Working tree of this worktree was never touched; `git status`
   stayed clean throughout.
2. **Commit `d8236d7`** ("feat(map): split West Bank into 10 PSE
   governorates, carve Kirkuk out of Iraq") — full commit message +
   `git show d8236d7 -- scripts/map/build/build_asia_1946.py` diff. This is
   the actual Kirkuk carve-out. Mechanism: `ZONED_GEOMETRIC["IQ"]["targets"]`
   changed from `{"Iraq": 7, "Kurdistan": 3}` to `{"Iraq": 6, "Kurdistan": 3,
   "Kirkuk": 1}`, plus a loop that sets `it["region_field"] = "Kirkuk"` on the
   raw `At-Ta'mim`/`Kirkuk` province before `geometric_merge_by_zone` runs.
   No re-drawing, clipping, or union touches Kirkuk's or its neighbours'
   vertices in this commit — pure pre-merge relabeling.
3. **`scripts/map/build/geometry_cleanup.py`** (current `main` version, via
   `git show`) — read in full. Confirmed exact signatures:
   `absorb_slivers(mutable_feats, context_geoms=(), water_geoms=(),
   clip_box=None, label="")` and `absorb_slivers_until_stable(...,
   max_passes=3)`. Confirmed the "longest shared boundary wins" rule, the
   ribbon-splitting logic, and the documented reasons buffer-based filling
   was replaced (module docstring cites the same `2026-07-19-e` decision).
4. **`build_asia_1946.py`** (current `main` version, via `git show`) —
   grepped for existing `absorb_slivers`/gap-closing usage. Found
   `absorb_middle_east_slivers(features)` (~line 333): makes
   `{"PS","JO","SY","LB"}` mutable, everything else (explicitly including
   Iraq) context, builds a local `clip_box` from the mutable union's bounds
   padded by 0.5°, loads `water = load_water_geoms(clip_box)`, calls
   `absorb_slivers_until_stable`. Confirmed via `grep` that Iraq (`IQ`) is
   **not** in `MUTABLE_ISO` anywhere — this existing pass does not and never
   did cover an internal Iraq/Kirkuk seam. Confirmed call order in `main()`:
   `geometric_merge_by_zone` (~line 983) runs before `out_features` is
   final; `clip_palestine_to_neighbors` → `clip_against_dead_sea` → ... →
   `absorb_middle_east_slivers(out_features)` (~line 1025) run after, in
   that order — matching the skill's documented "clip overlaps → clip water
   → absorb" sequence.
5. **`scripts/map/AGENTS.md`** and **`scripts/map/README.md`** (current
   `main`, via `git show`) — read `AGENTS.md` in full (60 lines); grepped
   `README.md`'s numbered checklist headings and read items 8-14 verbatim
   (the gap-methodology cluster) to cross-check wording against SKILL.md.
   No discrepancies found; README.md is the older, itemized version of the
   same rules.
6. **`docs/TODO.md` / `docs/DECISIONS.md`** on `main`, and `TODO.md` on
   `claude/1946-map-geometry-cleanup` — grepped for "Kirkuk"/"Iraq". Only
   hits are the original carve-out decision entry; no logged Iraq/Kirkuk gap
   or seam issue anywhere.
7. **Discovered `claude/1946-map-geometry-cleanup` has 3 commits not yet
   merged into `main`** (`f59b754`, `535156d`, `22b1a87`, all dated
   2026-07-24, i.e. today) — confirmed via `git merge-base --is-ancestor
   <sha> main` (NO for the first two) and topo-ordered branch log. Read both
   non-docs commits in full:
   - `f59b754` — fixes a real bug in `absorb_slivers` itself (a second,
     stricter area gate for cells touching exactly one land feature lacked
     the ribbon exception the first gate had, so it silently rejected real
     thin coastal gaps even though they passed the general test). Directly
     relevant precedent: even this project's own gap-first tool has shipped
     bugs where a "clean" numeric pass didn't mean the gap was actually
     closed — reinforces "render, don't trust the number" for whatever fix
     is applied to Kirkuk too.
   - `535156d` — adds `scripts/map/build/diagnose_coastline_gaps.py` (read
     in full, 308 lines). Classifies uncovered polygonize cells into
     COASTLINE / LAND_HOLE / LAND_SEAM, where LAND_SEAM (elongated,
     `minimum_rotated_rectangle` aspect ratio ≥ 8, not touching water) is
     explicitly documented as "almost certainly neighbouring-admin-border
     digitization noise, not a real gap" and is counted but not listed/
     rendered as something to fix. This is a highly relevant, very fresh
     (same-day) precedent for classifying whatever the Iraq/Kirkuk seam
     turns out to be before deciding it needs a fix at all.
8. **`0e8b7b0`** ("feat(client): improve map visual rendering (fix region
   seams, coastline contrast, and label positioning)") — checked `--stat`
   only (client `MapView.tsx` / `GeometryEngine.ts`, not `scripts/map/`).
   Confirms a separate, already-existing client-side rendering-seam
   mitigation exists, independent of the data pipeline — relevant as an
   alternative explanation to rule out if the visible gap turns out to be
   render-only.

## What I measured myself (not just read)

Extracted `client/public/world_1946.geojson` from `main` via `git show`
(38.6 MB, 1532 features) into the session scratchpad (outside the repo).
Used Python 3.12 + Shapely 2.1.2 (both already available in this
environment) to:

- Confirm the property schema (`iso_a2`, `name`, no `region_type` — matches
  the skill's warning that `client/public` and `scripts/map/out` use
  different schemas).
- Enumerate all 10 `iso_a2=="IQ"` features and confirm they match the code's
  `targets` (`Kurdistan`: Dihok/Arbil/As-Sulaymaniyah = 3; `Iraq`:
  Diyala/An-Najaf/Ninawa/Sala ad-Din/Al-Anbar/Al-Muthannia = 6; `Kirkuk` = 1).
- Compute `shapely` `distance()`/`touches()` between Kirkuk and every other
  IQ feature: touches (distance 0) Arbil, As-Sulaymaniyah, Sala ad-Din;
  0.18-0.24° from Ninawa/Diyala (not direct neighbours).
- Run a `polygonize`-based cell mosaic (the same technique
  `absorb_slivers`/`diagnose_coastline_gaps.py` use internally) restricted to
  a local box around Kirkuk with **all 6 relevant IQ regions** as the
  covering set: **0 uncovered cells** — i.e., no measurable void among
  Kirkuk and its Iraq/Kurdistan neighbours in the currently-committed `main`
  data. (An earlier, narrower attempt that only included the 3 *directly
  touching* neighbours as context — not all 6 — produced 2 large false-
  positive "gap" cells that turned out to be real Ninawa/Diyala territory
  outside that too-narrow covering set; corrected by widening context to
  match how `absorb_slivers`'s own `context_geoms` parameter is meant to be
  used.)
- Rendered Kirkuk + its 5 IQ neighbours to a PNG (matplotlib, same
  land-fill + polygonize-highlight technique as `diagnose_coastline_gaps.py
  --render`) and viewed it with the Read tool. Borders tile cleanly; no
  visible seam. Two small flagged cells appear far from Kirkuk, at the box's
  NE corner — plausibly a probe artifact from not loading Iran/Turkey into
  the covering set there; not chased further (out of scope, unrelated to
  the Kirkuk seam specifically).

## Bottom line on the task's premise

I could not reproduce a measurable or visible Iraq/Kirkuk gap in the
currently-committed `main` state, numerically or by render. I reported this
transparently in `response.md` rather than fabricating a "found and fixed"
narrative, and gave three candidate explanations if the user does see a gap
on their screen (a real data gap from a later edit or a blind spot in my
probe's box size; the newly-defined LAND_SEAM noise class; a client-side
MapLibre rendering artifact unrelated to `scripts/map/`) plus a one-line way
to tell them apart. Regardless of which of these it turns out to be, the
answer to "what tool closes it if it's real" is unambiguous from the code
and history read above: gap-first `absorb_slivers_until_stable`, wired the
same way `absorb_middle_east_slivers` already is for the neighbouring
Palestine/Jordan/Syria/Lebanon seam, never a `buffer()` bridge.

## What I did not do

- Did not run any `build_*.py` script or the pipeline (`make_1946.py`).
- Did not modify any file inside the repository/worktree. `git status`
  confirmed clean before writing the two required output files.
- Did not touch, merge, or check out `claude/1946-map-geometry-cleanup` or
  any other branch — read its blobs via `git show <ref>:<path>` only.
- Did not chase the two unrelated flagged cells near Iran/Turkey (outside
  this task's scope).
- Did not attempt to distinguish a real LAND_HOLE from LAND_SEAM for those
  2 cells since they are not part of the Kirkuk seam this task asked about.
