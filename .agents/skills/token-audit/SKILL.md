---
name: token-audit
description: Read-only audit of persistent agent context for duplication, stale instructions, unnecessary always-loaded content, and avoidable token cost.
---

# Token Audit

## Trigger

Use when reviewing AGENTS, provider adapters, Codex config, skills, agents, or
hooks for context efficiency and instruction clarity.

## Do not trigger

Do not use as a general source audit or to shorten a prompt without checking
authority, safety, and references. Do not edit unless explicitly requested.

## Required inputs

Repository root, instruction/config scope, relevant clients, and any known
context limit. Unknown tokenizer/model details must remain unknown.

## Workflow and tools

1. Inventory always-loaded, path-scoped, conditional, and task-local context.
2. Record size/line count; `characters / 4` may be used only as a labeled rough
   estimate, never as tokenizer output.
3. Find exact/semantic duplication and stale contradictions.
4. Classify each item: keep always loaded, move to skill, move to canonical
   docs, derive at runtime, or delete.
5. Check references and provider loading behavior before deletion. Use `rg` and
   targeted reads; use Repowise only when exposed.
6. Rank by recurring cost, ambiguity reduction, and migration risk.

## Verification and failure conditions

Claims about actual loading require client/CLI evidence; file presence alone is
`UNVERIFIED`. Do not enumerate secrets or private config. If loading/tokenizer
behavior cannot be observed, provide estimates with explicit uncertainty.

## Output

Table: location, issue, evidence, target layer, rough recurring savings, risk.
End with a minimal migration sequence, preserved guardrails, and unknowns.
