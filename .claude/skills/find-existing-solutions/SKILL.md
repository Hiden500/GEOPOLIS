---
name: find-existing-solutions
description: Mandatory search protocol before concluding "X doesn't exist", importing an external source/dependency, or building a new implementation. Exhausts the repository, its data files, git history, and decision docs first — and reports the search as evidence, not a guess.
---

# Find Existing Solutions

## Trigger

Use BEFORE any of these conclusions or actions:

- "the data/feature/utility does not exist in this project";
- importing an external data source, library, or dependency;
- writing a new implementation of something generic (a merge step, a
  validator, a helper) that plausibly exists already;
- presenting the user a trade-off between two new options.

Also use when the user says a solution exists and you could not find it —
your search was probably too narrow.

Repo evidence for why this is mandatory:

- **Northern Cyprus (2026-07-19):** the search was `iso_a2 == "CY"` only →
  "Kyrenia is missing from game_map.json" → external geoBoundaries graft with
  an ugly visible seam → rejected by the user. The complete territory sat in
  the same file under `iso_a2 == "-1"` (`sov_a3 == "CYN"`), fitting the
  existing districts with zero gap. One extra query key would have avoided
  the whole detour.
- Earlier the same pattern was recorded as user feedback: two trade-off
  options were presented when existing infrastructure already avoided the
  trade-off entirely.

## Do not trigger

When the user explicitly names the exact new dependency/source to use, or the
thing to build is unambiguously novel to the project (a new game mechanic
with no prior art in the repo).

## Required inputs

A one-sentence definition of the target: what would count as an existing
solution (data covering area X; a function doing Y; a config pattern for Z).
Without this the search stops at the first plausible miss. Derive it from the
task; ask only if it cannot be derived.

## Workflow and tools

1. **Search the code and data by MULTIPLE keys, never one.**
   - Code: `rg` for synonyms, related terms, and likely file names; Repowise
     (`search_codebase`, `get_answer`) when available.
   - Datasets: never filter by a single tag. For geo data specifically:
     query by the country tag AND `iso_a2 == "-1"` (non-country: disputed /
     de-facto territories — Kashmir, Spratly, Northern Cyprus, Dhekelia live
     there) AND name fields (`name`, `name_en`, `admin`, `sov_a3`) AND
     spatial adjacency (bbox intersection with the target area).
2. **Search history and decisions.** `git log -S<term>`, `docs/DECISIONS.md`
   and `docs/decisions/`, existing plans in `.agent/plans/`. The thing may
   have existed and been removed for a documented reason — that reason
   changes the answer.
3. **Only after 1-2 are exhausted:** propose the external/new option, with
   provenance and compatibility checked against what the project already
   uses (for geometry: generalization level and seam fit against ALL
   neighbours — see `map-geometry-qa`).

## Verification and failure conditions

A conclusion of absence is verified only when the search list (keys, files,
commands) is recorded and covers step 1 and step 2 above. If a needed search
cannot be run (missing tool, unreadable file), report `BLOCKED` with the
exact gap — do not substitute a conclusion of absence.

## Output

Either the found existing solution (path/symbol/feature and how it fits), or
a proposal for a new/external one accompanied by the evidence of absence:
what was searched (keys, files, commands) and what was not found. "Не нашёл"
without the search list is a guess, not evidence.
