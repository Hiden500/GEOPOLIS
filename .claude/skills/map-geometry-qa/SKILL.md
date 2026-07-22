---
name: map-geometry-qa
description: Verify 1946-map geometry after any cut/merge/border edit — close gaps with gap-first absorb_slivers (never buffers), check every seam numerically AND by per-region render, and protect deliberate water holes. Use whenever scripts/map geometry, borders, region counts, or lakes/seas change.
---

# Map Geometry QA

Hard-won checklist for editing `scripts/map` geometry. Every rule here is a bug
that already shipped on this repo (`docs/DECISIONS.md`, entries 2026-07-19-a…q,
2026-07-20, 2026-07-22). Do not re-open the same graves.

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
- **Adding a feature from a foreign source: clip against ALL adjacent countries,
  not one.** Golan clipped against raw Jordan but not raw Lebanon left a Shebaa/
  Hermon overlap that absorb (a gap tool) can't fix.
- **A cell touching only 1 land feature is still a real gap, even if it also
  touches water.** `absorb_slivers` used to skip these ("coastal mismatch,
  masked by background") — wrong (2026-07-19-g): the map background is darker
  than the sea fill, so the gap shows background, not sea, and is visible. Land
  is authoritative for identity; water is just backdrop. The only guard left is
  area (`MAX_COMPACT_AREA`/ribbon exception) so a whole sea/lake still isn't
  swallowed.
- **Before concluding "territory X is missing from the source" and bridging/
  grafting a fix — search the dataset by MORE than the country's own
  `iso_a2`.** The entire Kyrenia saga (2026-07-19-g) was built on a false
  premise: checking only `iso_a2 == "CY"` found 5 districts and "no Kyrenia",
  so a bridge to an external geoBoundaries source was built (see below, now
  removed). The real answer was in the SAME file the whole time, as a
  `iso_a2 == "-1"` feature (`"Northern Cyprus"`, `sov_a3 == "CYN"` — the same
  non-country tag already used for Kashmir/Spratly) that fits the existing
  5 districts with distance=0.0, overlap=0.0 (2026-07-19-i). Mandatory now:
  run the `find-existing-solutions` skill's search protocol (multi-key,
  including `iso_a2 == "-1"` and name/bbox search) before any "doesn't exist"
  conclusion about `game_map.json`. Full rule in `scripts/map/AGENTS.md`.
  **A gap already "covered" by a coarser neighbouring water polygon won't be
  touched by gap-first** (by design — it doesn't override real water), even
  when the two land masses ARE meant to be contiguous. If, after the search
  above, a genuine gap remains, bridge explicitly:
  `LineString([p1, p2]).buffer(gap/2 + 0.002, cap_style=2, join_style=2)`
  (flat caps, mitre joins — no round "pimples"), never `convex_hull` (measured
  ~0.18 deg² of spurious area on one real case). But verify the "gap" isn't
  actually a third feature you haven't loaded yet — `fix_cyprus_famagusta_gap`
  (2026-07-19-g) bridged Famagusta to Larnaca over what turned out to be 100+
  km² of real Northern Cyprus territory once that feature was added
  (2026-07-19-i) — the bridge was deleted, not the false gap.
- **A cross-source overlap between two land features you're both adding is a
  real, fixable defect, not backdrop noise.** UNDOF (Natural Earth, kept as a
  literal anachronism) and Golan (geoBoundaries ISR, purpose-built historical
  boundary) independently digitized overlapping ground — 42.6 km², ~16% of
  UNDOF (2026-07-19-i). Treat the purpose-built historical polygon as
  authoritative and clip the raw/generic source against it before merging.
- **Git LFS on raw GitHub URLs silently returns the pointer stub, not the file.**
  `raw.githubusercontent.com/<repo>/<commit>/<path>` for an LFS-tracked file
  gives you a ~130-byte text pointer (`version https://git-lfs.github.com/...`),
  not the actual content — no error, so it's easy to miss. Use
  `media.githubusercontent.com/media/<repo>/<commit>/<path>` instead.
- **A plain `A.difference(B)` between two independently-digitized boundaries
  can leave several small disconnected fragments of A stuck to B's edge, not
  one clean line.** HaZafon minus Golan (2026-07-19-j) left 4 fragments
  (22.8 km² total) that rendered as duplicate labels scattered across Golan —
  all 4 touched Golan at distance=0 but were 0.02-0.1° from HaZafon's own main
  body. Fix: after any `.difference()` between two features from different
  sources, check `geom_type == "MultiPolygon"`; if so, keep only the largest
  part for the feature being clipped and merge the stray parts into whichever
  neighbour they actually touch (same move as the UNDOF/Golan overlap above,
  just triggered by a subtraction instead of an addition). This bit twice in
  one session (HaZafon→Golan, then a PSE-Jerusalem union leaving 5 stray
  slivers → merged into Bethlehem) — check for it after every clip/union
  involving two differently-sourced polygons, not just once.
- **Merging a governorate/ADM2 polygon from a NEW source into an EXISTING
  same-name region can still leave real gaps if you skip a piece for naming
  reasons.** Splitting West Bank into geoBoundaries PSE governorates
  (2026-07-19-j), the PSE "Jerusalem" governorate was excluded outright (to
  avoid a duplicate-named region — the raw "Jerusalem" already existed) —
  but PSE's Jerusalem covered 282.6 km² the existing region didn't, leaving a
  real hole between Ramallah/Bethlehem/Jericho visible on render. Right move:
  don't just skip the excluded piece — union the excluded piece's full
  geometry into the region you kept the name from, then re-check for the
  MultiPolygon-fragment pattern above.
- **Adding new land next to existing water: the water file doesn't clip
  itself.** `out/seas_1946.geojson`/`lakes_1946.geojson` are hand-maintained
  static inputs, same as `ownership_1946.json` — no build step subtracts new
  land from them. Northern Cyprus/Dhekelia (2026-07-19-j) sat almost entirely
  inside the Mediterranean polygon until this was done explicitly
  (2026-07-19-k, user: "вырезать новые территории Кипра из моря") — same
  move as `clip_against_dead_sea`, just in the opposite direction (clip
  water by new land, not land by water). Do this in the same build step that
  adds the new land, not as an afterthought.
- **A water-clip gap can be a bug that was NEVER fixed on this continent,
  not just a regression on this one.** Africa's Lake Victoria/Tanganyika
  sat inside Tabora/Uganda/Katanga/Maniema/Rift Valley/Muchinga/Burundi
  from the day `out/lakes_1946.geojson` first gained those lake features —
  `build_africa_1946.py` never had a clip step for them at all (unlike
  Europe's Dead Sea/Sea of Galilee, which did). Don't assume every missing
  water-clip is "this session broke it" (2026-07-19-l) — check whether the
  continent's build script ever had the step in the first place.
- **A docstring and the code below it can silently disagree — trust
  neither without checking the raw source data.** `build_africa_1946.py`'s
  header docstring claimed "Uganda - exactly 4 British provinces 1946" and
  `game_map.json`'s 112 raw Uganda districts do carry exactly that `region`
  field (Central/Eastern/Northern/Western) — but `SINGLE_COUNTRY` collapsed
  it to 1 region anyway, ignoring the field the docstring described
  (2026-07-19-m). When a comment describes a mechanism that isn't what the
  code actually does, check the raw source fields directly rather than
  trusting either the comment or your assumption about "how it's probably
  handled".
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
- **When inverting `absorb_slivers` to grow WATER instead of land (mutable =
  sea, context = land), the "skip large compact cells" safety net becomes
  actively harmful, not just conservative.** That guard exists to protect
  real inland lake-holes when mutable is LAND — it has no equivalent
  meaning when mutable is a sea, since every real water body is already
  passed in as `water_geoms`. Skipping it left visible white gaps between
  islands in fragmented archipelagos (Alaska Panhandle/British Columbia,
  2026-07-19-n) — 11603 km2 closed by the standard pass, another 23947 km2
  needed a second, uncapped pass over the same cell set. Write the
  compactness-check-free version as its own function; don't just raise the
  area threshold on the shared one (land-absorption still needs it).
- **A "snapshot taken once at the start" for `water_geoms`/`context_geoms`
  goes stale the moment ANY of those same features get mutated later in
  the same run.** Fixing coastline gaps sea-by-sea in one script, each sea
  read every OTHER sea's geometry from a list built before the loop
  started — sea B, processed after sea A had already grown, saw A's OLD
  shape and could claim the same contested cell independently. Result:
  433 sea-vs-sea overlaps (`merge_world_1946.py`'s own diagnostic caught
  it) where baseline was ~6. Read mutated neighbors LIVE (`shape(other_ft
  ["geometry"])`) inside the loop, never from a list frozen before it.
- **Even with live reads, independent per-feature passes don't guarantee a
  partition — add one deterministic finalize pass.** Growing N mutable
  features one at a time, each only checking its own immediate neighbors,
  can still leave the group non-disjoint at the far end of a long
  processing order. After the main loop: walk the list once, clip each
  feature against the union of all previously-finalized ones (list order
  = priority) — cheap, deterministic, and guarantees zero overlaps within
  the group regardless of how the main loop got there.
- **`client/public/world_1946.geojson` and `scripts/map/out/world_
  1946.geojson` use DIFFERENT property schemas — a filter that works on
  one silently returns nothing on the other.** The `out/` file (straight
  from `merge_world_1946.py`) has explicit `region_type: "land"/"sea"/
  "lake"`. The `client/public/` file (after `import_to_game.py`) has
  `type: "region"` and `continent`, with NO `region_type` key at all.
  A land/water filter keyed on `region_type` against the client file
  returns an empty list — `STRtree` built from it finds zero candidates
  for every query, and every downstream `.difference()` becomes a silent
  no-op. If you need `region_type`, read the `out/` file, even if you
  need it for something scoped to the same land the client file also has
  (2026-07-19-n: a "clip water against current land" step returned 0
  candidates for every one of 113 seas before this was caught).
- **Computing a "local" clip_box from `.bounds()` of a multi-part geometry
  breaks silently at the antimeridian.** A sea/feature whose parts sit on
  both sides of the dateline (Bering/Chukchi Sea, Pacific "sector"
  polygons) has `.bounds() == (-180, ..., 180, ...)` for the WHOLE
  MultiPolygon — a "local" clip_box (±0.5°) built from that is nearly the
  entire globe in longitude. A gap-fill pass then treats anything within
  that box as fair game — Bering Sea absorbed fragments near Norway,
  Iceland, Greenland, and Finland because they all fell inside its
  "local" bbox (2026-07-19-o, user: "Берингово море разбросано по
  нескольким побережьям"). Fix: compute clip_box PER PART (`geom.geoms`),
  never from the whole multi-part feature's own `.bounds()`. A genuinely
  single-part feature that legitimately spans all longitudes (Southern
  Ocean, a ring around Antarctica) still gets a large box correctly —
  that's not a bug for that one case.
- **Cleaning up already-scattered fragments by cluster TOTAL AREA isn't
  enough — use an anchor.** Grouping a MultiPolygon's parts by proximity
  and keeping clusters above an area threshold looks reasonable, but nearby
  garbage fragments (many small pieces wrongly absorbed near the SAME
  wrong coastline, e.g. Greenland) cluster with each other and can still
  clear a total-area bar even though none of them is legitimate. Require
  the cluster to contain at least one part above an "anchor" threshold
  (something on the order of the feature's real trunk body, order of
  magnitude larger than any stray fragment) — a swarm of small pieces with
  no anchor gets dropped regardless of its summed area.
- **`unary_union`/`buffer(0)`/`.intersection()` can silently degrade a
  Polygon/MultiPolygon into a `GeometryCollection` with zero-area
  `LineString`/`Point` artifacts mixed in.** Found on White Sea: a prior
  buggy union left a `GeometryCollection` of 12 degenerate `LineString`s
  plus 1 real `Polygon`. Downstream code that assumes Polygon/MultiPolygon
  (`.boundary`, `cell.boundary.intersection(g.boundary)`) can silently
  return `None` instead of raising anything useful, then crash on the next
  attribute access. Write a `to_polygonal()` helper that filters a
  `GeometryCollection` down to its Polygon/MultiPolygon members, and apply
  it after every union AND after every `.intersection(clip_box)` call
  (tangent intersections can produce the same degenerate mix) — not just
  at the one place you first saw it break.
- **Adding a genuinely new/previously-missing land feature still needs the
  same "water doesn't know about new land" and "economy heuristics assume
  typical shape" treatment as any other new territory.** The Faroe Islands
  existed whole as a single untouched `game_map.json` feature but were
  never in any country list in `build_europe_1946.py` — silently dropped
  since the file was written, not a regression. Fixing "missing land"
  still triggers: (1) `clip_seas_against_land` for whatever sea used to
  cover that spot as open water: (2) a re-check of any generic per-country
  economy heuristic that assumes "smallest region by area = capital/city"
  (`economy_1946/density_tiers.py::generic_tier`) — a small OFFSHORE
  territory newly added to a country's region list can trip that heuristic
  and get a wildly wrong population (Faroe Islands got 1.2M instead of the
  real ~23-30K until an explicit per-country tier classifier was added).
- **When the user says a fix should stop reshaping ALREADY-CURATED land to
  match a newly-glued authoritative source, don't clip the new source back
  to match the old — leave the resulting land/sea mismatch as a known,
  documented, deferred gap.** An early version of the sea-gluing finalize
  step clipped the freshly-glued sea by the CURRENT curated land layer to
  eliminate overlaps — this directly undid the point of using the raw
  source as ground truth wherever curated land (Gaza/West Bank
  geoBoundaries, restored German zones, US county-cluster splits) diverges
  from it. The user's explicit call: the raw-glued water is right now; the
  mismatched land gets trimmed in a LATER, separate pass. Removing an
  "obviously helpful" clip because it fights the stated intent is
  sometimes the correct fix, not a regression.
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
- **Adding a country to `SINGLE_REGION` in `build_europe_1946.py` needs a
  matching `translate_world.py::TRANSLATE` entry, every time.** The dict
  VALUE is used directly as the feature's output name and is conventionally
  Russian (`"AD": "Андорра"`) — `translate_world.py` has a reverse lookup
  table that turns that exact string into the English name before it
  reaches `world_1946.geojson`. Forgetting the entry doesn't error, it just
  leaves the Russian string in the English `name` field (caught by
  `translate_world.py`'s own "Не переведено" count, not by any test) —
  happened twice in a row (Faroe Islands, then Malta) right after adding
  each to `SINGLE_REGION`. Add both in the same edit.
- **An "is this cluster legitimate" check applied to the WHOLE cluster lets
  pure numerical noise hide behind one real neighbor.** After fixing the
  antimeridian bug, a self-check claimed "0 orphan fragments" across all
  113 seas — wrong. Dozens of MultiPolygon parts at 1e-18..1e-6 deg2 (raw
  floating-point residue from repeated `union`/`intersection`/`buffer(0)`
  over several script runs, not geography at all) survived because the
  proximity-cluster+anchor check evaluated legitimacy per CLUSTER: a
  noise speck sitting within 2° of one real small island inherited that
  island's legitimacy for the whole cluster it was grouped into, even
  though the speck itself was garbage. Fix: filter individual parts below
  an absolute epsilon (something on the order of 1e-4 deg2, i.e. a
  fraction of a km2 — real coastal features at this map's resolution
  don't get smaller than that) BEFORE any clustering/anchor logic runs,
  not as part of the same per-cluster legitimacy check. Verify the choice
  by histogramming every remaining part's area across the whole dataset —
  a real epsilon sits at a clean gap between "clearly noise" and "clearly
  a small real feature", not in the middle of a smooth distribution.
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
- **NEVER run a single `build_*.py` step "just to test it" if its output is
  a gitignored `out/*.geojson`.** These files are NOT reproducible from
  scratch by one script — they accumulate the result of a whole chain
  (`build_namerica_1946.py` → `build_us_states_split_1946.py` → `fill_us_
  border_gaps.py`, 51 states → 112 county clusters) PLUS at least one
  enrichment no script reproduces at all (Panama Canal Zone, `git log
  -S"Panama Canal Zone"` only hits the original `146933a` import — same
  class of loss as the German occupation zones AND the Lake Ladoga/Baikal
  clip in 2026-07-19-l, both destroyed by this session's own first
  `build_europe_1946.py` run, not by anything "historical"). Running
  `build_namerica_1946.py` alone to check pyshp availability (2026-07-19-k)
  silently regenerated it from `game_map.json` from scratch, discarding 62
  regions (268→206) that no later step could rebuild. If you must confirm a
  script runs, check the traceback/exit code only — don't let it finish
  writing its output — or immediately diff the feature count against `git
  show <last-good-commit>:client/public/world_1946.geojson` afterward and
  restore from that commit if it shrank.
- **"This predates the session" must be checked against the LAST commit
  before the session started, not the oldest commit in the dataset's
  history.** 2026-07-19-h compared Germany's current (collapsed) state to
  the very first import commit (`146933a`) and concluded the collapse
  "is not this session" — wrong. `git show <last-commit-before-session>:
  client/public/world_1946.geojson` showed the 7 occupation zones were
  still intact at session start; they were destroyed by this session's own
  earlier `build_europe_1946.py` run. Comparing to the oldest commit only
  proves a feature existed at some point, never that today's edits didn't
  touch it. See 2026-07-19-l for the full correction.
- **A distance-based "is this fragment legitimate" threshold can't tell
  "far from its own body but rightfully so" apart from "far from its own
  body AND actually belongs to a neighbor"** — tightening `CLUSTER_DIST_DEG`
  to fix one case (Baltic Sea wrongly claiming Norway's coast) broke another
  (Ionian Sea's real Gulf of Patras gap-fill got discarded as if it were the
  same kind of noise), because BOTH look identical under "distance to own
  trunk". Tried replacing the absolute threshold with a relative one
  ("closer to own sea than to the nearest OTHER registered sea") — also
  failed, because the distance to a genuinely adjacent neighbor sea is
  normally ≈0 (two seas sharing a strait/coastline touch by construction,
  that's not a defect signal). Neither distance metric is the right lever;
  see the next bullet for the actual fix (2026-07-20).
- **The real bug wasn't the post-hoc cleanup — it was processing 113 seas
  ONE AT A TIME with every other sea frozen as "authoritative context".**
  When a genuinely-uncovered land-touching cell falls inside the buffered
  clip_box of MULTIPLE seas (Gulf of Patras: both Ionian and Aegean;
  Norway's Skagerrak coast: both Baltic and North Sea; Bristol Channel/
  Thames Estuary/Moray Firth: both a giant Atlantic "sector" catch-all AND
  the specific named sea that should own them), whichever sea happens to
  run FIRST in list order claims it — geography never gets a vote. Fix:
  process seas in GROUPS (tiled by rough continent bbox, matching
  `diagnose_global_gaps.py`'s tiles for easy before/after comparison), and
  when several seas are mutable in the same call, give a contested cell to
  whichever one shares the LONGEST boundary with it (the same rule
  `absorb_slivers` already uses for land) — not to whichever ran first.
  Order-dependence disappears entirely; see `absorb_compact_gaps_multi()`
  in `fix_sea_coastline_gaps.py`. Confirmed working: total area absorbed
  went UP (24,100→36,560 km², cells that were previously ping-ponging
  between two claimants now resolve immediately), and the post-loop cleanup
  pass dropped from "dozens of seas losing hundreds-to-thousands of km²
  each" down to one 2.8 km² noise fragment.
- **A "global gap diagnostic" is only as trustworthy as the land layer it
  reads — mixing curated and raw land in the same check manufactures fake
  gaps.** `diagnose_global_gaps.py` used `client/public/world_1946.geojson`
  (curated, post-session land) while the actual sea-gluing fix only ever
  reads raw `game_map.json`. Wherever this session's own curation legitimately
  diverges from raw Natural Earth (US county-level splits with more detail
  than raw ADM1 — Chesapeake Bay; a county polygon that includes an entire
  strait as "land" — Washington–San Juan, whose curated bounds run to
  49.71°N while raw `game_map.json`'s Washington stops at 48.99°N), the
  diagnostic reported a "gap" or an "overlap" that has nothing to do with sea
  absorption completeness. This inflated one count 2772 gaps/6555 km² down
  to the true 316/531.9 km² once the diagnostic was pointed at the SAME raw
  land the fix script uses. Before treating a coarse gap/overlap count as a
  measure of remaining work, confirm both sides of the check use the SAME
  land source the fix itself is authoritative against — otherwise you're
  measuring known, already-accepted land-curation divergence, not the bug
  you're trying to close.
- **"Misassigned to the wrong sea" is a touching-boundary question, not a
  distance question — and it needs its own pass, separate from noise
  cleanup.** After the order-independent tile-batched fix (previous bullet),
  individual seas could still carry a stray MultiPolygon part that visibly
  belongs to a NEIGHBORING sea (Ionian Sea's Argolic Gulf fragment touching
  Aegean Sea's boundary at distance 0, not Ionian's own trunk; Andaman Sea
  slivers touching Bay of Bengal, not their own body). Distance-based
  cleanup (`cleanup_scattered_fragments`) can't fix this — the part IS close
  to something (whichever sea it wrongly touches), just not to its own
  trunk, and a 2026-07-20 attempt to use "distance to own sea vs distance to
  nearest OTHER sea" failed for the identical reason documented above
  (neighboring seas touch by construction, ≈0 distance either way). The
  actual fix is a dedicated pass BEFORE cleanup: for each non-trunk part
  that does NOT share a boundary with the rest of its own feature but DOES
  share a boundary with a different sea, move it to whichever sea it shares
  the longest boundary with (see `transfer_misassigned_parts()`). Running it
  on the full 113-sea dataset (not just the reported case) surfaced ~100
  more of the same class — spot-render a sample from different parts of the
  world, not just the two the user pointed at, and confirm the pass
  converges to 0 transfers on a second call before trusting it.
- **A `python -c` sanity check that imports the module and inspects the
  in-memory value proves the read path AND the string literal are correct —
  it does NOT prove the persisted file is correct, because a PRIOR buggy run
  may have already baked the corruption into that file.** Fixing a missing
  `encoding="utf-8"` in a script's `open()` calls (2026-07-22, `build_us_
  states_split_1946.py` read `namerica_1946.geojson` and a counties source
  without it — on a machine whose default text encoding is not UTF-8, this
  silently decoded already-correct UTF-8 bytes as the wrong codepage, then
  wrote the now-corrupted in-memory strings back out as technically-valid
  UTF-8) is necessary but not sufficient if the script already ran once
  before the fix: the on-disk file it reads is now full of mojibake that
  round-trips as valid UTF-8 forever after, since the corruption happened at
  DECODE time, not encode time. Re-running the fixed script against that
  same corrupted file just re-reads the mojibake correctly — it doesn't
  un-mojibake it. The fix is to regenerate the upstream file FROM SCRATCH
  (the earlier build step that isn't touched by the encoding bug) and only
  then re-run the fixed script against clean input. Diagnostic for "is this
  mojibake or real Cyrillic/error": `bad_string.encode('cp1251').decode
  ('utf-8')` — if that round-trip produces readable text, it's UTF-8 bytes
  that got decoded as CP1251 somewhere upstream, not a translation gap.
- **A `build_*.py` step that crashes on a missing external source (before
  writing any output) is safe to skip — its existing `out/*.geojson` stays
  whatever it was before the run, and downstream steps that read it are
  unaffected.** Two FULL_REBUILD_STEPS entries (`build_china_1946_v2.py`,
  `build_brazil_1946.py`) failed on missing external shapefiles/geoBoundaries
  files this session; both raised the exception at `open()`, before any
  `json.dump`, so their pre-existing outputs (dated weeks before this
  session, confirmed via file mtime) were untouched and downstream steps
  (`build_asia_1946.py`, `build_southamerica_1946.py`) consumed them exactly
  as before — not a regression, nothing to fix, unless that specific
  country/continent is actually in scope for the current task. Contrast with
  a step whose FIX requires the missing source (`build_us_states_split_
  1946.py` needed `geoBoundaries-USA-ADM2.geojson` to produce the 112-region
  county split this session's own earlier work — and this task — depended
  on): there, downloading the file (with the user's explicit go-ahead,
  matching the already-pinned geoBoundaries commit `9469f09` used by ISR/
  PSE/CYP, via `media.githubusercontent.com` not `raw.` — same Git-LFS trap
  documented for CYP-ADM1) was the correct call, not skipping the step.

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

**A third sibling, same disease, different location:** `generate_country_
registry.py::CAPITAL_REGION_OVERRIDES` is a hardcoded Python dict of
`region_id -> number`, baked in at whatever numbering existed when it was
written (commit `6c1cf56`) — every later region-count change anywhere in the
world drifts it too. This is the `capitalRegionId` violation category that
`validate_region_economy_1946.py` already reports every run (~31-33 entries,
count drifts slightly with every region-count change) — **already known,
already deferred by the user to a single dedicated pass once the whole map is
done. Do not try to fix all of them as a side effect of an unrelated geometry
change** — confirm the count is in the same ballpark as before your change
(not exploding) and move on.

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
   `python scripts/map/make_1946.py --full-rebuild` for a full pass.
2. **Numeric pairwise scan** for every edited country pair + water: for A,B print
   `A.buffer(0.01)∩B.buffer(0.01) − A − B − water` (residual gap) and
   `A∩B` (overlap). Overlaps must be 0; gaps at real disputed tripoints may leave
   a µ-residual 2-3 orders below anything visible — note it, don't chase it.
3. **Diagnostic polygonize** of the final file: 0 absorbable inter-land cells
   (only coastal strips + pure-water slivers remain, by design).
4. **Per-seam renders** (matplotlib → PNG → Read tool), yellow/beige background so
   any void is loud. Label placement must skip collisions (largest-area first) or
   dense clusters are illegible — that itself was a complaint.
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
- `docs/DECISIONS.md` 2026-07-19-a…k — the full incident history behind each rule.
