---
name: verify-change
description: Select and run the repository's real typecheck, test, lint, build, data, documentation, and agent-config checks for the files changed.
---

# Verify Change

## Trigger

Use after repository changes, before a local commit, or when the user asks for
verification/readiness evidence.

## Do not trigger

Do not run the full matrix for a read-only explanation with no changed files,
or substitute unrelated broad checks for a known targeted test.

## Required inputs

`git status`/diff, starting baseline failures, affected modules, and any explicit
acceptance criteria. Preserve unrelated user changes.

## Workflow and expected tools

1. Inspect changed paths and select the smallest complete matrix.
2. `client/` or shared client consumers:
   `npx tsc --noEmit -p tsconfig.app.json`, `npm test`, `npm run lint`; add
   `npm run build` for production/UI/build-config changes.
3. `server/` or shared server consumers:
   `npx tsc --noEmit -p tsconfig.json`, `npm test`.
4. scenario/map data:
   `python scripts/map/validate_region_economy_1946.py` and
   `python scripts/map/test_validate_region_economy_1946.py`; for
   `groups.json`/`demographics.json`/`ideology.json` also
   `python scripts/map/validate_demographics_1946.py` and
   `python scripts/map/test_validate_demographics_1946.py`.
5. instructions, skills, `.agent/`, `.gemini/`, provider adapters, or docs:
   `python .agent/evals/public/run_public_evals.py`.
6. Run targeted tests before full workspace checks. Capture exit codes and
   inspect output; distill noisy output only if the original remains available.
7. Review final diff and `git status` for generated/unrelated files.

## Verification and failure conditions

Success requires every selected check to exit 0 or an identical pre-recorded
baseline failure with no new diagnostics. Never call a failed gate green. Stop
and report when dependencies, runtime, services, browser, or permissions are
missing; do not install or weaken checks implicitly.

Independent verification passes yield diminishing returns: whatever is critical
surfaces in the first passes, the rest is detail. Threshold — fix what is
critical, file what is moderate to the backlog, do not chase what is cosmetic.
This decides how many passes are enough; it does not license skipping a check
the changed scope requires.

## Output

List selected scope, command/cwd, exit code, observed result, and duration when
available. Separate passed checks, baseline failures, introduced failures, and
not-run/blocked checks. Finish with commit readiness, not a generic “all good”.
