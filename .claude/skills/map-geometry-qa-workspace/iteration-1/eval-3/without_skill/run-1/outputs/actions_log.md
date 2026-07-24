# Actions log — Greenland absorb_slivers threshold question

## Task

Advisory question: should the shared `MAX_COMPACT_AREA`/compactness
threshold in `absorb_slivers` be loosened to close a compact (non-ribbon)
gap cell on Greenland's east coast that the script currently rejects.
Required to check `docs/TODO.md`/`docs/DECISIONS.md` for real prior
history before answering.

## What was read/checked, in order

1. `git status`, `git log --oneline -10` in the working worktree
   (`worktree-agent-a2d612fe706904df4`, based on `main`, HEAD `a2b9768`).
2. Searched this worktree for `absorb_slivers`/`MAX_COMPACT_AREA`/`sliver`/
   `compact` (Grep, plain `grep -ril`) across `.py`/`.md`/`.json`/`.txt` —
   **zero matches**. `scripts/map/build/` in this worktree contains no
   `geometry_cleanup.py` at all.
3. Read `docs/TODO.md` (full, 349 lines) and `docs/DECISIONS.md` (first
   716 of 1093 lines) in this worktree — **no mention of Greenland,
   Svalbard, `absorb_slivers`, or a compactness threshold anywhere**. Also
   grepped the remainder of `docs/DECISIONS.md` (lines 717–1093)
   specifically for "Гренланд|Greenland" — no hits.
4. `git log --all --oneline -i --grep="sliver"` and `--grep="greenland"` —
   found the real commits: `af0ca49` (introduces `absorb_slivers` in
   `scripts/map/build/geometry_cleanup.py`), `f59b754` (fixes a ribbon-
   exception gap for gate 2, explicitly leaves Greenland/Svalbard
   unfixed), `535156d` (adds `diagnose_coastline_gaps.py`, finds the same
   rejected class is much larger than Greenland/Svalbard alone).
5. `git merge-base --is-ancestor f59b754 HEAD` → **not an ancestor**;
   `git branch -a --contains f59b754` → only `claude/1946-map-geometry-
   cleanup`. Confirmed this entire feature/history lives on an unmerged
   branch, not on `main` or this worktree.
6. Read (via `git show claude/1946-map-geometry-cleanup:<path>`, read-only,
   no checkout/merge performed) that branch's:
   - `docs/TODO.md` and `docs/DECISIONS.md` (dumped to scratchpad,
     grepped for "Гренланд|Greenland" with context) — found the actual
     documented reasoning, dated 2026-07-23 and 2026-07-24.
   - `scripts/map/build/geometry_cleanup.py` (full file, 362 lines) — read
     the real `absorb_slivers()` implementation and constants
     (`MAX_COMPACT_AREA=0.008` deg², `MAX_RIBBON_AREA=0.08` deg²,
     `RIBBON_COMPACTNESS=0.12`, the two rejection gates, the ribbon
     exception fixed 2026-07-23 for gate 2 only).
   - `scripts/map/build/diagnose_coastline_gaps.py` (full file, 308 lines)
     — read the COASTLINE/LAND_HOLE/LAND_SEAM classifier and the
     `minimum_rotated_rectangle` aspect-ratio technique used to work
     around compactness being fooled by jagged admin-border vertices.
   - `.agent/plans/absorb-slivers-ribbon-gate-fix.md` (full ExecPlan,
     153 lines) — found the explicit "Alternatives and selected decision"
     section stating the global-threshold-loosening option was considered
     and rejected on 2026-07-23.
   - `.claude/skills/map-geometry-qa/SKILL.md` (grepped for "Гренланд|
     Greenland|компактн|compact" with context, ~1287 lines total) — found
     the same conclusion restated as accumulated lessons, plus the
     `minimum_rotated_rectangle` lesson and the "safe if it touches an
     already-registered water body directly" candidate idea for a future
     narrower mechanism.
7. Confirmed `git log --oneline --all --diff-filter=A -- scripts/map/
   build/geometry_cleanup.py` → introduced only at `af0ca49`, which is
   also not an ancestor of `main` — i.e. the whole `absorb_slivers`
   mechanism (not just the Greenland decision) is exclusive to the
   unmerged branch.

## Key facts extracted (with source)

- Greenland: 11 cells / 853.7 km², Svalbard: 5 cells / 143.1 km² —
  unchanged as of 2026-07-23. Rejected by gate 1 (general gate), not gate
  2 (the one fixed that day for ribbon-shaped 1-land-touch cells).
  Example cell compactness values: 0.447 (83.6 km²), 0.163 (51.7 km²),
  0.230 (134.8 km²) — all above `RIBBON_COMPACTNESS=0.12`, so none
  qualify for the ribbon exception; all exceed `MAX_COMPACT_AREA`
  (~70-90 km²). Source: `docs/DECISIONS.md` entry "2026-07-23 — Найден и
  исправлен общий баг absorb_slivers" (branch).
- The global-loosening option was explicitly considered and rejected
  2026-07-23. Source: `.agent/plans/absorb-slivers-ribbon-gate-fix.md`
  §"Alternatives and selected decision" (branch): shared function (6+
  calling scripts), risk of false-absorbing a real un-mapped small lake
  judged disproportionate to the benefit for a case an order of magnitude
  smaller than what was already fixed.
- 2026-07-24 follow-up (`diagnose_coastline_gaps.py`, branch) found the
  same gate-1-rejected class is NOT limited to Greenland/Svalbard: 991
  COASTLINE cells / 4701.1 km² worldwide, concentrated on Alaska's fjord
  coast (verified real via zoomed render + geodesic width 1-11 km, not
  render-noise), plus isolated cases on other continents. Combined with a
  distinct LAND_HOLE class (24 cells / 2732.5 km², mostly Brazil/Paraguay),
  total ~1015 cells / ~7434 km² — comparable in scale to the already-
  applied Great Lakes fix (1509 km²) + its global side effect (14,112
  km²). Recorded explicitly as a priority decision for the user (fix now
  vs. defer), not a technical detail.
- Recommended technical direction already identified in the docs (not
  "loosen the number"): replace/augment perimeter-based `compactness()`
  with `minimum_rotated_rectangle` aspect ratio (+ absolute geodesic
  width) — already validated in this same codebase on a real case (a
  1464 km² Brazil/Paraguay blob scored compactness=0.0024, a false
  "ribbon" reading, but aspect ratio correctly gave 1.5, "nearly
  square"). Not yet implemented inside `absorb_slivers` itself.

## Recommendation given

**Recommended against loosening the shared `MAX_COMPACT_AREA`/compactness
threshold globally.** This is not a fresh judgment call — it restates and
reinforces a decision the project already made and documented on
2026-07-23 (rejected explicitly in the ExecPlan's "Alternatives" section)
and the 2026-07-24 follow-up data makes the case stronger, not weaker: the
same rejected class turned out to be ~7x larger than Greenland+Svalbard
alone (~7434 km² vs. ~997 km²) and mostly unverified by render, so a
"small" threshold change would in practice open an uncontrolled,
world-wide blast radius rather than a Greenland-only fix.

Instead, the response recommends two non-mutually-exclusive paths that
don't touch the shared gate:
1. A metric swap (compactness → `minimum_rotated_rectangle` aspect ratio +
   absolute width) as the principled general fix, ideally scoped together
   with Alaska (the dominant share of the same class) rather than
   Greenland alone, since Greenland is a small fraction of the same
   backlog.
2. If the user wants Greenland specifically closed now: a targeted,
   one-off geometry patch for that confirmed cell (render-verified, same
   rigor as the Great Lakes fix), leaving `absorb_slivers`'s shared
   thresholds untouched — the same pattern already used elsewhere in this
   project's history for one-off geographic corrections (e.g. Aral Sea,
   Faroe Islands).
3. Noted this is a purely cosmetic ~0.04%-of-feature-area seam (does not
   affect region economy/population, which are computed from the
   pipeline's registered feature area), so deferring it entirely is also
   a legitimate option.

Also flagged as a separate, prior-order concern: `absorb_slivers` and its
entire documented history exist only on the unmerged branch
`claude/1946-map-geometry-cleanup` — this worktree (based on `main`) has
none of it. Whether/when that branch merges into `main` is a more basic
open question than the threshold itself.

## Not done / out of scope

- Did not modify any code, docs, or the map pipeline output — this was a
  read-only advisory task.
- Did not check out, merge, or alter `claude/1946-map-geometry-cleanup` or
  any other branch; all cross-branch reads used `git show branch:path`
  from within this worktree's own branch.
- Did not independently re-verify the Alaska/Greenland cell geometry by
  running `diagnose_coastline_gaps.py` or any render — the numbers above
  are as recorded in the branch's own commit messages/docs, not
  independently re-derived in this session.
