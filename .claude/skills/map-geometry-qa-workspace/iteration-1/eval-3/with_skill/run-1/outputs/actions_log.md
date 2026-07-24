# Actions log — Greenland compactness threshold question

## Task
Advisory question: should the shared `MAX_COMPACT_AREA`/`compactness`
threshold in `absorb_slivers` be loosened to absorb a compact (non-ribbon)
gap cell on Greenland's east coast?

## Skill file location issue (first finding)
`.claude/skills/map-geometry-qa/SKILL.md` does not exist in this agent's own
worktree (`D:\Pax Historia LOCAL\.claude\worktrees\agent-a8317b249a8dfffed`,
branched from `main` @ a2b9768). Checked `git worktree list`: found it at
`D:\Pax Historia LOCAL\.claude\worktrees\capital-region-fix`
(branch `claude/1946-map-geometry-cleanup`, not yet merged to `main`).
Confirmed via Bash/Grep that this same worktree also lacks
`scripts/map/build/geometry_cleanup.py`, `absorb_slivers`,
`diagnose_coastline_gaps.py`, etc. entirely — the whole gap-fixing
apparatus this question is about lives only in that other branch/worktree.
Read the skill (1288 lines) and the relevant docs directly from
`capital-region-fix` (Read/Grep tool, not `git`, so the earlier
worktree-isolation refusal on `Bash`+`cd`/`git` didn't apply) rather than
re-deriving the investigation from scratch. Did not run any script or write
any file in `capital-region-fix` — read-only, respecting that it isn't this
task's worktree.

## What was read
- `.claude/skills/map-geometry-qa/SKILL.md` (capital-region-fix worktree),
  in full (two reads, offset 0 and 815, 1288 lines total). Key hit: the
  bullet "Not every rejected-by-a-safety-gate cell has the same root
  cause" — documents the exact Greenland case (11 cells/853.7 km²,
  rejected by gate 1, example compactness 0.16-0.45) and already concludes
  loosening the general gate is "materially different, riskier."
- `docs/TODO.md` (capital-region-fix), Greenland/Svalbard entry (~lines
  349-396): confirms the same-class backlog is much wider than Greenland
  alone — `diagnose_coastline_gaps.py` found COASTLINE: 991 cells/4701.1 km2
  worldwide, same subclass, concentrated on Alaska's coast. States
  "дальнейшее ослабление общего порога компактности рискованно ... решение
  о приоритете за пользователем" (not yet decided).
- `docs/DECISIONS.md` (capital-region-fix):
  - 2026-07-23 entry "Найден и исправлен общий баг absorb_slivers"
    (~lines 3861-3952): the gate-2 ribbon-exception fix (Great Lakes,
    +14,112 km2 globally) that was already done, and the explicit
    "NOT fixed this round" note for Greenland (853.7 km2/11 cells) and
    Svalbard (143.1 km2/5 cells) — rejected by gate 1 (general), not gate 2.
    Gives specific per-cell compactness values (83.6 km2/0.447, 51.7 km2/
    0.163, 134.8 km2/0.230) and the Kinneret (160 km2) comparison.
  - 2026-07-24 entry "Постоянный diagnose_coastline_gaps.py" (~lines
    3955-4034): formalizes the diagnostic, finds the 991-cell/4701.1 km2
    global COASTLINE class (same gate-1 rejection reason as Greenland),
    proposes `minimum_rotated_rectangle` aspect ratio as a more robust
    metric than raw Polsby-Popper compactness (validated on a Brazil/
    Paraguay blob: compactness=0.0024 falsely read as ribbon, aspect=1.5
    correctly read as compact blob) — candidate fix, not implemented in
    the actual absorption gate.
  - Also checked an earlier, unrelated Greenland mention (~line 2718,
    "СВ Гренландия/Nationalparken, 49.3 km2, тонкий клин") from an earlier
    2026-07-20 session — a different, smaller, separately-deferred case
    (thin wedge that doesn't touch land by the algorithm's own criterion),
    not the one this task's "compact, non-ribbon" description matches.
- `scripts/map/build/geometry_cleanup.py` (capital-region-fix): read the
  module docstring and `absorb_slivers` implementation directly to confirm
  current constants (`MAX_COMPACT_AREA=0.008` deg2, `MAX_RIBBON_AREA=0.08`,
  `RIBBON_COMPACTNESS=0.12`) and the two-gate structure described in the
  docs actually matches the code.
- `scripts/map/build/diagnose_coastline_gaps.py` (capital-region-fix): read
  in full to confirm `_mrr_aspect()` (minimum_rotated_rectangle aspect
  ratio) is implemented and validated, but only in this read-only
  diagnostic — not wired into `absorb_slivers` itself.
- `scripts/map/README.md` (capital-region-fix), checklist item 13: confirms
  the same rationale (compactness alone is known-unreliable for jagged
  coastlines; MAX_COMPACT_AREA's job is protecting undiscovered real lakes).
- Confirmed my own worktree (`agent-a8317b249a8dfffed`, based on `main`)
  has no `scripts/map/build/geometry_cleanup.py` or related diagnostics at
  all — this whole subsystem is unmerged work, so no live re-verification
  of current cell-level numbers was possible/attempted from here.

## Recommendation given
**Did not recommend loosening the shared `MAX_COMPACT_AREA`/compactness
threshold.** Reasons, in order of weight:
1. Shared function used by 6+ pipeline scripts — a global constant change,
   not a Greenland-local one.
2. The threshold's entire purpose is guarding against silently absorbing a
   real, not-yet-modeled lake; one of the Greenland candidate cells
   (compactness 0.447) is explicitly documented as being in the danger
   zone for that exact confusion.
3. The same gate rejects the same subclass at ~991 cells/4701.1 km2
   worldwide (mostly Alaska) — loosening enough to pass the ~50-135 km2
   Greenland cell would mechanically open most of that much larger,
   largely unverified backlog too, not just the one cell asked about.
4. The project's own docs already reached this same conclusion twice
   (2026-07-23, 2026-07-24) and left it as an explicit open,
   user-priority decision — nothing found suggests this was superseded by
   an approval to loosen it since.

**Recommended instead:** a narrower, targeted fix — either (A) a
point/local fix for just the one render-confirmed Greenland cell (no
change to the shared numeric constants), or (B), if the whole subclass is
in scope, replacing/supplementing raw Polsby-Popper compactness inside
`absorb_slivers` itself with the already-validated
`minimum_rotated_rectangle`-aspect-ratio approach (currently implemented
only in the read-only diagnostic) or a "touches an already-registered
water body directly" signal — both ideas already named in `docs/TODO.md`
as the candidate direction, neither implemented yet. Framed (B) as a
separate, larger task needing its own render+regression verification per
the skill's recipe, with priority left to the user, matching what the
docs already say.

## Not done / out of scope for this task
- Did not modify any code or docs (advisory-only task).
- Did not re-run `diagnose_coastline_gaps.py` or re-render the Greenland
  cell myself (not possible from this worktree; would also mean executing
  in another worktree not assigned to this task).
- Did not check for agent activity/newer commits in `capital-region-fix`
  beyond reading file contents (git commands into that worktree are
  blocked for a worktree-isolated agent).
