import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { centroid, bbox, union } from '@turf/turf';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { Country } from '@shared/types/Country';
import type { MapFeature } from '@shared/types/map/MapFeature';
import { loadGameMapData, updateMapData, type GameMapData, type MapRegionProperties } from './GeoJsonLoader';

type RegionFeature = Feature<Polygon | MultiPolygon, MapRegionProperties>;
interface CountryLabelProps { name: string; sizeZ2: number; sizeZ7: number; sortKey: number; appearZoom: number; rotateDeg: number }

// Зум, на котором (несглаженный) размер подписи пересекает порог
// читаемости — ниже appearZoom страна не показывается совсем (см.
// computeAppearZoom/text-opacity), это и заменяет коллизионный declutter.
const READABLE_PX = 11;
// Ширина перехода (в уровнях зума) от невидимого к полностью видимому —
// см. сэмплинг text-opacity ниже.
const APPEAR_TRANSITION = 0.6;

// Фиксированная зум-сетка для сэмплинга data-driven text-opacity (шаг 0.5,
// сопоставим с шириной перехода APPEAR_TRANSITION — даёт точную аппроксимацию
const APPEAR_ZOOM_STOPS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];

function appearOpacityExpr(stopZoom: number): ExpressionSpecification {
  return ['max', 0, ['min', 1, ['/', ['-', stopZoom, ['get', 'appearZoom']], APPEAR_TRANSITION]]];
}

const LABEL_LETTER_SPACING_EM = 0.08;

function getGeometryPoints(features: RegionFeature[]): { lon: number; lat: number }[] {
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

function computeLabelSizes(
  name: string,
  spanLongAxisDeg: number,
  spanShortAxisDeg: number
): { sizeZ2: number; sizeZ7: number } {
  const charCount = Math.max(1, name.length);
  
  const sizeAtZoom = (zoom: number): number => {
    // Желаемая длина надписи на экране (75% от длинной оси страны)
    const pixelLengthLimit = (spanLongAxisDeg / 360) * 512 * Math.pow(2, zoom);
    // Максимально допустимая высота (кегль) шрифта (50% от ширины короткой оси страны)
    const pixelHeightLimit = (spanShortAxisDeg / 360) * 512 * Math.pow(2, zoom);
    
    const rawSizeFromLength = (0.75 * pixelLengthLimit) / (charCount * (0.55 + LABEL_LETTER_SPACING_EM));
    const maxHeightAllowed = 0.5 * pixelHeightLimit;
    
    const size = Math.min(rawSizeFromLength, maxHeightAllowed);
    return Math.min(150, Math.max(9, size));
  };
  
  return { sizeZ2: sizeAtZoom(2), sizeZ7: sizeAtZoom(7) };
}

function computeAppearZoom(name: string, spanLongAxisDeg: number): number {
  const charCount = Math.max(1, name.length);
  const k = Math.max(1e-9, (0.75 * (spanLongAxisDeg / 360) * 512) / (charCount * (0.55 + LABEL_LETTER_SPACING_EM)));
  return Math.min(20, Math.log2(READABLE_PX / k));
}

function largestMainlandCluster(ownedRegions: Region[]): Region[] {
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

function computeCountryAxis(
  points: { lon: number; lat: number }[],
  paired: { region: Region; feature: RegionFeature }[]
): { lon: number; lat: number; rotateDeg: number; spanLongAxisDeg: number; spanShortAxisDeg: number } {
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

  if (Lu / Math.max(1e-3, Lv) < 1.25) {
    rotateDeg = 0;
  }

  return {
    lon: labelLon,
    lat: lat0,
    rotateDeg,
    spanLongAxisDeg: Lu / 111,
    spanShortAxisDeg: Lv / 111,
  };
}

/**
 * Подписи стран в стиле EU5 — точка-якорь + поворот вдоль главной оси
 * формы (см. computeCountryAxis), кегль растёт геометрически с зумом (см.
 * computeLabelSizes). Видимость — порог читаемости (`appearZoom`, см.
 * computeAppearZoom) вместо коллизионного declutter: крупные державы видны
 * с малого зума, мелкие проявляются по мере приближения, ничего не
 * "выбрасывается" из-за overlap (слой использует text-allow-overlap:true).
 * sortKey по площади задаёт только порядок отрисовки (крупные сверху).
 */
function buildCountryLabels(mapData: GameMapData, regions: Region[]): FeatureCollection<Point, CountryLabelProps> {
  const featureByRegionId = new Map<number, RegionFeature>();
  for (const feature of mapData.featureCollection.features) {
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
      .filter((p): p is { region: Region; feature: RegionFeature } => p.feature != null);
    if (paired.length === 0) continue;

    const mainlandFeatures = paired.map(p => p.feature);
    const points = getGeometryPoints(mainlandFeatures);
    const axis = computeCountryAxis(points, paired);

    const name = mainlandFeatures[0].properties.ownerName;
    const totalArea = mainland.reduce((sum, r) => sum + (r.area || 0), 0);
    
    const { sizeZ2, sizeZ7 } = computeLabelSizes(name, axis.spanLongAxisDeg, axis.spanShortAxisDeg);
    const appearZoom = computeAppearZoom(name, axis.spanLongAxisDeg);

    labelFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [axis.lon, axis.lat] },
      properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea, appearZoom, rotateDeg: axis.rotateDeg }
    });
  }

  return { type: 'FeatureCollection', features: labelFeatures };
}

function buildGraticule(): FeatureCollection {
  const features: any[] = [];
  // Линии долготы (меридианы) с шагом 15 градусов
  for (let lon = -180; lon <= 180; lon += 15) {
    const coordinates: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 5) {
      coordinates.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { type: 'meridian', value: lon }
    });
  }
  // Линии широты (параллели) с шагом 15 градусов
  for (let lat = -75; lat <= 75; lat += 15) {
    const coordinates: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) {
      coordinates.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { type: 'parallel', value: lat }
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildRegionLabels(mapData: GameMapData): FeatureCollection<Point, { name: string; regionId: number }> {
  const featuresByRegionId = new Map<number, RegionFeature[]>();
  
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

function buildCountryOutlines(mapData: GameMapData): FeatureCollection<Polygon | MultiPolygon> {
  const featuresByCountry = new Map<string, any[]>();
  
  for (const feature of mapData.featureCollection.features) {
    const props = feature.properties;
    if (props.type === 'region' && props.ownerCountryId) {
      const list = featuresByCountry.get(props.ownerCountryId) || [];
      list.push(feature);
      featuresByCountry.set(props.ownerCountryId, list);
    }
  }

  const countryFeatures: any[] = [];
  for (const [countryId, features] of featuresByCountry.entries()) {
    if (features.length === 0) continue;
    try {
      let united: any = null;
      if (features.length === 1) {
        united = features[0];
      } else {
        // Turf union в v7 принимает FeatureCollection
        united = union({
          type: 'FeatureCollection',
          features: features
        });
      }
      if (united) {
        countryFeatures.push({
          type: 'Feature',
          geometry: united.geometry,
          properties: {
            ownerCountryId: countryId,
            ownerColor: features[0].properties.ownerColor,
            ownerName: features[0].properties.ownerName
          }
        });
      }
    } catch (e) {
      console.warn(`Failed to union regions for country ${countryId}:`, e);
      // Фолбек в случае ошибки геометрии
      features.forEach(f => {
        countryFeatures.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            ownerCountryId: countryId,
            ownerColor: f.properties.ownerColor,
            ownerName: f.properties.ownerName
          }
        });
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features: countryFeatures
  };
}

interface MapViewProps {
  regions: Region[];
  countries: Country[];
  mapFeatures: MapFeature[];
  onRegionClick?: (regionId: number) => void;
  selectedRegionId?: number | null;
  onPopupStateChange?: (isOpen: boolean) => void;
  closePopupTrigger?: number;
}

export function MapView({
  regions,
  countries,
  mapFeatures,
  onRegionClick,
  selectedRegionId,
  onPopupStateChange,
  closePopupTrigger
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapData, setMapData] = useState<GameMapData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(2);
  const hoveredRef = useRef<string | number | null | undefined>(null);
  const countryMapRef = useRef<Map<string, Country>>(new Map());
  const regionsRef = useRef<Region[]>(regions);

  console.log('MapView render - regions:', regions.length, 'countries:', countries.length);

  useEffect(() => { regionsRef.current = regions; }, [regions]);

  useEffect(() => {
    const m = new Map<string, Country>();
    countries.forEach(c => m.set(c.id, c));
    countryMapRef.current = m;
  }, [countries]);

  // Инициализация карты — чистая география без подложки
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {},
        layers: [],
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        'font-faces': {
          'EB Garamond': [
            {
              url: '/fonts/EBGaramond-Bold.ttf'
            }
          ]
        }
      } as any,
      center: [37.6173, 55.7558],
      zoom: 2,
      maxZoom: 8,
      minZoom: 2,
      attributionControl: false
    });

    m.on('load', () => {
      // Фон — тёмно-синий (подложка под океаны)
      m.addLayer({
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#0a1628'
        }
      });

      setLoaded(true);
    });

    m.addControl(new maplibregl.NavigationControl(), 'top-right');

    m.on('zoom', () => {
      setCurrentZoom(m.getZoom());
    });

    mapRef.current = m;

    return () => {
      m.remove();
      mapRef.current = null;
    };
  }, []);

  // Закрытие попапа по триггеру извне
  useEffect(() => {
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
      if (onPopupStateChange) onPopupStateChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePopupTrigger]);

  function setupInteractions(m: maplibregl.Map) {
    m.on('mousemove', 'regions-fill', (e) => {
      if (!m || !e.features?.length) return;
      m.getCanvas().style.cursor = 'pointer';
      const feature = e.features[0];
      if (feature.properties?.type === 'ocean') return;
      const featureId = feature.id != null ? feature.id : undefined;

      if (hoveredRef.current != null && hoveredRef.current !== featureId) {
        try { m.setFeatureState({ source: 'regions', id: hoveredRef.current }, { hover: false }); } catch {} // eslint-disable-line no-empty
      }

      if (featureId != null) {
        try { m.setFeatureState({ source: 'regions', id: featureId }, { hover: true }); } catch {} // eslint-disable-line no-empty
      }
      hoveredRef.current = featureId;
    });

    m.on('mouseleave', 'regions-fill', () => {
      if (!m) return;
      m.getCanvas().style.cursor = '';
      if (hoveredRef.current != null) {
        try { m.setFeatureState({ source: 'regions', id: hoveredRef.current }, { hover: false }); } catch {} // eslint-disable-line no-empty
      }
      hoveredRef.current = null;
    });

    m.on('click', 'regions-fill', (e) => {
      if (!m || !e.features?.length) return;

      const feature = e.features[0];
      const props = feature.properties as Record<string, unknown> | null;
      if (!props || props.type === 'ocean') return;

      const ownerColor = (props.ownerColor as string) || '#808080';
      const ownerName = (props.ownerName as string) || 'Neutral';
      const name = (props.name as string) || 'Unknown';

      if (popupRef.current) popupRef.current.remove();

      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="region-popup">
            <h3 style="border-left:4px solid ${ownerColor};padding-left:8px;font-size:1rem;margin-bottom:0.5rem;color:#f1f5f9">
              ${name}
            </h3>
            <div style="font-size:0.8rem;color:${ownerColor};">${ownerName}</div>
          </div>`)
        .addTo(m);

      popup.on('close', () => {
        popupRef.current = null;
        if (onPopupStateChange) onPopupStateChange(false);
      });

      popupRef.current = popup;
      if (onPopupStateChange) onPopupStateChange(true);

      if (onRegionClick) {
        const rawId = feature.id != null ? feature.id : props.id;
        const id = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
        if (!isNaN(id)) onRegionClick(id);
      }
    });
  }

  // Загрузка данных карты
  useEffect(() => {
    if (!mapRef.current || !loaded || regions.length === 0 || countries.length === 0) return;

    const m = mapRef.current;

    const loadMap = async () => {
      try {
        console.log('Loading map with countries:', countries.map(c => ({ id: c.id, name: c.name, color: c.color })));
        const data = await loadGameMapData('/world_1946.geojson', regions, countries);
        setMapData(data);

        if (m.getSource('regions')) {
          (m.getSource('regions') as maplibregl.GeoJSONSource).setData(data.featureCollection);
          const countrySource = m.getSource('country-outlines') as maplibregl.GeoJSONSource | undefined;
          if (countrySource) {
            countrySource.setData(buildCountryOutlines(data));
          }
        } else {
          m.addSource('regions', {
            type: 'geojson',
            data: data.featureCollection,
            maxzoom: 8
          });

          // Сетка координат
          m.addSource('graticule', {
            type: 'geojson',
            data: buildGraticule()
          });

          // Внешние контуры стран
          const countryOutlines = buildCountryOutlines(data);
          m.addSource('country-outlines', {
            type: 'geojson',
            data: countryOutlines
          });

          // 1. Слои морей/океанов — заливка по собственному цвету фичи
          m.addLayer({
            id: 'oceans-fill',
            type: 'fill',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'ocean'],
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.85
            }
          });

          // 2. Береговое свечение (glow) — темно-синее, как было
          m.addLayer({
            id: 'coastline-glow',
            type: 'line',
            source: 'country-outlines',
            paint: {
              'line-color': '#1b3a5f', // Бирюзово-синий
              'line-width': 4.0,
              'line-blur': 3.0,
              'line-opacity': 0.35
            }
          });

          // 3. Слой для стран и регионов (поверх океанов)
          m.addLayer({
            id: 'regions-fill',
            type: 'fill',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'region'],
            paint: {
              'fill-color': ['get', 'ownerColor'],
              'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                0.8,
                ['boolean', ['feature-state', 'selected'], false],
                0.85,
                0.6
              ]
            }
          });

          // 4. Внутренние границы провинций (мягкие, полностью гаснут на мировом зуме)
          m.addLayer({
            id: 'regions-outline',
            type: 'line',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'region'],
            paint: {
              'line-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                '#FFFFFF',
                ['boolean', ['feature-state', 'selected'], false],
                '#FFD700',
                '#0b0e14'
              ],
              'line-width': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                2,
                ['boolean', ['feature-state', 'selected'], false],
                2.5,
                0.35
              ],
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                3.8, 0.0,
                5.5, 0.3
              ]
            }
          });

          // 5. Внешние государственные границы (четкие, но тонкие и аккуратные в стиле EU5)
          m.addLayer({
            id: 'country-outlines',
            type: 'line',
            source: 'country-outlines',
            paint: {
              'line-color': '#1f252e', // Мягкий темно-серый контур
              'line-width': 1.0,      // Тонкий контур
              'line-opacity': 0.7
            }
          });

          setupInteractions(m);
        }
      } catch (error) {
        console.error('Ошибка загрузки карты:', error);
      }
    };

    loadMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, countries, loaded]);

  // Обновление владельцев
  useEffect(() => {
    if (!mapRef.current || !mapData) return;

    const updatedData = updateMapData(mapData.featureCollection, regions, countries);
    setMapData({ featureCollection: updatedData });

    const source = mapRef.current.getSource('regions') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(updatedData);
    }

    const countrySource = mapRef.current.getSource('country-outlines') as maplibregl.GeoJSONSource;
    if (countrySource) {
      countrySource.setData(buildCountryOutlines({ featureCollection: updatedData }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, countries]);

  // Названия стран и регионов — динамические источники и слои
  useEffect(() => {
    if (!mapRef.current || !mapData) return;
    const m = mapRef.current;

    // 1. Обновление подписей стран
    const countryLabels = buildCountryLabels(mapData, regions);
    const countrySource = m.getSource('country-labels') as maplibregl.GeoJSONSource | undefined;
    if (countrySource) {
      countrySource.setData(countryLabels);
    } else {
      m.addSource('country-labels', { type: 'geojson', data: countryLabels });
    }

    if (!m.getLayer('country-labels')) {
      m.addLayer({
        id: 'country-labels',
        type: 'symbol',
        source: 'country-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-rotate': ['get', 'rotateDeg'],
          'text-rotation-alignment': 'map',
          'text-size': ['interpolate', ['exponential', 2], ['zoom'],
            2, ['get', 'sizeZ2'],
            7, ['get', 'sizeZ7']
          ],
          'text-letter-spacing': 0.15,
          'text-font': ['EB Garamond'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-sort-key': ['get', 'sortKey'],
        },
        paint: {
          'text-color': '#2a2a2a',
          'text-halo-color': '#eae5d8',
          'text-halo-width': 1.2,
          'text-halo-blur': 0.5,
          'text-opacity': [
            'interpolate', ['linear'], ['zoom'],
            ...APPEAR_ZOOM_STOPS.flatMap(z => [z, appearOpacityExpr(z)])
          ],
        },
      });
    }

    // 2. Обновление подписей регионов (без дублирования на островах)
    const regionLabels = buildRegionLabels(mapData);
    const regionSource = m.getSource('region-labels') as maplibregl.GeoJSONSource | undefined;
    if (regionSource) {
      regionSource.setData(regionLabels);
    } else {
      m.addSource('region-labels', { type: 'geojson', data: regionLabels });
    }

    if (!m.getLayer('region-labels')) {
      m.addLayer({
        id: 'region-labels',
        type: 'symbol',
        source: 'region-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': 10,
          'text-max-width': 8,
          'text-allow-overlap': false,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': '#4a4a4a',
          'text-halo-color': '#eae5d8',
          'text-halo-width': 0.8,
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5.5, 0.0,
            6.0, 0.8
          ]
        }
      });
    }
  }, [mapData, regions]);

  // Выделение региона
  useEffect(() => {
    if (!mapRef.current) return;
    const m = mapRef.current;

    if (selectedRegionId != null) {
      try { m.setFeatureState({ source: 'regions', id: selectedRegionId }, { selected: true }); } catch {} // eslint-disable-line no-empty
    }
  }, [selectedRegionId]);

  // Инициализация Map Features слоя
  useEffect(() => {
    if (!mapRef.current || !loaded) return;

    const m = mapRef.current;

    if (m.getSource('map-features')) return;

    m.addSource('map-features', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    m.addLayer({
      id: 'map-features-points',
      type: 'circle',
      source: 'map-features',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2, ['case', ['==', ['get', 'type'], 'capital'], 5, 4],
          8, ['case', ['==', ['get', 'type'], 'capital'], 11, 8]
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.85,
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'type'], 'capital'],
          2.5,
          1.5
        ],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'type'], 'capital'],
          '#FFD700', // Золотистый контур для столицы
          '#ffffff'
        ]
      },
    });

    m.addLayer({
      id: 'map-features-icons',
      type: 'symbol',
      source: 'map-features',
      layout: {
        'text-field': ['get', 'icon'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2, ['case', ['==', ['get', 'type'], 'capital'], 12, 10],
          8, ['case', ['==', ['get', 'type'], 'capital'], 20, 16]
        ],
        'text-anchor': 'center',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });
  }, [loaded]);

  // Обновление Map Features
  useEffect(() => {
    if (!mapRef.current || !loaded) return;

    const m = mapRef.current;

    const visibleFeatures = mapFeatures.filter(f => {
      if (f.visibleAtZoom === undefined) return true;
      return currentZoom >= f.visibleAtZoom;
    });

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: visibleFeatures
        .filter(f => f.coordinates)
        .map(f => {
          const country = countries.find(c => c.id === f.ownerId);
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: f.coordinates!,
            },
            properties: {
              id: f.id,
              type: f.type,
              name: f.name,
              ownerId: f.ownerId,
              ownerColor: country?.color || '#808080',
              icon: getIconForType(f.type),
              color: getColorForType(f.type),
            },
          };
        }),
    };

    const source = m.getSource('map-features') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(featureCollection);
    }
  }, [mapFeatures, countries, currentZoom, loaded]);

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />;
}

function getIconForType(type: string): string {
  const iconMap: Record<string, string> = {
    capital: '★',
    megacity: '●',
    city: '●',
    town: '○',
    port: '⚓',
    factory: '🏭',
    steel_mill: '🏭',
    refinery: '🛢️',
    shipyard: '⚓',
    mine: '⛏️',
    power_plant: '⚡',
    battalion: '⚔️',
    fleet: '⛵',
    airbase: '✈️',
    naval_base: '⚓',
    railway: '🚂',
    canal: '🚢',
    airport: '✈️',
    highway: '🛣️',
    protest: '📢',
    uprising: '🔥',
    government: '🏛️',
    border_dispute: '⚠️',
  };
  return iconMap[type] || '•';
}

function getColorForType(type: string): string {
  const colorMap: Record<string, string> = {
    capital: '#FFD700',
    megacity: '#FF6B6B',
    city: '#4ECDC4',
    town: '#95E1D3',
    port: '#45B7D1',
    factory: '#FF8C00',
    steel_mill: '#A0522D',
    refinery: '#8B4513',
    shipyard: '#4682B4',
    mine: '#696969',
    power_plant: '#FF4500',
    battalion: '#DC143C',
    fleet: '#1E90FF',
    airbase: '#00BFFF',
    naval_base: '#4169E1',
    railway: '#708090',
    canal: '#5F9EA0',
    airport: '#87CEEB',
    highway: '#FFA500',
    protest: '#FF69B4',
    uprising: '#FF0000',
    government: '#9370DB',
    border_dispute: '#FFA07A',
  };
  return colorMap[type] || '#FFFFFF';
}
