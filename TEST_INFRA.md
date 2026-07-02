# E2E Test Infra: Geopolis Country Labels Layout

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + BVA + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| F1 | Flat Web Mercator Layout | ORIGINAL_REQUEST §R1 | 5      | 5      | ✓      |
| F2 | Dynamic Baseline Shape (Straight vs Curved) | ORIGINAL_REQUEST §R2 | 5      | 5      | ✓      |
| F3 | Proportional Kerning | ORIGINAL_REQUEST §R3 | 5      | 5      | ✓      |
| F4 | Out-of-Bounds Extrapolation | ORIGINAL_REQUEST §R3 | 5      | 5      | ✓      |
| F5 | Continuous Rotation & Alignment | ORIGINAL_REQUEST §R3 | 5      | 5      | ✓      |

## Test Architecture
- Test runner: Vitest (`npx vitest run` in the client directory)
- Test suite location: `client/src/map/engine/__tests__/buildCountryLabels.e2e.test.ts`
- Target function under test: `buildCountryLabels` from `GeometryEngine.ts`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Compact Country Layout (France/Poland representation) | F1, F2, F3 | Low |
| 2 | Elongated Curved Country Layout (Norway/Chile representation) | F1, F2, F3, F5 | Medium |
| 3 | Long Name Extrapolation (Sumatra representation) | F1, F2, F4, F5 | Medium |
| 4 | Massive Transcontinental Country (Soviet Union representation) | F1, F2, F3, F4, F5 | High |
| 5 | Small Multi-Region Island Chain | F1, F2, F3 | Medium |

## Coverage Thresholds
- Tier 1: 25 test cases (5 per feature)
- Tier 2: 25 test cases (5 per feature)
- Tier 3: 5 test cases (pairwise combination coverage)
- Tier 4: 5 real-world scenarios
- Total: 60 test cases
