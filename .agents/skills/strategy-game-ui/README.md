# Strategy Game UI

Project-local Codex skill for evidence-based UI/UX discovery, specification,
plan review, and visual QA in grand-strategy and simulation games.

Invoke explicitly with `$strategy-game-ui`, for example:

```text
Use $strategy-game-ui to audit the current game interface without changing code.
Use $strategy-game-ui in visual-QA mode on the running build.
Use $strategy-game-ui to review this UI implementation plan before coding.
```

The skill does not install dependencies and does not require the upstream packs
at runtime. It adapts their reusable methods to repository-first Codex workflows:

- scenario-first interface discovery instead of a predetermined screen list;
- UX specification and review gates grounded in mechanics and player journeys;
- design-plan review for information architecture, states, identity, inputs, and
  unresolved product decisions;
- screenshot/build visual QA with explicit evidence limits;
- design-system reasoning for density, motion, hierarchy, components, and tokens.

## Contents

- [SKILL.md](SKILL.md) — entry workflow and mode routing.
- [repository-discovery.md](references/repository-discovery.md) — deriving UI
  needs from docs, mechanics, code, and flows.
- [strategy-game-heuristics.md](references/strategy-game-heuristics.md) —
  grand-strategy information and visual principles.
- [ux-review.md](references/ux-review.md) — read-only UX review passes.
- [visual-qa.md](references/visual-qa.md) — rendered-evidence QA.
- [design-plan-review.md](references/design-plan-review.md) —
  pre-implementation design-plan gate.
- [sources-and-adaptation.md](references/sources-and-adaptation.md) — upstream
  revisions and compatibility decisions.
- [audit templates](assets/templates/README.md) — reusable audit, scenario,
  state, and capture templates.
- [LICENSES.md](LICENSES.md) — upstream attribution and MIT notices.

Audits are read-only by default. UI/code implementation is a separate task and
must be requested explicitly.

## Validation

From the repository root, validate the skill metadata with the official
`skill-creator` validator, verify local Markdown links, scan for unsupported
provider commands, and run the repository public agent eval. Exact commands are
environment-specific; validation evidence belongs in the task report rather than
being embedded as a runtime dependency of this skill.

