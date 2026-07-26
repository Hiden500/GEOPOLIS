# CAPITAL_REGION_OVERRIDES remap (46 stale entries)

Status: complete
Owner: Claude (this session)
Starting commit: `af781e4` (game_map.json restore post agent-os merge) on
`claude/capital-region-fix` (branched from `codex/1946-country-borders`)

## Objective and observable outcome

`validate_region_economy_1946.py` showed 46 `[FAIL] capitalRegionId belongs
to wrong country` — a pre-existing, known category (README checklist #6:
"CAPITAL_REGION_OVERRIDES — хардкод-словарь в generate_country_registry.py,
не файл... уже известная/отложенная категория"), accumulated across this
branch's region-count-changing work (packages A/B: 11 islands, no direct
region-count change from China/Taiwan/sea-holes work, but earlier Oceania/
Asia/NAM/EUR insertions shifted numeric ids for everything built after
them). User directed fixing it now, per `scripts/map/AGENTS.md` region_id
cascade protocol.

Observable outcome: `validate_region_economy_1946.py` — 0 capitalRegionId
failures ("Все проверки пройдены чисто").

## Scope and constraints

In scope: `scripts/map/generate_country_registry.py`'s
`CAPITAL_REGION_OVERRIDES` dict (61 entries, 46 stale) — remap each stale
numeric id to the current correct one.

Out of scope: `remap_region_ids.py` itself (that tool already correctly
updates `ownership_1946.json`/`names_ru.json`/`occupation_overlay.json`
each time it's run — it does NOT touch this Python-hardcoded dict, a
separate positional-fragility point per README #6). No geometry changes.

## Assumptions and unknowns

Each `CAPITAL_REGION_OVERRIDES` entry carries a comment naming the intended
region (by raw ADM1 name, e.g. "Баглан (Кабул)"). Assumption: that name is
still present, unrenamed, in the current `names.en.json`/`names.ru.json` —
holds for all 46 (confirmed below). One entry (QZN) had a stale literal
`geoJsonId` reference in its comment ("AFR-0089") that itself no longer
points to the described region (shifted to AFR-0092) — resolved by name
search, not by trusting the embedded id.

## Alternatives and selected decision

Considered re-deriving capitals from a rule (e.g. largest-population region
per country) instead of a hardcoded override table — rejected: out of
scope, changes semantics/behavior beyond the stale-id bug, and the table
encodes real historical-capital knowledge (comments) that a rule can't
recover. Selected: remap the 46 stale ids in place, keep the table
structure and comments (updating only ids + the couple of comments that
referenced now-wrong ids/counts).

## Progress

- [x] 1. Extracted all 61 `CAPITAL_REGION_OVERRIDES` entries programmatically
      (regex over the source) to avoid transcription error.
- [x] 2. For each of the 46 failing entries: extracted a search key term
      from its comment, searched current `names.en.json`+`names.ru.json`
      for matching region names, filtered candidates to the CURRENT owner
      (`regions.state.json`) matching the country_id. 44/46 resolved to a
      single unambiguous exact-owner match on the first pass.
- [x] 3. 2 remaining (QRI "Java", SLE "Sierra Leone") resolved manually:
      QRI's comment says "содержит Yogyakarta" — none of QRI's owned
      regions are literally named "Java" (Indonesian spelling "Jawa"
      doesn't substring-match "java"); checked distance from each QRI
      region's geometry to Yogyakarta's coordinates — "Jawa Barat"
      (ASI-0121) has distance 0 (contains the point). SLE's comment says
      "единственный Sierra Leone polygon" (the only SLE-owned polygon,
      not literally named "Sierra Leone") — SLE owns exactly 1 region,
      "Northern" (AFR-0193).
- [x] 4. Cross-checked all 46 proposed new ids against `regions.state.json`
      ownership one more time (0 mismatches) and confirmed no duplicate
      target ids among the 46 (46 unique).
- [x] 5. Applied the remap to `CAPITAL_REGION_OVERRIDES` (comments updated
      only where they referenced a now-wrong literal id/count, e.g. QZN's
      "AFR-0089"→"AFR-0092", SLE's comment gained the actual region name).
- [x] 6. Regenerated (`generate_country_registry.py`) and verified.

## Discoveries

The stale-id pattern is NOT limited to countries whose OWN region count
changed — CAN/BRA/JPN/HKG/IND/SGP/MAC etc. never had their own regions
touched this branch, but sit alphabetically/positionally after countries
that did (11 new islands across EUR/ASI/NAM/OCE, Taiwan's rename — no
count change there — and the 95 sea-hole fills, also no count change).
Confirms README #6's framing: "сдвиг не ограничен алфавитно-более-поздними
странами" — position in BUILD order matters, not country-name alphabetical
order. `IDN` (Sulawesi Selatan) was already correct pre-fix — apparently
protected by coincidence (region 479 unchanged) or an earlier partial fix;
not touched.

## Decision log

- Match by NAME + owner cross-check, not by trusting any numeric id
  embedded in a comment (QZN's "AFR-0089" literal reference was itself
  stale — a reminder that even a docstring's embedded id can rot).
- Java/Jawa spelling mismatch resolved by geometry (point-in-polygon
  distance to Yogyakarta), not by guessing which "Jawa X" region is meant.

## Validation

`validate_region_economy_1946.py` — 0 failures (was 46). `test_validate_
region_economy_1946.py` 9/9, `test_country_entities_1946.py` 12/12,
`.agent/evals/public/run_public_evals.py` 159/159, server+client
`tsc --noEmit` clean, server vitest 680+1skip, live `/game/start` (fresh
process, `netstat`-confirmed PID) — spot-checked AFG/BRA/JPN/QRI/SLE
capitals all resolve to the correct owner/region name.

## Rollback / containment

Single-file change (`generate_country_registry.py`) + regenerated
`countries.json`, on an isolated worktree branch (`claude/capital-region-
fix`). Revert via `git revert` or drop the branch — no effect on
`codex/1946-country-borders` until explicitly merged back.

## Final outcome

All 6 progress items complete. Changed: `scripts/map/
generate_country_registry.py` (46 remapped ids + doc comment),
`server/data/scenarios/1946/countries.json` (regenerated).

Baseline failures: 0 (this WAS the baseline failure category — now
resolved, not deferred further).

Introduced failures: 0.

Unresolved risks: none identified for this specific fix. General
`CAPITAL_REGION_OVERRIDES` fragility (hardcoded, not regenerated,
positionally sensitive to region-count changes anywhere in the build
order) remains — any FUTURE region-count change can re-stale these same
46+ entries again; not something this fix changes structurally (out of
scope — see Alternatives).

Fresh-session requirements: none.

## Addendum (2026-07-26)

The "Unresolved risks" prediction above was right, but not in the way it
implied. A follow-up audit (`.agent/plans/capital-region-invariant.md`)
found the validator this remap made green (`validate_region_economy_1946.py`,
owner-only capital check) was itself blind to a whole bug class: capital id
pointing at the WRONG region of the CORRECT country (e.g. SUN's capital
resolving to Chukotka AO, which IS owned by SUN). That check-blind-spot, not
a fresh geometry-driven renumbering, turned out to be why SUN/USA/GBR/FRA/
ITA/TWN were wrong — comparing this remap's own commit (`5344317`) against
HEAD showed **zero** of the 61 entries here had actually changed which
region name their id resolves to since this remap landed. Those six were
simply never touched by this remap in the first place (their owner already
matched by coincidence, so the owner-mismatch detection method used here
never looked at them) — meaning they were already wrong on 2026-07-23, this
remap's own verification pass (owner-match only) could not have caught them,
and the "0 расхождений владельца" success criterion recorded above was true
but insufficient. `capital-region-invariant.md` adds two invariants that
check the actual region identity (geographic point-in-polygon for 13
countries with real coordinates, expected-region-name for all 55 live
`CAPITAL_REGION_OVERRIDES` entries) instead of just ownership, and fixes the
9 confirmed-wrong entries found this way (including one, IDN, that also
predates this remap and was missed by it for the same reason). The general
fragility named above is still real for the ~48 entries without a
coordinate anchor and the ~100 countries with no override entry at all
(untouched, flagged as follow-up there) — this remap's table-value work
itself is not reverted or further edited by that follow-up beyond the 9
corrected/1 added/7 removed entries it documents.
