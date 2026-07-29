# Cross-source merging: foreign land/water, fragment cleanup, overlaps

Lessons about merging or clipping geometry that comes from a DIFFERENT,
independently-digitized source than what's already in the dataset —
adding a new country/territory, restoring a dropped island, splitting a
region using a different-vintage source, or resolving an overlap between
two countries' independently-drawn borders. This is where "zipper"
mismatches, stray MultiPolygon fragments after a `.difference()`, and
"which side is the imprecise one" judgment calls live.

- **Adding a feature from a foreign source: clip against ALL adjacent countries,
  not one.** Golan clipped against raw Jordan but not raw Lebanon left a Shebaa/
  Hermon overlap that absorb (a gap tool) can't fix.

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

- **The "ugly zigzag" pattern above isn't limited to raw-vs-intersection
  precision mismatches — growing a curated boundary to meet a newly
  reshaped water body (`absorb_slivers_until_stable`) produces the SAME
  coastline-hugging ugliness, and the SAME fix applies.** After
  `reconstruct_aral_sea_1946.py` gave the Aral Sea a more accurate shape,
  the gap-closing fix grew Aqtöbe/Qyzylorda/Karakalpakstan cell-by-cell to
  meet the new water edge — geometrically correct (0 gaps/overlaps) but the
  province borders ended up tracing every wiggle of the lake's outline, a
  coastline OFFSET rather than an independent administrative line (user:
  "прилипание некрасивое"). Fix, same principle as Dalian/Qingdao: go back
  to the RAW `game_map.json` polygons (before absorb-growth touched them)
  and clip THEM by the current water shape (`raw.difference(water)`)
  instead of growing the already-deformed current shape further. Caveat
  found here that didn't apply to Dalian: some raw provinces in this
  dataset are themselves `merge_method: "geometric"` clusters of MULTIPLE
  raw ADM1 units (`source_adm1` lists >1 code) — union all listed source
  codes before subtracting water, or the clip silently drops every source
  unit but the first. Before applying, verify quantitatively (not just "it
  renders fine"): the raw-clipped provinces must not overlap each other,
  and their combined area should match the current (pre-fix) combined area
  closely — a real difference concentrated in one small patch away from
  the water usually means the growth algorithm had ALSO silently resolved
  an unrelated same-country border dispute at some point, which the raw
  swap will legitimately re-open in the raw source's favor (verify that's
  actually correct before shipping it, don't just assume 0 is the only
  acceptable diff).

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
