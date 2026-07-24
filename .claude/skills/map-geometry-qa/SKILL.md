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
- **Whole small territories drop silently during country-filtered builds — a
  raw-vs-output land-coverage diagnostic catches them; a manual world scan
  never will.** Akrotiri (adm0_a3=WSB) was never in the map at all; Maldives
  (21 raw features), Isle of Man, Jersey, the French Caribbean islets, and
  the Australian/French sub-Antarctic islands are all missing land that
  renders as background. `scripts/map/build/diagnose_missing_land.py` (2026-
  07-22, standalone, NOT a pipeline step) compares raw `game_map.json`
  against the output by coverage in three layers: whole countries (iso in raw
  absent from output — with a coverage check that separates genuine drops
  from folded/retagged territories like Israel at 99%), disputed iso="-1" by
  name (where Akrotiri hid), and per-feature uncovered points (flagging
  lake-adjacent false positives with [LAKE]). Run it after any build that
  changes country/region membership; it is scenario-agnostic (paths default
  to 1946 but are overridable). It is the answer to "I can't check every
  scrap by hand."
- **A land feature whose representative point falls inside a carved lake is
  usually NOT eaten — its district polygon just includes lake water, and only
  the water was clipped.** After adding Lake Malawi, the diagnostic flagged
  Likoma (a Malawian island district) as "missing" because its rep point
  landed in the lake. But the district polygon is 198.8 km² (a Malawian
  exclave whose administrative boundary extends into Mozambican lake waters);
  the actual island (21.9 km²) survived because `ne_10m_lakes` carries an
  interior hole for it, and `land.difference(lake)` kept the hole's land. The
  before-state was WORSE (198 km² of "land" jutting into the lake). Verify a
  suspected lake-eaten island by comparing its before/after *land-area
  coverage*, not its rep-point coverage — and check whether the NE lake
  polygon has a hole there before assuming the island was destroyed.
- **Scattered small islands are a game-design "archipelago", not a geometry
  bug — merge them, don't over-detail them.** The user's rule (2026-07-22):
  islands with ≈0 political weight get consolidated into ONE polygon region
  (they won't be governed separately — unnecessary depth), but they must
  EXIST because the navy needs them (bases, fleet range). Reusable mechanism
  already in the tree: `ARCHIPELAGO_BUFFER_DEG=3.0` + `reduce_clusters` in
  `build_oceania_1946.py` union a country's scattered islands into one
  MultiPolygon WITHOUT flooding the water between them (the buffer only tests
  adjacency for the union, it doesn't add sea-as-land). A region that is a
  disconnected mainland+islands blob (Philippines MIMAROPA: 24 parts, 340 km
  span) is the same class — the islands want separating from the mainland
  part into their own archipelago region.
- **China gaps are a distinct, self-inflicted class: `host.difference(city.
  buffer(δ))` leaves a δ-wide no-man's ring around every carved-out special
  municipality.** `build_china_1946_v2.py` cuts each special city as `city =
  district ∩ host_province`, then removes it from the host via
  `host.difference(city.buffer(0.001))`. Because the city was already clipped
  to the host but the subtraction inflates it by 0.001° (~95 m), a ~95 m
  ring around each of the 6 municipalities (Nanjing/Qingdao/Guangzhou/Hankou/
  Harbin/Dalian) is claimed by neither — 19-47 km² of background per city.
  There is NO gap-closing pass for China at all (v2 disabled
  `fill_china_gaps`/`clip_china_to_neighbors`; `fix_sea_coastline_gaps.py`
  only touches seas). Note also that `china_1946_historical.json` cannot be
  regenerated (its Virtual Shanghai `china_hist/1947-49` shapefile was never
  committed and is nowhere on disk) — China fixes must POST-PROCESS the
  existing 47-feature output JSON directly, not re-run the build.
- **A "smallest-region-gets-a-capital-bonus" tier bug can hit ANY country,
  not just the ones you already patched — check it for every newly-added
  tiny territory, even under a country that already has an explicit
  classifier.** Adding 11 missing islands (2026-07-22) reproduced the Faroe/
  Akrotiri class of bug twice more: (1) GBR/FRA already have explicit
  `gbr_tier`/`fra_tier` classifiers, but the new island names didn't match
  any keyword branch, so they fell through to the unconditional `return 3`
  default — too high a density assumption for small remote islands (Isle of
  Man got 136K population against a real ~52K); (2) AUS had NO explicit
  classifier at all, so newly-added Cocos/Christmas/Coral Sea/Heard fell
  into `generic_tier`'s bottom-20%-by-area-in-country bucket alongside
  Australia's mainland states — the exact same bug, just triggered by
  country-relative area instead of an unconditional default (Christmas
  Island: 43,791 against a real ~2-3K; Heard Island, genuinely uninhabited:
  21,973). Fix pattern for a country with NO existing classifier: don't
  force it to name-match every region (risks changing already-correct
  behavior for the rest of the country) — let the classifier return `None`
  for anything it doesn't explicitly recognize, and extend the dispatcher
  (`compute_region_tier` in `fill_region_economy_1946.py`) to fall back to
  `generic_tier` on `None`. This is a one-line, backward-compatible
  extension (existing classifiers never returned `None`, so nothing else
  changes) that lets a new classifier cover ONLY the newly-added edge cases.
  Tier 1 (the lowest available) still won't reach true zero for genuinely
  uninhabited large territories (French Southern Territories, 7244 km²,
  landed at 43,658 even at tier 1 — the `area^0.55` term alone still
  produces a non-trivial weight) — that's an accepted, pre-existing
  limitation of the tier formula (Clipperton Island already showed the same
  pattern at a smaller scale, 636 population for 3.1 km² uninhabited rock),
  not something to chase further without a dedicated near-zero override
  mechanism.
- **The zombie-server-on-port-3000 bug (2026-07-19-i) recurred in this same
  session two rounds later — `netstat` before every live check is not
  optional, it's the only thing that catches it.** Started a fresh `nohup
  npm run dev &` after a rebuild, the FIRST `/game/start` response looked
  plausible but was wrong in a way only visible on close inspection
  (`regions: 1388` instead of the expected 1399, scrambled owners — Isle of
  Man showed `ITA`, Jersey showed `SUN`). `netstat -ano | grep :3000` before
  trusting ANY live check showed only one LISTENING PID, but it was the
  OLD server from earlier in the session, still alive under the SAME
  believed-dead port — `nohup ... &` starting cleanly and printing "Server
  started on port 3000" does NOT prove that message came from your new
  process if an old one silently kept the port and Node just queued/failed
  the bind in a way that didn't surface as an error in this environment.
  `taskkill //F //PID <the one netstat shows>` then a fresh start fixed it
  immediately. Treat every live-check result as suspect until you've
  confirmed the PID currently on the port matches the process you just
  launched — a plausible-looking wrong answer is worse than an obvious
  crash because it doesn't prompt you to double-check.
- **The Browser-pane preview tool (`preview_start`/`.claude/launch.json`)
  launches its "server"/"client" configs against the session's MAIN
  checkout directory, not whatever worktree your Bash `cd` is currently
  in — confirmed 2026-07-23 via `preview_list`, which showed `"cwd":
  "D:\\Pax Historia LOCAL"` for a server started while working in `.claude/
  worktrees/capital-region-fix`.** First symptom: a `preview_start(name=
  "server")` restart reported success on port 3000, but the live-check
  region/country counts (1366/128) didn't match the just-run validator
  (1399/157) — it was quietly serving the MAIN checkout's `server/data/
  scenarios/1946/*.json`, not this worktree's freshly-rebuilt data.
  `netstat -ano | grep :3000` + `wmic process where "ProcessId=<pid>" get
  CommandLine` showed the listening process running from `D:\Pax Historia
  LOCAL\node_modules\...` — looked at first like it could be another
  agent's live session in the main checkout (a real possibility per
  `AGENTS.md`, "основной checkout может быть занят чужой сессией", and
  genuinely ambiguous in the moment since the worktree's OWN server ALSO
  resolves `node_modules` to that same physical path when it's a symlink,
  as this repo's `server/node_modules` is, to skip a slow `npm install` in
  fresh worktrees) — `preview_list` afterward settled it: both entries
  were this session's own processes, just aimed at the wrong cwd, not a
  stranger's. Either way, the safe move is the same and doesn't require
  resolving the ambiguity: for verifying WORKTREE data specifically, skip
  the preview tool's named configs and launch your own process on an
  explicit port instead (`PORT=39xx npx tsx src/index.ts`, `cd`'d into the
  worktree's `server/` first) — a fresh, explicit port both sidesteps the
  ownership question and guarantees you're hitting the right checkout.
- **`build_oceania_1946.py`'s `SINGLE_ORPHANS` loop filters raw features by
  `iso_a2` fresh each iteration — it does NOT depend on the `ALL_COUNTRIES`
  union like `SINGLE_REGION`/`SINGLE_COUNTRY` do.** A country with a real
  (non-"-1") iso_a2, even one with multiple scattered features that should
  merge into one "archipelago" region (French Southern Territories: 4
  features — Kerguelen/Crozet/Amsterdam/Éparses), can go straight into
  `SINGLE_ORPHANS` with no other wiring needed — same one-line cost as
  `SINGLE_REGION` elsewhere. Only iso_a2="-1" territories (Natural Earth's
  tag for disputed/no-ISO features, shared by many unrelated entities) need
  the heavier `EXTRA_SINGLE_FEATURES`-by-`adm1_code` mechanism that asia/
  namerica already had and oceania didn't — added it there for Cocos/
  Christmas/Coral Sea Islands (2026-07-22), same pattern, output `iso_a2`
  can be set to whatever the sovereign's code is (here `"AU"`) since
  ownership is resolved separately via `ownership_1946.json`, not derived
  from the land feature's own iso_a2.
- **China's ring gaps (previous bullet) are now fixed — and verifying the
  fix by per-city area growth is the WRONG check.** `absorb_slivers_
  until_stable` assigns each gap cell to whichever of the two touching
  features has the longer shared boundary — for a thin ring, that can be
  the HOST province rather than the city, so the city's own `area_km2`
  can show 0 growth even though its ring closed completely (both sides are
  China either way, so the visible hole is gone regardless of which one
  absorbs it). Verify with a direct residual check instead:
  `city.buffer(δ).difference(city).difference(all_china ∪ all_water)` —
  must be empty. Checking only "did this feature's area increase" gave a
  false "still broken" reading for 2 of 6 municipalities (Guangzhou,
  Harbin) that were actually fully closed.
- **A `MultiPolygon` part can be a real, far-flung piece of the same
  feature (keep it) or a degenerate sliver from an intersection/difference
  chain (drop it) — area alone doesn't distinguish them, render does.**
  Qingdao's 4 parts looked like "2 real + 2 junk" by area alone (930+131 km²
  vs 0.66+0.07 km²), but a zoomed render was still necessary to confirm the
  2 small ones are thin needle-shaped triangles at the bay mouth (classic
  computational-geometry noise) rather than small real islands — a
  legitimately real small island would render roughly compact/rounded, not
  a 1-2px-wide sliver. Drop mechanism: a small explicit `{feature_name:
  threshold_km2}` dict, applied ONLY to named features — never a blanket
  "drop every small part under N km²" for a whole continent/country, since
  provinces with genuine archipelagos (Shandong: 10 parts, Liaoning: 21)
  have many real small-but-legitimate islands mixed in with the same size
  range.
- **Renaming an EXISTING region (same `region_id`, no count/id shift) is
  a SEPARATE staleness trigger from the count-shift class already
  documented below — `names_ru.json` needs the same manual patch either
  way.** `import_to_game.py` sources `name_en`/`name_ru` from `scripts/
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
  Taiwan) change. This is the exact same class already documented for the
  Gulf/Tonga test below (rewritten to resolve by `(name, iso_a2)` instead
  of a literal id) — Norfolk Island's two assertions were fixed in place
  this round (not rewritten to the by-name pattern) since they're a single
  simple `assertEqual`; a future hit on the SAME two assertions should
  trigger the by-name rewrite instead of a third string patch.

- **Sea/lake polygons carry interior-ring holes pre-cut for islands from a
  richer coastline source than `game_map.json`'s ADM1 layer — a hole with
  NO matching land is a distinct bug class from anything `diagnose_missing_
  land.py` catches.** That tool diffs against ADM1 records, so it's blind
  to an island that never had an ADM1 record to begin with. Found
  (2026-07-23, user screenshot: a sharp white wedge on a solid-colour sea —
  turned out to be a French Polynesia atoll) via a NEW permanent tool,
  `diagnose_sea_holes.py`: for every interior ring in every sea/lake
  feature, `hole.difference(nearby_land)` — non-empty residual (even
  partial — a single representative-point check gives false "covered"
  when land only partly overlaps the hole) means a real gap. 115 found
  world-wide, split into two very different fix paths: 95 matched an
  actual raw `game_map.json` feature at >30% area overlap (the island is
  real, just never reached the output — most likely eaten by
  threshold-based scattered-fragment cleanup during a state/province
  geometric merge, see Alaska below); 20 had no raw source at all
  (genuine synthesis-from-hole-shape territory, needs a per-case owner
  decision, not auto-applied).
- **When restoring a real-but-dropped island, union the HOLE's geometry,
  not the raw source feature's geometry.** The hole is guaranteed
  seam-free against the sea polygon by construction (it IS the sea
  polygon's own cutout); the raw ADM1 feature may have been digitized
  against a different coastline source and re-introduce a hairline gap.
  Use the raw match only to identify country/state (for choosing which
  existing output feature to merge into), not for the shape.
- **Alaska's build output is 2 geometric-merge clusters ("Alaska —
  Aleutians West", "Alaska — Yukon-Koyukuk"), not a real county split —
  same "winner name, not true boundary" pattern as Taiwan.** 47 of the 115
  sea-holes matched Alaska alone: small coastal/Aleutian islands whose
  raw ADM1 record exists but got dropped, almost certainly by the same
  scattered-fragment cleanup pattern already documented for China/other
  continents (a state with thousands of tiny real offshore islands is
  exactly the shape a distance-threshold cleanup misclassifies as noise).
  Fix used nearest-existing-same-`iso_a2`-feature merging rather than
  trying to map each island to its "correct" borough — good enough for
  ownership correctness, consistent with the existing tolerance for
  approximate sub-country labels.
- **Merging an island into "nearest same-country feature" by raw distance
  can silently overlap a DIFFERENT feature of that same country if the
  county-cluster geometry is complex/far-reaching.** Filling the San Juan
  Islands (WA) holes picked "Washington — Adams" as nearest for one hole
  even though "Washington — San Juan" is the thematically obvious owner —
  the two are both geometric multi-county merges, so "nearest by boundary
  distance" isn't the same as "nearest by name/theme," and produced a real
  0.002° overlap between the two Washington clusters. Caught by the
  standard `merge_world_1946.py` overlap-count regression check (98→99),
  not by anything geometry-specific — reinforces that the overlap
  diagnostic must be re-run after ANY hole-fill, not just after
  edits that look like they touch a border. Fixed by `A.difference(B)` in
  favor of whichever cluster is the more sensible thematic owner.
- **A post-processing script that patches `scripts/map/out/*.geojson`
  continent files directly is only safe if those files are NOT regenerated
  by anything else — check `.gitignore` before assuming a fix persists.**
  `fix_china_geometry.py` gets away with living outside `FULL_REBUILD_
  STEPS` because it patches `china_1946_historical.json`, a git-TRACKED
  file nothing else regenerates (China rebuild is impossible — see
  earlier entry). The first version of `fill_sea_holes.py` copied that
  "standalone post-processing script" shape but patched `out/namerica_
  1946.geojson`/`out/europe_1946.geojson` — both match `*.geojson` in
  `.gitignore` and get FULLY OVERWRITTEN by `build_namerica_1946.py`/
  `build_europe_1946.py` on every run, for any reason, not just this one.
  The fix would have silently vanished the next time either continent
  needed a rebuild for something unrelated. Caught before commit by
  checking `git status` and noticing the modified continent `.geojson`
  files simply weren't in the diff. Fix: rewrite to read/write the
  continent files directly (not the merged `client/public/world_1946.
  geojson`) and add the script to `FULL_REBUILD_STEPS` in `make_1946.py`,
  positioned after `fix_sea_coastline_gaps.py` (sea already stabilized)
  and before `merge_world_1946.py` — same "must be in the reproducible
  chain" rule from README checklist #5, but this is the first time it
  bit a script that LOOKED like it followed the safe `fix_china_
  geometry.py` precedent while actually violating the precondition that
  makes that precedent safe (target file not regenerated elsewhere).
- **A brand-new hole-scan on a freshly-fixed area can surface an
  UNRELATED, larger pre-existing bug purely because you finally rendered
  that spot with water layered in.** Verifying the Isle Royale fix (Lake
  Superior) turned up ~448 km² of real, unrelated land-vs-lake coastline
  gaps along the south shore — and the same class exists on all 4 Great
  Lakes (~2086 km² total). Root cause is very likely a side effect of the
  EARLIER `refresh_lakes_from_ne10m.py` lake-shape replacement (2026-07-22,
  package A): swapping in the full `ne_10m_lakes` contour changed the
  lake's coastline precision without a matching land-vs-lake reconciliation
  pass (the kind of gap-first absorb every SEA coastline already gets).
  Not fixed in the same session it was found — flagged as a separate,
  sizable, not-point-fixable finding for the user to prioritize
  separately, same call as "this is too big to fold into the current
  patch" for the 20 synthesis-needed holes above.

- **"Ugly zigzag border" has two different root causes that need different
  fixes — check which one BEFORE proposing a solution.** User flagged
  Dalian↔Liaoning and Qingdao↔Shandong as both "badly cut." Rendering the
  RAW source polygon (`geoBoundaries-CHN-ADM2.geojson`'s own `Qingdaoshi`,
  before any `∩ host_province`) showed it was already smooth — the zigzag
  was purely an artifact of the pipeline's intersection step, fixable by
  using the raw polygon directly, no research needed. The RAW `Dalianshi`
  polygon, by contrast, was itself jagged (real coastal detail) AND
  undersized vs. the true historical Kwantung Leased Territory — a
  fundamentally different problem needing a real administrative-boundary
  fix, not a coastline-precision one. Same symptom, opposite diagnosis;
  render the raw source before assuming either.
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
- **An unused constant left in the codebase can be a pre-validated answer,
  not dead code — check before doing the research yourself.**
  `build_china_1946_v2.py` had `PORT_ARTHUR_LAT_CUT = 39.46` sitting
  unreferenced (grep found exactly 2 hits, both the definition itself) —
  the build ultimately used a different method (`Dalianshi` raw county) and
  left this behind. Applying it anyway (a horizontal cut at that exact
  latitude) produced 3638.9 km², landing right inside the independently
  Wikipedia-sourced 3400-3500 km² range for the real 1898-1945 Kwantung
  Leased Territory — a near-exact match that's not coincidence. A previous
  session almost certainly already did this research and calibrated the
  constant, then abandoned the approach for unrelated reasons (maybe
  wanting a real county boundary instead of an arbitrary line) without
  deleting the evidence. `grep` for suspiciously-specific unused constants
  near the feature you're fixing before opening a browser.
- **A "horizontal line" request can still produce real (not synthetic)
  islands as a side effect — that's not a bug.** Cutting Dalian/Liaoning at
  a constant latitude swept up 4 small pre-existing Liaoning islets (their
  bounds matched exactly ones already catalogued earlier in the session)
  that happened to sit south of the line, turning Dalian from 1 part into
  5. Correct and expected under "everything south of the line belongs to
  Dalian" — verify by checking whether the extra MultiPolygon parts
  correspond to real, previously-known small islands (they do here) before
  treating a part-count increase as a regression.
- **`fill_sea_holes.py`'s "nearest feature of the same iso_a2" pick can
  create a new same-country overlap on EVERY fresh rebuild, not just
  once** — first hit (Washington "San Juan" vs "Adams", package-B era) was
  patched by hand; a from-scratch `--full-rebuild` in a fresh worktree
  reproduced the identical overlap deterministically, because the
  underlying "nearest by raw distance, not by touching-boundary" choice
  never changed. Manual per-incident patches don't survive a regenerate.
  Fixed by adding a general `resolve_same_iso_overlaps()` post-pass to the
  script itself: after filling, check every same-`iso_a2` pair in a
  continent for a NEW overlap and resolve it to whichever side has the
  longer shared boundary with the overlap polygon (same longest-boundary
  principle as `absorb_slivers` elsewhere in this codebase) — self-heals
  on every future rebuild instead of needing a human to notice the same
  `merge_world_1946.py` overlap-count regression again. The check must run
  unconditionally per continent, not only when new holes were filled in
  that specific invocation — an idempotent re-run (0 new holes) is exactly
  when a *leftover* overlap from an earlier run would otherwise never get
  caught.
- **`absorb_slivers`'s cell classifier had an upper area bound (skip if
  too big) but no LOWER one — a near-self-tangent boundary can produce a
  truly-zero-area `polygonize` cell that gets absorbed forever without
  converging.** Found 2026-07-23 on the Oceania tile: `fix_sea_coastline_
  gaps.py` printed "3 проходов не сошлись" every full run. Per-cell
  instrumentation showed the SAME cell (`area=1.7e-18 deg2`,
  `compactness=0.000`) absorbed by the SAME single feature on every pass —
  not two features fighting over a real sliver, a phantom artifact from
  `polygonize(unary_union([...boundaries]))` at a spot where a polygon's
  own boundary almost touches itself. Absorbing it is a geometric no-op
  (union with a sliver of itself) but perturbs float coordinates just
  enough that the next pass's `polygonize` regenerates an identical
  phantom — an infinite loop that never trips `n_absorbed == 0`. Fixed by
  a general `MIN_CELL_AREA_DEG2 = 1e-9` guard at the top of `absorb_
  slivers`'s cell loop (`geometry_cleanup.py`) — NOT the same threshold as
  `fix_sea_coastline_gaps.py`'s own `DEGENERATE_AREA_DEG2 = 1e-4` (that one
  filters MultiPolygon parts AFTER a union, calibrated against noise
  observed up to 1e-6 deg² in that different context; reusing it as a
  PRE-absorption floor would risk dropping real small slivers — this
  session absorbed real ones as small as 0.05 km² ≈ 4e-6 deg²). Pick a
  cell-classifier floor from the specific noise magnitude you actually
  reproduce, not by borrowing a neighboring constant that solved a
  differently-scaled problem. `absorb_slivers` is shared by 6 pipeline
  scripts — fix it at that shared layer, not in the one caller where the
  symptom happened to surface.
- **A tile-loop's printed per-tile "+X km2" can go negative and still be
  harmless — verify by checking the PERSISTED property across repeated
  runs, not just by reasoning about the union math.** While verifying the
  fix above, re-running `fix_sea_coastline_gaps.py` on its own already-
  processed `seas_1946.geojson` printed identical negative deltas for a
  couple of seas (Norwegian Sea -12.7 km², 3 runs in a row, bit-for-bit
  the same). `unary_union([full_before, grown_piece])` should mathematically
  never shrink `full_before` for valid inputs, so this looked alarming at
  first — but `g.is_valid` and `area_km2(g) == area_km2(g.buffer(0)) ==
  area_km2(to_polygonal(g))` all checked out for the stored geometry
  (ruling out invalid/self-overlapping input as the cause). The decisive
  check: read the stored `area_km2` property before a run, run the real
  script, read it again — it was bit-identical (1456629.1 both times).
  That proves the printed delta is a transient measurement artifact
  inside that one union call, not a persisted, compounding loss. Don't
  trust "the math says X can't happen" OR "the number looks scary" alone
  when a script is close to idempotent — read the actual persisted state
  before and after a real run.
- **When a sourceless hole needs an owner, check the NEAREST EXISTING
  feature in the dataset before doing independent historical research —
  a prior session may have already made and vetted that sovereignty
  call.** Assigning owners to the 20 sea-holes with no raw source
  (2026-07-23) could have meant researching 1946 sovereignty for 8
  scattered locations from scratch. Instead, for each hole, `Point(
  *centroid).distance(g)` against every existing land feature found the
  nearest one already in the dataset, and its `iso_a2`/owning country was
  reused as-is. This wasn't just a shortcut — it surfaced choices already
  more carefully researched than a fresh lookup would likely produce:
  Yap/Pohnpei's owner in `countries.json` is `QPS`, "U.S. Naval
  Administration of the Former Japanese Mandated Islands" — the real
  transitional 1946 authority (Japan surrendered 1945, UN Trust Territory
  only formalized 1947), not the anachronistic modern "Federated States
  of Micronesia" a naive lookup might reach for. Greenland is its own
  playable country (`GRL`), not merged into Denmark. Only trust the
  nearest-feature answer when the distance is decisively small AND
  unambiguous (this session's 8 clusters ranged 0.055-1.08° to the
  chosen owner vs. 1.5-14° to the next-nearest alternative) — a close
  three-way tie near a real, contested land border would still need a
  judgment call, not an automatic nearest-neighbor pick.
- **When a lake gains a new, more detailed contour and no longer matches
  land, check which side actually moved before assuming water is
  authoritative and growing water into land — it can be the reverse.**
  The Great Lakes gap-fix's whole design hinged on one measurement done
  BEFORE writing any code: the lake's current contour gives EXACTLY 0.0
  km² of gap against RAW `game_map.json` land, for all 4 lakes — meaning
  the NE10m refresh (`refresh_lakes_from_ne10m.py`, 2026-07-22) is
  perfectly aligned with the original source. The gap only exists against
  CURATED `out/namerica_1946.geojson` land, which has its own history of
  divergence from raw (the same geometric-cluster county-split that
  produces "Michigan — Crawford"/"Lapeer"/"Marquette" as separate
  regions). That flips the standard `fix_sea_coastline_gaps.py` authority
  direction on its head: there, land is old/authoritative and sea grows;
  here, the LAKE is what independently matches ground truth, so LAND has
  to grow toward it — the exact same `absorb_slivers_until_stable` engine
  (`geometry_cleanup.py`), just with mutable/authoritative roles swapped,
  and no need for the sea-specific `absorb_compact_gaps` (its liberal,
  no-compactness-check variant only makes sense when mutable is water and
  every real lake-hole is already excluded via `water_geoms` — for
  mutable=land the standard blob-safety check is exactly the one you
  want, same as any other land-gap fix in this codebase). Don't assume
  the newly-refreshed feature is the one that regressed — measure both
  candidate authorities against the original raw source first.
- **A gap-cell diagnostic that copies `absorb_slivers`'s cell-mosaic logic
  MUST clip `water_geoms`/`context_geoms` to the local bbox before
  passing them in — the real function tolerates unclipped, far-away
  geometry; a standalone copy checking things in a different order might
  not.** Building a quick side-script to inspect exactly which cells
  `absorb_slivers` was skipping as "compact blobs" near the Great Lakes,
  passing ALL 13 lakes (unclipped) as `water_geoms` produced phantom
  "blob" cells at coordinates nowhere near the Great Lakes — (33°E,-2°N)
  and (48-52°E,44-52°N), i.e. Lake Victoria/Tanganyika and Caspian/Aral
  territory. `absorb_slivers` itself is immune to this (a cell that
  doesn't touch any `mutable_feats` boundary gets dropped via the
  `land_touch` check regardless of how far-flung the water geometry that
  produced it was), but a hand-rolled diagnostic that reorders or omits
  that check can report nonsense. Always intersect water/context geometry
  with the clip_box (or at minimum filter by `.intersects(clip_box)`)
  before feeding it into any copy of this cell-mosaic pattern.
- **`absorb_slivers`'s `n_skipped_blob` counter increments BEFORE checking
  whether the cell is already covered by existing land/water — it can
  overcount cells that aren't real gaps at all, just interior mosaic
  subdivisions at a complex multi-feature junction.** Investigating the
  Great Lakes fix's "24 compact blobs skipped" message (after fixing the
  clipping bug above), an independent re-check that ALSO verified
  `representative_point()` coverage before classifying a cell as a
  "blob" found zero real candidates — every one of the 24 was already
  covered by an existing feature. The count isn't wrong for its stated
  purpose (it never claims to filter by coverage), but reading it as "N
  real potential gaps got protected" is wrong. If a `n_skipped_blob`
  count seems large, don't treat it as N missed gaps without independently
  re-checking coverage first — it may be entirely benign.
- **When no historical shapefile is findable, anchor a hand-built polygon
  to a few REAL, verifiable coordinates plus documented dimensions —
  don't try to algorithmically deform a dramatically-shrunk modern remnant
  back to its historical size.** The Aral Sea's 1946 shape was a
  "calibrated ellipse" placeholder (right area, ~68,000 km², wrong shape
  — a previous session had already tried and failed to find "точных
  архивных контуров 1946 года"). WebSearch/WebFetch found no downloadable
  historical vector data (cartographyvectors.com was unreachable in the
  moment; a GitHub "historical-basemaps" project covers country borders,
  not water bodies; cawater-info.net has only raster historical maps).
  What WAS findable: real coordinates for 2 port cities that sat directly
  on the 1946 shore (Muynak south, Aralsk northeast) and independently
  documented overall dimensions (428-435 km N-S, 234-290 km E-W across 2
  sources). First attempt — scale the modern, already-split North/South
  Aral Sea polygons (`sources/naturalearth/ne_10m_lakes.geojson`) up from
  a fixed corner to reach the historical area — produced a nonsense snake
  shape, because 60 years of recession wasn't spatially uniform (the lake
  retreated far more from the south/east than elsewhere), so naive scaling
  distorts orientation, not just size. What worked: build a polygon
  directly from waypoints (2 real anchors + synthesized intermediate
  points matching the documented aspect ratio and overall silhouette),
  densify with deterministic per-segment normal-offset jitter (fixed
  `random.Random(seed)`, not the bare `random` module state) so the coast
  looks organically irregular rather than a faceted rough polygon, then
  do one final uniform area-correction scale from the centroid to land
  exactly on the documented total area. Verify by checking both real
  anchor points end up within ~2 km of the final boundary, and — since
  the point of the reconstruction was to later clip 3 real administrative
  regions by it — render the new lake shape against its real neighbors
  and confirm it sits where the actual sea does relative to them, not
  just that it "looks like a lake" in isolation.
- **"Clip land by every water polygon it overlaps" is not safe to apply
  uniformly — check the FRACTION of each feature's area being removed,
  not just whether an overlap exists.** `clip_land_by_water.py`'s first
  run (2026-07-23) blindly subtracted every overlapping sea/lake from
  every land feature and silently destroyed real territory: Washington —
  San Juan dropped 94.4% (7704.6→425.4 km²), French Southern Territories
  dropped 97.7% (7244.4→165.8 km²). Root cause: several "seas" in this
  dataset are broad ocean SECTOR polygons (e.g. "Сев. Пасифика —
  Американский сектор" spans from the equator to 49.7°N — effectively
  "the whole ocean over there"), and even some precisely-named ones
  (English Channel, Caribbean Sea) are too coarse to have island-shaped
  holes cut for every small feature inside their bounds. Computing the
  overlap-to-total-area ratio for all 83 affected land features revealed
  a sharp, unambiguous gap in the distribution: 0-11% smoothly (genuine
  coastline mismatches), then a jump straight to 14%+ and nine features
  at exactly 100% (entirely swallowed). A `MAX_SAFE_FRACTION` threshold
  (10% worked here) with an explicit, individually-vetted override list
  for the few real exceptions (the Aral Sea trio, already confirmed
  correct by rendering against neighbors) is the right shape for this
  kind of "clip A by B" operation in general — never trust "they
  overlap, so subtract" without also asking "how much of A would be left,
  and is that plausible for a real administrative region?"
- **When a gitignored, regenerated `out/*.geojson` gets corrupted mid-
  session and there's no git history to fall back on, check whether
  `--full-rebuild` can even complete before assuming you need it — and if
  it can't, individual continent build scripts often still work
  standalone.** Recovering from the clip incident above, `make_1946.py
  --full-rebuild` died partway through on a genuinely missing external
  source (`1947_1949.shp` for China) — a known, pre-existing limitation
  of this worktree, not something the recovery could fix. But
  `build_asia_1946.py` run BY ITSELF succeeded anyway: it reads China's
  geometry from the already-existing, git-TRACKED `china_1946_
  historical.json` rather than needing `build_china_1946_v2.py` to have
  just regenerated it. Same for South America/Brazil (`build_brazil_
  1946.py` failed on a missing geoBoundaries file, but `build_south
  america_1946.py` used Brazil's already-existing, untouched output
  file directly). Lesson: a failed upstream step doesn't necessarily
  block downstream steps that merge in a separately-persisted
  intermediate file — check what a script actually READS before assuming
  the whole chain is blocked. This made it possible to regenerate only
  the actually-corrupted continents (Europe/Asia/N.America/S.America/
  Oceania) individually, then replay the session's own idempotent fixes
  (`fill_sea_holes.py`, `fix_lake_coastline_gaps.py`) on top — verified
  by confirming `merge_world_1946.py`'s overlap count and every
  individual affected feature's area matched the pre-incident state
  bit-for-bit, not just "looked plausible."
- **When a land-water overlap is flagged as "too large a fraction to trim
  land," the fix is usually to clip the WATER instead, not to give up —
  and running that as a general pass (no hardcoded feature list) makes it
  naturally target exactly the residual cases.** The 19 features
  `clip_land_by_water.py` flagged and skipped (2026-07-23) all shared one
  root cause: the land was a real, precisely-shaped feature (Guernsey,
  Washington — San Juan, French Southern Territories, ...), but the
  overlapping sea was the imprecise side (a coarse ocean sector or a
  low-resolution named sea with no island-shaped hole). Once you know
  which side is imprecise, the fix is the mirror of the original
  operation: `water = water.difference(land)` instead of `land =
  land.difference(water)`. Writing `clip_sea_by_land.py` as a blanket
  "for every sea/lake, subtract whatever land it still overlaps" pass —
  run AFTER `clip_land_by_water.py`, with no explicit list of the 19
  names — worked cleanly: everywhere the first pass had already resolved
  the overlap (by trimming land), there was nothing left to subtract
  (a no-op); the only features where an overlap remained were exactly
  the 19 flagged ones, so the general pass targeted precisely the right
  set without maintaining a name list that could drift out of sync with
  future geometry changes. This direction also needs no symmetric
  safety threshold — the "victim" (a sea, often millions of km²) is
  always vastly bigger than the "aggressor" (a small island), so there's
  no structural risk of the water disappearing the way small islands did
  in the original direction.
- **The "longest shared boundary wins" rule (already used for same-iso
  overlaps and sliver absorption) applies just as well between two
  DIFFERENT countries — a border overlap between independently-digitized
  countries is the same "zipper" phenomenon `geometry_cleanup.py` already
  fights for gaps, just showing up as intersections instead of holes.**
  The last remaining overlap in the whole dataset (2026-07-23) was
  Ponta Porã (Brazil) vs Presidente Hayes (Paraguay) — not a territorial
  dispute, just two countries' raw ADM1 sources drawing their shared
  ~240 km border slightly differently, producing 33 separate small
  intersection fragments strung along its length (0.0002-44.7 km² each)
  rather than one blob. Resolved per-fragment by comparing shared-
  boundary length with each side and assigning the fragment to whichever
  is longer — identical principle to `resolve_same_iso_overlaps`, just
  applied point-in-time for a single known cross-country pair rather
  than as a general same-iso pass (there was only one instance in the
  entire dataset, so a small standalone script was proportionate; don't
  generalize to "diff every country pair" without evidence more exist).
  Side note that cost some investigation time: "Presidente Hayes" in
  this dataset is not the Paraguayan department of that name — it's
  ALL OF PARAGUAY merged into one region (18 raw provinces collapsed to
  1 by the geometric clustering step, and the winning name happened to
  be that department's). A region's display name is not proof of its
  geographic extent when a country has been clustered down to a single
  feature — check `source_adm1`/actual bounds before assuming a named
  region matches its literal namesake's boundaries.

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
3b. **Missing-land scan** after any build that changes country/region
   membership: `python scripts/map/build/diagnose_missing_land.py` — flags
   whole territories present in raw `game_map.json` but absent from output
   (the manual-scan-is-impossible class: Akrotiri, Maldives, Channel
   Islands). Layer-1/2 `*** ПРОПАЖА ***` lines are genuine drops; Layer-3
   `[LAKE]` tags are lake-adjacent false positives, not drops.
3c. **Sea/lake hole scan**, a different class 3b can't see (no ADM1 record
   required to be a real gap): `python scripts/map/build/diagnose_sea_
   holes.py` — finds interior-ring holes in sea/lake polygons with no
   (or only partial) covering land. Splits results into matched-to-raw-
   source (safe to auto-fill via `fill_sea_holes.py`, merge the hole
   geometry — not the raw feature's — into the nearest same-`iso_a2`
   output feature) vs unmatched (needs a per-case owner decision before
   any land is synthesized).
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
