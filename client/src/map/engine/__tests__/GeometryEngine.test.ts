import { describe, it, expect } from 'vitest';
import {
  lonLatToMercator,
  mercatorToLonLat,
  getCharacterWidth,
  getPointAlongLine,
  getLineLength,
  computeCountryAxis,
  buildCountryLabelLine
} from '../GeometryEngine';
import type { Feature, Polygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';

describe('GeometryEngine - Web Mercator Projections', () => {
  it('should be mutually inverse within 1e-6 precision', () => {
    const testCases: [number, number][] = [
      [0, 0],
      [10, 20],
      [-150, 60],
      [179.9, -80],
      [-45, 85],
      [180, 85.051128],
      [-180, -85.051128]
    ];

    for (const [lon, lat] of testCases) {
      const [x, y] = lonLatToMercator(lon, lat);
      const [lon2, lat2] = mercatorToLonLat(x, y);
      expect(lon2).toBeCloseTo(lon, 5);
      expect(lat2).toBeCloseTo(lat, 5);
    }
  });

  it('should clamp latitudes to valid Web Mercator range', () => {
    const [x1, y1] = lonLatToMercator(0, 90);
    const [x2, y2] = lonLatToMercator(0, 85.051128);
    expect(x1).toBeCloseTo(x2, 5);
    expect(y1).toBeCloseTo(y2, 5);
  });
});

describe('GeometryEngine - Proportional Character Kerning', () => {
  it('should return correct widths for specific characters', () => {
    expect(getCharacterWidth('I')).toBe(0.22);
    expect(getCharacterWidth('l')).toBe(0.22);
    expect(getCharacterWidth('W')).toBe(0.85);
    expect(getCharacterWidth('M')).toBe(0.85);
    expect(getCharacterWidth('E')).toBe(0.45);
    expect(getCharacterWidth('t')).toBe(0.45);
    expect(getCharacterWidth('A')).toBe(0.55);
    expect(getCharacterWidth('Z')).toBe(0.55);
    expect(getCharacterWidth('?')).toBe(0.55);
  });
});

describe('GeometryEngine - Large ownership geometry', () => {
  it('does not spread a large coordinate set into Math.max/min arguments', () => {
    const pointCount = 150_000;
    const ring: [number, number][] = Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / (pointCount - 1)) * Math.PI * 2;
      return [20 + Math.cos(angle), 50 + Math.sin(angle)];
    });
    ring[pointCount - 1] = ring[0];
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { type: 'region', regionId: 1, ownerName: 'Large Country' },
    };
    const region: Region = {
      id: 1,
      geoJsonId: 'LARGE-1',
      names: { ru: 'Большой регион', en: 'Large Region' },
      ownerCountryId: 'large-country',
      neighboringRegionIds: [],
      area: 1,
      population: 1,
      urbanization: 0,
      stability: 50,
      infrastructure: 0,
      development: 0,
      gdp: 1,
      deposits: {},
      extraction: {},
    };

    expect(() => computeCountryAxis([feature], [{ region, feature }])).not.toThrow();
  });
});

describe('GeometryEngine - Linear Tangent Extrapolation', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0]
  ];

  it('should interpolate inside the line bounds', () => {
    const { point, tangent } = getPointAlongLine(line, 5);
    expect(point[0]).toBeCloseTo(5, 5);
    expect(point[1]).toBeCloseTo(0, 5);
    expect(tangent[0]).toBeCloseTo(1, 5);
    expect(tangent[1]).toBeCloseTo(0, 5);
  });

  it('should extrapolate backwards along the first segment tangent when d < 0', () => {
    const { point, tangent } = getPointAlongLine(line, -3);
    expect(point[0]).toBeCloseTo(-3, 5);
    expect(point[1]).toBeCloseTo(0, 5);
    expect(tangent[0]).toBeCloseTo(1, 5);
    expect(tangent[1]).toBeCloseTo(0, 5);
  });

  it('should extrapolate forwards along the last segment tangent when d > L_base', () => {
    const { point, tangent } = getPointAlongLine(line, 14);
    expect(point[0]).toBeCloseTo(14, 5);
    expect(point[1]).toBeCloseTo(0, 5);
    expect(tangent[0]).toBeCloseTo(1, 5);
    expect(tangent[1]).toBeCloseTo(0, 5);
  });

  it('should handle multi-segment lines correctly', () => {
    const multiLine: [number, number][] = [
      [0, 0],
      [3, 4], // length 5
      [9, 12] // length 10 from (3,4), total length 15
    ];
    // Interpolate first segment
    const res1 = getPointAlongLine(multiLine, 2.5);
    expect(res1.point[0]).toBeCloseTo(1.5, 5);
    expect(res1.point[1]).toBeCloseTo(2.0, 5);
    expect(res1.tangent[0]).toBeCloseTo(3 / 5, 5);
    expect(res1.tangent[1]).toBeCloseTo(4 / 5, 5);

    // Interpolate second segment
    const res2 = getPointAlongLine(multiLine, 10);
    // 5 units along [3,4]->[9,12]
    // vector is [6, 8], length is 10. Unit vector: [0.6, 0.8]
    // Point: (3, 4) + 5 * [0.6, 0.8] = (3+3, 4+4) = (6, 8)
    expect(res2.point[0]).toBeCloseTo(6, 5);
    expect(res2.point[1]).toBeCloseTo(8, 5);
    expect(res2.tangent[0]).toBeCloseTo(0.6, 5);
    expect(res2.tangent[1]).toBeCloseTo(0.8, 5);

    // Extrapolate past end
    const res3 = getPointAlongLine(multiLine, 20);
    // 5 units past (9, 12) along [0.6, 0.8] = (9+3, 12+4) = (12, 16)
    expect(res3.point[0]).toBeCloseTo(12, 5);
    expect(res3.point[1]).toBeCloseTo(16, 5);
    expect(res3.tangent[0]).toBeCloseTo(0.6, 5);
    expect(res3.tangent[1]).toBeCloseTo(0.8, 5);
  });
});

describe('GeometryEngine - Compact vs Elongated Baselines', () => {
  const createMockRegion = (id: number, area: number, neighbors: number[] = []): Region => ({
    id,
    geoJsonId: `GEO-${id}`,
    names: { ru: `Регион ${id}`, en: `Region ${id}` },
    ownerCountryId: 'test-country',
    neighboringRegionIds: neighbors,
    area,
    population: 1000,
    urbanization: 0,
    stability: 100,
    infrastructure: 1,
    development: 1,
    gdp: 1000,
    deposits: {},
    extraction: {}
  });

  const createMockFeature = (id: number, coords: [number, number][]): Feature<Polygon> => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords]
    },
    properties: {
      type: 'region',
      regionId: id,
      ownerName: 'Test Country'
    }
  });

  it('should build a straight line for compact shapes', () => {
    // 4 points forming a square (compact shape)
    const squareCoords: [number, number][] = [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
      [10, 10]
    ];
    const paired = [
      {
        region: createMockRegion(1, 1.0, [2]),
        feature: createMockFeature(1, squareCoords)
      }
    ];

    const axis = computeCountryAxis([paired[0].feature], paired);
    const line = buildCountryLabelLine(paired, axis);

    // Compact shape must produce a straight line (a segment consisting of exactly 2 points)
    expect(line.length).toBe(2);
    // Length should match axis.spanLongAxisDeg
    const len = getLineLength(line);
    expect(len).toBeCloseTo(axis.spanLongAxisDeg, 5);
  });

  it('should build a curved line for elongated shapes with multiple regions', () => {
    // 4 regions arranged in a diagonal line (elongated shape)
    const r1 = createMockRegion(1, 1.0, [2]);
    const r2 = createMockRegion(2, 1.0, [1, 3]);
    const r3 = createMockRegion(3, 1.0, [2, 4]);
    const r4 = createMockRegion(4, 1.0, [3]);

    const paired = [
      { region: r1, feature: createMockFeature(1, [[10, 10], [10.2, 10], [10.2, 10.2], [10, 10.2], [10, 10]]) },
      { region: r2, feature: createMockFeature(2, [[11, 11], [11.2, 11], [11.2, 11.2], [11, 11.2], [11, 11]]) },
      { region: r3, feature: createMockFeature(3, [[12, 12], [12.2, 12], [12.2, 12.2], [12, 12.2], [12, 12]]) },
      { region: r4, feature: createMockFeature(4, [[13, 13], [13.2, 13], [13.2, 13.2], [13, 13.2], [13, 13]]) }
    ];

    const axis = computeCountryAxis(paired.map(p => p.feature), paired);
    // Aspect ratio should be large because it's highly elongated
    const aspectRatio = axis.spanLongAxisDeg / axis.spanShortAxisDeg;
    expect(aspectRatio).toBeGreaterThanOrEqual(1.4);

    const line = buildCountryLabelLine(paired, axis);
    // For elongated shape with 4 regions (>= 3), it should be a smoothed curve (more than 2 points)
    expect(line.length).toBeGreaterThan(2);
  });
});
