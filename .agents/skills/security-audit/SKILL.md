---
name: security-audit
description: Perform a read-only security audit of AI-agent, Codex, Claude, MCP, hook, permission, and automation configuration. Use when checking prompt-injection exposure, secret handling, command execution, sandbox boundaries, MCP trust, or overly broad permissions. Never prints secret values or changes configuration automatically.
---

# Security Audit

Assess the agent execution boundary without weakening it and without exposing protected data.

## Workflow

1. Define the audited boundary: repository-local config, user-level config, MCP servers, hooks, skills, agents, CI, or automation.
2. Read applicable instructions and inventory configuration entry points. On Windows, include relevant `.codex/config.toml`, `.claude/settings*.json`, `.mcp.json`, agent files, hooks, and scripts when present.
3. Trace each capability from trigger to effect: input source, tool or command, permission boundary, filesystem/network reach, credentials, and resulting mutation.
4. Check for:
   - secrets embedded in files, arguments, URLs, logs, or generated output;
   - untrusted repository or web content treated as executable instructions;
   - broad shell prefixes, wildcard writes, destructive commands, or approval bypasses;
   - hooks or MCP servers that execute automatically or inherit excessive environment access;
   - duplicated servers/providers, stale configuration, or unclear ownership;
   - missing validation, path containment, quoting, timeout, and failure handling;
   - committed local indexes, caches, session data, or credentials.
5. Validate important claims with non-mutating checks. Treat managed sandbox policy and observed runtime behavior as separate evidence.
6. Rank findings by exploitability, impact, exposure, and confidence.

## Secret-safe handling

- Never output secret values, even when already present in a tracked file.
- Report only the key name, redacted location, and remediation class.
- Do not run commands that enumerate the full environment or credential stores.
- Do not connect to production, rotate credentials, install software, or alter permissions.

## Output

List findings first, ordered by severity. For each include evidence, attack path, impact, confidence, and smallest remediation. Then state verified controls, untested boundaries, and whether a focused follow-up is required. If there are no findings, say so without implying exhaustive proof.
