---
name: plan-challenger
description: Critically review an implementation, migration, refactor, rollout, or audit plan against the actual repository before work begins. Use when the user asks to challenge, review, de-risk, or approve a plan. This is an adversarial read-only review, not plan execution.
---

# Plan Challenger

Stress-test the plan against repository evidence and the user's underlying objective.

## Workflow

1. Extract the objective, proposed changes, assumptions, acceptance criteria, sequencing, and rollback story.
2. Read applicable repository instructions, `docs/TODO.md`, `docs/DECISIONS.md`, domain docs, architecture, current implementation, tests, and Git state.
3. Verify every material premise. Mark facts, inferences, assumptions, and unknowns separately.
4. Challenge the plan from these angles:
   - objective fit and unnecessary scope;
   - reuse versus parallel abstractions;
   - architecture boundaries, public contracts, migrations, and compatibility;
   - data integrity, security, permissions, and secret handling;
   - performance at project scale and operational failure modes;
   - testability, observability, rollback, and documentation footprint;
   - user experience, accessibility, localization, and edge states when relevant;
   - ownership conflicts and unrelated user work in the worktree.
5. Search for a third option that preserves the important advantages before presenting a forced A-versus-B trade-off.
6. Classify each issue as blocker, material revision, optional improvement, or unsupported concern.
7. Rewrite only the affected plan steps. Do not execute the plan or edit repository files.

## Output

Lead with verdict: ready, ready with revisions, or not ready. List findings by severity with repository evidence and consequence. Then provide a corrected minimal plan, explicit acceptance checks, rollback or containment where relevant, and unresolved decisions that truly require the user.

Do not manufacture objections to appear adversarial. If the plan is sound, state which risks were checked and why they are adequately controlled.
