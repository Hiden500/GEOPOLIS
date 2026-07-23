# Visual QA with rendered evidence

## Preconditions

Establish target platform, logical viewport range, input methods, UI scale, locale,
build/asset maturity, and the states that can be reached safely. If screenshots or
a runnable build are unavailable, perform only static risk review and label the
visual result `PARTIAL`.

Use existing project tooling. Do not install a browser, visual-test framework, or
image dependency implicitly. Treat placeholder art and explicitly WIP surfaces as
separate scope rather than final-quality failures.

## Capture matrix

Use [visual-qa-register.md](../assets/templates/visual-qa-register.md). Include:

- repository-defined baseline viewport;
- narrowest and widest supported logical viewport;
- minimum supported height and any high-DPI/OS-scaling case documented by the
  project;
- default and longest supported locale where practical;
- map/world states with bright, dark, dense, and sparse backgrounds where the UI
  overlays variable content;
- default, selected, hover, focus-visible, disabled, unavailable, loading, empty,
  error, success, and modal/notification stacking states that apply;
- pointer, keyboard, and gamepad flows actually claimed by the project.

Record exact dimensions, state setup, input, locale, evidence path, and result.

## Inspection passes

### Hierarchy and map relationship

- Does the eye land on the scenario's first priority before decoration?
- Can the player retain map/selection context while inspecting details?
- Do panels obscure the decision target or create accidental dead space?
- Are urgent notifications visually distinct without permanently dominating?

### Typography and information density

- Measure rendered font size, contrast, line height, wrapping, truncation, and
  numeric alignment where relevant.
- Check long labels, large/small values, negative signs, percentages, dates, and
  localized interpolation.
- Verify dense layouts retain grouping and click/focus targets; density is not a
  license for illegible text.

Do not scale vendor font tables mechanically with physical resolution. Browser
CSS pixels, UI scale, viewing distance, OS scaling, and project requirements
determine readability. WCAG contrast targets remain useful for UI text/components
when applicable, but measure actual foreground/background pairs.

### Geometry and adaptation

- Check overlap, clipping, unexpected scrollbars, map-control collisions, fixed
  elements covering content, and focus outlines cut by overflow.
- Verify anchoring at narrow/wide ratios instead of stretching every HUD element
  to screen edges.
- Check modal and popover containment, viewport collision handling, zoom, and
  scroll restoration.

### Component polish and states

- Align shared components to the same grid, type scale, padding, icon style, and
  semantic state language.
- Verify hover does not stand in for focus or selected.
- Verify pressed feedback does not shift layout.
- Distinguish disabled from rule-unavailable and explain unavailable actions.
- Check loading does not look frozen, empty states preserve the player's goal,
  and errors preserve context and expose recovery.

### Motion and feedback

- Observe, do not infer, enter/exit direction, interruption behavior, reduced
  motion, cancellation, and rapid repeated actions.
- Motion should explain hierarchy or causality. Flag ambient or looping motion
  that competes with map scanning.
- Confirm command feedback corresponds to the actual accepted/rejected/pending
  lifecycle.

### Accessibility and input

- Exercise keyboard-only navigation, visible focus, modal trapping/restoration,
  and Escape/back semantics.
- Exercise gamepad navigation and prompt switching only if supported and tooling
  permits; otherwise mark `UNKNOWN`.
- Inspect grayscale/color-independent meaning, text scaling if supported, and
  critical information conveyed only by sound or motion.

## Severity

- `P0`: unplayable/core-loop block, hidden consequential state, trap, seizure or
  serious access risk.
- `P1`: always/frequently visible failure in a core scenario or supported target.
- `P2`: intermittent/secondary failure or recurring inconsistency with workaround.
- `P3`: low-frequency polish issue visible only under close inspection.

Frequency can raise or lower severity; rarity does not excuse data loss or an
accessibility blocker.

## Output

Report capture coverage first. Then list findings with screenshot/state evidence,
reproduction conditions, expected/actual, priority, recommendation, and a visual
acceptance criterion. Separate:

- confirmed rendered defects;
- static risks not reproduced;
- intentional art direction verified by docs;
- untested states/inputs/viewports.

Do not issue a ship-ready visual score when any target viewport, primary input, or
core state is unobserved.

