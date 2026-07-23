# Strategy-game UI heuristics

## Decision surface, not dashboard

A grand-strategy interface exists to turn world state into decisions and
decisions into legible consequences. The map is usually the primary spatial
model, not decorative whitespace behind a business dashboard.

Reject a layout when it:

- duplicates map information as permanent KPI cards without increasing decision
  quality;
- presents every system at equal visual weight;
- uses generic card grids, oversized marketing headings, glass panels, or icon-
  only navigation as a substitute for game-specific hierarchy;
- hides causality behind numbers with no delta, source, comparison, or world
  consequence;
- forces the player to remember selection context while a panel obscures it.

## Information economy

For every datum, evaluate:

1. decision frequency;
2. consequence of missing it;
3. volatility between turns/ticks;
4. need to compare alternatives;
5. whether the map already communicates it;
6. cost in attention and occluded world area.

High-frequency, high-consequence state may be persistent. Volatile contextual
state belongs near the selection or command. Historical detail and deep analysis
are usually on-demand. Do not turn available data into permanent data merely
because the API exposes it.

## Command lifecycle

Every consequential action should communicate:

```text
affordance -> prerequisites -> cost/trade-off -> confirmation when warranted ->
pending/queued -> accepted or rejected -> world/state feedback -> undo/recovery
```

Distinguish:

- `disabled`: control cannot be interacted with for a stable UI reason;
- `unavailable`: game rules currently prohibit the action; explain the rule;
- `insufficient`: the action is understood but required resources are missing;
- `pending`: the command was issued but not yet resolved;
- `rejected/error`: validation or execution failed; preserve context and provide
  a recovery action.

Silent state changes and generic error toasts break strategic trust.

## Selection and scale

The interface must preserve orientation across world scales. Verify:

- selected country/region/unit/actor remains identifiable when focus moves;
- map mode, time/turn state, and comparison baseline are explicit;
- zoom or aggregation changes do not make the same color/icon mean something
  different without explanation;
- bulk/multi-selection flows avoid per-region micromanagement when the game's
  mission promises macro decisions;
- rendering and selectors do not require full-world work for every pointer move
  or UI render in games with thousands of regions.

## Feedback hierarchy

Not every event deserves a modal. Route feedback by urgency:

- immediate blocking choice: interruption with explicit consequence;
- important but non-blocking change: queued notification with inspect action;
- contextual result: anchored response near selection/action;
- ambient world evolution: map/state change, log, or summary;
- repeated low-value noise: aggregate, deduplicate, or suppress.

The player must be able to answer: what changed, why, whether action is required,
and where to inspect consequences.

## Design dials

Adapt the UI UX Pro Max density/motion/variance idea as constrained project dials:

- **Density**: set by decisions per minute and comparison complexity. Dense does
  not mean small; it means high information value per occupied area.
- **Motion**: use to explain hierarchy, causality, or state change. Avoid constant
  ambient motion competing with map scanning; provide reduced-motion behavior.
- **Variance**: allow visual distinctiveness where it reinforces game identity,
  while stable component geometry and semantics preserve learnability.

Record dial targets and evidence. Do not generate a new design system when the
repository already has tokens or an approved visual direction.

## Game-specific visual identity

Apply the genre-swap test: if names and flags were removed, could the interface
belong to any analytics product or any strategy game? If yes, identify which
gameplay pillar, historical framing, material language, cartographic convention,
or interaction rhythm should make it specific.

Identity must not reduce readability. Texture, ornament, period typography, and
animation are subordinate to text contrast, map legibility, focus visibility,
and consistent state semantics.

## Component and token discipline

Prefer semantic tokens for surfaces, text, borders, selection, warning, danger,
success, unavailable, and focus. Pair color with shape, icon, pattern, text, or
position. Reuse components when behavior is the same; create variants when the
player meaning differs. A shared visual shell with divergent semantics is false
reuse.

