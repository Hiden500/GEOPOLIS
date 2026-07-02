import { centroid, bbox } from '@turf/turf';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { GameMapData } from '../GeoJsonLoader';

interface Point2D {
  x: number;
  y: number;
}

function lonToX(lon: number): number {
  return (lon + 180) / 360;
}

function latToY(lat: number): number {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2;
}

function xToLon(x: number): number {
  return x * 360 - 180;
}

function yToLat(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const CHAR_WIDTH_FACTORS: Record<string, number> = {
  'i': 0.25, 'l': 0.25, 't': 0.3, 'f': 0.35, 'r': 0.35,
  'm': 0.8, 'w': 0.8, 'M': 0.85, 'W': 0.9, 'I': 0.3,
  ' ': 0.4
};

function getCharWidthFactor(char: string): number {
  return CHAR_WIDTH_FACTORS[char] !== undefined ? CHAR_WIDTH_FACTORS[char] : 0.55;
}

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
const LABEL_LETTER_SPACING_EM = 0.08;

function getGeometryPoints(features: Feature<Polygon | MultiPolygon, any>[]): { lon: number; lat: number }[] {
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
  features: Feature<Polygon | MultiPolygon, any>[],
  paired: { region: Region; feature: Feature<Polygon | MultiPolygon, any> }[]
): LabelAxis {
  const points = getGeometryPoints(features);

  let centroidPoints = paired.map(({ region, feature }) => {
    const [lon, lat] = centroid(feature).geometry.coordinates;
    return { lon, lat, weight: region.area || 1 };
  });

  const lonsCentroid = centroidPoints.map(p => p.lon);
  if (Math.max(...lonsCentroid) - Math.min(...lonsCentroid) > 180) {
    centroidPoints = centroidPoints.map(p => ({ ...p, lon: p.lon < 0 ? p.lon + 360 : p.lon }));
  }

  const sumW = centroidPoints.reduce((s, p) => s + p.weight, 0);
  const lon0 = centroidPoints.reduce((s, p) => s + p.lon * p.weight, 0) / sumW;
  const lat0 = centroidPoints.reduce((s, p) => s + p.lat * p.weight, 0) / sumW;
  let labelLon = lon0;
  if (labelLon > 180) labelLon -= 360;

  if (points.length === 0) {
    return { lon: labelLon, lat: lat0, rotateDeg: 0, spanLongAxisDeg: 5, spanShortAxisDeg: 5 };
  }

  let normalizedPoints = points.map(p => ({ ...p }));
  const lons = normalizedPoints.map(p => p.lon);
  if (Math.max(...lons) - Math.min(...lons) > 180) {
    normalizedPoints = normalizedPoints.map(p => ({ ...p, lon: p.lon < 0 ? p.lon + 360 : p.lon }));
  }

  const n = normalizedPoints.length;
  const sumLon = normalizedPoints.reduce((s, p) => s + p.lon, 0);
  const sumLat = normalizedPoints.reduce((s, p) => s + p.lat, 0);
  const meanLon = sumLon / n;
  const meanLat = sumLat / n;

  const latRad = (meanLat * Math.PI) / 180;
  const kmPerDegLon = 111 * Math.cos(latRad);

  const xy = normalizedPoints.map(p => ({
    x: (p.lon - meanLon) * kmPerDegLon,
    y: (p.lat - meanLat) * 111,
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

  let Lu = Math.max(...projU) - Math.min(...projU);
  let Lv = Math.max(...projV) - Math.min(...projV);

  if (Lu < Lv) {
    const temp = Lu;
    Lu = Lv;
    Lv = temp;
    theta = theta + Math.PI / 2;
  }

  let rotateDeg = (-theta * 180) / Math.PI;

  while (rotateDeg < -90) rotateDeg += 180;
  while (rotateDeg > 90) rotateDeg -= 180;

  return {
    lon: labelLon,
    lat: lat0,
    rotateDeg,
    spanLongAxisDeg: Lu / 111,
    spanShortAxisDeg: Lv / 111,
  };
}

export function computeLabelSizes(
  name: string,
  spanLongAxisDeg: number,
  spanShortAxisDeg: number
): LabelSizes {
  const charCount = Math.max(1, name.length);
  
  const sizeAtZoom = (zoom: number): number => {
    const pixelLengthLimit = (spanLongAxisDeg / 360) * 512 * Math.pow(2, zoom);
    const pixelHeightLimit = (spanShortAxisDeg / 360) * 512 * Math.pow(2, zoom);
    
    const rawSizeFromLength = (0.55 * pixelLengthLimit) / (charCount * (0.55 + LABEL_LETTER_SPACING_EM));
    const maxHeightAllowed = 0.85 * pixelHeightLimit;
    
    const size = Math.min(rawSizeFromLength, maxHeightAllowed);
    return Math.min(150, Math.max(9, size));
  };
  
  return { sizeZ2: sizeAtZoom(2), sizeZ7: sizeAtZoom(7) };
}

export function computeAppearZoom(name: string, spanLongAxisDeg: number): number {
  const charCount = Math.max(1, name.length);
  const k = Math.max(1e-9, (0.55 * (spanLongAxisDeg / 360) * 512) / (charCount * (0.55 + LABEL_LETTER_SPACING_EM)));
  return Math.min(20, Math.log2(READABLE_PX / k));
}



export function buildCountryLabelLine(
  paired: { region: Region; feature: Feature<Polygon | MultiPolygon, any> }[],
  axis: LabelAxis
): [number, number][] {
  const thetaRad = (-axis.rotateDeg * Math.PI) / 180;
  const ratio = axis.spanLongAxisDeg / Math.max(1e-5, axis.spanShortAxisDeg);
  
  if (paired.length < 3 || ratio < 1.4) {
    const halfLen = axis.spanLongAxisDeg * 0.5; // Линия длиной ровно в spanLongAxisDeg
    const latRad = (axis.lat * Math.PI) / 180;
    const cosFactor = Math.cos(latRad);
    
    const dx = (halfLen * Math.cos(thetaRad)) / Math.max(0.1, cosFactor);
    const dy = halfLen * Math.sin(thetaRad);
    
    return [
      [axis.lon - dx, axis.lat - dy],
      [axis.lon + dx, axis.lat + dy]
    ];
  }

  const centroids = paired.map(({ feature }) => {
    const [lon, lat] = centroid(feature).geometry.coordinates;
    const proj = lon * Math.cos(thetaRad) + lat * Math.sin(thetaRad);
    return { lon, lat, proj };
  });

  centroids.sort((a, b) => a.proj - b.proj);

  const K = Math.min(10, centroids.length);
  const pts: { lon: number; lat: number }[] = [];
  for (let k = 0; k < K; k++) {
    const startIdx = Math.floor((k * centroids.length) / K);
    const endIdx = Math.floor(((k + 1) * centroids.length) / K);
    const bucket = centroids.slice(startIdx, endIdx);
    if (bucket.length > 0) {
      const avgLon = bucket.reduce((sum, p) => sum + p.lon, 0) / bucket.length;
      const avgLat = bucket.reduce((sum, p) => sum + p.lat, 0) / bucket.length;
      pts.push({ lon: avgLon, lat: avgLat });
    }
  }

  let smoothed = pts;
  for (let pass = 0; pass < 2; pass++) {
    const nextPts: { lon: number; lat: number }[] = [];
    for (let i = 0; i < smoothed.length; i++) {
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(smoothed.length - 1, i + 1);
      const windowPts = smoothed.slice(startIdx, endIdx + 1);
      
      const avgLon = windowPts.reduce((sum, p) => sum + p.lon, 0) / windowPts.length;
      const avgLat = windowPts.reduce((sum, p) => sum + p.lat, 0) / windowPts.length;
      nextPts.push({ lon: avgLon, lat: avgLat });
    }
    smoothed = nextPts;
  }

  return smoothed.map(p => [p.lon, p.lat]);
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
  featureCollection: FeatureCollection<Polygon | MultiPolygon, any>,
  regions: Region[]
): FeatureCollection<Point, CountryLabelProps> {
  const featureByRegionId = new Map<number, Feature<Polygon | MultiPolygon, any>>();
  for (const feature of featureCollection.features) {
    const props = feature.properties;
    if (props.type === 'region' && props.regionId != null) {
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
      .filter((p): p is { region: Region; feature: Feature<Polygon | MultiPolygon, any> } => p.feature != null);
    if (paired.length === 0) continue;

    const mainlandFeatures = paired.map(p => p.feature);
    const axis = computeCountryAxis(mainlandFeatures, paired);

    const name = mainlandFeatures[0].properties.ownerName || '';
    if (!name) continue;

    const totalArea = mainland.reduce((sum, r) => sum + (r.area || 0), 0);
    const effectiveSpanLongAxis = axis.spanLongAxisDeg;

    const { sizeZ2, sizeZ7 } = computeLabelSizes(name, effectiveSpanLongAxis, axis.spanShortAxisDeg);
    const appearZoom = computeAppearZoom(name, effectiveSpanLongAxis);

    const lineCoords = buildCountryLabelLine(paired, axis);
    if (lineCoords.length < 2) {
      // Fallback
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [axis.lon, axis.lat] },
        properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea, appearZoom, rotateDeg: axis.rotateDeg }
      });
      continue;
    }

    // Преобразуем географические координаты в плоские Web Mercator Point2D[]
    const path: Point2D[] = lineCoords.map(([lon, lat]) => ({
      x: lonToX(lon),
      y: latToY(lat)
    }));

    // Убеждаемся, что базовая линия течет строго слева направо
    if (path[path.length - 1].x < path[0].x) {
      path.reverse();
    }

    // Вычисляем длины сегментов и кумулятивные длины в Web Mercator
    const cumulativeLengths: number[] = [0];
    let L_base = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      L_base += dist;
      cumulativeLengths.push(L_base);
    }

    if (L_base <= 0) {
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [axis.lon, axis.lat] },
        properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea, appearZoom, rotateDeg: axis.rotateDeg }
      });
      continue;
    }

    // Переводим пиксельные размеры в плоские Mercator на zoom 2
    // Ширина мира на zoom 2 = 2048 px
    const px_to_mercator = 1.0 / 2048.0;
    const sizeZ2_mercator = sizeZ2 * px_to_mercator;

    const charCount = name.length;
    const charWidths: number[] = [];
    let text_width_mercator = 0;
    for (let i = 0; i < charCount; i++) {
      const factor = getCharWidthFactor(name[i]);
      const w = sizeZ2_mercator * factor;
      charWidths.push(w);
      text_width_mercator += w;
    }
    const spacing_mercator = sizeZ2_mercator * LABEL_LETTER_SPACING_EM;
    text_width_mercator += (charCount - 1) * spacing_mercator;

    // Целевая ширина растягивания
    let W_target = L_base * 0.8;
    if (W_target < text_width_mercator) {
      W_target = text_width_mercator;
    }
    if (W_target > L_base * 0.95) {
      W_target = Math.max(text_width_mercator, L_base * 0.95);
    }

    const start_dist = (L_base - W_target) / 2;
    const gap = charCount > 1 ? (W_target - text_width_mercator) / (charCount - 1) + spacing_mercator : 0;

    let current_dist = start_dist;
    for (let i = 0; i < charCount; i++) {
      const char = name[i];
      const w = charWidths[i];
      const d_i = current_dist + w / 2;
      current_dist += w + gap;

      // Интерполяция и экстраполяция по касательным
      let pt: Point2D;
      let tangent: Point2D;

      const n = path.length;
      if (d_i < 0) {
        // Экстраполируем назад от начала линии
        const pt0 = path[0];
        const pt1 = path[1];
        const dx = pt1.x - pt0.x;
        const dy = pt1.y - pt0.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = len > 0 ? dx / len : 1;
        const uy = len > 0 ? dy / len : 0;

        pt = { x: pt0.x + d_i * ux, y: pt0.y + d_i * uy };
        tangent = { x: ux, y: uy };
      } else if (d_i > L_base) {
        // Экстраполируем вперед от конца линии
        const ptn2 = path[n - 2];
        const ptn1 = path[n - 1];
        const dx = ptn1.x - ptn2.x;
        const dy = ptn1.y - ptn2.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = len > 0 ? dx / len : 1;
        const uy = len > 0 ? dy / len : 0;

        pt = { x: ptn1.x + (d_i - L_base) * ux, y: ptn1.y + (d_i - L_base) * uy };
        tangent = { x: ux, y: uy };
      } else {
        // Обычная линейная интерполяция внутри линии
        let idx = 0;
        for (let j = 0; j < n - 1; j++) {
          if (cumulativeLengths[j] <= d_i && d_i <= cumulativeLengths[j + 1]) {
            idx = j;
            break;
          }
        }
        const pt0 = path[idx];
        const pt1 = path[idx + 1];
        const segLen = cumulativeLengths[idx + 1] - cumulativeLengths[idx];
        const t = segLen > 0 ? (d_i - cumulativeLengths[idx]) / segLen : 0;

        const dx = pt1.x - pt0.x;
        const dy = pt1.y - pt0.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = len > 0 ? dx / len : 1;
        const uy = len > 0 ? dy / len : 0;

        pt = { x: pt0.x + t * dx, y: pt0.y + t * dy };
        tangent = { x: ux, y: uy };
      }

      // Переводим точку Web Mercator обратно в градусы
      const lon = xToLon(pt.x);
      const lat = yToLat(pt.y);

      // Угол поворота буквы (в градусах по часовой стрелке)
      const rotateDeg = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;

      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
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
  const featuresByRegionId = new Map<number, Feature<Polygon | MultiPolygon, any>[]>();
  
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

    const name = mainFeature.properties.name || `Region ${regionId}`;
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

