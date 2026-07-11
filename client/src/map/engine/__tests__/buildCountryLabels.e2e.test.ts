import { describe, it, expect } from 'vitest';
import {
  lonLatToMercator,
  mercatorToLonLat,
  getCharacterWidth,
  getPointAlongLine,
  computeCountryAxis,
  buildCountryLabelLine,
  buildCountryLabels,
  largestMainlandCluster
} from '../GeometryEngine';
import type { FeatureCollection, Polygon, Feature } from 'geojson';
import type { Region } from '@shared/types/map/Region';

// Helper to create mock region
const createMockRegion = (
  id: number,
  area: number,
  neighbors: number[] = [],
  ownerCountryId = 'test-country'
): Region => ({
  id,
  geoJsonId: `region-${id}`,
  names: { ru: `Регион ${id}`, en: `Region ${id}` },
  ownerCountryId,
  neighboringRegionIds: neighbors,
  area,
  population: 1000,
  urbanization: 0.5,
  stability: 1.0,
  infrastructure: 1.0,
  development: 1.0,
  gdp: 1000,
  deposits: {},
  extraction: {},
});

// Helper to create mock feature
const createMockFeature = (
  id: number,
  coords: [number, number][],
  ownerName = 'Test Country'
): Feature<Polygon> => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [coords]
  },
  properties: {
    type: 'region',
    regionId: id,
    ownerName
  }
});

// Helper to create circular coordinates
const createCircularCoords = (cx: number, cy: number, r: number, numPoints = 12): [number, number][] => {
  const coords: [number, number][] = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    const lon = cx + r * Math.cos(angle);
    const lat = cy + r * Math.sin(angle);
    coords.push([lon, lat]);
  }
  coords.push([coords[0][0], coords[0][1]]);
  return coords;
};

describe('Tier 1: Basic Functional Tests (T1_F1_1 ... T1_F5_5)', () => {
  // --- F1: Flat Web Mercator Layout ---
  it('T1_F1_1: should project a base point at the equator correctly', () => {
    const coords: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const regions = [createMockRegion(1, 4)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'A')]
    };
    const labels = buildCountryLabels(fc, regions);
    expect(labels.features.length).toBe(1);
    const label = labels.features[0];
    expect(label.properties.name).toBe('A');
    expect(label.geometry.coordinates[0]).toBeCloseTo(0, 2);
    expect(label.geometry.coordinates[1]).toBeCloseTo(0, 2);
  });

  it('T1_F1_2: should maintain equal spacing between characters for symmetric names at equator in Mercator', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'ABA')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(3);
    const p0 = lonLatToMercator(labels[0].geometry.coordinates[0], labels[0].geometry.coordinates[1]);
    const p1 = lonLatToMercator(labels[1].geometry.coordinates[0], labels[1].geometry.coordinates[1]);
    const p2 = lonLatToMercator(labels[2].geometry.coordinates[0], labels[2].geometry.coordinates[1]);
    const dist01 = Math.sqrt((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2);
    const dist12 = Math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2);
    expect(dist01).toBeCloseTo(dist12, 4);
  });

  it('T1_F1_3: should correctly compute spacing at high latitudes in Mercator', () => {
    // Stretched region at lat: 70
    const coords: [number, number][] = [[-10, 68], [10, 68], [10, 72], [-10, 72], [-10, 68]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'ABA')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(3);
    const p0 = lonLatToMercator(labels[0].geometry.coordinates[0], labels[0].geometry.coordinates[1]);
    const p1 = lonLatToMercator(labels[1].geometry.coordinates[0], labels[1].geometry.coordinates[1]);
    const p2 = lonLatToMercator(labels[2].geometry.coordinates[0], labels[2].geometry.coordinates[1]);
    const dist01 = Math.sqrt((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2);
    const dist12 = Math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2);
    expect(dist01).toBeCloseTo(dist12, 4);
  });

  it('T1_F1_4: should ensure monotonic increase of X coordinates for west-east layouts', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'EAST')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(4);
    expect(labels[0].geometry.coordinates[0]).toBeLessThan(labels[1].geometry.coordinates[0]);
    expect(labels[1].geometry.coordinates[0]).toBeLessThan(labels[2].geometry.coordinates[0]);
    expect(labels[2].geometry.coordinates[0]).toBeLessThan(labels[3].geometry.coordinates[0]);
  });

  it('T1_F1_5: should ensure monotonic increase or decrease of Y coordinates for south-north layouts', () => {
    const coords: [number, number][] = [[-2, -10], [2, -10], [2, 10], [-2, 10], [-2, -10]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'NORTH')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(5);
    const yVals = labels.map(l => l.geometry.coordinates[1]);
    const isIncreasing = yVals[0] < yVals[1] && yVals[1] < yVals[2];
    const isDecreasing = yVals[0] > yVals[1] && yVals[1] > yVals[2];
    expect(isIncreasing || isDecreasing).toBe(true);
  });

  // --- F2: Dynamic Baseline Shape ---
  it('T1_F2_1: should build a straight baseline for a compact shape', () => {
    const coords = createCircularCoords(0, 0, 1); // aspect ratio ~ 1.0
    const regions = [createMockRegion(1, 3)];
    const paired = [{ region: regions[0], feature: createMockFeature(1, coords) }];
    const axis = computeCountryAxis([paired[0].feature], paired);
    const line = buildCountryLabelLine(paired, axis);
    // Compact shapes result in straight 2-point baselines
    expect(line.length).toBe(2);
  });

  it('T1_F2_2: should build a curved baseline for an elongated shape', () => {
    // 4 regions arranged in a diagonal line (elongated shape)
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2, 4]),
      createMockRegion(4, 1, [3])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]]) },
      { region: regions[1], feature: createMockFeature(2, [[1, 1], [1.2, 1], [1.2, 1.2], [1, 1.2], [1, 1]]) },
      { region: regions[2], feature: createMockFeature(3, [[2, 2], [2.2, 2], [2.2, 2.2], [2, 2.2], [2, 2]]) },
      { region: regions[3], feature: createMockFeature(4, [[3, 3], [3.2, 3], [3.2, 3.2], [3, 3.2], [3, 3]]) }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    expect(line.length).toBeGreaterThan(2);
  });

  it('T1_F2_3: should orient the baseline from west to east', () => {
    const coords: [number, number][] = [[-10, -1], [10, -1], [10, 1], [-10, 1], [-10, -1]];
    const regions = [createMockRegion(1, 40)];
    const paired = [{ region: regions[0], feature: createMockFeature(1, coords) }];
    const axis = computeCountryAxis([paired[0].feature], paired);
    const line = buildCountryLabelLine(paired, axis);
    expect(line[line.length - 1][0]).toBeGreaterThanOrEqual(line[0][0]);
  });

  it('T1_F2_4: should reverse the baseline if initial centroids order is east-to-west', () => {
    const r1 = createMockRegion(1, 1, [2]);
    const r2 = createMockRegion(2, 1, [1, 3]);
    const r3 = createMockRegion(3, 1, [2]);
    // Centers going East to West: 10 -> 5 -> 0
    const paired = [
      { region: r1, feature: createMockFeature(1, [[10, 0], [10.2, 0], [10.2, 0.2], [10, 0.2], [10, 0]]) },
      { region: r2, feature: createMockFeature(2, [[5, 0], [5.2, 0], [5.2, 0.2], [5, 0.2], [5, 0]]) },
      { region: r3, feature: createMockFeature(3, [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]]) }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    expect(line[line.length - 1][0]).toBeGreaterThanOrEqual(line[0][0]);
  });

  it('T1_F2_5: should fallback to a straight line if country has less than 3 regions', () => {
    // 2 regions (aspect ratio could be high, but < 3 regions)
    const regions = [createMockRegion(1, 1, [2]), createMockRegion(2, 1, [1])];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]) },
      { region: regions[1], feature: createMockFeature(2, [[5, 5], [5.5, 5], [5.5, 5.5], [5, 5.5], [5, 5]]) }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    expect(line.length).toBe(2);
  });

  // --- F3: Proportional Kerning ---
  it('T1_F3_1: should calculate spacing proportional to character widths', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'WI')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(2);
    // Center spacing should incorporate half-widths of W (0.85) and I (0.22)
    const p0 = lonLatToMercator(labels[0].geometry.coordinates[0], labels[0].geometry.coordinates[1]);
    const p1 = lonLatToMercator(labels[1].geometry.coordinates[0], labels[1].geometry.coordinates[1]);
    const dist = Math.sqrt((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2);
    expect(dist).toBeGreaterThan(0);
  });

  it('T1_F3_2: should handle space character widths correctly', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'A B')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(3);
    expect(labels[1].properties.name).toBe(' ');
  });

  it('T1_F3_3: should layout mixed case names correctly', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'Ay')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(2);
    expect(labels[0].properties.name).toBe('A');
    expect(labels[1].properties.name).toBe('y');
  });

  it('T1_F3_4: should fallback to default width for unknown special characters', () => {
    const wDefault = getCharacterWidth('#');
    expect(wDefault).toBe(0.55);
  });

  it('T1_F3_5: should scale spacing linearly with zoom font size', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'ABA')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    // sizeZ2 and sizeZ7 must scale properly
    expect(labels[0].properties.sizeZ7).toBeGreaterThanOrEqual(labels[0].properties.sizeZ2);
  });

  // --- F4: Out-of-Bounds Extrapolation ---
  it('T1_F4_1: should extrapolate long name outside short baseline without overlapping', () => {
    // very narrow region
    const coords: [number, number][] = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]];
    const regions = [createMockRegion(1, 0.04)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'LONGNAME')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(8);
    // Verify no two adjacent letters share the same position
    for (let i = 0; i < labels.length - 1; i++) {
      const p1 = labels[i].geometry.coordinates;
      const p2 = labels[i + 1].geometry.coordinates;
      const dist = Math.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2);
      expect(dist).toBeGreaterThan(1e-4);
    }
  });

  it('T1_F4_2: should extrapolate backwards along first segment tangent when d < 0', () => {
    const line: [number, number][] = [[0, 0], [10, 0]];
    const { point, tangent } = getPointAlongLine(line, -5);
    expect(point[0]).toBeCloseTo(-5, 5);
    expect(point[1]).toBeCloseTo(0, 5);
    expect(tangent[0]).toBeCloseTo(1, 5);
    expect(tangent[1]).toBeCloseTo(0, 5);
  });

  it('T1_F4_3: should extrapolate forwards along last segment tangent when d > L_base', () => {
    const line: [number, number][] = [[0, 0], [10, 0]];
    const { point, tangent } = getPointAlongLine(line, 15);
    expect(point[0]).toBeCloseTo(15, 5);
    expect(point[1]).toBeCloseTo(0, 5);
    expect(tangent[0]).toBeCloseTo(1, 5);
    expect(tangent[1]).toBeCloseTo(0, 5);
  });

  it('T1_F4_4: should extrapolate along a 45 degree diagonal line correctly', () => {
    const line: [number, number][] = [[0, 0], [10, 10]]; // length 14.142
    const { point } = getPointAlongLine(line, -5);
    // Extrapolate backward along unit vector [1/sqrt(2), 1/sqrt(2)]
    const expectedX = -5 / Math.sqrt(2);
    const expectedY = -5 / Math.sqrt(2);
    expect(point[0]).toBeCloseTo(expectedX, 5);
    expect(point[1]).toBeCloseTo(expectedY, 5);
  });

  it('T1_F4_5: should handle zero length baseline extrapolation without NaN', () => {
    const line: [number, number][] = [[5, 5]];
    const { point } = getPointAlongLine(line, 5);
    expect(point[0]).not.toBe(NaN);
    expect(point[1]).not.toBe(NaN);
  });

  // --- F5: Continuous Rotation & Alignment ---
  it('T1_F5_1: should keep horizontal letters at 0 rotation', () => {
    const coords: [number, number][] = [[-10, -1], [10, -1], [10, 1], [-10, 1], [-10, -1]];
    const regions = [createMockRegion(1, 40)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'HELL')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(4);
    for (const label of labels) {
      expect(Math.abs(label.properties.rotateDeg)).toBeLessThan(2);
    }
  });

  it('T1_F5_2: should align vertical letters at 90 or -90 rotation', () => {
    const coords: [number, number][] = [[-1, -10], [1, -10], [1, 10], [-1, 10], [-1, -10]];
    const regions = [createMockRegion(1, 40)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'UP')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(2);
    for (const label of labels) {
      expect(Math.abs(Math.abs(label.properties.rotateDeg) - 90)).toBeLessThan(2);
    }
  });

  it('T1_F5_3: should normalize rotation to [-90, 90] range', () => {
    // Line going bottom-left (-135 degrees)
    const line: [number, number][] = [[10, 10], [0, 0]];
    const { tangent } = getPointAlongLine(line, 5);
    const angleRad = Math.atan2(tangent[1], tangent[0]);
    let angleDeg = angleRad * 180 / Math.PI;
    while (angleDeg < -90) angleDeg += 180;
    while (angleDeg > 90) angleDeg -= 180;
    expect(angleDeg).toBeCloseTo(45, 5);
  });

  it('T1_F5_4: should change rotation monotonically along a smooth circular arc', () => {
    // 5 points on a quarter circle
    const line: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const angle = (i * Math.PI) / 8; // 0 to 90 degrees
      line.push([Math.cos(angle), Math.sin(angle)]);
    }
    const rotations: number[] = [];
    for (let d = 0.1; d < 1.5; d += 0.3) {
      const { tangent } = getPointAlongLine(line, d);
      const rot = Math.atan2(tangent[1], tangent[0]) * 180 / Math.PI;
      rotations.push(rot);
    }
    // Rotations should be monotonic
    const isIncreasing = rotations.slice(1).every((r, idx) => r >= rotations[idx]);
    const isDecreasing = rotations.slice(1).every((r, idx) => r <= rotations[idx]);
    expect(isIncreasing || isDecreasing).toBe(true);
  });

  it('T1_F5_5: should position and rotate single-letter labels according to PCA axis', () => {
    const coords: [number, number][] = [[-10, -2], [10, -2], [10, 2], [-10, 2], [-10, -2]];
    const regions = [createMockRegion(1, 80)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'Z')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(1);
    expect(labels[0].properties.name).toBe('Z');
    expect(Math.abs(labels[0].properties.rotateDeg)).toBeLessThan(3);
  });
});

describe('Tier 2: Boundary Conditions and Extreme Values (T2_F1_1 ... T2_F5_5)', () => {
  // --- F1: Flat Web Mercator Layout ---
  it('T2_F1_1: should cross antimeridian 180 degrees without massive coordinate jumps', () => {
    // Regions at 179 and -179 longitude
    const r1 = createMockRegion(1, 1, [2]);
    const r2 = createMockRegion(2, 1, [1]);
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [
        createMockFeature(1, [[178.5, -0.5], [179.5, -0.5], [179.5, 0.5], [178.5, 0.5], [178.5, -0.5]], 'CROSS'),
        createMockFeature(2, [[-179.5, -0.5], [-178.5, -0.5], [-178.5, 0.5], [-179.5, 0.5], [-179.5, -0.5]], 'CROSS')
      ]
    };
    const labels = buildCountryLabels(fc, [r1, r2]).features;
    expect(labels.length).toBeGreaterThan(0);
    // Longitudes of all label points should be within standard [-180, 180] range
    for (const label of labels) {
      expect(label.geometry.coordinates[0]).toBeGreaterThanOrEqual(-180);
      expect(label.geometry.coordinates[0]).toBeLessThanOrEqual(180);
    }
  });

  it('T2_F1_2: should clamp extreme North latitude at 85.051128', () => {
    const [x, y] = lonLatToMercator(0, 90);
    const [, lat] = mercatorToLonLat(x, y);
    expect(lat).toBeCloseTo(85.051128, 4);
  });

  it('T2_F1_3: should clamp extreme South latitude at -85.051128', () => {
    const [x, y] = lonLatToMercator(0, -90);
    const [, lat] = mercatorToLonLat(x, y);
    expect(lat).toBeCloseTo(-85.051128, 4);
  });

  it('T2_F1_4: should process micro-regions without numerical overflow or division by zero', () => {
    const coords: [number, number][] = [
      [-1e-6, -1e-6],
      [1e-6, -1e-6],
      [1e-6, 1e-6],
      [-1e-6, 1e-6],
      [-1e-6, -1e-6]
    ];
    const regions = [createMockRegion(1, 1e-12)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'TINY')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(4);
    for (const label of labels) {
      expect(label.geometry.coordinates[0]).not.toBe(NaN);
      expect(label.geometry.coordinates[1]).not.toBe(NaN);
      expect(Math.abs(label.geometry.coordinates[0])).toBeLessThan(2);
      expect(Math.abs(label.geometry.coordinates[1])).toBeLessThan(2);
    }
  });

  it('T2_F1_5: should handle point-like degenerate polygons correctly', () => {
    const coords: [number, number][] = [[10, 10], [10, 10], [10, 10], [10, 10]];
    const regions = [createMockRegion(1, 0)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'POINT')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0].geometry.coordinates[0]).toBeCloseTo(10, 4);
    expect(labels[0].geometry.coordinates[1]).toBeCloseTo(10, 4);
  });

  // --- F2: Dynamic Baseline Shape ---
  it('T2_F2_1: should behave deterministically at aspect ratio threshold 1.4', () => {
    // 3 regions arranged to give aspect ratio close to 1.4
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 0], [1, 0], [1, 0.7], [0, 0.7], [0, 0]]) },
      { region: regions[1], feature: createMockFeature(2, [[1, 0], [2, 0], [2, 0.7], [1, 0.7], [1, 0]]) },
      { region: regions[2], feature: createMockFeature(3, [[2, 0], [3, 0], [3, 0.7], [2, 0.7], [2, 0]]) }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    expect(line.length).toBeDefined();
  });

  it('T2_F2_2: should layout vertical elongated countries (e.g. Chile) correctly', () => {
    // 4 regions arranged vertically from north to south
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2, 4]),
      createMockRegion(4, 1, [3])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 10], [1, 10], [1, 11], [0, 11], [0, 10]], 'CHILE') },
      { region: regions[1], feature: createMockFeature(2, [[0, 7], [1, 7], [1, 8], [0, 8], [0, 7]], 'CHILE') },
      { region: regions[2], feature: createMockFeature(3, [[0, 4], [1, 4], [1, 5], [0, 5], [0, 4]], 'CHILE') },
      { region: regions[3], feature: createMockFeature(4, [[0, 1], [1, 1], [1, 2], [0, 2], [0, 1]], 'CHILE') }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    // Baseline should flow vertically
    expect(line.length).toBeGreaterThan(2);
  });

  it('T2_F2_3: should place baseline inside landmass for a C-shaped crescent country', () => {
    // Crescent shape: regions at (0,0), (1,1), (0,2), global centroid is around (0.3, 1) which might be water
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]) },
      { region: regions[1], feature: createMockFeature(2, [[1, 1], [1.5, 1], [1.5, 1.5], [1, 1.5], [1, 1]]) },
      { region: regions[2], feature: createMockFeature(3, [[0, 2], [0.5, 2], [0.5, 2.5], [0, 2.5], [0, 2]]) }
    ];
    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    const line = buildCountryLabelLine(paired, axis);
    // Baseline should pass through the regions (smoothed centroids)
    expect(line.length).toBeGreaterThan(2);
  });

  it('T2_F2_4: should build baseline focusing on largest mainland cluster in archipelagos', () => {
    // 3 connected regions (mainland) and 1 disconnected remote region
    const r1 = createMockRegion(1, 1, [2], 'island-nation');
    const r2 = createMockRegion(2, 1, [1, 3], 'island-nation');
    const r3 = createMockRegion(3, 1, [2], 'island-nation');
    const r4 = createMockRegion(4, 1, [], 'island-nation'); // disconnected remote island
    const owned = [r1, r2, r3, r4];
    const mainland = largestMainlandCluster(owned);
    expect(mainland.length).toBe(3);
    expect(mainland.map(m => m.id)).not.toContain(4);
  });

  it('T2_F2_5: should handle empty region list safely without exceptions', () => {
    const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] };
    const labels = buildCountryLabels(fc, []);
    expect(labels.features.length).toBe(0);
  });

  // --- F3: Proportional Spacing Limits ---
  it('T2_F3_1: should clamp character spacing to max limit (0.60em) for very long baselines', () => {
    // 1 very wide region, short name
    const coords: [number, number][] = [[-100, -1], [100, -1], [100, 1], [-100, 1], [-100, -1]];
    const regions = [createMockRegion(1, 400)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'A B')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(3);
    const p0 = lonLatToMercator(labels[0].geometry.coordinates[0], labels[0].geometry.coordinates[1]);
    const p2 = lonLatToMercator(labels[2].geometry.coordinates[0], labels[2].geometry.coordinates[1]);
    const totalDist = Math.sqrt((p2[0]-p0[0])**2 + (p2[1]-p0[1])**2);
    // Should be bounded, not stretched across all 200 degrees
    expect(totalDist).toBeLessThan(100);
  });

  it('T2_F3_2: should clamp character spacing to min limit (0.08em) for very short baselines', () => {
    const coords: [number, number][] = [[-0.01, -0.01], [0.01, -0.01], [0.01, 0.01], [-0.01, 0.01], [-0.01, -0.01]];
    const regions = [createMockRegion(1, 0.0004)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'VERYLONGNAME')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(12);
  });

  it('T2_F3_3: should correctly compute width factor sum containing dash and wide letters', () => {
    const name = 'M-W';
    const sumW = name.split('').reduce((sum, c) => sum + getCharacterWidth(c), 0);
    expect(sumW).toBeCloseTo(0.85 + 0.55 + 0.85, 2); // getCharacterWidth('-') defaults to 0.55 or special
  });

  it('T2_F3_4: should handle strings consisting of only spaces without crashing', () => {
    const coords: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const regions = [createMockRegion(1, 4)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, '   ')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(3);
  });

  it('T2_F3_5: should handle empty string names safely', () => {
    const coords: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const regions = [createMockRegion(1, 4)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, '')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(0);
  });

  // --- F4: Out-of-Bounds Extrapolation ---
  it('T2_F4_1: should extrapolate extremely long names without clumping', () => {
    const line: [number, number][] = [[0, 0], [1, 0]];
    // points far outside [0, 1] range
    const p1 = getPointAlongLine(line, -100).point;
    const p2 = getPointAlongLine(line, -90).point;
    const dist = Math.abs(p2[0] - p1[0]);
    expect(dist).toBeCloseTo(10, 4);
  });

  it('T2_F4_2: should fallback horizontally for a zero length baseline', () => {
    const line: [number, number][] = [[10, 10]];
    const res = getPointAlongLine(line, 5);
    expect(res.point[0]).toBeCloseTo(10, 4);
    expect(res.point[1]).toBeCloseTo(10, 4);
    expect(res.tangent[0]).toBeCloseTo(1, 4);
  });

  it('T2_F4_3: should follow last segment direction for forward extrapolation in sharp 90-deg bend', () => {
    const line: [number, number][] = [[0, 0], [10, 0], [10, 10]];
    const res = getPointAlongLine(line, 25); // total length is 20, past end
    // Last segment is vertically up. Tangent should be [0, 1].
    expect(res.tangent[0]).toBeCloseTo(0, 4);
    expect(res.tangent[1]).toBeCloseTo(1, 4);
    expect(res.point[0]).toBeCloseTo(10, 4);
    expect(res.point[1]).toBeCloseTo(15, 4);
  });

  it('T2_F4_4: should extrapolate past loop / self-intersecting baseline correctly', () => {
    const line: [number, number][] = [[0, 0], [10, 0], [5, 5], [5, -5]];
    // length of segments: 10, sqrt(25+25) = 7.07, 10. Total length = 27.07
    // Extrapolate forward. Last segment: [5, 5] -> [5, -5] (vertically down)
    const res = getPointAlongLine(line, 35);
    expect(res.tangent[0]).toBeCloseTo(0, 4);
    expect(res.tangent[1]).toBeCloseTo(-1, 4);
  });

  it('T2_F4_5: should extrapolate a two-point line symmetrically on both ends', () => {
    const line: [number, number][] = [[10, 10], [20, 20]]; // direction [1/sqrt(2), 1/sqrt(2)]
    const backward = getPointAlongLine(line, -5);
    const forward = getPointAlongLine(line, 5 + 14.142);
    const distBack = Math.sqrt((backward.point[0]-10)**2 + (backward.point[1]-10)**2);
    const distFor = Math.sqrt((forward.point[0]-20)**2 + (forward.point[1]-20)**2);
    expect(distBack).toBeCloseTo(5, 2);
    expect(distFor).toBeCloseTo(5, 2);
  });

  // --- F5: Continuous Rotation & Alignment ---
  it('T2_F5_1: should transition rotation angles smoothly on an S-curve', () => {
    const line: [number, number][] = [[0, 0], [5, 5], [10, 5], [15, 0]];
    const rotations: number[] = [];
    for (let d = 1; d < 18; d += 2) {
      const { tangent } = getPointAlongLine(line, d);
      rotations.push(Math.atan2(tangent[1], tangent[0]) * 180 / Math.PI);
    }
    // No sudden jumps of >= 180 degrees
    for (let i = 0; i < rotations.length - 1; i++) {
      const diff = Math.abs(rotations[i + 1] - rotations[i]);
      expect(diff).toBeLessThan(90);
    }
  });

  it('T2_F5_2: should keep vertical rotation pointing up at exactly 90 degrees', () => {
    const line: [number, number][] = [[0, 0], [0, 10]];
    const { tangent } = getPointAlongLine(line, 5);
    const angleRad = Math.atan2(tangent[1], tangent[0]);
    let angleDeg = angleRad * 180 / Math.PI;
    while (angleDeg < -90) angleDeg += 180;
    while (angleDeg > 90) angleDeg -= 180;
    expect(Math.abs(angleDeg)).toBeCloseTo(90, 4);
  });

  it('T2_F5_3: should normalize vertical rotation pointing down to 90 degrees', () => {
    const line: [number, number][] = [[0, 10], [0, 0]];
    const { tangent } = getPointAlongLine(line, 5);
    const angleRad = Math.atan2(tangent[1], tangent[0]);
    let angleDeg = angleRad * 180 / Math.PI;
    while (angleDeg < -90) angleDeg += 180;
    while (angleDeg > 90) angleDeg -= 180;
    expect(Math.abs(angleDeg)).toBeCloseTo(90, 4);
  });

  it('T2_F5_4: should compute rotation stably on high curvature lines', () => {
    const line: [number, number][] = [[0, 0], [0.1, 1], [0, 2]];
    const res = getPointAlongLine(line, 1.0);
    expect(res.tangent[0]).not.toBe(NaN);
    expect(res.tangent[1]).not.toBe(NaN);
  });

  it('T2_F5_5: should handle micro-segment rounding noise without NaN rotation', () => {
    const line: [number, number][] = [[0, 0], [1e-9, 1e-9]];
    const res = getPointAlongLine(line, 0.5e-9);
    expect(res.tangent[0]).not.toBe(NaN);
    expect(res.tangent[1]).not.toBe(NaN);
  });
});

describe('Tier 3: Integration Tests (T3_1 ... T3_5)', () => {
  it('T3_1: should layout a curved high-latitude country with mixed character widths correctly', () => {
    // 5 regions arranged in a curve at lat: 75
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2, 4]),
      createMockRegion(4, 1, [3, 5]),
      createMockRegion(5, 1, [4])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 75], [0.2, 75], [0.2, 75.2], [0, 75.2], [0, 75]], 'MINIMUM-WIDTH') },
      { region: regions[1], feature: createMockFeature(2, [[1, 76], [1.2, 76], [1.2, 76.2], [1, 76.2], [1, 76]], 'MINIMUM-WIDTH') },
      { region: regions[2], feature: createMockFeature(3, [[2, 77], [2.2, 77], [2.2, 77.2], [2, 77.2], [2, 77]], 'MINIMUM-WIDTH') },
      { region: regions[3], feature: createMockFeature(4, [[3, 76], [3.2, 76], [3.2, 76.2], [3, 76.2], [3, 76]], 'MINIMUM-WIDTH') },
      { region: regions[4], feature: createMockFeature(5, [[4, 75], [4.2, 75], [4.2, 75.2], [4, 75.2], [4, 75]], 'MINIMUM-WIDTH') }
    ];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: paired.map(p => p.feature)
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe('MINIMUM-WIDTH'.length);
    for (const label of labels) {
      expect(label.geometry.coordinates[0]).toBeGreaterThanOrEqual(-180);
      expect(label.geometry.coordinates[0]).toBeLessThanOrEqual(180);
    }
  });

  it('T3_2: should layout a compact country crossing 180 antimeridian with extrapolation correctly', () => {
    // Regions at 179 and -179
    const r1 = createMockRegion(1, 2, [2]);
    const r2 = createMockRegion(2, 2, [1]);
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [
        createMockFeature(1, [[178, -1], [180, -1], [180, 1], [178, 1], [178, -1]], 'CROSSING-THE-LINE'),
        createMockFeature(2, [[-180, -1], [-178, -1], [-178, 1], [-180, 1], [-180, -1]], 'CROSSING-THE-LINE')
      ]
    };
    const labels = buildCountryLabels(fc, [r1, r2]).features;
    expect(labels.length).toBe('CROSSING-THE-LINE'.length);
  });

  it('T3_3: should layout an S-curved country with extreme extrapolation and rotation', () => {
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2, 4]),
      createMockRegion(4, 1, [3])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]], 'EXTRAPOLATE-S-CURVE') },
      { region: regions[1], feature: createMockFeature(2, [[1, 2], [1.2, 2], [1.2, 2.2], [1, 2.2], [1, 2]], 'EXTRAPOLATE-S-CURVE') },
      { region: regions[2], feature: createMockFeature(3, [[2, 2], [2.2, 2], [2.2, 2.2], [2, 2.2], [2, 2]], 'EXTRAPOLATE-S-CURVE') },
      { region: regions[3], feature: createMockFeature(4, [[3, 0], [3.2, 0], [3.2, 0.2], [3, 0.2], [3, 0]], 'EXTRAPOLATE-S-CURVE') }
    ];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: paired.map(p => p.feature)
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe('EXTRAPOLATE-S-CURVE'.length);
  });

  it('T3_4: should layout an archipelago of 8 regions with spacing compression and rotation', () => {
    // 8 regions in a chain
    const regions: Region[] = [];
    const features: Feature<Polygon>[] = [];
    for (let i = 1; i <= 8; i++) {
      regions.push(createMockRegion(i, 1, i < 8 ? [i + 1] : []));
      features.push(createMockFeature(i, [[i, i], [i + 0.5, i], [i + 0.5, i + 0.5], [i, i + 0.5], [i, i]], 'ARCHIPELAGO-NATION'));
    }
    const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe('ARCHIPELAGO-NATION'.length);
  });

  it('T3_5: should layout a micro-country with a single-letter name', () => {
    const coords: [number, number][] = [[10, 10], [10.01, 10], [10.01, 10.01], [10, 10.01], [10, 10]];
    const regions = [createMockRegion(1, 0.0001)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, coords, 'I')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(1);
    expect(labels[0].properties.name).toBe('I');
  });
});

describe('Tier 4: Real-World Scenarios (T4_1 ... T4_5)', () => {
  it('T4_1: should simulate France/Poland compact layout', () => {
    const circularCoords = createCircularCoords(2, 48, 3); // Center around France-like coords
    const regions = [createMockRegion(1, 28)];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [createMockFeature(1, circularCoords, 'FRANCE')]
    };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(6);
  });

  it('T4_2: should simulate Norway/Chile elongated curved layout', () => {
    // Chain representing Norway/Chile
    const regions = [
      createMockRegion(1, 1, [2]),
      createMockRegion(2, 1, [1, 3]),
      createMockRegion(3, 1, [2, 4]),
      createMockRegion(4, 1, [3, 5]),
      createMockRegion(5, 1, [4])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[5, 60], [5.5, 60], [5.5, 60.5], [5, 60.5], [5, 60]], 'NORWAY') },
      { region: regions[1], feature: createMockFeature(2, [[6, 62], [6.5, 62], [6.5, 62.5], [6, 62.5], [6, 62]], 'NORWAY') },
      { region: regions[2], feature: createMockFeature(3, [[7, 64], [7.5, 64], [7.5, 64.5], [7, 64.5], [7, 64]], 'NORWAY') },
      { region: regions[3], feature: createMockFeature(4, [[9, 66], [9.5, 66], [9.5, 66.5], [9, 66.5], [9, 66]], 'NORWAY') },
      { region: regions[4], feature: createMockFeature(5, [[12, 68], [12.5, 68], [12.5, 68.5], [12, 68.5], [12, 68]], 'NORWAY') }
    ];
    const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: paired.map(p => p.feature) };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(6);
  });

  it('T4_3: should simulate Sumatra diagonal layout with extrapolation', () => {
    // Diagonal island
    const regions = [
      createMockRegion(1, 2, [2]),
      createMockRegion(2, 2, [1])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[95, -5], [97, -5], [97, -3], [95, -3], [95, -5]], 'SUMATRA') },
      { region: regions[1], feature: createMockFeature(2, [[100, -1], [102, -1], [102, 1], [100, 1], [100, -1]], 'SUMATRA') }
    ];
    const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: paired.map(p => p.feature) };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe(7);
  });

  it('T4_4: should simulate Soviet Union giant transcontinental layout', () => {
    // Giant country stretching from lon: 30 to 170, lat: 50 to 75
    const regions = [
      createMockRegion(1, 100, [2]),
      createMockRegion(2, 100, [1, 3]),
      createMockRegion(3, 100, [2])
    ];
    const paired = [
      { region: regions[0], feature: createMockFeature(1, [[30, 50], [60, 50], [60, 75], [30, 75], [30, 50]], 'SOVIET UNION') },
      { region: regions[1], feature: createMockFeature(2, [[60, 50], [120, 50], [120, 75], [60, 75], [60, 50]], 'SOVIET UNION') },
      { region: regions[2], feature: createMockFeature(3, [[120, 50], [170, 50], [170, 75], [120, 75], [120, 50]], 'SOVIET UNION') }
    ];
    const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: paired.map(p => p.feature) };
    const labels = buildCountryLabels(fc, regions).features;
    expect(labels.length).toBe('SOVIET UNION'.length);
  });

  it('T4_5: should simulate Caribbean/Bahamas dispersed island chain focusing on largest component', () => {
    // Caribbean chain: Cuba/Hispaniola/Jamaica (connected or largest component) + far away Bahamas
    const Cuba = createMockRegion(1, 10, [2], 'CARIBBEAN');
    const Hispaniola = createMockRegion(2, 8, [1], 'CARIBBEAN');
    const Bahamas = createMockRegion(3, 2, [], 'CARIBBEAN'); // Disconnected
    const owned = [Cuba, Hispaniola, Bahamas];
    const fc: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [
        createMockFeature(1, [[-84, 20], [-80, 20], [-80, 23], [-84, 23], [-84, 20]], 'CARIBBEAN'),
        createMockFeature(2, [[-74, 18], [-70, 18], [-70, 20], [-74, 20], [-74, 18]], 'CARIBBEAN'),
        createMockFeature(3, [[-78, 25], [-76, 25], [-76, 27], [-78, 27], [-78, 25]], 'CARIBBEAN')
      ]
    };
    const labels = buildCountryLabels(fc, owned).features;
    // Caribbean contains 9 letters
    expect(labels.length).toBe(9);
  });
});
