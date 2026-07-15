---
name: token-audit
description: Audit persistent AI-agent context for duplication, unnecessary always-loaded instructions, oversized skills, and avoidable token cost. Use when reviewing AGENTS.md, CLAUDE.md, Codex or Claude configuration, skills, hooks, or agent prompts for context efficiency. Produces recommendations only unless edits are explicitly requested.
---

# Token Audit

Find context that can be removed, narrowed, or loaded only when needed without losing stable guardrails.

## Scope

Inspect only files that influence agent context, including applicable `AGENTS.md`, `.claude/CLAUDE.md`, `.agents/skills`, `.claude/skills`, agent definitions, hooks, and Codex configuration. Do not scan application source unless needed to verify that an instruction is derivable from code or configuration.

## Workflow

1. Inventory persistent, conditional, and task-local context separately.
2. Record file size, line count, and a rough token estimate. Use `characters / 4` only as an explicitly labeled approximation; do not present it as tokenizer output.
3. Identify exact or semantic duplication across global, repository, nested, skill, and documentation layers.
4. Classify every finding:
   - keep always loaded: stable high-impact guardrail;
   - move to a skill: conditional repeatable workflow;
   - move to canonical docs: domain knowledge or explanation;
   - derive at runtime: facts reliably available from code or executable config;
   - delete: stale, contradictory, or redundant instruction.
5. Check references before recommending deletion. A shorter prompt is not better if it hides required authority or safety rules.
6. Rank findings by estimated recurring cost, ambiguity reduction, and migration risk.

## Safety

- Remain read-only unless the user asks for edits.
- Do not print environment values, credentials, tokens, or complete private configuration.
- Do not recommend a second repository-intelligence or external-docs provider when Repowise or Context7 already covers the need.
- Preserve the narrowest authoritative source instead of creating a new summary layer.

## Output

Provide a table with location, issue, evidence, recommended layer, rough recurring savings, and risk. End with a minimal migration sequence and call out estimates and unverified assumptions.
