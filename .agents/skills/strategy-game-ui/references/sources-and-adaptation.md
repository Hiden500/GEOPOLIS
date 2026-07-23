# Sources and Codex adaptation

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

## Codex replacements

| Upstream mechanism | Codex-compatible replacement |
|---|---|
| Claude slash commands such as `/team-ui` or `/ux-review` | one auto/explicit Codex skill with mode routing and `$strategy-game-ui` invocation |
| `Task`, named Claude agents, and fixed agent hierarchy | main-agent workflow; optional Codex collaboration only when user/repository instructions authorize independent delegation |
| `AskUserQuestion` at every section | repository evidence and autonomous reversible decisions; user input only for material product semantics |
| `TodoWrite`, session-state files, and `~/.gstack` artifacts | current Codex plan/commentary and user-requested repository artifacts only |
| hooks, Bash preambles, Bun generation, telemetry, global installs | no runtime hooks, telemetry, package installation, or home-directory writes |
| fixed `design/gdd/**` and `.claude/**` paths | discover canonical docs and code through repository instructions and `rg` |
| external CLI-to-Codex second opinion | no nested provider CLI; use native collaboration only when permitted |
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
