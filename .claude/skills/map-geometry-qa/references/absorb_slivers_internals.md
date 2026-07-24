# absorb_slivers internals: gates, thresholds, classifier pitfalls

Deep-dive lessons about `scripts/map/build/geometry_cleanup.py`'s
`absorb_slivers`/`absorb_slivers_until_stable` — the shared gap-first
sliver-absorption engine used by 6+ pipeline scripts. Read this when you're
touching the function itself, its constants (`MAX_COMPACT_AREA`,
`MAX_RIBBON_AREA`, `RIBBON_COMPACTNESS`, `MIN_CELL_AREA_DEG2`), or writing a
diagnostic that mirrors its cell-mosaic logic. For the general gap-first
principle and when to reach for this function at all, see the main
`SKILL.md`.

- **A cell touching only 1 land feature is still a real gap, even if it also
  touches water.** `absorb_slivers` used to skip these ("coastal mismatch,
  masked by background") — wrong (2026-07-19-g): the map background is darker
  than the sea fill, so the gap shows background, not sea, and is visible. Land
  is authoritative for identity; water is just backdrop. The only guard left is
  area (`MAX_COMPACT_AREA`/ribbon exception) so a whole sea/lake still isn't
  swallowed.

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

- **A cell-classifier with multiple size/shape gates doesn't automatically
  share exceptions between them — a fix (or a design decision) applied to
  one gate has to be deliberately re-checked against every OTHER gate the
  same candidate could still hit.** `absorb_slivers` has two separate
  place where a cell can be rejected for being "too big": (1) a general
  gate at the top of the loop (reject unless compact-and-small OR a
  ribbon: area <= MAX_RIBBON_AREA and compactness < RIBBON_COMPACTNESS),
  and (2) a second, stricter gate specifically for cells touching exactly
  1 land feature (2026-07-19-g's fix for "coastal mismatch, not masked by
  background") that used a bare `area > MAX_COMPACT_AREA` check with NO
  ribbon exception at all. A long, thin, obviously-ribbon-shaped gap
  along a lake shore (114.7 km², compactness 0.031 - nowhere near a
  round blob) passed gate 1 easily, then got silently rejected by gate 2
  purely on absolute size, with no way to know from the outside why. The
  fix mirrors gate 1's ribbon exception into gate 2 - not a new, looser
  threshold, just consistency between two checks that should have agreed
  from the start. When investigating "why didn't X get absorbed," trace
  the SPECIFIC cell through every gate in the function by hand (or with
  instrumented prints) rather than assuming the first gate that looks
  relevant is the one that fired - this bug hid behind a gate that looked
  like a minor, already-settled safety detail, three gates past the one
  that seemed most likely to be the culprit. This function is shared by
  6+ pipeline scripts - a fix here has effects everywhere, confirmed by a
  full fix_sea_coastline_gaps.py run adding +14,112 km2 worldwide (stale,
  previously-silent gaps of the exact same class, not a new regression).

- **Not every rejected-by-a-safety-gate cell has the same root cause -
  check WHICH gate fired before assuming one fix covers all remaining
  cases.** After the fix above closed the Great Lakes gaps completely,
  Greenland (853.7 km², 11 cells) and Svalbard (143.1 km², 5 cells)
  gaps the user also flagged were completely unchanged. Tracing one
  Greenland cell showed it was rejected by the FIRST, general gate (not
  the one just fixed) - its compactness (0.16-0.45) was too high (too
  round, not ribbon-shaped enough) to qualify for either gate's ribbon
  exception, and its area alone exceeded the compact-blob cap. Loosening
  that general gate further to let these through is a materially
  different, riskier change (it's the primary defense against absorbing
  a real, not-yet-modeled small lake, and one of the candidate cells'
  shape - fairly round at 0.447 compactness - is exactly the profile a
  real small lake would have). Left undone and clearly documented rather
  than forcing a fix that would widen a shared safety net beyond what
  the evidence justifies - see docs/TODO.md for the specific numbers and
  the reasoning for why this one needs a narrower, different mechanism
  (e.g. "safe if it touches an already-registered water body directly")
  rather than just tuning the existing thresholds.

- **Perimeter-based `compactness()` (4*pi*area/perimeter²) is fooled by a
  jagged boundary even on a shape that isn't elongated at all — use
  `minimum_rotated_rectangle` aspect ratio instead when you need to tell
  "genuinely thin ribbon" from "compact blob with a noisy edge."**
  Building `diagnose_coastline_gaps.py` (2026-07-24) turned up a 1464 km²
  gap on the Brazil/Paraguay border whose `compactness` was 0.0024 - by
  the same threshold `absorb_slivers` uses, indistinguishable from an
  extreme ribbon. But its `minimum_rotated_rectangle` aspect ratio was
  1.5 (nearly square) - a real, roughly-blob-shaped hole, not a sliver.
  The gap's boundary was stitched from many small administrative-border
  vertices (independently-digitized neighboring regions), which inflates
  perimeter for ANY shape regardless of true elongation - a compact blob
  with a fractal-ish edge scores exactly like a thin ribbon under a
  perimeter-based formula. `minimum_rotated_rectangle`'s side ratio is
  immune to edge jaggedness since it only cares about the point cloud's
  extent, not the boundary path length. Empirically on this dataset:
  genuine border-noise slivers had aspect >= ~10, genuine holes/gaps had
  aspect <= ~2 - a wide, comfortable gap between the two, not a knife
  edge. If a future gate/classifier needs "is this elongated," reach for
  this instead of raw compactness when the input boundaries come from
  independently-digitized adjacent polygons (i.e. almost always in this
  dataset).
