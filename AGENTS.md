# AGENTS.md

# Geopolis — Agent Instructions

Last updated: 2026-06-30

Global rules for the AI agent working on Geopolis. Mandatory.

Default response language: **Russian**.

This file holds process rules and high-level design guardrails. Specific
game-design numbers (region counts, country breakdowns, tech trees, historical
data) live only in `/docs` — link there instead of restating numbers here.

---

# Documentation Authority

Mandatory rules also live in `/docs`. Always read `docs/TODO.md` and
`docs/DECISIONS.md` first — everything else is routed by what the task
touches, not read wholesale:

| Task touches | Read |
|---|---|
| simulation ticks, `SimulationEngine.ts` order | `docs/AI_RULES.md` §Симуляция (status of each tick — trust the file listed there, not this table) |
| economy (GDP, budget, resources) | `docs/ECONOMY.md` |
| politics (`stability`/`legitimacy`/`corruption`) | `docs/POLITICS.md` |
| war/combat (currently unbuilt) | `docs/WAR.md` |
| trade/logistics (currently unbuilt) | `docs/TRADE.md` |
| diplomacy, alliances, Threat/Rivalry | `docs/DIPLOMACY.md` |
| LLM prompt/response/validation | `docs/LLM_RULES.md` |
| map features (factories, mines, ports, battalions) | `docs/MAP_FEATURES.md` |
| UI visual design, layout, styling, design tokens (`client/src/components/`, `App.css`) | `docs/UI_DESIGN.md` (agent: `.claude/agents/ui-designer.md`) |
| starting scenarios (1836/1946/2000) | `docs/SCENARIOS.md` |
| tech tree | `docs/TECH_TREE.md` (draft, unresolved) |
| world events | `docs/EVENTS.md` (draft, unresolved) |
| map geometry/rendering (frozen — see TODO) | `docs/GEMINI_MAP_ENGINE.md` |
| world scale, region counts | `docs/WORLD.md` |
| historical sourcing standards | `docs/HISTORICAL_ACCURACY.md` |
| overall architecture/module map | `docs/ARCHITECTURE.md`, `docs/PROJECT.md` |

Docs marked "заготовка"/"черновик" in their own header carry unresolved
open questions — read the warning at the top of the file before treating
anything in it as settled.

Any future documentation added to `/docs` is authoritative.

Code is the source of truth about *current behavior*. Docs describe intent and
can lag reality — that has happened in this project (see `docs/DECISIONS.md`,
e.g. "Выполнено" ≠ "проверено end-to-end"). Therefore:

* Never silently ignore documentation.
* But never silently trust a doc that the code contradicts.
* If docs conflict with the code, or two docs conflict — stop, report the
  conflict, ask for clarification.

**MANDATORY, not optional — read before, write after:**

* Before starting any non-trivial task, read the relevant docs listed above
  (and `docs/TODO.md`/`docs/DECISIONS.md` always) — not "if convenient."
* After finishing a task, update docs in the SAME turn, before reporting
  done — not "later," not "if I remember." A task is not complete until its
  doc footprint is updated. Concretely:
  - finished work that was tracked in `docs/TODO.md` → remove it there;
  - a real decision, deferral, or open question → dated entry in
    `docs/DECISIONS.md`;
  - new backlog/deferred item discovered mid-task → added to `docs/TODO.md`
    before ending the turn, not left only in chat or a local plan file.
* This is a recurring failure mode for this agent specifically — docs were
  forgotten more than once. Treat "did I touch `/docs`?" as a mandatory
  self-check before ending any turn that changed behavior, scope, or
  decisions, the same way tests/typecheck are mandatory before a commit.

---

# Keep `/docs` Lean

`docs/TODO.md` and `docs/DECISIONS.md` are easy to let balloon into a second
commit history. Don't let them — git already is one.

* `docs/TODO.md` lists only currently-open and future work. When an item is
  done, **delete it from TODO.md** — don't leave it checked off in place.
  If the rationale is non-obvious and worth keeping, it gets a one-line dated
  entry in `docs/DECISIONS.md` (existing convention — see entries dated
  2026-06-22 onward), not a paragraph in TODO.md. The "Готово (архив)" section
  at the bottom of TODO.md stays terse bullet points, not a changelog.
* `docs/DECISIONS.md` is an append-only dated log plus a live "Открытые
  вопросы" index. Add new decisions as dated entries; when an open question
  resolves, strike it from the index (already the existing pattern) rather
  than rewriting history.
* Do not create a new tracking doc per task/feature/refactor backlog item —
  it fragments visibility. Add backlog items to the existing TODO.md sections
  (or DECISIONS.md's open-questions index if it's a design question, not a
  task). Only add a new file under `/docs` for a genuinely new *design
  domain* (the existing per-system docs — ECONOMY/POLITICS/WAR/etc. — are the
  precedent), never for "things to do later."
* Detailed historical narrative (what changed, why, step by step) belongs in
  commit messages, not docs — `git log` is authoritative for that.
* New entries should already be terse (Decision/Reason/Status, pointer to the
  commit for detail) — don't write commit-message-level narrative into
  `DECISIONS.md` in the first place; that defeats the point of archiving.
* **Archive convention:** when `DECISIONS.md` grows past a comfortable scan
  length, move closed/old dated entries verbatim (no rewriting — the
  "append-only" rule still applies) into `docs/decisions/<YYYY-MM>.md`. Keep
  in `DECISIONS.md`: the intro, the most recent entries, and the live "Открытые
  вопросы" index — that index never moves to the archive. Add a one-line
  pointer in the intro to where the archive lives. Precedent: `docs/decisions/2026-06.md`
  (2026-06-29, entries 06-22 through 06-27 archived, ~750→~280 lines).

---

# Tooling Authority

Codebase intelligence (this repo) → Repowise MCP. External library docs → Context7 MCP.
Tool-usage protocol lives in `.claude/CLAUDE.md`. Do not add a second repository-intelligence
system or a second docs provider — they duplicate these and waste context.

# Context Budget

Default to the cheapest sufficient read. For any indexed file: Repowise `get_context`
skeleton → `get_symbol` for bodies → `path:a-b` range reads. Reserve full `Read` for files
the index marks `mostly_full` or cannot serve. Do not re-read content a `verified` Repowise
response already returned. Prefer `repowise distill` for noisy command output.

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

# Design for Multi-Locale From the Start

Full picture, current status, and rationale: `docs/LOCALIZATION.md` — read it
before touching either layer below, this section is only the standing rule.

**Two independent layers — a new feature almost always needs to think about
both, not just one:**

1. **Data** (`shared/src/types/i18n/LocalizedText.ts`,
   `type LocalizedText = Partial<Record<Locale, string>>` + `getText()`) —
   any user-facing name/label introduced into a shared type (`Region`,
   `Country`, generated content, future tech/equipment names) must use this
   from the first commit — established pattern, see `Region.names`. Do not
   add a new plain-`string` name field and plan to migrate it later — the
   migration cost compounds with every consumer added in between.
2. **UI strings** (`react-i18next`, adopted 2026-07-06 — independent
   gейм-дизайн разбор) — any new client component/string must call
   `t('key')` against its own namespace (`client/src/i18n/locales/{ru,en}/<component>.json`)
   from the first commit, not a hardcoded literal with a "translate later"
   plan. Same reasoning as layer 1: retrofitting compounds. Exception:
   `client/src/map/` — carries the standing map freeze (see below), do not
   add i18n work there without an explicit request even though it's
   otherwise in scope for this rule.

Known remaining gaps (tracked in `docs/LOCALIZATION.md`, not proactive
todos): `Country.name`/`shortName` still plain `string` (12 legacy
hand-authored country files + generated 1946 registry depend on it — migrate
as one pass when next working on countries, not a drive-by); a handful of
client `getText()` call sites don't pass locale explicitly yet.

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

Determinism boundary (the one fact worth restating here — violating it is the
most likely LLM-integration mistake): the LLM never calculates economy,
production, combat, or pathfinding, and never touches savegame integrity —
those stay deterministic in the engine. Everything else about the LLM's role
(prompt construction, response validation, event generation) is canonical in
`docs/LLM_RULES.md` — not duplicated here.

---

# Historical Data

Use reliable sources whenever possible: United Nations, League of Nations,
Maddison Project, CIA historical publications, academic publications, historical
atlases. Do not invent numbers when reliable estimates exist. When estimates are
required, document assumptions, keep internal consistency, and separate
estimates from verified data.

---

# Координация моделей (Claude + Gemini)

Над проектом могут работать несколько AI-моделей. Чтобы не дублировать работу
и не создавать конфликты, соблюдается следующий протокол.

## Доменное разделение

| Домен | Владелец |
|---|---|
| `server/` — симуляция, сервисы, маршруты | Claude |
| `client/` — UI, компоненты (без карты) | Gemini |
| `client/src/map/**` — карта (геометрия, топология, рендер) | **Claude** (с 2026-07-11, было Gemini — см. `docs/DECISIONS.md`) |
| `shared/types/` — общие типы | **только через `main`, не параллельно** |
| `docs/`, `scripts/` | любой, не одновременно |

Эти границы — дефолт, не жёсткий закон. Менять через запись в `docs/DECISIONS.md`.

Карта по-прежнему заморожена (решение пользователя 2026-07-03, см.
`docs/TODO.md` «Постоянные рамки») — таблица выше фиксирует, кто возьмётся за
неё, когда заморозка снимется, не открывает работу сейчас.

Дополнительно Gemini закреплён за **исторической калибровкой/фактчекингом**
данных сценариев (проверка страновых/региональных чисел против источников,
docs/HISTORICAL_ACCURACY.md) — не домен файлов, а тип задачи, назначается
явно по конкретной находке (пример кандидата — калибровка ВВП/чел Китая,
`docs/TODO.md`). Генерация изображений (Nano Banana) — тоже за Gemini,
конкретная первая задача не выбрана, см. `docs/TODO.md`.

## Разделение процессов разработки карты (MAS Pipeline) — устарело, см. выше

Раздел ниже описывал прежнее разделение (карта — исключительно Gemini) и
оставлен как история: `docs/GEMINI_MAP_ENGINE.md` — зафиксированные промпты
и правила прежнего MAS-пайплайна, справочно, не обязателен к использованию
Claude при возврате к карте (решать по факту, когда заморозка снимется —
переиспользовать пайплайн или проектировать заново, сейчас не решалось).

* ~~Разработка геометрических алгоритмов, топологии, рендеринга и выравнивания надписей карты Geopolis ведется исключительно моделями Gemini по иерархическому пайплайну (Multi-Agent System).~~
* ~~Модель Claude игнорирует пайплайн MAS и не вносит изменений в файлы геометрии карты без явного согласования с пользователем.~~


## Ветки

Каждая модель работает в своей ветке:
- `claude/<feature>` — работа Claude
- `gemini/<feature>` — работа Gemini

Ветки мержатся в `main` когда фича готова и тесты зелёные.
После мержа в `main` — другая модель делает `git merge main` перед следующей задачей.

## Протокол старта (обязателен для каждой сессии)

1. `git checkout main && git pull` — взять актуальный `main`
2. Прочитать `git log --oneline -10` — что сделала другая модель
3. Прочитать `docs/TODO.md` — что открыто, что в работе
4. Прочитать `docs/DECISIONS.md` — свежие архитектурные решения
5. Создать ветку: `git checkout -b claude/<task>` или `gemini/<task>`

## Правила shared/types/

`shared/types/` — общая земля, конфликты здесь болезненны.

- Никогда не менять `shared/types/` в параллельных ветках.
- Нужно добавить тип → сначала смержить текущую ветку в `main`, потом
  создать отдельный маленький PR только с типами, остальные ветки ребейзятся.
- Если нужен новый тип прямо сейчас — записать в `docs/DECISIONS.md`
  ("резервирую shared/types/ до мержа ветки X") и сообщить пользователю.

## Что НЕ делать

- Не брать задачи из чужого домена без явной записи в `DECISIONS.md`.
- Не работать с `shared/types/` в параллельных ветках.
- Не создавать ветку от незамерженной ветки другой модели.
- Не мержить в `main` с красными тестами.

CI (`.github/workflows/doc-guardrails.yml`) блокирует PR/push в `main`, если
закоммичен `.repowise/` или дока в корне репо вне `README.md`/`AGENTS.md` —
это не заменяет правила выше, а страхует от их нарушения (см.
`docs/DECISIONS.md`, 2026-07-03, чистка ветки `gemini/ui-map-improvements`).

---

# Git & Workflow

Before committing: run typecheck and tests (and lint where it exists). Do not
leave broken builds. Do not commit generated files unless repository conventions
require it.

**Standing authorization — local commits:** the agent may create local commits
without asking for per-commit confirmation, provided typecheck/tests/lint (per
above) pass first. This is a durable, advance authorization — it applies in
every session, not just the one where it was granted. Reason: Repowise tracks
index staleness as the gap between `indexed_commit` and live `HEAD`
(`get_overview`'s `stale_warning`); leaving work uncommitted widens that gap
and makes the index increasingly unreliable, so committing promptly is part of
keeping the index usable, not optional housekeeping. This authorization covers
**local commits only** — push (including force-push), history rewrites, and
any other action that touches shared/remote state still require explicit
confirmation each time, per the agent's standing safety rules.

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
