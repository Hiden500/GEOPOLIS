# Sources and adaptation

## Source revisions

The integration was prepared from shallow clones of the official repositories on
2026-07-16:

| Project | Revision | Selected source material |
|---|---|---|
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `f8ac5e1266dba8354ea96e19994d9f4345e7ec31` | `src/ui-ux-pro-max/templates/base/skill-content.md`, `templates/platforms/codex.json`, design-system query/density/motion/variance concepts, accessibility and pre-delivery heuristics |
| [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | `984023ddac0d5e27624f2baacde6105e45de375f` | `.claude/skills/team-ui/SKILL.md`, `ux-design/SKILL.md`, `ux-review/SKILL.md`, UX/HUD/interaction/accessibility templates |
| [gstack-game](https://github.com/fagemx/gstack-game) | `7259ab9782fa9c17e45c16f1fb8347823ddb4379` | `game-ux-review`, `game-visual-qa`, `plan-design-review` source templates and their scoring/state/slop/threshold references |

Full upstream MIT notices are preserved in [LICENSES.md](../LICENSES.md).

## Retained concepts

- UI UX Pro Max: requirements-first analysis, design-system reasoning, semantic
  tokens, density/motion/variance as explicit dials, accessibility and state
  pre-delivery checks.
- Claude Code Game Studios: context-before-design, player need/arrival context,
  information hierarchy before layout, entry/exit mapping, data ownership,
  interaction maps, state coverage, localization, accessibility, and a read-only
  review gate before implementation.
- gstack-game: game-specific UX rather than generic app UX, scenario narration,
  genre-swap/AI-slop challenge, interaction-state coverage, evidence-calibrated
  visual QA, target viewport/input checks, and design-plan review.

## Upstream mechanisms

The first adaptation (2026-07-16) targeted Codex, so upstream mechanisms that
Codex lacked were replaced by substitutes. Codex is no longer used on this
project and Claude Code is the only runner, so those substitutes are retired:
the mechanisms below are native again and are used under the repository rules.

| Upstream mechanism | Status here |
|---|---|
| slash commands such as `/team-ui` or `/ux-review` | native, but still one skill: modes are routed inside `SKILL.md` and invoked as `/strategy-game-ui`, not split into a command per mode |
| `Task`, named agents, and a fixed agent hierarchy | delegation is native and permitted for independent read-only slices, such as the `ui-reviewer` subagent; the fixed hierarchy stays rejected, and a subagent report is evidence to reconcile, not a verdict |
| `TodoWrite` and session-state files | native session tooling tracks progress; `~/.gstack` and other home-directory artifacts stay out, and durable notes go into repository files the user asked for |

The remaining upstream mechanisms were never refused because of the runner, and
they stay refused:

| Upstream mechanism | Why it is still refused |
|---|---|
| `AskUserQuestion` at every section | repository evidence and autonomous reversible decisions come first; user input is for material product semantics |
| hooks, Bash preambles, Bun generation, telemetry, global installs | no runtime hooks, telemetry, package installation, or home-directory writes |
| fixed `design/gdd/**` and `.claude/**` paths | canonical docs and code are discovered through repository instructions and `rg` |
| external CLI second opinion | no nested provider CLI; independent review happens through repository agents |
| automatic plan/code writes | read-only by default; mutation requires the user's requested mode |

## Deliberate deviations

- No predetermined screen catalog. Screens and panels are outputs of scenario
  discovery, not inputs to it.
- No universal weighted score. A score is allowed only when all weighted evidence
  was observed; otherwise criteria are `PASS/FAIL/PARTIAL/UNKNOWN`.
- No mechanical use of vendor pixel tables. Browser CSS pixels, OS scaling,
  viewing distance, target platform, and project requirements control thresholds.
- No monetization, multiplayer, inventory, health, combat-HUD, or mobile checks
  unless repository evidence makes them applicable.
- No promise that static inspection proves visual quality or input behavior.

## License boundary

This skill is a rewritten, project-oriented adaptation rather than a verbatim
installation of the upstream packs. License notices remain because workflow
structure, review concepts, and some terminology were materially informed by the
MIT sources.
