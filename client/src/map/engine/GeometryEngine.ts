import { centroid, bbox } from '@turf/turf';
import type { Feature, FeatureCollection, GeoJsonProperties, Point, Polygon, MultiPolygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { GameMapData } from '../GeoJsonLoader';

export interface LabelAxis {
  lon: number;
  lat: number;
  rotateDeg: number;
  spanLongAxisDeg: number;
  spanShortAxisDeg: number;
}

export interface LabelSizes {
  sizeZ2: number;
  sizeZ7: number;
}

export interface CountryLabelProps {
  name: string;
  sizeZ2: number;
  sizeZ7: number;
  sortKey: number;
  appearZoom: number;
  rotateDeg: number;
}

const READABLE_PX = 11;

function extent(values: number[]): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

export function lonLatToMercator(lon: number, lat: number): [number, number] {
  const clampedLat = Math.max(-85.051128, Math.min(85.051128, lat));
  const x = 512 * (lon + 180) / 360;
  const latRad = (clampedLat * Math.PI) / 180;
  const y = 256 - (256 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return [x, y];
}

export function mercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / 512) * 360 - 180;
  const expVal = Math.exp(((256 - y) * Math.PI) / 256);
  const lat = (2 * Math.atan(expVal) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}

export function getCharacterWidth(char: string): number {
  if (['I', 'l', '1', ' ', '!', '.'].includes(char)) return 0.22;
  if (['E', 'F', 'J', 'L', 't'].includes(char)) return 0.45;
  if (['W', 'M'].includes(char)) return 0.85;
  if (/^[A-Z]$/.test(char)) return 0.55;
  return 0.55;
}

export function getLineLength(line: [number, number][]): number {
  let len = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dy = line[i + 1][1] - line[i][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

interface PointAlongLineResult {
  point: [number, number];
  tangent: [number, number];
}

export function getPointAlongLine(
  line: [number, number][],
  d: number
): PointAlongLineResult {
  if (line.length === 0) {
    return { point: [0, 0], tangent: [1, 0] };
  }
  if (line.length === 1) {
    return { point: line[0], tangent: [1, 0] };
  }

  const m = line.length - 1;
  const segments: number[] = [];
  const dists: number[] = [0];
  let L_base = 0;

  for (let i = 0; i < m; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dy = line[i + 1][1] - line[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segments.push(len);
    L_base += len;
    dists.push(L_base);
  }

  // 1. Экстраполяция до начала
  if (d < 0) {
    const p0 = line[0];
    const p1 = line[1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = segments[0] || 1e-9;
    const ux = dx / len;
    const uy = dy / len;
    return {
      point: [p0[0] + d * ux, p0[1] + d * uy],
      tangent: [ux, uy]
    };
  }

  // 2. Экстраполяция после конца
  if (d > L_base) {
    const pm1 = line[m - 1];
    const pm = line[m];
    const dx = pm[0] - pm1[0];
    const dy = pm[1] - pm1[1];
    const len = segments[m - 1] || 1e-9;
    const ux = dx / len;
    const uy = dy / len;
    return {
      point: [pm[0] + (d - L_base) * ux, pm[1] + (d - L_base) * uy],
      tangent: [ux, uy]
    };
  }

  // 3. Точка внутри линии
  for (let i = 0; i < m; i++) {
    if (d >= dists[i] && d <= dists[i + 1]) {
      const segLen = segments[i];
      if (segLen <= 1e-9) {
        return { point: line[i], tangent: [1, 0] };
      }
      const t = (d - dists[i]) / segLen;
      const pStart = line[i];
      const pEnd = line[i + 1];
      const dx = pEnd[0] - pStart[0];
      const dy = pEnd[1] - pStart[1];
      const ux = dx / segLen;
      const uy = dy / segLen;
      return {
        point: [pStart[0] + t * dx, pStart[1] + t * dy],
        tangent: [ux, uy]
      };
    }
  }

  return { point: line[m], tangent: [1, 0] };
}

function getGeometryPoints(features: Feature<Polygon | MultiPolygon, GeoJsonProperties>[]): { lon: number; lat: number }[] {
  const points: { lon: number; lat: number }[] = [];
  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0];
      if (ring) {
        for (const coords of ring) {
          points.push({ lon: coords[0], lat: coords[1] });
        }
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        const ring = poly[0];
        if (ring) {
          for (const coords of ring) {
            points.push({ lon: coords[0], lat: coords[1] });
          }
        }
      }
    }
  }
  return points;
}

/**
 * Вычисляет оптимальную ось надписи страны с помощью метода главных компонент (PCA).
 * Определяет наклон, длину и ширину территории.
 */
export function computeCountryAxis(
  features: Feature<Polygon | MultiPolygon, GeoJsonProperties>[],
  paired: { region: Region; feature: Feature<Polygon | MultiPolygon, GeoJsonProperties> }[]
): LabelAxis {
  const points = getGeometryPoints(features);

  let centroidPoints = paired.map(({ region, feature }) => {
    const [lon, lat] = centroid(feature).geometry.coordinates;
    const [x, y] = lonLatToMercator(lon, lat);
    return { x, y, weight: region.area || 1 };
  });

  const xsCentroid = centroidPoints.map(p => p.x);
  const [minCentroidX, maxCentroidX] = extent(xsCentroid);
  if (xsCentroid.length > 0 && maxCentroidX - minCentroidX > 256) {
    centroidPoints = centroidPoints.map(p => ({ ...p, x: p.x < 256 ? p.x + 512 : p.x }));
  }

  const sumW = centroidPoints.reduce((s, p) => s + p.weight, 0);
  const meanX = sumW > 0 ? centroidPoints.reduce((s, p) => s + p.x * p.weight, 0) / sumW : 256;
  const meanY = sumW > 0 ? centroidPoints.reduce((s, p) => s + p.y * p.weight, 0) / sumW : 256;

  let labelX = meanX;
  if (labelX >= 512) labelX -= 512;
  const [labelLon, labelLat] = mercatorToLonLat(labelX, meanY);

  if (points.length === 0) {
    return { lon: labelLon, lat: labelLat, rotateDeg: 0, spanLongAxisDeg: 5, spanShortAxisDeg: 5 };
  }

  let normalizedPoints = points.map(p => {
    const [x, y] = lonLatToMercator(p.lon, p.lat);
    return { x, y };
  });

  const xs = normalizedPoints.map(p => p.x);
  const [minX, maxX] = extent(xs);
  if (maxX - minX > 256) {
    normalizedPoints = normalizedPoints.map(p => ({ ...p, x: p.x < 256 ? p.x + 512 : p.x }));
  }

  const n = normalizedPoints.length;
  const sumX = normalizedPoints.reduce((s, p) => s + p.x, 0);
  const sumY = normalizedPoints.reduce((s, p) => s + p.y, 0);
  const mX = sumX / n;
  const mY = sumY / n;

  const xy = normalizedPoints.map(p => ({
    x: p.x - mX,
    y: p.y - mY,
  }));

  let Sxx = 0, Syy = 0, Sxy = 0;
  for (const p of xy) {
    Sxx += p.x * p.x;
    Syy += p.y * p.y;
    Sxy += p.x * p.y;
  }
  Sxx /= n;
  Syy /= n;
  Sxy /= n;

  let theta = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy);

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const projU = xy.map(p => p.x * cosT + p.y * sinT);
  const projV = xy.map(p => -p.x * sinT + p.y * cosT);

  const [minU, maxU] = extent(projU);
  const [minV, maxV] = extent(projV);
  let Lu = maxU - minU;
  let Lv = maxV - minV;

  if (Lu < Lv) {
    const temp = Lu;
    Lu = Lv;
    Lv = temp;
    theta = theta + Math.PI / 2;
  }

  let rotateDeg = (theta * 180) / Math.PI;

  while (rotateDeg < -90) rotateDeg += 180;
  while (rotateDeg > 90) rotateDeg -= 180;

  return {
    lon: labelLon,
    lat: labelLat,
    rotateDeg,
    spanLongAxisDeg: Lu,
    spanShortAxisDeg: Lv,
  };
}

export function computeLabelSizes(
  name: string,
  spanLongAxisDeg: number,
  spanShortAxisDeg: number
): LabelSizes {
  const charCount = Math.max(1, name.length);
  const textWidthEm = name.split('').reduce((sum: number, c: string) => sum + getCharacterWidth(c), 0);
  
  const sizeAtZoom = (zoom: number): number => {
    const pixelLengthLimit = spanLongAxisDeg * Math.pow(2, zoom);
    const pixelHeightLimit = spanShortAxisDeg * Math.pow(2, zoom);
    
    const minSpacingEm = 0.08;
    const rawSizeFromLength = (0.8 * pixelLengthLimit) / (textWidthEm + (charCount - 1) * minSpacingEm);
    const maxHeightAllowed = 0.85 * pixelHeightLimit;
    
    const size = Math.min(rawSizeFromLength, maxHeightAllowed);
    return Math.min(150, Math.max(9, size));
  };
  
  return { sizeZ2: sizeAtZoom(2), sizeZ7: sizeAtZoom(7) };
}

export function computeAppearZoom(name: string, spanLongAxisDeg: number): number {
  const charCount = Math.max(1, name.length);
  const textWidthEm = name.split('').reduce((sum: number, c: string) => sum + getCharacterWidth(c), 0);
  const minSpacingEm = 0.08;
  const k = Math.max(1e-9, (0.8 * spanLongAxisDeg) / (textWidthEm + (charCount - 1) * minSpacingEm));
  return Math.min(20, Math.log2(READABLE_PX / k));
}

export function buildCountryLabelLine(
  paired: { region: Region; feature: Feature<Polygon | MultiPolygon, GeoJsonProperties> }[],
  axis: LabelAxis
): [number, number][] {
  const thetaRad = (axis.rotateDeg * Math.PI) / 180;
  const aspectRatio = axis.spanLongAxisDeg / Math.max(0.1, axis.spanShortAxisDeg);

  if (aspectRatio < 1.4 || paired.length < 3) {
    const halfLen = axis.spanLongAxisDeg * 0.5;
    const [cx, cy] = lonLatToMercator(axis.lon, axis.lat);
    const dx = halfLen * Math.cos(thetaRad);
    const dy = halfLen * Math.sin(thetaRad);
    const line: [number, number][] = [
      [cx - dx, cy - dy],
      [cx + dx, cy + dy]
    ];
    const dxFlow = line[line.length - 1][0] - line[0][0];
    const dyFlow = line[line.length - 1][1] - line[0][1];
    const shouldReverse = Math.abs(dxFlow) >= Math.abs(dyFlow) ? dxFlow < 0 : dyFlow > 0;
    if (shouldReverse) {
      line.reverse();
    }
    return line;
  }

  const centroids = paired.map(({ feature }) => {
    const [lon, lat] = centroid(feature).geometry.coordinates;
    const [x, y] = lonLatToMercator(lon, lat);
    const proj = x * Math.cos(thetaRad) + y * Math.sin(thetaRad);
    return { x, y, proj };
  });

  centroids.sort((a, b) => a.proj - b.proj);

  const K = Math.min(10, centroids.length);
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k < K; k++) {
    const startIdx = Math.floor((k * centroids.length) / K);
    const endIdx = Math.floor(((k + 1) * centroids.length) / K);
    const bucket = centroids.slice(startIdx, endIdx);
    if (bucket.length > 0) {
      const avgX = bucket.reduce((sum, p) => sum + p.x, 0) / bucket.length;
      const avgY = bucket.reduce((sum, p) => sum + p.y, 0) / bucket.length;
      pts.push({ x: avgX, y: avgY });
    }
  }

  let smoothed = pts;
  for (let pass = 0; pass < 2; pass++) {
    const nextPts: { x: number; y: number }[] = [];
    for (let i = 0; i < smoothed.length; i++) {
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(smoothed.length - 1, i + 1);
      const windowPts = smoothed.slice(startIdx, endIdx + 1);
      
      const avgX = windowPts.reduce((sum, p) => sum + p.x, 0) / windowPts.length;
      const avgY = windowPts.reduce((sum, p) => sum + p.y, 0) / windowPts.length;
      nextPts.push({ x: avgX, y: avgY });
    }
    smoothed = nextPts;
  }

  const line = smoothed.map(p => [p.x, p.y] as [number, number]);
  if (line.length >= 2) {
    const dxFlow = line[line.length - 1][0] - line[0][0];
    const dyFlow = line[line.length - 1][1] - line[0][1];
    const shouldReverse = Math.abs(dxFlow) >= Math.abs(dyFlow) ? dxFlow < 0 : dyFlow > 0;
    if (shouldReverse) {
      line.reverse();
    }
  }
  return line;
}

/**
 * Находит крупнейшие компоненты связности регионов одной страны.
 */
export function largestMainlandCluster(ownedRegions: Region[]): Region[] {
  const ownedIds = new Set(ownedRegions.map(r => r.id));
  const byId = new Map(ownedRegions.map(r => [r.id, r]));
  const visited = new Set<number>();
  let best: Region[] = [];
  let bestArea = -1;

  for (const start of ownedRegions) {
    if (visited.has(start.id)) continue;
    const queue = [start.id];
    visited.add(start.id);
    const component: Region[] = [];
    while (queue.length > 0) {
      const id = queue.pop()!;
      const region = byId.get(id);
      if (!region) continue;
      component.push(region);
      for (const neighborId of region.neighboringRegionIds) {
        if (ownedIds.has(neighborId) && !visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    const componentArea = component.reduce((sum, r) => sum + (r.area || 0), 0);
    const better = component.length > best.length
      || (component.length === best.length && componentArea > bestArea);
    if (better) {
      bestArea = componentArea;
      best = component;
    }
  }
  return best;
}

/**
 * Генерирует надписи стран в виде FeatureCollection.
 */
export function buildCountryLabels(
  featureCollection: FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>,
  regions: Region[]
): FeatureCollection<Point, CountryLabelProps> {
  const featureByRegionId = new Map<number, Feature<Polygon | MultiPolygon, GeoJsonProperties>>();
  for (const feature of featureCollection.features) {
    // properties у GeoJSON-фичи по спецификации может быть null. Раньше это
    // скрывал `any`: фича без свойств роняла бы обход на ровном месте.
    const props = feature.properties;
    if (props && props.type === 'region' && props.regionId != null) {
      featureByRegionId.set(props.regionId, feature);
    }
  }

  const regionsByCountry = new Map<string, Region[]>();
  for (const region of regions) {
    const list = regionsByCountry.get(region.ownerCountryId);
    if (list) list.push(region); else regionsByCountry.set(region.ownerCountryId, [region]);
  }

  const labelFeatures: Feature<Point, CountryLabelProps>[] = [];
  for (const ownedRegions of regionsByCountry.values()) {
    const mainland = largestMainlandCluster(ownedRegions);
    if (mainland.length === 0) continue;

    const paired = mainland
      .map(region => ({ region, feature: featureByRegionId.get(region.id) }))
      .filter((p): p is { region: Region; feature: Feature<Polygon | MultiPolygon, GeoJsonProperties> } => p.feature != null);
    if (paired.length === 0) continue;

    const mainlandFeatures = paired.map(p => p.feature);
    const axis = computeCountryAxis(mainlandFeatures, paired);

    const name = mainlandFeatures[0]?.properties?.ownerName || '';
    if (!name) continue;

    const totalArea = mainland.reduce((sum, r) => sum + (r.area || 0), 0);
    const effectiveSpanLongAxis = axis.spanLongAxisDeg;

    const { sizeZ2, sizeZ7 } = computeLabelSizes(name, effectiveSpanLongAxis, axis.spanShortAxisDeg);
    const appearZoom = computeAppearZoom(name, effectiveSpanLongAxis);

    const lineCoords = buildCountryLabelLine(paired, axis);
    if (lineCoords.length < 2) {
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [axis.lon, axis.lat] },
        properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea, appearZoom, rotateDeg: axis.rotateDeg }
      });
      continue;
    }

    const L_base = getLineLength(lineCoords);
    if (L_base <= 0) {
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [axis.lon, axis.lat] },
        properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea, appearZoom, rotateDeg: axis.rotateDeg }
      });
      continue;
    }

    const charCount = name.length;
    const fontSize = sizeZ2 / 4;
    const textWidthEm = name.split('').reduce((sum: number, c: string) => sum + getCharacterWidth(c), 0);
    const W_target = L_base * 0.8;

    const letterSpacing = charCount > 1 ? (W_target / fontSize - textWidthEm) / (charCount - 1) : 0.08;
    const clampedSpacing = Math.max(0.08, Math.min(0.60, letterSpacing));
    const W_word = (textWidthEm + (charCount - 1) * clampedSpacing) * fontSize;
    const start_d = (L_base - W_word + getCharacterWidth(name[0]) * fontSize) / 2;

    const globalAngle = Math.atan2(
      lineCoords[lineCoords.length - 1][1] - lineCoords[0][1],
      lineCoords[lineCoords.length - 1][0] - lineCoords[0][0]
    ) * 180 / Math.PI;

    let currentOffset = 0;
    for (let i = 0; i < charCount; i++) {
      const char = name[i];
      const w_i = getCharacterWidth(char);
      if (i > 0) {
        const w_prev = getCharacterWidth(name[i - 1]);
        currentOffset += (w_prev / 2 + w_i / 2 + clampedSpacing) * fontSize;
      }
      const d_i = start_d + currentOffset;

      const { point, tangent } = getPointAlongLine(lineCoords, d_i);
      const [rawLon, lat] = mercatorToLonLat(point[0], point[1]);
      let lon = rawLon;
      while (lon < -180) lon += 360;
      while (lon > 180) lon -= 360;

      const rotateRad = Math.atan2(tangent[1], tangent[0]);
      let rotateDeg = rotateRad * 180 / Math.PI;
      while (rotateDeg - globalAngle > 90) rotateDeg -= 180;
      while (rotateDeg - globalAngle < -90) rotateDeg += 180;

      labelFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties: {
          name: char,
          sizeZ2,
          sizeZ7,
          sortKey: -totalArea,
          appearZoom,
          rotateDeg
        }
      });
    }
  }

  return { type: 'FeatureCollection', features: labelFeatures };
}

export function buildRegionLabels(mapData: GameMapData): FeatureCollection<Point, { name: string; regionId: number }> {
  const featuresByRegionId = new Map<number, Feature<Polygon | MultiPolygon, GeoJsonProperties>[]>();
  
  for (const feature of mapData.featureCollection.features) {
    const props = feature.properties;
    if (props.type === 'region' && props.regionId != null) {
      const list = featuresByRegionId.get(props.regionId) || [];
      list.push(feature);
      featuresByRegionId.set(props.regionId, list);
    }
  }

  const labelFeatures: Feature<Point, { name: string; regionId: number }>[] = [];
  for (const [regionId, features] of featuresByRegionId.entries()) {
    if (features.length === 0) continue;
    
    let mainFeature = features[0];
    let maxArea = -1;
    for (const f of features) {
      const b = bbox(f);
      const areaEstimate = (b[2] - b[0]) * (b[3] - b[1]);
      if (areaEstimate > maxArea) {
        maxArea = areaEstimate;
        mainFeature = f;
      }
    }

    const name = mainFeature.properties?.name || `Region ${regionId}`;
    const ctr = centroid(mainFeature);

    labelFeatures.push({
      type: 'Feature',
      geometry: ctr.geometry as Point,
      properties: {
        name,
        regionId
      }
    });
  }

  return { type: 'FeatureCollection', features: labelFeatures };
}

