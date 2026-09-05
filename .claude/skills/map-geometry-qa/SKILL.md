---
name: map-geometry-qa
description: Verify 1946-map geometry after any cut/merge/border edit — close gaps with gap-first absorb_slivers (never buffers), check every seam numerically AND by per-region render, and protect deliberate water holes. Use whenever scripts/map geometry, borders, region counts, or lakes/seas change.
---

# Map Geometry QA

Hard-won checklist for editing `scripts/map` geometry. Every rule here is a bug
that already shipped on this repo (`docs/DECISIONS.md`, entries 2026-07-19-a…q,
2026-07-20, 2026-07-22 through 2026-07-24). Do not re-open the same graves.

This file holds the universal, always-relevant rules. Deeper, narrower lesson
sets live in `references/` and are pointed to below — read the relevant one
before touching that specific area, rather than assuming this file alone
covers it.

## Trigger

Use when a change touches map geometry: `scripts/map/build/*.py`, region
cutting/merging, country border curation, region-count changes, or lake/sea
polygons. Also when the user reports gaps, overlaps, "pimples", zippers,
missing territory, or wrong region names on the map.

## Do not trigger

Pure economy/ownership/name-text edits that don't move a vertex, or client
render-only styling with no geometry change.

## The one rule that overrides intuition

**Numeric checks are a filter, NEVER a substitute for looking.** `merge_world`'s
invalid/overlap report passed clean while the user's screenshots showed a torn
Gaza-Sinai border, a Dead-Sea encroachment, and Kashmir/Sharjah labels on top of
Jerusalem. After every geometry edit you MUST render the specific edited region
+ its immediate neighbours (not the whole world — you lose the detail) to a PNG
and open it with the Read tool. The Browser pane has been unreliable all along;
use the standalone matplotlib renderer.

**"Idempotent, 0 absorbed on a second run" proves the algorithm converged — it
does NOT prove there's nothing left to absorb.** A function can stably,
silently reject the same real gap on every single run forever.
`fix_lake_coastline_gaps.py` reported success by every automated signal
available at the time (2110.7 km² added, 0 on re-run) — real gaps remained
anyway, visible only as thin red coastline ribbons in a rendered view. The
automated checks were answering "did the algorithm reach a fixed point," not
"does the fixed point match reality" — those are different questions, and only
a visual render (or equivalent independent check) answers the second one.

**A rendered "gap" that looks like a hairline is only real evidence of being
sub-visible noise if the render's zoom level could actually show its true
width.** A 27°-wide bbox compressed a genuine 1-11 km wide Alaska coastline gap
into 1-2 pixels, making it indistinguishable by eye from real border-digitizing
noise. Check absolute width (geodesic distance via `pyproj`, not degrees) or
re-render at a zoom where the candidate would occupy enough pixels to show its
actual shape before calling anything noise.

## Closing gaps: gap-first only

To close gaps/zippers between polygons, use
`scripts/map/build/geometry_cleanup.py::absorb_slivers_until_stable`, NEVER a
`buffer()`-based fill. Buffer filling was tried and removed (2026-07-19-e) — it
produces join-style "pimples", needs a hand-tuned radius, doesn't reliably
converge, and inflates in every direction so it creates fresh overlaps on third
parties. Gap-first `polygonize`s all boundaries, finds cells covered by neither
land nor water (the actual void), and hands each to the feature with the longest
shared boundary. It cannot create overlaps (voids intersect nothing) and snaps
seams onto existing borders.

Order in a continent builder:
1. `clip_*_to_neighbors` — subtract genuine overlaps (authoritative neighbour wins).
2. `clip_against_dead_sea` / lake clips — subtract water the land covers.
3. `absorb_slivers_until_stable(mutable, context, water, clip_box)` — fill voids.

`context` = authoritative neighbours you must NOT move (other continents, Iraq,
Turkey…); `water` = `load_water_geoms(clip_box)`. Cross-continent seams (Asia↔
Africa) can't be closed inside one builder — the other continent isn't built yet;
do it in a post-step (`fill_palestine_egypt_gap.py`).

**For the internal gates/thresholds/classifier pitfalls of `absorb_slivers`
itself** (compactness vs. `minimum_rotated_rectangle` aspect ratio, the
dual-gate ribbon-exception bug, blob-vs-lake protection, clip_box-at-the-
antimeridian, and more) — see `references/absorb_slivers_internals.md` before
touching the function's constants or writing a diagnostic that mirrors its
cell-mosaic logic.

## Safeguards you must respect

- **Deliberate water holes.** A real lake absent from `lakes_1946.geojson` renders
  as background and must not be absorbed. Compactness alone won't protect it (a
  jagged shoreline scores low, like a ribbon). Either carve it into
  `lakes_1946.geojson` (so `load_water_geoms` sees it as water — preferred, see
  `extract_kinneret.py`) or add a point to `PROTECTED_HOLE_POINTS`.
- **A hole covered by nobody isn't caught by pairwise overlap/distance checks.**
  When you exclude a unit from one country (e.g. Golan out of Palestine), assert
  a `Point` inside it is `contains()`-ed by *some* feature in the final
  `world_1946.geojson`. Missing-territory bugs are invisible to pair checks.
- **A quick matplotlib render for verification can lie about coverage if it
  ignores polygon interior holes.** `ax.fill(*p.exterior.xy)` paints the
  WHOLE exterior ring solid, silently ignoring `p.interiors` — a sea
  polygon correctly excluding a small island (a real hole around it) still
  renders as one solid blob covering that island, making genuinely-correct
  data look like a bug ("Faroe Islands missing" — they were present and
  correctly un-overlapped; the render script just couldn't show a hole).
  Use `matplotlib.path.Path`/`PathPatch` with both the exterior AND each
  interior ring's vertices/codes when the verification depends on holes
  being visible, not a bare `ax.fill` per exterior only.
  **This exact bug recurred in the PERMANENT tool itself, not just a
  one-off script** — `diagnose_coastline_gaps.py::render()` (the canonical,
  reused-dozens-of-times-per-session verification renderer) painted
  interior rings `color="white"` OVER whatever was drawn underneath, rather
  than leaving them transparent; when a polygon's hole happens to be a
  neighboring feature's legitimate territory (routine after any
  `resolve_same_iso_overlaps` — see `cross_source_merging.md`), the render
  showed that neighbor's real land as a blank "gap" (2026-07-29, Washington
  — San Juan, 7 of 8 holes were British Columbia). The general rule above
  was already written down after the FIRST occurrence (Faroe Islands) — it
  didn't stop this second one, because it wasn't checked against every
  render call site, just fixed where it was first found. Fixed now via
  `PathPatch` in the shared tool; if you write or touch ANY new render
  function in this codebase, grep for `color=.white.`/`color="#a8d8f0"`
  near an `interiors` loop before trusting it.
  **The `PathPatch` fix itself introduced a NEW render artifact** — it
  strokes the ENTIRE compound path with one `edgecolor`, including
  interior rings, so a legitimate hole (a neighbor's real territory) now
  got a visible black outline traced right through the middle of the
  polygon on the very next render (same day, same user report: "чёрная
  полоса в полигоне"). Fix: never pass `edgecolor` to the fill patch at
  all — draw the exterior ring's stroke as a SEPARATE `ax.plot(*exterior.
  xy, ...)` call, so interior rings are used only for the even-odd fill
  exclusion and never get their own visible border.
- **A user pointing at several visually-similar defects in one screenshot
  can be describing MULTIPLE independent bugs sharing one symptom — fixing
  the first plausible explanation and re-rendering "clean" doesn't mean
  the rest are explained by it too, verify each circled item separately.**
  The white-hole render bug above was real and WAS the correct fix for
  "white patches" — but the same user complaint also circled genuinely
  disconnected `MultiPolygon` fragments (see next bullet) and genuine
  unclosed coastline gaps that had been separately triaged as "deferred
  backlog" earlier the same session. Declaring the area "fixed" after
  solving only the render bug, without independently re-checking geometry
  (part connectivity) and running the numeric gap scanner again, produced
  a second render that still showed real defects the user had already
  pointed at once. Each distinct-looking annotation needs its own
  independent verification method (containment check for coverage,
  distance-to-different-country for orphan parts, a fresh `diagnose_
  coastline_gaps.py` scan for gaps) — don't let one satisfying root cause
  explain away everything else in the same screenshot.
- **A disconnected `MultiPolygon` part that touches a DIFFERENT country's
  land at distance ≈0 is very likely misattributed territory, not
  noise — check whether raw source confirms ownership before assuming
  it's fine.** Washington — San Juan carried 4 parts beyond its main body;
  3 (touching ONLY British Columbia, north of the US/Canada line or on
  Vancouver Island's own coast) had NO raw `game_map.json` feature under
  Washington at that location at all — genuine Canadian territory that had
  drifted into the wrong feature (most likely the same "`unary_union`
  shifts float coordinates elsewhere in the geometry" mechanism already
  documented for Alaska/British Columbia). The 4th DID have a raw
  Washington source — legitimately Washington, just in the wrong cluster.
  Decisive test, not a judgment call: does the disconnected part touch
  EXACTLY ONE other feature (reassign to it) — a part touching zero or
  several needs a human look, don't auto-resolve those.
- **The raw-source "same country" check above can itself be fooled by an
  oversized raw ADM1 polygon — measure distance-to-own-body FIRST, treat the
  raw name as secondary evidence, not proof.** T-2 fragment review
  (2026-08-30): 12 AFR-0055 (Malawi "Northern") slivers, each touching
  AFR-0093 (Tanzania "Ruvuma") at distance 0 and 40-71 km from AFR-0055's own
  main body, were first waved through as legitimate because their dominant
  raw `game_map.json` unit was named "Nkhata Bay"/"Rumphi" — real Malawian
  districts. Wrong: those raw district polygons extend far past the visible
  coastline (same mechanism already caught for Likoma minutes earlier in the
  same session — a 198.8 km² raw "Likoma" polygon around a 21.9 km² visible
  island, there correctly owned; here the same oversized-polygon pattern
  hid a genuine misattachment), so the intersection-based "owner" lookup
  named the geographically-plausible-sounding country without the piece
  being anywhere near that country's own territory. The fix that actually
  settles it, cheap and independent of source data quality:
  `piece.distance(own_main_body)` vs `piece.distance(candidate_neighbour)` in
  km. A piece 40+ km from its own region's body but touching (0 km, no
  overlap) a specific neighbour is decisive regardless of what any raw
  source label says; only compute/trust the raw-source name check when the
  distance test is ambiguous (multiple touching neighbours, or genuinely
  near its own body). Confirm visually with a tight render at the exact
  touch point (a country-wide bbox makes a sub-km-wide sliver sub-pixel —
  `render_region.py --neighbours` only outlines neighbours, doesn't fill
  them, so thin pieces disappear entirely at that zoom; fill BOTH source and
  destination region solid with distinct colours and zoom to the specific
  coordinate before concluding anything from a picture).
- **Never dismiss residual diagnostic overlaps as "background noise" without
  checking their actual area.** 2026-07-19-k wrote off 18 remaining
  intersections as "the same background noise as always, including Lake
  Ladoga/Baikal" — without measuring them. They were 20013.8/8572.6/
  11536.4/9093.0 km² of Soviet oblast polygons sitting directly on top of
  the lakes (a `build_europe_1946.py` run had silently discarded the
  lake-clip that used to exist, same class of loss as the German zones
  above). Print the actual `.area` of each flagged intersection before
  calling anything noise — coastal-simplification slivers are sub-km²,
  a missing clip step is thousands of km².
- **Don't assume "preserve current area exactly" when a user asks to fix a
  bad boundary — ask, or check if current area is itself the bug.** First
  pass here computed a smoothing algorithm engineered to keep Dalian's
  area byte-identical to its CURRENT (2116.6 km²) value. User rejected
  this outright: the current area was already wrong (a known, previously
  logged, deferred finding — Dalian's area was ~40% short of the
  documented historical Kwantung Leased Territory). "Fix the boundary" can
  mean "keep the total the same, just make the line pretty" or "make the
  line historically correct, area be damned" — these produce very
  different algorithms. When in doubt, especially after a "known area
  discrepancy" was logged earlier in the same investigation, don't default
  to area-preservation as a silent constraint.
- **When no historical shapefile is findable, anchor a hand-built polygon
  to a few REAL, verifiable coordinates plus documented dimensions —
  don't try to algorithmically deform a dramatically-shrunk modern remnant
  back to its historical size.** The Aral Sea's 1946 shape was a
  "calibrated ellipse" placeholder (right area, ~68,000 km², wrong shape).
  What was findable: real coordinates for 2 port cities that sat directly
  on the 1946 shore (Muynak south, Aralsk northeast) and independently
  documented overall dimensions (428-435 km N-S, 234-290 km E-W across 2
  sources). Naive scaling of the modern, already-shrunk remnant produced a
  nonsense snake shape (60 years of recession wasn't spatially uniform).
  What worked: build a polygon directly from waypoints (2 real anchors +
  synthesized intermediate points matching the documented aspect ratio),
  densify with deterministic per-segment normal-offset jitter, then one
  final uniform area-correction scale from the centroid. Verify both real
  anchor points end up within ~2 km of the final boundary, and render the
  new shape against its real neighbors to confirm it sits where the actual
  feature does relative to them, not just that it "looks like" the thing
  in isolation.

**For merging/clipping geometry from a different, independently-digitized
source** (adding a new country/territory, restoring a dropped island,
resolving an overlap between two countries' independently-drawn borders,
stray MultiPolygon fragments after a `.difference()`) — see
`references/cross_source_merging.md`.

**For safely running, testing, and verifying the build pipeline itself**
(schema differences between intermediate and final files, why you can't
test one `build_*.py` step in isolation, live-server verification traps) —
see `references/build_pipeline_gotchas.md`.

## Positional-file fragility (silent, untested)

`ownership_1946.json` and `names_ru.json` are external, positionally-keyed, and
regenerated by nothing. Changing any country's output region count shifts the
numbering of everything built after it (special blocks like China/Palestine sit
near the front, so the shift is not limited to alphabetically-later countries).
No test checks displayed names or per-region owners — the symptom is wrong
names/owners on the live map, not a red test. This has now bitten Asia
(2026-07-19-c, -i, -j, `--prefix ASI-`) and Europe (2026-07-19-h and again
-i, `--prefix EUR-`) independently and repeatedly — assume it can hit any
continent, EVERY time region counts change, not just once per continent.
A test with a hardcoded `region_id` string (not read from live config) will
silently go stale on the next shift too — `test_country_entities_1946.py`'s
Gulf/Tonga test needed manual updates THREE times (2026-07-19-i, -j) before
being rewritten to match by `(name, iso_a2)` against the live
`world_1946.geojson` instead of a literal id — do that rewrite the first
time you touch a test like this, don't just patch the string again.

- **`remap_region_ids.py`'s `--old` snapshot is compared against
  `client/public/world_1946.geojson`, not the freshly-rebuilt
  `scripts/map/out/world_1946.geojson`.** If you run the build chain but
  haven't run `import_to_game.py` yet, `client/public` is still stale and
  the remap dry-run will report "0 real shifts" — not because nothing
  moved, but because it's comparing the old file to itself. Correct order:
  build chain -> `import_to_game.py` (refreshes `client/public`, will warn
  about ownerless regions using still-stale positional files — expected)
  -> remap (now sees the real shift) -> manual additions for genuinely-new
  regions -> `import_to_game.py` again -> `generate_country_registry.py`
  -> `fill_region_economy_1946.py` -> validators/tests.
- **The remap tool has no manual-disambiguation flag; when it blocks
  `--apply` on a duplicate-name pair, resolve by exact area+centroid match
  and call `apply_*_remap` directly instead of hand-editing every file.**
  Two source features can legitimately share a name (Algeria's two
  "Territoires du Sud" zones, Malawi's two "Chitipa" polygons — both
  already documented in `build_africa_1946.py` as intentionally-not-merged
  duplicates) and the tool's `(name, iso_a2)` key can't tell them apart.
  Import `remap_region_ids` as a module, call `build_remap()`, merge in a
  manually-verified `{old_id: new_id}` dict for the ambiguous pairs (verify
  the pairing with `shapely` — identical `.area` and `.centroid` between
  the old and new candidate is proof, not a guess), then call the four
  `apply_*_remap` functions yourself with the combined dict.
- **Renaming an EXISTING region (same `region_id`, no count/id shift) is
  a SEPARATE staleness trigger from the count-shift class above —
  `names_ru.json` needs the same manual patch either way.**
  `import_to_game.py` sources `name_en`/`name_ru` from `scripts/
  map/out/names_ru.json` by `region_id`, falling back to the geojson's
  `name` property ONLY when that `region_id` has no entry at all. A pure
  rename in a `build_<continent>_1946.py` (Taiwan's 2 mis-named
  geometric-merge clusters, 2026-07-22) doesn't change the region count,
  so `remap_region_ids.py` isn't needed and wasn't run — but the OLD name
  entry for that unchanged `region_id` is still sitting in `names_ru.json`
  and wins over the fresh geojson name every time. Symptom: `client/public/
  world_1946.geojson` shows the new name, but `server/data/scenarios/1946/
  names.en.json`/`names.ru.json` (and therefore the live game) still show
  the old one. Check both files, not just the geojson, after ANY rename —
  not only after a count-changing rebuild.
- **A hardcoded `region_id` in a test can go stale from someone ELSE's
  remap, in a totally unrelated area of the map, and sit broken for a
  whole session before anything runs it.** `test_country_entities_1946.py`
  had two literal `"OCE-0008"` (Norfolk Island) assertions; package A's
  Oceania rebuild (5 new regions inserted earlier in build order) shifted
  it to `OCE-0011` in the actual config, and `remap_region_ids.py --apply`
  correctly updated `country_entities_1946.json`/`occupation_overlay.json`
  — but the test's literal string wasn't part of that remap and went stale
  silently (package A's own ExecPlan claimed "12/12" — likely stated before
  the final remap, or just not re-run). Caught only because package B
  happened to run the full test suite again for an unrelated (China/
  Taiwan) change. Norfolk Island's two assertions were fixed in place this
  round (not rewritten to the by-name pattern) since they're a single
  simple `assertEqual`; a future hit on the SAME two assertions should
  trigger the by-name rewrite instead of a third string patch.

**Never run `remap_region_ids.py --apply` twice against the same `--old`
snapshot after an intermediate edit.** The tool diffs "snapshot" vs
"current world" — it doesn't know the positional files were already
partially remapped by an earlier run. Sequence that broke (2026-07-19-j):
build with change A → `remap --apply` (files now hold post-A ids) → make
code fix B → rebuild → `remap --apply` AGAIN with the SAME original
snapshot → the tool's remap dict is keyed by pre-A ids, so post-A ids it
find in the files don't match anything and get dropped as "unresolved",
silently deleting ~20 already-correct entries (Kashmir, Spratly, Yemen
provinces, etc.) that had nothing to do with change B. Recovery: `git
checkout --` the 4 positional files back to the last clean commit, then run
`remap --apply` exactly ONCE against the FINAL state (after every geometry/
code edit is done). Batch all edits before remapping; don't remap after
each intermediate step.

**When a positional shift is composite/non-uniform (not a clean "+N from
here on"), match by CONTENT instead of computing an offset.** Substituting
an external snapshot as a new base file (see `cross_source_merging.md`'s
D:\MAP entries) can shift `ownership_1946.json`/`names_ru.json` by a
DIFFERENT amount in different sub-ranges of the same continent, because the
snapshot's own internal feature order doesn't match this tree's — a
"shift every id ≥ N by -1" fix (the obvious first attempt, mirroring
`remap_region_ids.py`'s single-offset model) silently only fixes the FIRST
sub-range and leaves everything after the second break point still wrong
(2026-07-29: fixed NAM-0055..0093, left NAM-0094..0267 broken, discovered
only by re-verifying after the "fix" instead of trusting it). Diagnosing
the exact composite offset pattern is unnecessary work — instead, build a
`name_en -> value` map from ALL existing (even mis-positioned) entries in
the stale file, then for every region_id in the CURRENT world file, look up
its `name` in that map and write the value at the CURRENT (correct)
position. This is immune to however many breakpoints the shift has, because
it never computes an offset at all — it only requires that content (a
name, an owner code) survives somewhere in the stale file under SOME wrong
key, which is true for any pure reordering (nothing added or removed, just
moved). Verify 0 remaining mismatches by re-comparing `name_en` (or
`owner`) against the live world file afterward — don't trust the fix
without this, exactly like the shift-based attempt above wasn't caught
until re-verified.

**Majority-vote across a small bucket can be fooled by the SAME corruption
it's trying to detect — needs an independent ground truth, not internal
consensus.** Repairing `ownership_1946.json` after a large positional shift,
grouping entries by `iso_a2` and trusting whichever `owner` value appears
most often in each bucket "fixed" 2 small Caribbean buckets (Saint Kitts,
Trinidad — 2 entries each) by making BOTH entries agree on a value that was
WRONG for both of them (the shift had corrupted every entry in those small
buckets identically, so "majority" just confirmed the shared error and
overwrote the one entry that had coincidentally still been correct). Caught
by cross-checking against a source truly independent of the file being
repaired: `iso_a2 -> iso3` derived directly from `game_map.json`'s raw
`adm0_a3`/`sov_a3` fields (with explicit, already-decided overrides for
this game's deliberate 1946 anachronisms — Baltic/Belarus/Ukraine/Caucasus/
Central Asian SSRs read `SUN` not their modern code, Yugoslav/Czechoslovak
successor states read `YUG`/`CSK`, undivided Korea reads `KOR`, Taiwan
reads `CHN`, and this game's convention of small dependent territories
getting their OWN iso3 rather than the administering power's — Aruba=ABW
not NLD, confirmed already-correct examples before trusting the pattern for
new ones). Use majority-vote only as a candidate generator on a dataset you
don't already suspect is corrupted; once corruption is suspected, the
final check needs a source the corruption couldn't have touched.

**A third sibling, same disease, different location:**
`economy_1946/capital_overrides.py::CAPITAL_REGION_OVERRIDES` is a hardcoded
Python dict of `country_code -> numeric region id` (NOT a `region_id` string
like `"NAM-0055"` — a plain int, `regions.core.json`'s own sequential
`id` field, assigned by `import_to_game.py` from feature order) — every
later region-count change ANYWHERE in the world earlier in build order
drifts it. **This got fully resynced 2026-07-29** (26/55 entries had drifted
+22..+25 from that session's own Oceania/Philippines/Panama work) using a
protocol already built into the same file: `CAPITAL_REGION_ANCHOR_NAMES`
pairs each code with the expected English name of the region currently at
that id (added 2026-07-26, checked by `validate_region_economy_1946.py`
every run). To resync: for each `(code, id)` whose current name ≠ the
anchor name, search `names.en.json` for a region whose name EXACTLY matches
the anchor (filtering by `ownerCountryId == code` when the anchor name is
ambiguous across countries, e.g. "Northern"/"Eastern" appear in several
African countries) — a unique match is the corrected id. Do this any time
the violation count balloons past its prior baseline, not just once —
it's cheap (pure lookup, no geometry) and the anchor-name table makes it
mechanical, not a research task each time.

After any region-count change run `scripts/map/build/remap_region_ids.py
--old <pre-edit world snapshot> --prefix <XXX-> --apply` (a snapshot of the
very first commit works fine as `--old` if nothing has remapped that
continent since — check `git log --oneline -- scripts/map/out/names_ru.json`
first), then re-add genuinely-new regions (0-candidate/"unresolved" in the
tool's dry-run output) to `names_ru.json`/`ownership_1946.json` by hand —
the tool only carries forward matches for entities that already existed.

**Bug found in the tool itself (2026-07-19-h, fixed):** `apply_overlay_remap`
used to leave an unresolved old key untouched instead of dropping it — if a
region disappeared (e.g. old Berlin sectors / Kiel Canal Zone folded into
unified Berlin), its stale `occupation_overlay.json` entry survived under its
old numeric-suffixed id, which the NEW build may have reassigned to a
completely unrelated region (an orphaned `"EUR-0366": "QGB"` from a vanished
Kiel Canal Zone silently landed on Vatican). All four `apply_*` remap
functions must drop unresolved keys, not just ownership/names_ru.

New water bodies have a matching trap: `import_to_game`'s neighbour filter must
decide land-vs-water from the **world file's** `region_type`, not from
`names_ru.json` (a lake missing there defaults to "land" and leaks a dangling
neighbour id — validate: "region N: сосед M не существует").

## Verification recipe

1. **Rebuild** the affected chain (`build_<continent>_1946.py` → any post gap
   step → `build_oceania` if water changed → `merge_world_1946.py` →
   `build_neighbor_graph.py` → `translate_world.py` → `import_to_game.py` →
   `generate_country_registry.py` → `fill_region_economy_1946.py`), or
   `python scripts/map/make_1946.py --rebuild-master` for a full pass.
   Since 2026-07-30 the plain `make_1946.py` does NOT rebuild geometry — it
   reads the frozen `scripts/map/master/world_1946.master.geojson`. Editing
   geometry means rebuilding the master (`--rebuild-master`, needs
   `sources/` + `PAXMAP_SOURCES` in a linked worktree) and committing the
   new master file; otherwise your change reaches nothing.
2. **Numeric pairwise scan** for every edited country pair + water: for A,B print
   `A.buffer(0.01)∩B.buffer(0.01) − A − B − water` (residual gap) and
   `A∩B` (overlap). Overlaps must be 0; gaps at real disputed tripoints may leave
   a µ-residual 2-3 orders below anything visible — note it, don't chase it.
3. **Diagnostic polygonize** of the final file: 0 absorbable inter-land cells
   (only coastal strips + pure-water slivers remain, by design).
3b. **Acceptance audit — the gate, not an option:** `python scripts/map/
   build/audit_map_geometry.py` (12 classes: `INFLATED`, `ORPHAN_FOREIGN`,
   `ORPHAN_UNSOURCED`, `WATER_SHATTERED`, `SPIKE`, `SCATTERED`,
   `MISSING_LAND`, `COASTLINE_GAP`, `SEA_HOLE`, `UNION_HOLE`,
   `COVERAGE_INVALID`, `FALSE_COAST`). Any finding outside
   `config/geometry_audit_baseline.json` exits non-zero; it runs inside
   `make_1946.py` before `import_to_game.py`. `diagnose_missing_land.py` and
   `diagnose_scattered_regions.py` no longer exist — their logic is inside
   the audit. Update the baseline only with `--update-baseline` plus a dated
   `docs/DECISIONS.md` entry, never silently.
   Three classes answer three DIFFERENT questions and none substitutes for
   another: `UNION_HOLE` = "is there a hole in the map" (no shape
   thresholds, unlike `COASTLINE_GAP`), `COVERAGE_INVALID` = "does GEOS
   consider neighbour edges matched", `FALSE_COAST` = "will the CLIENT draw
   a coastline inside land". The last one exists because a geometrically
   valid coverage still fails in the client: `TopologyBuilder.ts` compares
   segments by endpoints rounded to 1e-5, so one extra vertex on a
   neighbour's edge splits the keys and paints `coastline-solid` (2.5px) +
   glow (4px) through a continent. Measured on the pre-weld snapshot: 5217
   such segments, longest 148 km.
3c. **Sea/lake hole scan**, a different class 3b can't see (no ADM1 record
   required to be a real gap): `python scripts/map/build/diagnose_sea_
   holes.py` — finds interior-ring holes in sea/lake polygons with no
   (or only partial) covering land. Splits results into matched-to-raw-
   source (safe to auto-fill via `fill_sea_holes.py`, merge the hole
   geometry — not the raw feature's — into the nearest same-`iso_a2`
   output feature) vs unmatched (needs a per-case owner decision before
   any land is synthesized).
3d. **Coastline gap scan**, world-wide and read-only: `python scripts/map/
   build/diagnose_coastline_gaps.py` (`--scan` for numbers, `--render
   MINX MINY MAXX MAXY` for a specific area) — classifies uncovered cells
   into COASTLINE (touches water, a real berth gap), LAND_HOLE (compact,
   inland, a different defect class), and LAND_SEAM (elongated, inland —
   almost always admin-border digitizing noise, reported as a count only).
4. **Per-seam renders** (matplotlib → PNG → Read tool), yellow/beige background so
   any void is loud. Label placement must skip collisions (largest-area first) or
   dense clusters are illegible — that itself was a complaint.
4b. **Shots of the REAL client** when the question is "what does the user
   see" (line/seam/colour complaints), because matplotlib does not reproduce
   `coastline-glow`/`internal-borders`/opacity stacking. Recipe that worked
   2026-07-30 after the Browser pane again refused to composite frames
   ("pane is not displayed"):
   - `npm install` inside the worktree's `client/` and `server/` (a linked
     worktree has no `node_modules`, and Node's upward resolution does not
     reach the main checkout's `client/node_modules`) — seconds on a warm
     cache;
   - start `npx tsx src/index.ts` (server, `PORT=3000`) and `npx vite --port
     <free> --strictPort` (client) as background tasks; the client proxies to
     3000, so the pair must match the same worktree or region ids diverge;
   - drive it with Playwright: scenario → country → "Начать игру", then use
     `window.map` (MapView already exposes it) for exact framing:
     `m.jumpTo({center, zoom})` + `await new Promise(r => m.once('idle', r))`
     before each `page.screenshot`. Do NOT add your own debug hook — check
     for an existing one first.
   - hide the HUD before shooting (walk up from `canvas`, `display:none` on
     each sibling, then `map.resize()`), else a third of the frame is panels;
   - for a before/after pair, swap ONLY the data with `git checkout <ref> --
     client/public/world_1946.geojson server/data/scenarios/1946/`, restart
     the server, shoot, then `git checkout HEAD -- …` back. Comparing against
     the main checkout instead is a trap: `main` may carry other agents' newer
     systems (its client crashed on missing campaign data on 2026-07-30) and
     its region ids differ, so colours/owners would not line up.
5. **Pipeline gates:** `test_country_entities_1946.py`,
   `validate_region_economy_1946.py` (expect only the known deferred
   `capitalRegionId` fails — a *new* fail count is a regression),
   `test_validate_region_economy_1946.py`, `server` + `client` `tsc --noEmit`,
   `server` vitest.
6. **Live check:** `curl -X POST localhost:3000/game/start` with a `playerCountryId`
   → confirm country count and per-owner region counts; spot-check `names.ru.json`
   for the edited regions (names must not have shifted). **Before trusting the
   result, verify you're actually hitting a fresh process**: `netstat -ano |
   grep :3000` and confirm the PID matches the server you just started. In Git
   Bash on Windows, `ps aux` shows wrapper PIDs, not the real Windows PID —
   `kill`/`taskkill` by the wrong number leaves an old server (loaded before
   your edits) answering the port, giving a plausible-looking but stale
   response (2026-07-19-i: a zombie from hours earlier in the same session
   served a response missing the region just added, with a stale total
   count — looked like a real bug until `netstat` found the real PID).

## Canonical references

- `scripts/map/README.md` — the numbered checklist (items 1-14) this skill enforces.
- `scripts/map/AGENTS.md` — geometry-source search rules (search before
  concluding absence; region-count decisions belong to the user).
- `.agents/skills/find-existing-solutions/SKILL.md` — the mandatory search
  protocol before any "doesn't exist" conclusion or external-source reach.
- `scripts/map/build/geometry_cleanup.py` — the gap-first implementation + docstrings.
- `scripts/map/build/remap_region_ids.py` — the positional-fragility remap tool.
- `scripts/map/build/diagnose_coastline_gaps.py` — permanent world-wide
  coastline/land-hole gap scanner + bbox render tool (read-only).
- `scripts/map/build/audit_map_geometry.py` — the 12-class acceptance gate
  and its baseline; read a class's docstring before trusting or changing it.
- `scripts/map/build/freeze_master_map.py` — refuses to freeze a torn map
  (0 holes + valid coverage are preconditions, not aspirations).
- `references/absorb_slivers_internals.md` — `absorb_slivers` gates/thresholds/classifier pitfalls.
- `references/cross_source_merging.md` — merging/clipping geometry from independently-digitized sources.
- `references/build_pipeline_gotchas.md` — running/testing/verifying the build pipeline safely.
