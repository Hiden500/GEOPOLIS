---
name: investigate
description: Diagnose failures, regressions, errors, or unclear behavior before proposing a fix. Read-only unless implementation is requested separately.
---

# Investigate

## Trigger

Use when the user asks why something fails, requests root-cause analysis, or
wants a regression reproduced and explained.

## Do not trigger

Do not use for a known mechanical implementation, general code review, QA with
predefined acceptance criteria, or when the user explicitly asks only for a fix
and the cause is already verified.

## Required inputs

Observed symptom, affected scope, expected behavior, current Git state, and the
relevant code/docs/config. Ask only if the missing input cannot be discovered.

## Workflow and tools

1. State the symptom and observable success criterion.
2. Read applicable instructions and only relevant sections of live/domain docs.
3. Reproduce with the narrowest non-mutating command, test, request, or UI flow.
4. Trace execution from symptom to inputs/invariants. Prefer Repowise when
   exposed; otherwise use `rg` and targeted reads.
5. Form competing hypotheses and a falsifier for each.
6. Run cheap non-mutating checks before broader ones. Do not edit, install,
   restart shared services, or change configuration.
7. Stop at a supported root cause or a precisely described evidence gap.

## Verification and failure conditions

A diagnosis is verified only when reproduction and evidence exclude the main
alternatives. If reproduction is impossible, required access is unavailable,
or hypotheses remain tied, report `BLOCKED/UNKNOWN`; do not guess. Never expose
secret values.

## Output

Report reproduction status, verified cause with file/symbol evidence, excluded
alternatives, impact, smallest recommended fix, baseline failures, and
unverified areas. Do not apply the fix unless separately requested.
