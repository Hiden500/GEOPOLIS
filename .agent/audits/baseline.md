# Bootstrap baseline — 2026-07-15

Status: captured before bootstrap changes. Starting commit:
`470a719748c3aab3a73d82f213706f0fd3e60abf` on
`codex/global-working-agreements`.

Evidence labels in this file are literal: `VERIFIED` means an executed command
or inspected repository file; `UNKNOWN` means the value was not observable.

## Git and workspace

- `VERIFIED` — root: `D:/Pax Historia LOCAL`; worktree clean before and after
  baseline checks.
- `VERIFIED` — remotes: `origin` (GitHub SSH) and local `localbackup`.
- `VERIFIED` — two additional Claude worktrees exist under
  `.claude/worktrees/`; neither was modified.
- `VERIFIED` — `server/.env` exists locally, is ignored by `.gitignore`, and
  is not tracked. Its contents were not read.
- `VERIFIED` — `.repowise/` is ignored and has no tracked files.

## Observable agent environment

- `VERIFIED` — Codex Desktop, GPT-5-based agent, workspace-write sandbox,
  auto-reviewed approvals, restricted network, and subagent support (four
  concurrent slots including the parent).
- `UNKNOWN` — exact model identifier, reasoning setting, alternate model list,
  token use, and cost.
- `VERIFIED` — ordinary sandboxed PowerShell could not start:
  `CreateProcessAsUserW failed: 5 (Отказано в доступе.)`. Read-only shell
  discovery therefore required auto-reviewed escalation.
- `VERIFIED` — Repowise `0.24.0` is installed and a local post-commit hook
  queues `repowise update` in ignored `.repowise/` state.
- `VERIFIED` — Repowise and Context7 are declared in `.mcp.json` and
  `.codex/config.toml`, but neither exposed callable tools in this session.
  Their effective project-local loading remains `UNKNOWN` until a fresh trusted
  session.
- `VERIFIED` — web access, image tools, shell, file patching, subagents, and
  installed plugin skills were observable. A dedicated browser/computer-use
  tool was not exposed.
- `VERIFIED` — `codex.exe` exists in the desktop package but could not be
  launched from the shell (`Access denied`), so CLI-based config introspection
  was unavailable.

## Stack and tooling

- `VERIFIED` local runtimes: Git `2.54.0.windows.1`, Node `v24.16.0`, npm
  `11.17.0`, Python `3.12.1`, ripgrep `15.1.0`, Repowise `0.24.0`.
- `VERIFIED` CI runtimes: Node 22 and Python 3.12. No `.nvmrc`, `engines`, or
  equivalent Node pin exists, so local checks did not use the CI Node version.
- `VERIFIED` — npm lockfiles exist at root, `client/`, and `server/`; there is
  no npm workspace declaration. `shared/` has no package manifest and is
  compiled through client/server aliases.
- `VERIFIED` — client: React 19, TypeScript 6, Vite 8, MapLibre 5,
  react-i18next, Vitest, Testing Library, happy-dom, ESLint.
- `VERIFIED` — server: Express 5, TypeScript 6, Zod 4, Vitest, Supertest.
- `VERIFIED` — Python powers the map/scenario pipeline. `pyproj 3.7.2` and
  Shapely `2.1.2` are installed; the `shapefile` module (PyShp) is missing.
  No Python dependency manifest exists.
- `VERIFIED` — no database, migration framework, container manifest, IaC,
  formatter config, release workflow, or deployment workflow was found.
  Persistence is JSON-file based (`server/src/game/SaveService.ts`).
- `VERIFIED` — CI contains client/server/data/security jobs. TruffleHog scans
  history; client/server `npm audit` jobs are advisory because they use
  `continue-on-error: true`.

## Canonical executable commands found

| Purpose | Command |
|---|---|
| Setup (Windows) | `.\start.ps1 -Install` |
| Dev | `cd server; npm run dev` and `cd client; npm run dev` |
| Client build | `cd client; npm run build` |
| Client typecheck | `cd client; npx tsc --noEmit -p tsconfig.app.json` |
| Server typecheck | `cd server; npx tsc --noEmit -p tsconfig.json` |
| Tests | `npm test` in `client/` and `server/` |
| Lint | `cd client; npm run lint` |
| Data validation | `python scripts/map/validate_region_economy_1946.py` |
| Data unit checks | `python scripts/map/test_validate_region_economy_1946.py` |
| Dependency audit | `npm audit --audit-level=high` in each npm package |

There is no server build script, root aggregate verification script, formatter,
migration command, browser E2E command, or release command.

## Executed baseline checks

Durations are wall-clock measurements captured by the command wrapper and are
not benchmark results.

| Command | Exit | Duration | Result |
|---|---:|---:|---|
| `server: npx tsc --noEmit -p tsconfig.json` | 0 | 4.139 s | clean |
| `client: npx tsc --noEmit -p tsconfig.app.json` | 0 | 4.273 s | clean |
| `server: npm test` | 0 | 4.958 s | 48 files; 679 passed, 1 skipped |
| `client: npm test` | 0 | 3.658 s | 7 files; 92 passed |
| `client: npm run lint` | 1 | 4.816 s | 20 errors |
| `client: npm run build` | 0 | 5.025 s | built; chunk-size warning |
| `python scripts/map/validate_region_economy_1946.py` | 0 | 1.640 s | valid; console text rendered as mojibake |
| `python scripts/map/test_validate_region_economy_1946.py` | 0 | 1.752 s | 9 passed |
| `client: npm audit --audit-level=high` | 0 | 1.646 s | 0 vulnerabilities |
| `server: npm audit --audit-level=high` | 0 | 1.206 s | 0 vulnerabilities |
| `root: npm audit --audit-level=high` | 0 | 1.622 s | 1 low-severity `esbuild` advisory |

## Baseline failures and warnings

1. `VERIFIED` — client lint is red with 20 pre-existing errors across
   `PlayerIntentPanel.tsx`, `MapView.tsx`, `GeometryEngine.ts`, and
   `TopologyBuilder.ts`. This is also recorded in `docs/TODO.md`.
2. `VERIFIED` — the full Python map rebuild environment is not reproducible
   from repository manifests: PyShp is missing locally and no Python dependency
   manifest exists. The two CI data checks do not require PyShp and passed.
3. `VERIFIED` — the client production bundle builds but emits a >500 kB chunk
   warning; the main JS chunk was 1,379.95 kB (381.44 kB gzip).
4. `VERIFIED` — the root lockfile has one low-severity Windows development
   server file-read advisory in `esbuild`; root dependencies are not covered by
   the current CI security job.
5. `VERIFIED` — the data validator exits successfully but its Russian console
   output is mojibake in this PowerShell execution environment.
6. `VERIFIED` — ordinary Windows sandbox shell startup fails, forcing
   escalated execution even for read-only commands. This is an environment
   limitation, not a repository regression.

## Not executed

- Dependency installation (`npm ci`/`npm install`) was not repeated because it
  would mutate existing dependency trees; lockfiles and installed trees were
  present.
- Dev servers and browser flows were not run during baseline capture.
- Full map generation was not run because it writes generated data and the
  local Python environment is incomplete.
- TruffleHog was not run locally because the executable is absent; its CI
  configuration was inspected.
- CI itself was not run on Node 22. Local checks used Node 24.
- No production, deployment, release, push, merge, credential, or billing
  operation was attempted.
