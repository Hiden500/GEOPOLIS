---
name: qa
description: Read-only verification of acceptance criteria, product behavior, regressions, APIs, UI states, and release readiness without implementing fixes.
---

# QA

## Trigger

Use for test, smoke-test, reproduction, acceptance validation, regression
assessment, or release-readiness requests.

## Do not trigger

Do not use to implement fixes, alter fixtures/snapshots, or replace a root-cause
investigation whose primary question is “why”.

## Required inputs

Feature/flow scope, expected behavior or acceptance criteria, target environment,
and current Git state. Derive missing criteria from canonical docs/tests where
possible; report conflicts.

## Workflow and tools

1. Build the smallest matrix covering happy path, boundaries, invalid input,
   loading/empty/error/success, persistence, permissions, and regressions.
2. Capture baseline and relevant diff before attributing failures.
3. Use targeted tests/typechecks, API/service smoke tests, and browser/viewport
   checks only when those capabilities are available.
4. Disposable local outputs are allowed only when the command is a documented
   verification step and cleanup is safe; never mutate shared/production state.
5. Record command/environment/input, expected, actual, exit/status, and
   reproducibility for every failure.

## Verification and failure conditions

Mark a criterion passed only after its observable flow executed. Static review
is `PARTIAL`, not E2E. Return `BLOCKED` when required services, browser, data,
credentials, or permissions are unavailable; do not weaken checks.

## Output

Per criterion: `PASS`, `FAIL`, `PARTIAL`, or `BLOCKED`. Separate confirmed
defects, baseline failures, observations, and untested areas. Defects include
severity, prerequisites, exact steps, expected/actual, evidence, scope, and
reproducibility.
