import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { centroid, bbox, bezierSpline } from '@turf/turf';
import type { Feature, FeatureCollection, LineString, Position, Polygon, MultiPolygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { Country } from '@shared/types/Country';
import type { MapFeature } from '@shared/types/map/MapFeature';
import { loadGameMapData, updateMapData, type GameMapData, type MapRegionProperties } from './GeoJsonLoader';

type RegionFeature = Feature<Polygon | MultiPolygon, MapRegionProperties>;
interface CountryLabelProps { name: string; sizeZ2: number; sizeZ7: number; sortKey: number }

// letter-spacing для подписей стран (em) — небольшой постоянный, основное
// "растягивание на страну" даёт text-size (геометрический рост с зумом),
// не spacing (большой spacing на символ-линии переносил текст в столбик).
const LABEL_LETTER_SPACING_EM = 0.08;

/**
 * Долготный разброс территории в градусах, нормализованный на переход
 * через антимеридиан (иначе ложно раздувается пересечением -180/180,
 * напр. у СССР с Чукоткой). Нужен для расчёта пиксельной ширины на экране.
 */
function lonSpanDegrees(features: RegionFeature[]): number {
  const [minLon, , maxLon] = bbox({ type: 'FeatureCollection', features });
  let span = maxLon - minLon;
  if (span > 180) {
    const normalized = features.flatMap(f => {
      const [lon0, , lon1] = bbox(f);
      return [lon0 < 0 ? lon0 + 360 : lon0, lon1 < 0 ? lon1 + 360 : lon1];
    });
    span = Math.max(...normalized) - Math.min(...normalized);
  }
  return span;
}

/**
 * Кегль подписи на двух опорных зумах (2 и 7) — растёт геометрически с
 * зумом (имя стремится занять ширину страны на экране), клампится в
 * [9,48]px. Между опорами maplibre интерполирует exponential-base-2.
 */
function computeLabelSizes(name: string, lonSpanDeg: number): { sizeZ2: number; sizeZ7: number } {
  const charCount = Math.max(1, name.length);
  const sizeAtZoom = (zoom: number): number => {
    const pixelWidth = (lonSpanDeg / 360) * 512 * Math.pow(2, zoom);
    const raw = (0.9 * pixelWidth) / (charCount * (0.55 + LABEL_LETTER_SPACING_EM));
    return Math.min(48, Math.max(9, raw));
  };
  return { sizeZ2: sizeAtZoom(2), sizeZ7: sizeAtZoom(7) };
}

/**
 * Связная по суше "метрополия" страны — через graph BFS по
 * neighboringRegionIds, отфильтрованному на "тот же владелец". Нужно, чтобы
 * заморские департаменты/удалённые администрации, принадлежащие метрополии
 * напрямую (не колониальный блок — Франция, Норвегия, Нидерланды; Ливия как
 * прямое владение GBR/FRA через controller, см. occupation_overlay), не
 * раздували геометрию метрополии через весь земной шар: они не граничат по
 * суше с метрополией и попадают в свой отдельный компонент связности.
 *
 * Критерий выбора — число регионов в компоненте, НЕ суммарная площадь.
 * Площадь обманчива: историческая метрополия почти всегда раздроблена на
 * много провинций, тогда как удалённая военная администрация (напр. Феццан
 * под французским контролем — один регион ~596k км², физически БОЛЬШЕ всей
 * метрополии Франции из 13 регионов ~548k км² суммарно) — единственный
 * регион. По площади побеждает пустыня, по числу регионов — метрополия.
 */
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

/**
 * Изогнутая "осевая линия" территории — для symbol-placement: line-center,
 * чтобы название огибало форму страны (EU5-стиль), а не сидело точкой.
 * Алгоритм: центроиды регионов (вес = площадь) → площадь-взвешенный PCA
 * (главная ось через atan2 на ковариации) → проекция на ось, биннинг
 * вдоль неё → обратное преобразование. lon/lat не евклидовы — все
 * расчёты в локальных км (x = Δlon·111·cos(lat0), y = Δlat·111), чтобы
 * ось PCA отражала реальную форму, а не искажение долготы по широте.
 */
function buildSpine(paired: { region: Region; feature: RegionFeature }[]): Position[] {
  let points = paired.map(({ region, feature }) => {
    const [lon, lat] = centroid(feature).geometry.coordinates;
    return { lon, lat, weight: region.area || 1 };
  });

  // Антимеридиан: нормализуем долготы в [0,360) на время расчёта, если
  // разброс выглядит как пересечение -180/180.
  const lons = points.map(p => p.lon);
  if (Math.max(...lons) - Math.min(...lons) > 180) {
    points = points.map(p => ({ ...p, lon: p.lon < 0 ? p.lon + 360 : p.lon }));
  }

  const sumW = points.reduce((s, p) => s + p.weight, 0);
  const lon0 = points.reduce((s, p) => s + p.lon * p.weight, 0) / sumW;
  const lat0 = points.reduce((s, p) => s + p.lat * p.weight, 0) / sumW;
  const lat0Rad = (lat0 * Math.PI) / 180;
  const kmPerDegLon = 111 * Math.cos(lat0Rad);

  const xy = points.map(p => ({
    x: (p.lon - lon0) * kmPerDegLon,
    y: (p.lat - lat0) * 111,
    w: p.weight,
  }));

  let Sxx = 0, Syy = 0, Sxy = 0;
  for (const p of xy) { Sxx += p.w * p.x * p.x; Syy += p.w * p.y * p.y; Sxy += p.w * p.x * p.y; }
  Sxx /= sumW; Syy /= sumW; Sxy /= sumW;
  const theta = xy.length > 1 ? 0.5 * Math.atan2(2 * Sxy, Sxx - Syy) : 0;

  const rotated = xy.map(p => ({
    u: p.x * Math.cos(theta) + p.y * Math.sin(theta),
    v: -p.x * Math.sin(theta) + p.y * Math.cos(theta),
    w: p.w,
  }));

  const uVals = rotated.map(p => p.u);
  const uMin = Math.min(...uVals), uMax = Math.max(...uVals);
  const span = uMax - uMin;
  const nBins = Math.min(8, Math.max(2, Math.round(Math.sqrt(paired.length)) + 1));

  const bins = Array.from({ length: nBins }, () => ({ sumU: 0, sumV: 0, sumW: 0 }));
  if (span < 1e-6) {
    for (const p of rotated) { bins[0].sumU += p.u * p.w; bins[0].sumV += p.v * p.w; bins[0].sumW += p.w; }
  } else {
    for (const p of rotated) {
      const idx = Math.min(nBins - 1, Math.max(0, Math.floor(((p.u - uMin) / span) * nBins)));
      bins[idx].sumU += p.u * p.w;
      bins[idx].sumV += p.v * p.w;
      bins[idx].sumW += p.w;
    }
  }

  let spineUV = bins.filter(b => b.sumW > 0).map(b => ({ u: b.sumU / b.sumW, v: b.sumV / b.sumW }));

  if (spineUV.length < 2) {
    // Однорегионные/крошечные страны — нужна валидная линия ненулевой
    // длины для symbol-placement: line-center, иначе текст не разместится.
    const base = spineUV[0] ?? { u: 0, v: 0 };
    spineUV = [{ u: base.u - 15, v: base.v }, { u: base.u + 15, v: base.v }];
  }

  return spineUV.map(({ u, v }): Position => {
    const x = u * Math.cos(theta) - v * Math.sin(theta);
    const y = u * Math.sin(theta) + v * Math.cos(theta);
    let lon = lon0 + x / kmPerDegLon;
    if (lon > 180) lon -= 360;
    return [lon, lat0 + y / 111];
  });
}

/**
 * Подписи стран в стиле EU5 — изогнутая линия вдоль формы территории
 * (symbol-placement: line-center в слое), кегль растёт геометрически с
 * зумом (см. computeLabelSizes), sortKey по площади для declutter
 * (крупные державы всегда видны, мелкие проявляются при приближении).
 */
function buildCountryLabels(mapData: GameMapData, regions: Region[]): FeatureCollection<LineString, CountryLabelProps> {
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

  const labelFeatures: Feature<LineString, CountryLabelProps>[] = [];
  for (const ownedRegions of regionsByCountry.values()) {
    const mainland = largestMainlandCluster(ownedRegions);
    if (mainland.length === 0) continue;

    const paired = mainland
      .map(region => ({ region, feature: featureByRegionId.get(region.id) }))
      .filter((p): p is { region: Region; feature: RegionFeature } => p.feature != null);
    if (paired.length === 0) continue;

    const rawSpine = buildSpine(paired);
    let line: Position[] = rawSpine;
    if (rawSpine.length >= 3) {
      try {
        // Дефолтные опции turf (resolution=10000) дают плавную кривую за
        // ~1-2мс на страну (замерено) — пониженный resolution здесь ранее
        // по ошибке означал МЕНЬШЕ сглаживания (resolution у turf — это не
        // "точек на кривую", а параметр плотности самплинга; меньшее
        // значение почти отключает сглаживание, оставляя сырые острые
        // углы спайна, которые потом режутся text-max-angle).
        const smoothed = bezierSpline(
          { type: 'Feature', geometry: { type: 'LineString', coordinates: rawSpine }, properties: {} }
        );
        line = smoothed.geometry.coordinates as Position[];
      } catch {
        // Вырожденная геометрия (коллинеарные/совпадающие точки) — оставляем прямую линию (rawSpine).
      }
    }

    const mainlandFeatures = paired.map(p => p.feature);
    const name = mainlandFeatures[0].properties.ownerName;
    const totalArea = mainland.reduce((sum, r) => sum + (r.area || 0), 0);
    const { sizeZ2, sizeZ7 } = computeLabelSizes(name, lonSpanDegrees(mainlandFeatures));

    labelFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { name, sizeZ2, sizeZ7, sortKey: -totalArea }
    });
  }

  return { type: 'FeatureCollection', features: labelFeatures };
}

interface MapViewProps {
  regions: Region[];
  countries: Country[];
  mapFeatures: MapFeature[];
  onRegionClick?: (regionId: number) => void;
  selectedRegionId?: number | null;
}

export function MapView({ regions, countries, mapFeatures, onRegionClick, selectedRegionId }: MapViewProps) {
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
        // Тёмный фон для карты
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
      },
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

      popupRef.current = popup;

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
        } else {
          m.addSource('regions', {
            type: 'geojson',
            data: data.featureCollection,
            maxzoom: 8
          });

          // Слои морей/океанов — заливка по собственному цвету фичи + границы
          // между водными объектами (под слоями регионов/стран).
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

          m.addLayer({
            id: 'oceans-outline',
            type: 'line',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'ocean'],
            paint: {
              'line-color': '#0d2438',
              'line-width': 0.4
            }
          });

          // Слой для стран и регионов (поверх океанов)
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
                // Тёмная почти-чёрная линия — читается на любом цвете
                // заливки, в отличие от прежнего #334155, который терялся
                // на похожих по тону холодных оттенках.
                '#0b0e14'
              ],
              'line-width': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                2,
                ['boolean', ['feature-state', 'selected'], false],
                2.5,
                0.7
              ],
              // Прозрачность для границ по умолчанию — сплошная чёрная
              // линия слишком бросалась в глаза на некоторых цветах заливки
              // ("слишком выбиваются"). hover/selected остаются полностью
              // непрозрачными — это активная подсветка, не базовая линия.
              'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1,
                ['boolean', ['feature-state', 'selected'], false],
                1,
                0.45
              ]
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, countries]);

  // Названия стран — видны при отдалении (мало деталей регионов на экране),
  // гаснут при приближении (там читаются отдельные регионы кликом/попапом).
  useEffect(() => {
    if (!mapRef.current || !mapData) return;
    const m = mapRef.current;

    const labels = buildCountryLabels(mapData, regions);

    const source = m.getSource('country-labels') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(labels);
      return;
    }

    m.addSource('country-labels', { type: 'geojson', data: labels });

    m.addLayer({
      id: 'country-labels',
      type: 'symbol',
      source: 'country-labels',
      maxzoom: 7,
      layout: {
        'text-field': ['get', 'name'],
        // Изогнутая подпись вдоль формы страны (EU5-стиль) — геометрия
        // линии строится в buildSpine, здесь только режим размещения.
        'symbol-placement': 'line-center',
        // 60 (план) оказался слишком строгим: даже на гладких bezier-кривых
        // (501 точка) локальный угол между соседними отрезками местами его
        // превышает → maplibre тихо отказывает в размещении ВСЕЙ подписи
        // (проверено: на 60 пропадали все страны кроме CCCP, на 180 —
        // появлялись все). 100 — компромисс без риска самоперекрытия букв.
        'text-max-angle': 100,
        // Кегль растёт геометрически с зумом (предвычислен на двух опорных
        // зумах в computeLabelSizes) — имя стремится занимать ширину
        // страны на экране на любом зуме, не фиксированный размер.
        'text-size': ['interpolate', ['exponential', 2], ['zoom'],
          2, ['get', 'sizeZ2'],
          7, ['get', 'sizeZ7']
        ],
        'text-letter-spacing': LABEL_LETTER_SPACING_EM,
        'text-font': ['Open Sans Bold'],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        // EU5-declutter: крупные страны (меньший sortKey = -area) размещаются
        // первыми и выигрывают коллизии — видны издалека; мелкие уступают
        // место, пока зум не освободит его под их подпись.
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: {
        'text-color': '#f1f5f9',
        'text-halo-color': '#0b0e14',
        'text-halo-width': 1.4,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 2, 1, 5.5, 1, 6.5, 0],
      },
    });
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
        'circle-radius': 6,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    m.addLayer({
      id: 'map-features-icons',
      type: 'symbol',
      source: 'map-features',
      layout: {
        'text-field': ['get', 'icon'],
        'text-size': 16,
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
