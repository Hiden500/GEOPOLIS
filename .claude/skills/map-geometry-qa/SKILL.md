---
name: map-geometry-qa
description: Verify 1946-map geometry after any cut/merge/border edit — close gaps with gap-first absorb_slivers (never buffers), check every seam numerically AND by per-region render, and protect deliberate water holes. Use whenever scripts/map geometry, borders, region counts, or lakes/seas change.
---

# Map Geometry QA

Hard-won checklist for editing `scripts/map` geometry. Every rule here is a bug
that already shipped on this repo (`docs/DECISIONS.md`, entries 2026-07-19-a…k).
Do not re-open the same graves.

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
- **NEVER run a single `build_*.py` step "just to test it" if its output is
  a gitignored `out/*.geojson`.** These files are NOT reproducible from
  scratch by one script — they accumulate the result of a whole chain
  (`build_namerica_1946.py` → `build_us_states_split_1946.py` → `fill_us_
  border_gaps.py`, 51 states → 112 county clusters) PLUS at least one
  enrichment no script reproduces at all (Panama Canal Zone — same class of
  loss as the German occupation zones in 2026-07-19-i, `git log
  -S"Panama Canal Zone"` only hits the original `146933a` import). Running
  `build_namerica_1946.py` alone to check pyshp availability (2026-07-19-k)
  silently regenerated it from `game_map.json` from scratch, discarding 62
  regions (268→206) that no later step could rebuild. If you must confirm a
  script runs, check the traceback/exit code only — don't let it finish
  writing its output — or immediately diff the feature count against `git
  show <last-good-commit>:client/public/world_1946.geojson` afterward and
  restore from that commit if it shrank.

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
