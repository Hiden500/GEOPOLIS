# Repository-first interface discovery

## Goal

Derive interface requirements from the game that exists and the game the
canonical documents describe. Do not start with a memorized list of grand-
strategy screens.

## Evidence order

1. Read applicable repository instructions and current Git state.
2. Read the project README, current UI/design decisions and backlog, then the
   canonical documents for game loop, world, simulation timing, diplomacy, war,
   economy, politics, trade, events, map, localization, and UI only where those
   domains exist.
3. Trace executable behavior: application entry, scene composition, command/API
   handlers, shared contracts, state selectors, map interactions, components,
   styles/themes/tokens, localization keys, and tests.
4. Inspect rendered evidence only after target platform, viewport, data state,
   and build status are known.

When docs and code disagree, report the drift. Code proves current behavior;
normative docs prove intended constraints. Neither alone proves a rendered flow.

## Reconstruct player scenarios

Search mechanics for verbs and state changes, not screen nouns. For each player-
meaningful verb, capture:

```text
trigger -> current context -> player goal -> information needed -> decision ->
input -> validation -> state change -> visible feedback -> next decision
```

Add a scenario only when at least one source supports the mechanic, user goal, or
existing flow. Probe for:

- what the player repeats during the core loop;
- what begins, interrupts, resumes, and ends a session;
- which choices are consequential, reversible, delayed, or rejected;
- which changes occur outside the player's direct action;
- which failures require recovery rather than a dead end;
- how a novice learns the first meaningful decision and how an expert accelerates
  the same loop.

These prompts discover scenarios; they do not prescribe screens.

## Convert scenarios into interface contracts

For each scenario, answer:

| Question | Required evidence |
|---|---|
| What decision is the player making? | mechanic/command/docs |
| What must be compared before acting? | data contract/state selector |
| How time-sensitive is it? | tick/turn/event rules |
| What context is already visible in the world/map? | scene/map implementation |
| What must remain visible after selection changes? | loop and persistence rules |
| What can wait for explicit request? | frequency and consequence |
| What can fail, and how can the player recover? | validation/error paths |
| What proves the command resolved? | response/event/state update |

Derive a new surface only when inline disclosure, an existing component, or the
map cannot serve the scenario without hiding the decision or overloading the
current context.

## Visibility classification

- **Persistent**: needed across frequent decisions or to avoid severe surprise.
- **Contextual**: tied to current selection, mode, event, or command.
- **On-demand**: useful for analysis but not required during every decision.
- **Not visualized**: narrative/world feedback is sufficient, or the data does
  not exist. Do not invent metrics to fill a panel.

Persistent placement is a cost: it consumes attention and map area every moment.
Demand frequency, consequence, and comparison value before paying that cost.

## Inventory existing UI without assuming intent

Locate:

- mounted roots, routes, portals, overlays, popups, and map controls;
- reusable layout, button, list, tab, tooltip, dialog, notification, stat, and
  selection components;
- CSS variables, theme objects, typography/spacing scales, icon conventions, and
  animation primitives;
- focus handlers, hotkeys, pointer/keyboard/gamepad branches, and ARIA semantics;
- localization namespaces, interpolation/plural rules, long-string tests, and
  locale-aware formatting;
- component, integration, screenshot, or end-to-end tests and fixture states.

Record what a component demonstrably supports. A prop name is evidence of an
intended state; only a rendered/tested flow proves it works.

## Completion gate

Discovery is complete when every proposed interface surface maps to at least one
evidenced scenario, every persistent datum has a frequency/consequence reason,
and every missing-data or unverified-runtime claim is labeled explicitly.

