---
name: plan-challenger
description: Adversarial read-only review of an implementation, migration, refactor, rollout, or audit plan against repository evidence.
---

# Plan Challenger

## Trigger

Use when the user asks to challenge, review, de-risk, approve, or improve a
material plan before execution.

## Do not trigger

Do not use to execute the plan, review an already-written code diff, or add
ceremonial objections to a small reversible change.

## Required inputs

The plan or stated objective, acceptance criteria, affected scope, and current
repository state. Discover code/docs assumptions rather than asking for them.

## Workflow and tools

1. Extract objective, proposed changes, assumptions, sequencing, rollback, and
   acceptance criteria.
2. Read applicable instructions, relevant live/domain docs, implementation,
   tests, config, and Git state using Repowise when available or `rg`/reads.
3. Verify every material premise; label fact, inference, assumption, unknown.
4. Challenge objective fit, reuse, contracts/migrations, data/security,
   performance, UX/localization, testability, rollback, ownership, and dirty
   worktree risks where relevant.
5. Search for a third design before forcing an A/B trade-off.
6. Classify issues: blocker, material revision, optional, unsupported concern.
7. Rewrite only affected plan steps; do not edit repository files.

## Verification and failure conditions

The review is complete when each material premise and acceptance gate has
evidence or is explicitly unknown. If the plan or repository context is
unavailable, return `BLOCKED`; never invent constraints or approval.

## Output

Lead with `READY`, `READY WITH REVISIONS`, or `NOT READY`; then findings by
severity, corrected minimal plan, executable checks, rollback/containment, and
only the decisions that truly require the user.
