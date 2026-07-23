# Pre-implementation design-plan review

## Scope

Review a plan that contains player-facing UI, interaction, map, HUD, overlay, or
notification work. Do not implement code. Do not edit the plan unless the user
explicitly asks for plan revision; otherwise return precise proposed additions.

Read the plan, applicable instructions, mechanics/docs, current UI implementation,
existing components/tokens, and prior decisions. If the plan has no UI implication,
state that this review mode is not applicable.

## Fix-to-ready method

For every pass:

1. state current evidence and missing decisions;
2. describe what implementation-ready means for this plan;
3. propose the smallest additions that close the gap;
4. identify genuine product decisions separately from mechanical omissions;
5. label unresolved assumptions and the consequence of deferring them.

Scores may summarize coverage, but never substitute for missing decisions. Do not
inflate vague phrases such as “clean,” “intuitive,” “modern,” or “responsive.”

## Pass 1: scenario and information architecture

- Does every planned surface map to an evidenced player scenario?
- Is first/second/third information priority explicit?
- Are persistent/contextual/on-demand decisions justified?
- Are entry, exit, back, preservation, and cross-surface relationships defined?
- Does the map remain the spatial model where appropriate?

Add a scenario-to-surface matrix and flow diagram derived from mechanics, not a
stock screen tree.

## Pass 2: interaction states and recovery

Use [state-coverage-matrix.md](../assets/templates/state-coverage-matrix.md). Check
applicable default, hover, focus, pressed, selected, disabled, unavailable,
loading, empty, error, success, stale, insufficient, locked, pending, rejected,
no-selection, multi-selection, paused, and resolving states.

Every applicable state defines what the player sees, can do, and retains. The
plan must prevent duplicate commands and lost context during retry/rejection.

## Pass 3: player journey and expertise curve

Trace first meaningful action, first consequence, first failure, session resume,
repeated expert use, and long-campaign information load where supported. For each
moment, name the player need, likely mental state, UI support, and recovery.

Do not invent retention systems, daily rewards, monetization, or multiplayer when
the game does not contain them.

## Pass 4: game-specific identity

Apply the genre-swap test. Challenge generic dashboards, card grids, icon-only
navigation, default component styling, and reference-game copying. Require each
prominent visual/interaction choice to connect to the game's pillars,
cartographic model, historical framing, or decision rhythm.

Identity never overrides readability, input access, or consistent semantics.

## Pass 5: design-system alignment

Verify existing tokens/components are reused before proposing new ones. A plan is
ready when it identifies:

- semantic colors and non-color state reinforcement;
- type and spacing hierarchy;
- surface/elevation/border language;
- button, selection, tooltip, dialog, notification, list/table, and map-control
  patterns that actually apply;
- icon family/style and localization behavior;
- motion vocabulary and reduced-motion alternative;
- component ownership and justified variants.

If no system exists, propose the minimum contract needed for this scope; do not
silently create a parallel design system.

## Pass 6: input, accessibility, locale, viewport

Require explicit behavior for repository-supported targets:

- pointer, keyboard, gamepad, or touch as applicable;
- focus order, shortcuts/prompts, remapping claims, and input switching;
- contrast, color independence, semantic names/roles/states, text scaling, and
  reduced motion;
- localization expansion, plural/number/date formatting, overflow, and RTL only
  where supported;
- minimum/maximum logical viewports, UI scale, map/control collision, and modal
  containment.

“Responsive” without target states and acceptance criteria is incomplete.

## Pass 7: unresolved decisions and gates

List each unresolved item with:

```text
decision | why it matters | default if deferred | player risk | owner | gate
```

Only ask the user about materially different product semantics. Resolve ordinary
mechanical omissions from repository evidence and established patterns.

## Output

Lead with `READY`, `READY WITH REVISIONS`, or `NOT READY`. Then provide pass-by-
pass findings, proposed plan additions, intentionally excluded work, unresolved
product decisions, and executable acceptance gates. Implementation remains out of
scope.

