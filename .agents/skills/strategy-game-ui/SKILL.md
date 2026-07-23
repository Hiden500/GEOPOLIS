---
name: strategy-game-ui
description: Evidence-based UI/UX discovery, design specification, plan review, and visual QA for grand-strategy and simulation games. Use when Codex needs to derive interface surfaces from gameplay loops and repository evidence; audit or plan maps, HUDs, panels, overlays, notifications, and flows; review information architecture, game-specific visual identity, interaction states, accessibility, localization, keyboard/gamepad support, resolutions, components, themes, or design tokens; or inspect screenshots and a running build without changing game code unless implementation is separately requested.
---

# Strategy Game UI

## Operating contract

Treat the game, its mechanics, and its player decisions as the source of the
interface. Do not begin from a stock screen list, a SaaS dashboard pattern, or a
reference game's navigation. Derive surfaces only after reconstructing gameplay
scenarios from repository evidence.

Default audits and reviews to read-only. Do not edit game UI, game code, product
docs, plans, or design tokens unless the user explicitly requests that separate
mutation. Distinguish `VERIFIED`, `INFERRED`, `ASSUMED`, and `UNKNOWN`; static code
review never proves runtime or visual behavior.

## Trigger

Use for grand-strategy or simulation UI/UX discovery, specification, audit,
design-plan review, component/state analysis, information architecture, or
rendered visual QA when decisions must be grounded in gameplay and repository
evidence.

## Do not trigger

Do not use as a generic web/SaaS design pack, for non-game frontend work, or to
implement UI when the user requested review only. Do not use it to invent game
mechanics, metrics, platforms, or screens absent from the project.

## Required inputs

Require repository root, current Git state, applicable instructions, intended
review mode, relevant canonical docs/code, and any available target platform,
viewport, input, locale, runtime, or screenshot evidence. Discover missing inputs
from the repository before asking the user.

## Select the mode

- **Discovery audit**: derive scenarios, information architecture, missing
  surfaces, component/state gaps, current problems, and priorities. Read
  [repository-discovery.md](references/repository-discovery.md),
  [strategy-game-heuristics.md](references/strategy-game-heuristics.md), and
  [ux-review.md](references/ux-review.md).
- **UX specification**: turn an evidenced scenario into an implementation-ready
  interface contract. Use the scenario and state templates under
  [assets/templates](assets/templates/README.md). Keep implementation out of scope
  unless separately requested.
- **Design-plan review**: challenge a UI-bearing plan before implementation. Read
  [design-plan-review.md](references/design-plan-review.md).
- **Visual QA**: inspect screenshots or a running build at evidenced target
  viewports and inputs. Read [visual-qa.md](references/visual-qa.md). If no rendered
  evidence is available, report `PARTIAL` rather than simulating a visual pass.

When a request spans modes, run discovery first, then UX review, then visual QA.
Do not let a visual score hide missing scenario or interaction coverage.

## Workflow

### Start from repository evidence

1. Capture current Git state and read applicable `AGENTS.md` files, the project
   README, relevant live decisions/backlog, and canonical domain documents.
2. Locate the actual game loop, command paths, data contracts, UI entry points,
   map/scene composition, routes, components, styles/themes/tokens, localization,
   input handling, tests, and supported-platform configuration. Prefer `rg` and
   targeted reads; never scan secret values.
3. Reconstruct player scenarios as `trigger -> player goal -> decision -> action ->
   system response -> visible feedback -> next decision`. Include failure and
   recovery only where the mechanics or implementation make them applicable.
4. For each scenario, classify information as `persistent`, `contextual`,
   `on-demand`, or `not visualized`. Require evidence before promoting data to
   permanent HUD space.
5. Only then derive screens, panels, windows, overlays, notifications, and
   navigation. A surface must earn its existence through a player task, timing
   constraint, comparison need, or recovery path.

Use [scenario-interface-matrix.md](assets/templates/scenario-interface-matrix.md)
for the inventory. Do not fill rows with hypothetical mechanics presented as
project requirements.

## Build the interface architecture

For every derived surface, specify:

- player need and arrival context;
- entry, exit, back/cancel, and state-preservation behavior;
- first, second, and third information priority;
- data source/owner, refresh trigger, null/stale handling, and whether the UI is
  read-only or emits a validated command;
- reusable component/pattern and any justified exception;
- pointer, keyboard, and gamepad interaction if those inputs are targeted;
- default, hover, focus-visible, pressed, selected, disabled, unavailable,
  loading, empty, error, success, and domain-specific applicable states;
- localization expansion, wrapping, numeric/date formatting, and bidirectional
  layout implications where supported;
- minimum/maximum target viewport behavior, overflow, overlap, and focus order.

Use functional layers only after scenario discovery: world/map, persistent
status, contextual selection, focused decision workspace, interruption/modal,
and feedback queue. These are classification aids, not a mandatory screen set.

## Review the player experience

Apply the passes in [ux-review.md](references/ux-review.md):

1. game loop and player-need coverage;
2. information hierarchy, glanceability, and density;
3. navigation, selection context, comparison, and command feedback;
4. interaction-state and recovery coverage;
5. accessibility, localization, input, and viewport behavior;
6. component/token reuse and cross-surface consistency;
7. visual identity and the genre-swap test.

Reject generic praise. State the observed decision, why it helps or harms a
specific scenario, and the evidence. A recommendation must name what changes for
the player, not only what component moves.

## Run visual QA honestly

Use available browser/screenshot tools and inspect captured images. Cover the
repository's actual target viewports, plus the narrowest and widest supported
cases. Exercise applicable loading, empty, error, success, selection, hover,
focus, disabled/unavailable, localization, and input states. Record each capture
in [visual-qa-register.md](assets/templates/visual-qa-register.md).

Do not claim contrast, clipping, responsiveness, animation quality, focus order,
or gamepad behavior passed unless measured or exercised. Vendor thresholds are
heuristics; project requirements, browser CSS pixels, OS scaling, and target
hardware take precedence.

## Prioritize findings

- **P0**: blocks the core loop, loses/obscures a consequential command, traps the
  player, or creates a serious accessibility/safety failure.
- **P1**: materially harms a frequent decision, makes critical state ambiguous,
  or breaks a supported viewport/input.
- **P2**: recurring friction, inconsistency, missing recovery/state, or weak reuse
  with a practical workaround.
- **P3**: polish or low-frequency clarity issue.

For every finding include scenario, evidence, expected player outcome, actual or
inferred outcome, recommendation, acceptance criterion, and confidence. Separate
confirmed defects from design gaps and unverified risks.

## Verification and failure conditions

Complete discovery only when every proposed surface maps to an evidenced
scenario. Complete UX review only when each reported criterion has evidence or an
explicit `UNKNOWN`. Complete visual QA only when the claimed viewports, inputs,
and states were rendered and inspected. Missing runtime, screenshots, target
contracts, or reachable states produce `PARTIAL`/`UNKNOWN`, never a fabricated
pass. Conflicting product semantics that code/docs cannot resolve require user
direction; missing optional tooling does not authorize installation or weaker
checks.

## Output

Base the report on [audit-report.md](assets/templates/audit-report.md). Include:

1. evidence and validation limits;
2. gameplay scenario analysis;
3. derived interface architecture and information visibility;
4. reuse opportunities and missing component states;
5. current UX and visual findings by priority;
6. phased implementation recommendations without implementing them;
7. readiness criteria for the next stage.

Scores are optional. Use them only when the entire stated rubric is observed;
otherwise prefer per-criterion `PASS`, `FAIL`, `PARTIAL`, or `UNKNOWN`.

## Codex compatibility

Use repository reads, shell commands, image inspection, browser automation, and
Codex collaboration tools only when available and authorized. Do not invoke
Claude slash commands, `Task`, `AskUserQuestion`, `TodoWrite`, provider hooks,
gstack telemetry, Bun generation, or writes under user-home artifact folders.
Do not require subagents; if repository/user instructions explicitly allow them,
delegate only independent read-only slices and reconcile evidence in the main
report. See [sources-and-adaptation.md](references/sources-and-adaptation.md).

