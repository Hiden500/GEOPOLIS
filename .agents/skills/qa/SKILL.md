---
name: qa
description: Verify product behavior, acceptance criteria, regressions, UI states, APIs, and workflows as a read-only QA pass. Use when the user asks to test, smoke-test, validate a feature, reproduce a defect, or assess release readiness without implementing fixes. Records evidence and reports defects; does not auto-fix.
---

# QA

Test the requested behavior against explicit acceptance criteria and preserve the system under test.

## Workflow

1. Extract acceptance criteria from the request, canonical docs, existing tests, and current behavior. Flag conflicts instead of choosing silently.
2. Identify the smallest representative test matrix: happy path, boundaries, invalid input, loading, empty, error, success, persistence, permissions, and regression-sensitive flows.
3. Check the baseline and relevant Git state before attributing failures to the current change.
4. Use the narrowest available verification surface:
   - targeted automated tests and type checks;
   - API or service smoke tests;
   - browser flow and viewport checks when UI tooling is available;
   - static inspection only when execution is unavailable, clearly labeled.
5. Capture command, environment, input, expected result, actual result, and reproducibility for each failure.
6. Do not edit source, snapshots, fixtures, config, or tests; do not install dependencies or dismiss failing checks. If execution would mutate shared or production state, stop and report the required authorization.

## Defect quality

A defect report must contain:

- concise title and severity;
- preconditions and exact reproduction steps;
- expected and actual behavior;
- evidence such as error text, response status, or screenshot path;
- affected scope and reproducibility;
- whether it is baseline, regression, or unknown.

## Output

Lead with pass/fail/blocked status per acceptance criterion. Separate confirmed defects, baseline failures, observations, and untested areas. Do not claim end-to-end coverage when only static or partial checks ran. Recommend the next highest-value check or fix, but do not implement it unless asked separately.
