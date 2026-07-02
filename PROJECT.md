# Project: Geopolis Country Labels Layout

## Architecture
- **Geometry Engine (`client/src/map/engine/GeometryEngine.ts`)**:
  - Responsible for generating the label baselines (straight or curved).
  - Performs Web Mercator projection calculations.
  - Manages proportional letter kerning and baseline extrapolation.
  - Returns a GeoJSON `FeatureCollection<Point>` containing character glyph features.
- **Map View (`client/src/map/MapView.tsx`)**:
  - Binds the generated country label features to a MapLibre GL symbol layer.
  - Renders characters dynamically with calculated rotations (`text-rotate` mapping) and size interpolations.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | E2E Test Suite Development | Create comprehensive E2E tests (Tiers 1-4) in a test harness verifying placement, rotation, kerning, and compilation. | none | DONE (8d32f046-6e3a-4676-b919-0cd89054e799) |
| 2 | Codebase Exploration | Run read-only analysis of coordinate systems, PCA, and layout implementation. | M1 | DONE (4ea29e19-93d6-42b1-8b32-8294cfaaf0e8) |
| 3 | Math and Layout Implementation | Implement Web Mercator conversion, straight vs curved baseline heuristics, letter-specific kerning, linear extrapolation, and correct rotations. | M2 | DONE (4ea29e19-93d6-42b1-8b32-8294cfaaf0e8) |
| 4 | Map Style Integration | Refine MapLibre layers in `MapView.tsx` to display letters correctly without overlap or wavy distortions. | M3 | DONE (4ea29e19-93d6-42b1-8b32-8294cfaaf0e8) |
| 5 | Validation and Hardening | Run reviews, challenger tests, and forensic auditing to confirm correctness and integrity. | M4 | DONE (4ea29e19-93d6-42b1-8b32-8294cfaaf0e8) |

## Interface Contracts
### `GeometryEngine` ↔ `MapView`
- `buildCountryLabels(featureCollection, regions)`:
  - Inputs:
    - `featureCollection: FeatureCollection<Polygon | MultiPolygon, any>`
    - `regions: Region[]`
  - Output:
    - `FeatureCollection<Point, CountryLabelProps>` where:
      - `CountryLabelProps` contains `name` (single character string), `sizeZ2` (number), `sizeZ7` (number), `sortKey` (number), `appearZoom` (number), `rotateDeg` (number).
      - Letter geometries are projected back to `[lon, lat]` geographic coordinates.

## Code Layout
- `client/src/map/engine/GeometryEngine.ts` — Geometry calculations and label generation.
- `client/src/map/MapView.tsx` — Map rendering and layer configuration.
