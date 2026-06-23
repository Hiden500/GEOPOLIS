# AGENTS.md

# Geopolis — Agent Instructions

Last updated: 2026-06-23

Global rules for the AI agent working on Geopolis. Mandatory.

Default response language: **Russian**.

This file holds process rules and high-level design guardrails. Specific
game-design numbers (region counts, country breakdowns, tech trees, historical
data) live only in `/docs` — link there instead of restating numbers here.

---

# Documentation Authority

Mandatory rules also live in `/docs`. Inspect the relevant ones before any task:

* docs/PROJECT.md
* docs/ARCHITECTURE.md
* docs/AI_RULES.md
* docs/LLM_RULES.md
* docs/WORLD.md
* docs/HISTORICAL_ACCURACY.md
* docs/TECH_TREE.md (черновик, не продумано — см. предупреждение в файле)
* docs/EVENTS.md (черновик, не продумано — см. предупреждение в файле)
* docs/TODO.md
* docs/DECISIONS.md (журнал архитектурных решений и открытых вопросов — проверять перед спорными решениями)

Any future documentation added to `/docs` is authoritative.

Code is the source of truth about *current behavior*. Docs describe intent and
can lag reality — that has happened in this project (see `docs/DECISIONS.md`,
e.g. "Выполнено" ≠ "проверено end-to-end"). Therefore:

* Never silently ignore documentation.
* But never silently trust a doc that the code contradicts.
* If docs conflict with the code, or two docs conflict — stop, report the
  conflict, ask for clarification.

---

# Understand Before Changing

Before proposing, implementing, or refactoring:

1. Read the relevant code, architecture, data structures, and docs.
2. Identify constraints, dependencies, and risks.
3. Only then propose.

Never invent project structure or code that wasn't provided. Never redesign or
replace a working system without understanding it first — prefer incremental
change over speculative rewrite. If information is missing: state what is
unknown, why it matters, and ask.

When console output may be truncated, write it to a file and read the file
rather than trusting a truncated tail.

---

# Reuse Over Reinvention

Before adding a system, search for existing implementations, services, and
patterns — and reuse them. Do not create parallel or duplicate implementations
of existing functionality. If you find an architectural conflict, name it
explicitly and propose alternatives.

---

# How To Work With Me

These counter real failure modes — follow them even when they feel unnecessary:

* Do not automatically agree. Challenge weak or unrealistic assumptions and
  offer better alternatives when they exist.
* Never present assumptions as facts. If you don't know, say so — explain what
  is missing and how to verify it. Don't fabricate technical details.
* Prefer working, simple, maintainable solutions that fit the existing
  architecture over clever or idealized ones.
* Wait for approval before architectural changes.

---

# Simulation Philosophy

Geopolis is a geopolitical grand strategy game.

It is NOT: a city builder, a logistics simulator, a spreadsheet simulator.

Every system should primarily support diplomacy, warfare, economics, politics,
alternate history, and world simulation. Avoid mechanics that create excessive
micromanagement.

---

# Scale & Performance

The game must stay playable with thousands of regions (target count in
`docs/WORLD.md`), thousands of map features, and decades of campaign history —
including long campaigns and large save files.

Avoid: sending the entire world state to the LLM, scanning all regions
unnecessarily, expensive calculations every tick. Optimize context size, prefer
aggregated values, and don't add maintenance cost without meaningful gameplay
benefit.

---

# Region System

Regions are strategic administrative units and should stay relatively stable.
The world region count target is defined in `docs/WORLD.md` — do not restate the
number here.

High-detail countries (proportionally more regions than average): USSR, USA,
China, Germany, United Kingdom, France. Small countries usually have only 1–3
regions. Prefer 1946 historical plausibility over modern administrative borders,
and preserve valid geometry (no broken polygons).

---

# Map Features

Map Features are visual markers generated primarily from game state — they do
not directly represent game-state calculations. Examples: capitals, cities,
ports, factories, mines, refineries, shipyards, rail hubs, battalions, fleets,
airbases, protests, uprisings.

Battalion-related features MUST carry `tag = "battalion"`.

Avoid excessive manual maintenance.

---

# Economy

Economy stays lightweight — avoid Victoria-style complexity. Regional economy
focuses on population, development, infrastructure, industrialization, and
resource production. Use aggregated values whenever possible. Do not create
systems that require thousands of individual economic calculations every tick.

---

# Diplomacy

Diplomacy must be understandable, predictable, and explainable. Countries act
according to interests, ideology, security, economics, and geopolitical
situation — not pure randomness.

---

# LLM Integration

The simulation uses an external LLM. It does NOT receive the full game state —
only relevant context.

The LLM IS responsible for: world events, political developments, diplomatic
reactions, alternate-history outcomes, narrative developments.

The LLM is NOT responsible for: economy calculations, production calculations,
combat calculations, pathfinding, savegame integrity. These systems must remain
deterministic.

See `docs/LLM_RULES.md` for prompt construction and response validation detail.

---

# Historical Data

Use reliable sources whenever possible: United Nations, League of Nations,
Maddison Project, CIA historical publications, academic publications, historical
atlases. Do not invent numbers when reliable estimates exist. When estimates are
required, document assumptions, keep internal consistency, and separate
estimates from verified data.

---

# Git & Workflow

Before committing: run typecheck and tests (and lint where it exists). Do not
leave broken builds. Do not commit generated files unless repository conventions
require it.

For a significant task: read relevant docs → analyze current implementation →
identify constraints and risks → propose → get approval if architecture changes
are involved → implement → test → update documentation.

---

# Response Format

Default structure for substantive answers:

* **Краткий вывод** — короткое резюме.
* **Анализ** — текущее состояние и ограничения.
* **Рекомендуемое решение** — конкретные действия.
* **Риски** — побочные эффекты и ограничения.
* **Альтернативы** — только если действительно нужны.
