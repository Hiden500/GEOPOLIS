---
name: security-audit
description: Read-only audit of repository-scoped agent, MCP, hook, permission, secret-handling, and automation security boundaries.
---

# Security Audit

## Trigger

Use for prompt-injection, secrets, command execution, sandbox, MCP trust,
permissions, hooks, automation, or agent-configuration security reviews.

## Do not trigger

Do not scan user-level/private configuration unless explicitly in scope. Do not
rotate credentials, exploit systems, change permissions, or audit production.

## Required inputs

Audited boundary, repository path, threat focus, and allowed verification
surfaces. Default scope is tracked repository-local config plus directly invoked
local hooks/scripts.

## Workflow and tools

1. Inventory instruction, Codex/Claude/Gemini, MCP, skill, agent, hook, CI, and
   automation entry points in scope.
2. Trace each capability from trigger/input through permissions, environment,
   filesystem/network reach, mutation, and output.
3. Check secret exposure, untrusted content execution, broad command prefixes,
   approval bypass, auto-executed hooks, duplicated/stale providers, path
   containment, quoting, timeouts, failure handling, and committed local state.
4. Validate claims with non-mutating targeted reads/commands. Treat managed
   runtime policy separately from repository controls.
5. Rank by exploitability, impact, exposure, and confidence.

## Verification and failure conditions

Never print secret values; report only key names and redacted locations. When a
boundary cannot be observed, mark it `UNKNOWN`. A missing tool is not evidence
of safety. Stop if verification would require production access or mutation.

## Output

Findings first by severity, each with evidence, attack path, impact, confidence,
and smallest remediation. Then verified controls, untested boundaries, and
focused follow-up requirements.
