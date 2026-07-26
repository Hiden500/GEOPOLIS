# Capital region id — non-positional invariant + resync

Status: complete
Owner: Claude (this session)
Starting commit: `43d05a4` (main) — worktree `.claude/worktrees/capital-region-invariant`, branch `claude/capital-region-invariant`

## Objective and observable outcome

`countries.json::capitalRegionId` for several 1946 countries resolved to the
wrong specific region (SUN -> "Chukotka AO" instead of "Moscow", USA ->
"Texas — Comanche" instead of "District of Columbia", etc.) even though the
existing validator invariant (#11, `validate_structural_invariants`) reported
0 violations, because that invariant only checks "capital belongs to a region
owned by the same country" — Chukotka IS owned by SUN, so it passes. Task:
(1) diagnose the full extent, (2) add an invariant that does not rely on the
positional `region_id` (which is reassigned on every geometry regeneration,
see `scripts/map/AGENTS.md` "Каскад region_id"), (3) resync the data so the
validator is green for real, not by weakening the check.

Observable outcome: `validate_region_economy_1946.py` exits 0 with the new
invariants active (not just the old ones); `test_validate_region_economy_1946.py`
covers both new invariants with synthetic fixtures; a scripted regression
(reverting one entry to its stale id) makes the validator fail with a clear
message, proving the invariant is load-bearing, not a no-op.

## Scope and constraints

In scope: `scripts/map/generate_country_registry.py`'s `CAPITAL_REGION_OVERRIDES`
table (moved to a new shared module), `validate_region_economy_1946.py` (new
invariants), `test_validate_region_economy_1946.py` (tests), regenerating
`server/data/scenarios/1946/countries.json` via the existing generator
(no geometry rebuild).

Out of scope (explicit boundaries from the task): no edits to geometry
(`world_1946.geojson`, any `scripts/map/build/*` rebuild step — read-only use
of `client/public/world_1946.geojson` for point-in-polygon is NOT a geometry
edit); no edits under `client/src/map/**`; no attempt to fix the
`best_region_by_owner` fallback heuristic (area-largest-region) used for the
~100 countries that have no `CAPITAL_REGION_OVERRIDES` entry at all — that is
a materially bigger, separate problem (see Discoveries) and was flagged, not
fixed.

Known parallel work: `.claude/worktrees/capital-region-fix` (branch
`claude/1946-map-geometry-cleanup`, NOT the same branch name as the doc it
contains — that plan's branch was renamed/repurposed after the 2026-07-23
remap landed) is an active, unmerged, currently-dirty worktree doing further
map-geometry edits (sea/lake coastline fixes, sliver absorption, etc.). Its
commits `b2efe4d`/`f59b754` are already merged into `main` (and thus into
this worktree) — see Discoveries for why they turned out to be a red herring
for this specific bug. If/when that branch's FURTHER uncommitted work lands,
it could shift region ids again — that is exactly the class of regression
the new invariants in this plan are meant to catch automatically, so no
extra coordination action was needed beyond noting the overlap here.

## Assumptions and unknowns

- Assumed `client/public/world_1946.geojson` (committed, 38 MB) is the
  authoritative final polygon geometry for the 1946 scenario and stays in
  lockstep with `regions.core.json` — verified: for every id 1..1399 present
  in both, `geoJsonId`/`region_id` match exactly (0 mismatches); the geojson
  has 7 extra ids (1400-1406, `type: "region"`) not yet in `regions.core.json`
  — read as WIP from the parallel geometry branch, harmless (no country
  currently references them as a capital).
- Assumed the 13 hardcoded coordinates in `generateMapFeatures.ts::
  CAPITAL_OVERRIDES` are accurate real-world capital coordinates — these are
  extremely well-known cities (Moscow, Washington, London, Paris, Rome,
  Tokyo, Nanjing, Cairo, Kabul, Copenhagen, Ottawa, Rio, Yan'an); not
  independently re-verified against an external source, only cross-checked
  for internal plausibility (e.g. Washington's lon/lat sign matches a
  US-East-Coast location).
- UNKNOWN, not fixed: `AGO` (Angola) — see Discoveries, real Luanda
  coordinates land in neither the current override's region nor a
  geographically sensible one; Angola is modelled as only 5 coarse regions.
  Needs a decision on regrouping/geometry, out of this task's boundary.
- UNKNOWN, not audited: the ~48 `CAPITAL_REGION_OVERRIDES` entries with no
  real-world coordinate anchor, beyond a 14-item common-knowledge spot-check
  (12 confirmed correct, 1 wrong found — IDN — already fixed, 1 ambiguous —
  AGO, flagged) and a systematic comment-vs-current-name lead-key check (0
  further mismatches beyond the false-positive noise of the crude regex).
  Full coverage would need ~48 more sourced real-world capital coordinates —
  treated as "invent a second list" scope creep per the task's own
  boundary and left as a follow-up.
- UNKNOWN: the ~100 countries with NO `CAPITAL_REGION_OVERRIDES` entry at all
  (`best_region_by_owner` fallback = largest-area region) — CHN was one of
  these and was objectively wrong (Suiyuan instead of Shaanxi/Yan'an); how
  many of the others are also wrong is not established here.

## Alternatives and selected decision

Anchor mechanism (task allowed picking a stronger anchor than the suggested
lat/lon if justified, with the one hard constraint "not the positional id"):

- **Geographic coordinates + point-in-polygon** (task's suggested default).
  Strongest possible ground truth, fully independent of id/name/build-order.
  Implemented as `economy_1946/capital_geography.py`: coordinates are NOT a
  second hand-copied list — `load_ts_capital_anchors()` regex-parses
  `generateMapFeatures.ts` text directly (same source of truth, zero
  duplication; raises loudly if the TS format changes incompatibly, rather
  than silently returning an empty/partial set). Point-in-polygon is a
  hand-rolled ray-casting implementation (bbox-prefiltered), not Shapely —
  `test_validate_region_economy_1946.py`'s own docstring states "без новых
  зависимостей" (no new deps) and Shapely/pyproj are documented in
  `scripts/map/AGENTS.md` as build-pipeline-only, not validator dependencies.
  Cross-checked the ray-casting result against Shapely for all 13 real
  anchors (scratch script, not committed) — 100% agreement, including the
  one boundary edge case (DNK/Copenhagen, point not exactly inside any
  polygon — handled by silently skipping rather than guessing a
  nearest-match, see the function's docstring). Coverage: only the 13
  countries `generateMapFeatures.ts` has coordinates for.
- **Name-anchor** (region's `names.en` at the override's id must contain an
  expected string, itself not tied to build order): added as a second,
  complementary mechanism (`CAPITAL_REGION_ANCHOR_NAMES` in the new
  `economy_1946/capital_overrides.py`) specifically because the geographic
  method's 13-country coverage would leave the other 42 live
  `CAPITAL_REGION_OVERRIDES` entries with NO regression protection at all —
  and the diagnosis (see Discoveries) shows real bugs (IDN) live exactly in
  that uncovered set. Weaker than geography (a legitimately-renamed region
  would false-positive; it can't tell "region B has a plausible-but-wrong
  name" the way BRA's case would have slipped through it had I picked the
  wrong anchor name) but covers all 55 live entries at zero new external
  data cost — the anchor names are literally last-known-good values pulled
  from the same `names.en.json` already used everywhere else.
- Rejected: exporting `CAPITAL_OVERRIDES` to JSON via a `tsx` script (the
  `resource_catalog.json`/`exportResourceCatalog.ts` pattern already in this
  repo) — technically cleaner (true single list, no TS-parsing regex) but
  disproportionate machinery (new npm script, wiring into `make_1946.py`,
  a new committed JSON artifact) for 13 static lon/lat pairs; the regex
  approach reuses the *same* file with no new build step and fails loudly
  on format drift, which was judged sufficient.
- Rejected: re-deriving `best_region_by_owner` capitals for the ~100
  uncovered countries, or fully re-verifying all 55 `CAPITAL_REGION_OVERRIDES`
  entries against sourced coordinates — both are real, larger problems
  surfaced by this diagnosis, but are a materially bigger scope than "add an
  invariant + fix confirmed drift" (task's own stop condition). Flagged in
  Discoveries/Unknowns instead.

## Progress

- [x] 1. Re-verified the reported bug directly against live data (not taken
      on faith): confirmed SUN/USA/GBR/FRA all resolve to the wrong region;
      baseline `validate_region_economy_1946.py` run showed 0 violations
      (confirms the existing invariant is blind to this bug class).
- [x] 2. Located the real geometry (`client/public/world_1946.geojson`,
      via `scripts/map/build/paths.py` / `merge_world_1946.py`), confirmed
      it is in lockstep with `regions.core.json`, and confirmed
      `generateMapFeatures.ts::CAPITAL_OVERRIDES` (13 countries) as the
      existing coordinate source per the task's pointer.
- [x] 3. Full diagnosis (see Discoveries) — went well beyond the 4 named
      examples, and disproved the task's own causal hypothesis with
      evidence (see Discoveries).
- [x] 4. Implemented `economy_1946/capital_geography.py` (TS-anchor
      regex-parser + pure-Python point-in-polygon + region-geometry loader)
      and `economy_1946/capital_overrides.py` (moved `CAPITAL_REGION_OVERRIDES`
      out of `generate_country_registry.py`, added `CAPITAL_REGION_ANCHOR_NAMES`).
- [x] 5. Added `validate_capital_anchor_names` and `validate_capital_geography`
      to `validate_region_economy_1946.py`, wired into `main()` as checks
      14/15.
- [x] 6. Fixed data: 8 corrected ids (SUN/USA/GBR/FRA/ITA/TWN/BRA/IDN),
      1 new entry (CHN), 7 dead entries removed (UAE emirates, see
      Discoveries) — in `capital_overrides.py`; regenerated `countries.json`
      via `generate_country_registry.py` (no geometry rebuild).
- [x] 7. Tests: 13 new unit tests in `test_validate_region_economy_1946.py`
      (both new invariants + the `capital_geography` helpers), all passing;
      full suite 22/22.
- [x] 8. Regression smoke test: reverted `SUN` to its stale id 318 in
      `capital_overrides.py`, confirmed `validate_capital_anchor_names`
      caught it immediately (pre-regen); regenerated `countries.json` with
      the bad value and confirmed `validate_capital_geography` ALSO caught
      it independently; reverted both files back to the fixed state and
      re-confirmed a clean 0-violation run.
- [x] 9. Ran full applicable verification matrix (see Validation).
- [x] 10. Docs: this plan, dated addendum on the 2026-07-23 remap plan,
      `docs/DECISIONS.md` entry.

## Discoveries

**The task's stated causal hypothesis is not supported by the evidence and
was corrected, not assumed.** The task suspected later geometry commits
(`b2efe4d`, `f59b754`) re-shifted region numbering after the 2026-07-23
remap (commit `5344317`, `.agent/plans/capital-region-overrides-remap.md`).
Checked directly: extracted `regions.core.json`/`names.en.json`/`names.ru.json`
at `5344317` and compared, for all 61 (then-)override entries, the region
name each id resolved to THEN vs. at current HEAD — **0 entries changed
name** (i.e. zero positional drift occurred between the remap and now; the
geometry-shape commits in between did not change the region count/order for
these ids). The real root causes, established from `git show 5344317 --
scripts/map/generate_country_registry.py`:

1. **The 2026-07-23 remap's detection method (owner-mismatch) has a blind
   spot it never covered.** It only found/fixed entries where the OWNER at
   the stale id no longer matched (46 of 61). SUN/USA/GBR/FRA/ITA/TWN were
   NOT in that diff (owner already matched by coincidence — e.g. Chukotka
   IS owned by SUN) — untouched, and already wrong at that point (confirmed:
   `name_at_5344317 == name_now == "Chukotka AO"` for SUN, etc.). Of the 15
   entries never touched by that remap, 6 were wrong when checked against
   real coordinates (SUN, USA, GBR, FRA, ITA, TWN) and only 1 (DNK) was
   confirmably right — this population is exactly where the old validator's
   blind spot lived, predating even the July remap.
2. **The remap's own name-substring method has at least one known miss:**
   BRA's comment ("Рио-де-Жанейро") matched the "Rio de Janeiro" STATE
   region (id 1079, area 42,747 km²) instead of the pre-1960 "Distrito
   Federal" (id 1078, area 1,121 km², the actual federal capital district —
   Brazil's 1946 capital was Rio de Janeiro city as its own federal
   district, separate from the state, until Brasília in 1960). Real point-
   in-polygon for Rio's coordinates lands in 1078, not 1079.
3. **CHN had no override entry at all** — silently used
   `best_region_by_owner` (largest-area CHN region = "Suiyuan"), unrelated
   to Yan'an (the CCP wartime capital, in Shaanxi) which
   `generateMapFeatures.ts` already names as CHN's capital marker.
4. **7 dead entries** (`QSH`/`QRK`/`QAB`/`QUQ`/`QAJ`/`QFU`/`QDU` — the 7
   individual Trucial-Coast emirates) resolve to Palestine/China regions and
   have done so since at least `5344317` too — traced via `git log -S` to
   commit `5b2da2c` (2026-07-18, predates the remap): "consolidate UAE back
   to 1 country" under the native MAP code `ARE`; `docs/DECISIONS.md`'s
   2026-07-19 entry ("Ближний Восток: историческая Палестина, Ливан на
   реальные мухафазы, разворот по ОАЭ") explicitly says this removes the
   need for the 7 `CUSTOM_COUNTRIES` entries (which WERE cleaned up) but the parallel
   `CAPITAL_REGION_OVERRIDES` entries were missed. Inert (no country code
   `QSH` etc. exists to read them), not a live bug, but confusing clutter —
   removed. `ARE` itself has no override entry (falls back to the same
   largest-area heuristic) — not fixed (no sourced historical seat of the
   Trucial Coast administration in this session; flagged as a follow-up).
5. **IDN's comment ("Sulawesi Selatan") no longer matches its current
   region ("Kalimantan Timur")** — found by a systematic sweep comparing
   every remaining override's comment lead-phrase against the region it
   currently resolves to (not one of the 13 coordinate-covered countries,
   so this is real evidence that "untouched, no coordinate anchor" entries
   can ALSO drift for reasons distinct from the two named above — a third,
   still-unexplained instance of the general phenomenon this whole table is
   fragile to). Fixed: id 495 ("Sulawesi Selatan", confirmed unique
   IDN-owned match).

**Full diagnosis table (all 13 countries with a real coordinate anchor):**

| Country | Old id | Old region name | Anchor (real capital) | New id | New region name |
|---|---|---|---|---|---|
| SUN | 318 | Chukotka AO | Moscow | 320 | Moscow |
| USA | 990 | Texas — Comanche | Washington | 1015 | District of Columbia |
| GBR | 124 | North Eastern | London | 125 | Greater London |
| FRA | 108 | Centre-Val de Loire | Paris | 109 | Île-de-France |
| ITA | 175 | Basilicata | Rome | 178 | Lazio |
| TWN | 382 | Guangdong | Nanjing | 420 | Nanjing |
| BRA | 1079 | Rio de Janeiro (state) | Rio de Janeiro (city) | 1078 | Distrito Federal |
| CHN | (none — fallback: 415 Suiyuan) | — | Yan'an | 397 | Shaanxi |
| DNK | 67 | Hovedstaden | Copenhagen | 67 (unchanged) | Hovedstaden — confirmed correct (point ~200m outside polygon, nearest match) |
| CAN | 810 | Ontario | Ottawa | 810 (unchanged) | confirmed correct |
| JPN | 573 | Kanto | Tokyo | 573 (unchanged) | confirmed correct |
| AFG | 449 | Baghlan | Kabul | 449 (unchanged) | confirmed correct (real Kabul point lands in the "Baghlan"-named polygon in this dataset) |
| EGY | 1157 | Cairo | Cairo | 1157 (unchanged) | confirmed correct |

Plus, outside the coordinate-covered set: **IDN** 479 -> 495 (name-anchor
method, see above), **7 dead UAE entries removed**, **AGO left as an open,
unresolved finding** (see Unknowns).

**Total: 9 countries' capital fixed/added, 7 dead entries removed, out of
55 live `CAPITAL_REGION_OVERRIDES` entries.**

## Decision log

- Geography (point-in-polygon) chosen as the primary/strongest invariant for
  the 13 TS-anchored countries; name-anchor added as a complementary,
  broader-coverage mechanism for the rest of the table — see Alternatives.
- Coordinates reused by parsing `generateMapFeatures.ts` as text (regex),
  not by hand-copying values into Python or building a TS->JSON export
  pipeline — see Alternatives for the tradeoff.
- AGO and the ~48-entry / ~100-fallback-country long tails are reported,
  not fixed — matches the task's own stop condition ("если объём... больше
  ожидаемого... доложи") once the scope of a *complete* fix became clear
  (would need dozens of newly-sourced real-world coordinates, arguably the
  "invent a second list" the task explicitly warned against).
- Used a directory junction (`server/node_modules` -> main checkout's
  `server/node_modules`) to run `tsc`/`vitest` in this worktree, since this
  sandbox has no network access (`npm install` failed with `EAI_AGAIN`) and
  this worktree had no pre-installed `node_modules`. Same technique the
  2026-07-23 remap session used for the same reason (see `docs/DECISIONS.md`,
  "node_modules расшарен symlink'ами из основного checkout"). Read-only
  reference to the main checkout, does not modify it. Left in place
  (gitignored, does not appear in `git status`/diff).

## Validation

Run from `.claude/worktrees/capital-region-invariant` (cwd noted per command):

- `python scripts/map/validate_region_economy_1946.py` (repo root) — exit 0,
  "Все проверки пройдены чисто" (with the 2 new invariants active).
- `python scripts/map/test_validate_region_economy_1946.py -v` (repo root) —
  22/22 passed (9 pre-existing + 13 new).
- Scripted regression smoke test (not a committed test, ad-hoc): reverting
  `SUN` to its stale id made both new invariants fail with the expected
  message; reverting back restored the clean run — proves the invariants
  are load-bearing.
- `cd server && npx tsc --noEmit -p tsconfig.json` — exit 0, no output.
- `cd server && npm test` — 48 test files, 680 passed / 1 skipped (681) —
  identical numbers to the 2026-07-23 remap's own baseline.
- NOT run: `.agent/evals/public/run_public_evals.py` — this task changed
  game data + a Python validator, not agent configuration, so the public
  eval is not mandated by `AGENTS.md`'s trigger rule; skipped given the
  affected surface is already covered by the two targeted checks above plus
  server tests. NOT run: client `tsc`/`test`/`lint`/`build` — no client
  files touched.

Baseline failures: none — `validate_region_economy_1946.py` and
`test_validate_region_economy_1946.py` were both fully green before this
session's changes too (the bug was a false negative, not a reported
failure).

## Rollback / containment

Additive + one data regen, all within this worktree/branch:
- New files: `scripts/map/economy_1946/capital_overrides.py`,
  `scripts/map/economy_1946/capital_geography.py`.
- Modified: `scripts/map/generate_country_registry.py` (63-line inline dict
  replaced by an import), `scripts/map/validate_region_economy_1946.py`
  (2 new invariant functions + wiring), `scripts/map/test_validate_region_economy_1946.py`
  (new test classes), `server/data/scenarios/1946/countries.json`
  (9 `capitalRegionId` values changed, nothing else).
Revert via `git revert` of the relevant commit(s), or drop the branch — no
effect on `main` or any other worktree until explicitly merged.

## Final outcome

All progress items complete. Changed: see Rollback section file list.
Baseline failures: 0. Introduced failures: 0 (confirmed via the full
validation matrix above). Unresolved/deferred (see Assumptions/Unknowns):
`AGO` capital region (needs a geometry/regrouping decision, out of bounds
here); ~48 non-coordinate-anchored `CAPITAL_REGION_OVERRIDES` entries and
~100 fallback-heuristic countries not individually re-verified against real
coordinates (would need new sourced data — flagged as follow-up, not
invented here); `ARE` (Trucial Coast) has no capital override at all.
Fresh-session requirement: none to continue this specific plan; a *separate*
follow-up task would be needed to source real coordinates for the
non-covered countries if full coverage is ever wanted.
