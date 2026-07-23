# Read-only UX review

## Review stance

Review the implemented or documented experience against evidenced player
scenarios. Do not edit files. Name the exact player action, context, and
consequence; avoid generic praise or generic screen checklists.

## Pass 1: loop and player need

For every scenario, verify that the player can:

- understand the current decision context;
- inspect the inputs and consequences that matter;
- act without leaving the game model unnecessarily;
- see whether the action succeeded, failed, or remains pending;
- continue to the next meaningful decision.

Flag orphan surfaces with no scenario and scenarios with no usable interface.

## Pass 2: hierarchy and density

Run an evidenced glance test suited to the game's pace. For a turn-based grand
strategy, do not import a combat-HUD half-second threshold blindly. Ask whether
the player can quickly identify:

1. current selection and map mode;
2. current time/turn state and any blocking condition;
3. decision-relevant national/local state;
4. urgent change or consequence;
5. next available action.

Check first, second, and third reading order, map occlusion, repeated values,
decorative competition, line length, typography hierarchy, number formatting,
and whether permanent UI earns its screen area.

## Pass 3: navigation and decision flow

Trace actual entry/exit routes rather than assuming a menu tree. Check:

- consistent back/cancel/Escape behavior and focus return;
- preserved selection, scroll, filters, map position, and comparison context;
- keyboard reachability and shortcut discoverability;
- gamepad focus graph and absence of pointer-only precision if gamepad is targeted;
- clear relationship between map selection, contextual panel, focused workspace,
  and notifications;
- destructive or irreversible actions show consequence and confirmation only
  where undo is not a better model.

UI navigation choices should be obvious; strategic choices should carry the
thinking load.

## Pass 4: state and recovery coverage

Use [state-coverage-matrix.md](../assets/templates/state-coverage-matrix.md).
Evaluate only applicable states, but require an explicit reason for `N/A` on
consequential components.

Core states include default, hover, focus-visible, pressed, selected, disabled,
unavailable, loading, empty, error, success, and stale. Strategy-specific states
may include insufficient resources, locked by rules, command pending/queued,
command rejected, no selection, multi-selection, paused, or simulation resolving.
Do not invent a state unsupported by the mechanics.

For each failure ask: what remains visible, what context is preserved, what the
player can do next, and whether retry could duplicate a command.

## Pass 5: onboarding and expertise

Review the first meaningful action, not only the presence of a tutorial. Verify:

- the first interactive frame indicates what the player can do;
- instruction arrives when the mechanic becomes relevant;
- learning occurs through a real low-risk decision where possible;
- help is recoverable after dismissal;
- expert players can skip or accelerate explanation;
- shortcuts and comparison tools support repeated long-campaign work.

Count forced tutorial text only when the actual flow is available. Otherwise mark
the metric `UNKNOWN`.

## Pass 6: access, locale, input, viewport

Check:

- color-independent meaning and measured contrast for text/components;
- visible focus, logical order, semantic names/roles/states, and no keyboard trap;
- motion-reduction behavior and no critical motion-only/audio-only information;
- current locale pipeline, expansion/wrapping, plurals, numbers, dates, currencies,
  proper nouns, and bidirectional behavior if supported;
- actual target minimum/maximum logical viewports, OS scaling, overflow, overlap,
  clipping, and map-control collisions;
- hot-switching of input prompts only if multiple input methods are claimed.

Accessibility requirements follow project targets and current platform standards.
Vendor pixel tables are heuristics, not automatic pass criteria for browser CSS.

## Pass 7: consistency and identity

Compare tokens, component variants, icon family/stroke, type scale, spacing,
selection/focus semantics, transition direction, notification priority, and color
meaning. Then apply the genre-swap test from
[strategy-game-heuristics.md](strategy-game-heuristics.md).

Consistency is not sameness: the same player meaning should behave consistently;
different meanings may require distinct variants.

## Findings and verdict

For each criterion use `PASS`, `FAIL`, `PARTIAL`, or `UNKNOWN`. A static audit can
confirm missing code or contradictory contracts, but runtime behavior remains
`PARTIAL` until exercised. Prioritize findings by player impact and frequency,
not by visual novelty.

A finding contains:

```text
priority | scenario | evidence | expected | actual/inferred | player impact |
recommendation | acceptance criterion | confidence
```

Do not calculate a health score unless all weighted sections were observed under
the same declared scope. Never score absent monetization, multiplayer, touch, or
other unsupported mechanics as failures.
