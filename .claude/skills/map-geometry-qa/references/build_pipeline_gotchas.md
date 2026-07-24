# Build pipeline gotchas: running, testing, and verifying safely

General engineering/process lessons about this repo's map build pipeline
that aren't specific to any one geometry algorithm — safe ways to test a
single step, schema differences between intermediate and final files,
data-sourcing traps, and live-server verification pitfalls.

- **Git LFS on raw GitHub URLs silently returns the pointer stub, not the file.**
  `raw.githubusercontent.com/<repo>/<commit>/<path>` for an LFS-tracked file
  gives you a ~130-byte text pointer (`version https://git-lfs.github.com/...`),
  not the actual content — no error, so it's easy to miss. Use
  `media.githubusercontent.com/media/<repo>/<commit>/<path>` instead.

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
