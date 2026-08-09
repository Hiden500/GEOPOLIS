import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { Country } from '@shared/types/Country';
import type { MapFeature } from '@shared/types/map/MapFeature';
import { getText, type Locale } from '@shared/types/i18n/LocalizedText';
import { loadGameMapData, updateMapData, type GameMapData } from './GeoJsonLoader';
import { buildTopologyEdges, type SharedEdgeProperties } from './engine/TopologyBuilder';
import { buildCountryLabels, buildRegionLabels } from './engine/GeometryEngine';
import { centroid } from '@turf/turf';



function buildGraticule(): FeatureCollection {
  const features: Feature[] = [];
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

function syncEdgesState(
  map: maplibregl.Map | null,
  regs: Region[],
  topo: { edges: FeatureCollection<LineString, SharedEdgeProperties> } | null,
  countries: Country[]
) {
  if (!map || !topo || !map.getSource('shared-edges')) return;
  const regionOwnerMap = new Map<number, string>();
  const countryColorMap = new Map<string, string>();
  
  regs.forEach(r => {
    regionOwnerMap.set(r.id, r.ownerCountryId || 'neutral');
  });
  countries.forEach(c => countryColorMap.set(c.id, c.color));
  countryColorMap.set('neutral', '#808080');
  countryColorMap.set('water', '#0a1628');

  for (const edge of topo.edges.features) {
    const leftOwner = regionOwnerMap.get(edge.properties.leftRegionId) || 'neutral';
    const rightOwner = edge.properties.rightRegionId === -1 
      ? 'water' 
      : (regionOwnerMap.get(edge.properties.rightRegionId) || 'neutral');
    
    const leftColor = countryColorMap.get(leftOwner) || '#808080';

    map.setFeatureState(
      { source: 'shared-edges', id: edge.properties.id },
      { leftOwner, rightOwner, leftColor }
    );
  }
}

interface MapViewProps {
  regions: Region[];
  countries: Country[];
  mapFeatures: MapFeature[];
  /**
   * Клик по региону. Подробности региона показывает ПОЛОСА нового слоя
   * (`docs/UI_DESIGN.md` §6), поэтому карта только СООБЩАЕТ о выборе и своего
   * окна не рисует. Здесь жил `maplibregl.Popup` со свёрстанной `.setHTML`
   * карточкой — обломок старого интерфейса: он дублировал ПОЛОСУ и выглядел
   * чужим. Уцелел потому, что `client/src/map/**` был вне области ветки,
   * снявшей старый слой.
   */
  onRegionClick?: (regionId: number) => void;
  selectedRegionId?: number | null;
  /**
   * Оверлей цвета заливки по режиму карты (docs/plans/12_UI_REDESIGN.md,
   * Срез 2 — MapControls). null/отсутствует → политический цвет по
   * умолчанию (ownerColor из GeoJSON). Не трогает геометрию/топологию —
   * только paint-выражение поверх уже существующего слоя regions-fill.
   */
  regionModeColors?: Record<number, string> | null;
  /** Даёт вызывающему доступ к инстансу карты (кастомные кнопки зума в MapControls). */
  onMapReady?: (map: maplibregl.Map) => void;
}

export function MapView({
  regions,
  countries,
  mapFeatures,
  onRegionClick,
  selectedRegionId,
  regionModeColors,
  onMapReady
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapData, setMapData] = useState<GameMapData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(2);
  const hoveredRef = useRef<string | number | null | undefined>(null);
  const countryMapRef = useRef<Map<string, Country>>(new Map());
  const topologyRef = useRef<{
    edges: FeatureCollection<LineString, SharedEdgeProperties>;
    regionNeighbours: Map<number, Set<number>>;
    regionEdges: Map<number, number[]>;
  } | null>(null);
  const regionsRef = useRef<Region[]>(regions);
  const { i18n } = useTranslation();

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
      } as maplibregl.StyleSpecification,
      center: [37.6173, 55.7558],
      zoom: 2,
      maxZoom: 12,
      minZoom: 2,
      attributionControl: false
    });

    // Отладочный хук: карта достаётся из консоли браузера. Каст точечный —
    // глобальный тип Window ради него не расширяем.
    (window as unknown as { map?: maplibregl.Map }).map = m;

    m.on('load', () => {
      // Регистрируем кастомные иконки для столиц и городов
      const capitalCanvas = createCapitalStarIcon();
      const cityCanvas = createCityDotIcon();
      m.addImage('capital-icon', capitalCanvas);
      m.addImage('city-icon', cityCanvas);

      // Фон — тот же тон, что и дефолтный цвет океана (было '#0c1016',
      // почти чёрный). Любой непокрытый пропуск в геометрии (мелкие озёра
      // без полигона региона, микро-щели на стыках провинций, внутренние
      // моря без отдельной ocean-фичи вроде Каспия) теперь читается как
      // "вода", а не как чёрная дыра/артефакт — нашли 2026-07-18 по
      // скриншоту пользователя (чёрные точки/пятна поверх суши). Настоящий
      // фикс микро-щелей потребовал бы пересборки геометрии (см. TODO.md);
      // это — визуально безопасный fallback-цвет, не заплатка на геометрию.
      m.addLayer({
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#1a3a5c'
        }
      });

      setLoaded(true);
    });

    // Без встроенного NavigationControl — зум управляется кастомными кнопками
    // MapControls (docs/plans/12_UI_REDESIGN.md §1, "mapmodes + зум — правый
    // нижний угол"), не дефолтным светлым виджетом MapLibre.
    m.on('zoom', () => {
      setCurrentZoom(m.getZoom());
    });

    mapRef.current = m;
    onMapReady?.(m);

    return () => {
      m.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- инициализация карты один раз при монтировании; onMapReady читаем как актуальный колбэк, не как триггер пересоздания.
  }, []);

  // MapLibre хранит размер canvas отдельно от DOM. Синхронизируем его при
  // изменении контейнера/viewport, иначе остаются тёмные зазоры и смещается
  // hit-testing после перестройки HUD.
  useEffect(() => {
    const container = mapContainer.current;
    if (!container) return;

    let frame = 0;
    const resizeMap = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mapRef.current?.resize());
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeMap);
    observer?.observe(container);
    window.addEventListener('resize', resizeMap);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resizeMap);
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

      // Карта только сообщает о выборе: показывает регион ПОЛОСА.
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
        console.log('Loading map with countries:', countries.map(c => ({ id: c.id, name: getText(c.name), color: c.color })));
        const data = await loadGameMapData('/world_1946.geojson', regions, countries, i18n.language as Locale);
        setMapData(data);

        // Строим топологию ребер один раз при инициализации
        const topology = buildTopologyEdges(data.featureCollection);
        topologyRef.current = topology;

        if (m.getSource('regions')) {
          (m.getSource('regions') as maplibregl.GeoJSONSource).setData(data.featureCollection);
          const sharedEdgesSource = m.getSource('shared-edges') as maplibregl.GeoJSONSource | undefined;
          if (sharedEdgesSource) {
            sharedEdgesSource.setData(topology.edges);
          }
        } else {
          m.addSource('regions', {
            type: 'geojson',
            data: data.featureCollection,
            maxzoom: 12
          });

          // Сетка координат
          m.addSource('graticule', {
            type: 'geojson',
            data: buildGraticule()
          });

          // Общие ребра границ
          m.addSource('shared-edges', {
            type: 'geojson',
            data: topology.edges
          });

          // 1. Слои морей/океанов — заливка по собственному цвету фичи
          m.addLayer({
            id: 'oceans-fill',
            type: 'fill',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'ocean'],
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.22
            }
          });

          // 2. Береговое свечение (glow) — темно-синее по береговым ребрам
          m.addLayer({
            id: 'coastline-glow',
            type: 'line',
            source: 'shared-edges',
            filter: ['==', ['get', 'isCoast'], true],
            paint: {
              'line-color': '#1b3a5f',
              'line-width': 4.0,
              'line-blur': 3.0,
              'line-opacity': 0.35
            }
          });

          // 2.5. Четкая береговая линия
          m.addLayer({
            id: 'coastline-solid',
            type: 'line',
            source: 'shared-edges',
            filter: ['==', ['get', 'isCoast'], true],
            paint: {
              'line-color': '#0d1c2e',
              'line-width': 2.5,
              'line-opacity': 1.0
            }
          });

          // 3. Заливка регионов — было 0.36 (приглушить цвета и показать
          // подложку), но реальной текстурной подложки нет — на практике это
          // просто затемняло любой цвет через #0c1016 background layer и
          // делало почти неразличимые тонкие геометрические швы между
          // регионами заметными светлыми линиями. Поднято почти до непрозрачного
          // (2026-07-18, по фидбеку пользователя — карта была слишком тёмной).
          //
          // fill-antialias:false стоял с 2026-07-01 (коммит 0e8b7b0) как фикс
          // белых швов при полупрозрачной заливке. Побочный эффект, всплывший
          // после подъёма opacity и насыщенности палитры (2026-07-18): без
          // антиалиасинга суб-пиксельные геометрические швы между соседними
          // регионами (те же неточности стыковки полигонов, что и разрывы
          // берегов) рендерятся не смягчённым краем, а жёсткими одиночными
          // точками цвета фона — то, что пользователь видит как "чёрные
          // точки". Подтверждено эмпирически: WebGL readPixels на живой
          // карте (зум ~3.5, вглубь материка СССР) нашёл 742 изолированных
          // пикселя ровно цвета фона (26,58,92), полностью окружённых
          // заливкой. Фикс — вернуть антиалиасинг + fill-outline-color в тот
          // же цвет заливки (стандартный приём против швов между соседними
          // полигонами: каждый регион докрашивает свой край собственным
          // цветом, а не оставляет фон просвечивать сквозь субпиксельный
          // зазор). fill-opacity сейчас уже 0.96 (близко к непрозрачному),
          // поэтому исходный баг с двойным альфа-блендингом на полупрозрачной
          // заливке (ради которого антиалиасинг когда-то выключили) не
          // должен вернуться.
          m.addLayer({
            id: 'regions-fill',
            type: 'fill',
            source: 'regions',
            filter: ['==', ['get', 'type'], 'region'],
            paint: {
              // coalesce: приоритет у оверлея mapmode (feature-state), иначе
              // политический цвет владельца (GeoJSON-свойство) — см. regionModeColors.
              'fill-color': ['coalesce', ['feature-state', 'modeColor'], ['get', 'ownerColor']],
              'fill-opacity': 0.96,
              'fill-antialias': true,
              'fill-outline-color': ['coalesce', ['feature-state', 'modeColor'], ['get', 'ownerColor']]
            }
          });

          // 4. Внутренние границы регионов (для скрытия швов на малом зуме и показа границ на большом)
          m.addLayer({
            id: 'internal-borders',
            type: 'line',
            source: 'shared-edges',
            filter: ['==', ['get', 'isCoast'], false],
            paint: {
              'line-color': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4.8, ['feature-state', 'leftColor'],
                5.2, '#0b0e14'
              ],
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4.8, 1.2,
                5.2, 0.35
              ],
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4.5, 0.0,
                5.2, ['case', ['!=', ['feature-state', 'leftOwner'], ['feature-state', 'rightOwner']], 0.0, 0.35],
                7.0, ['case', ['!=', ['feature-state', 'leftOwner'], ['feature-state', 'rightOwner']], 0.0, 0.7]
              ]
            }
          });

          // 4.5 Контур подсветки при наведении/выделении
          m.addLayer({
            id: 'regions-outline-highlight',
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
                'transparent'
              ],
              'line-width': 2.0,
              'line-opacity': 1.0
            }
          });

          // 5. Внешние сухопутные государственные границы
          m.addLayer({
            id: 'country-borders',
            type: 'line',
            source: 'shared-edges',
            filter: ['==', ['get', 'isCoast'], false],
            paint: {
              'line-color': '#0d1117',
              'line-width': 1.6,
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                2.0, [
                  'case',
                  ['==', ['feature-state', 'leftOwner'], ['feature-state', 'rightOwner']], 0.0,
                  0.75
                ],
                5.0, [
                  'case',
                  ['==', ['feature-state', 'leftOwner'], ['feature-state', 'rightOwner']], 0.0,
                  0.75
                ],
                5.2, 0.0
              ]
            }
          });

          setupInteractions(m);
        }

        // Синхронизируем начальные состояния ребер
        syncEdgesState(m, regions, topology, countries);
      } catch (error) {
        console.error('Ошибка загрузки карты:', error);
      }
    };

    loadMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, countries, loaded]);

  // Обновление владельцев
  useEffect(() => {
    if (!mapRef.current || !mapData || !loaded) return;

    const updatedData = updateMapData(mapData.featureCollection, regions, countries, i18n.language as Locale);
    setMapData({ featureCollection: updatedData });

    const source = mapRef.current.getSource('regions') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(updatedData);
    }

    // Синхронизируем состояния ребер (вместо медленного turf.union)
    syncEdgesState(mapRef.current, regions, topologyRef.current, countries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, countries]);

  // Названия стран и регионов — динамические источники и слои
  useEffect(() => {
    if (!mapRef.current || !mapData) return;
    const m = mapRef.current;

    // 1. Обновление подписей стран
    const countryLabels = buildCountryLabels(mapData.featureCollection, regions);
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
          // Временно скрыт (2026-07-18) по запросу пользователя — подписи
          // стран ещё не доработаны. Убрать 'none', когда займёмся подписями.
          visibility: 'none',
          'text-field': ['upcase', ['get', 'name']],
          'symbol-placement': 'point',
          'text-rotate': ['get', 'rotateDeg'],
          'text-keep-upright': false,
          'text-size': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            2,
            ['/', ['get', 'sizeZ2'], 4],
            7,
            ['/', ['get', 'sizeZ7'], 4]
          ],
          // Без glyphs URL MapLibre рисует glyphs локально через TinySDF;
          // self-hosted IBM Plex Sans покрывает latin/cyrillic локали игры.
          'text-font': ['IBM Plex Sans'],
          'symbol-sort-key': ['get', 'sortKey'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-padding': 2
        },
        paint: {
          'text-color': '#eae5d899', // теплый белый с 60% прозрачностью
          'text-halo-color': '#0c1016', // темная подложка
          'text-halo-width': 0.8,
          'text-halo-blur': 0.2,
          // Прозрачность с затуханием по зуму и плавным проявлением по порогу читаемости (appearZoom)
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2.0,
            [
              'case',
              ['<', 2.0, ['get', 'appearZoom']],
              0.0,
              ['<', 2.0, ['+', ['get', 'appearZoom'], 0.6]],
              ['/', ['-', 2.0, ['get', 'appearZoom']], 0.6],
              1.0
            ],
            4.2,
            [
              'case',
              ['<', 4.2, ['get', 'appearZoom']],
              0.0,
              ['<', 4.2, ['+', ['get', 'appearZoom'], 0.6]],
              ['/', ['-', 4.2, ['get', 'appearZoom']], 0.6],
              1.0
            ],
            4.8,
            [
              'case',
              ['<', 4.8, ['get', 'appearZoom']],
              0.0,
              ['<', 4.8, ['+', ['get', 'appearZoom'], 0.6]],
              ['*', ['/', ['-', 4.8, ['get', 'appearZoom']], 0.6], 0.4],
              0.4
            ],
            5.2,
            0.0,
            8.0,
            0.0
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
          'text-font': ['IBM Plex Sans'],
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
  }, [mapData, regions, loaded]);

  // Выделение региона
  useEffect(() => {
    if (!mapRef.current) return;
    const m = mapRef.current;
    if (!m.getSource('regions')) return;

    if (selectedRegionId != null) {
      try { m.setFeatureState({ source: 'regions', id: selectedRegionId }, { selected: true }); } catch {} // eslint-disable-line no-empty
    }
  }, [selectedRegionId, mapData, loaded]);

  // Оверлей цвета режима карты (docs/plans/12_UI_REDESIGN.md, MapControls) —
  // сбрасывает modeColor у регионов, ушедших из карты, и выставляет заново
  // при смене режима/данных. null/отсутствие = политический режим (fallback
  // на ownerColor в paint-выражении regions-fill).
  useEffect(() => {
    if (!mapRef.current || !loaded) return;
    const m = mapRef.current;
    if (!m.getSource('regions')) return;
    for (const r of regions) {
      const color = regionModeColors?.[r.id];
      try {
        m.setFeatureState({ source: 'regions', id: r.id }, { modeColor: color ?? null });
      } catch {} // eslint-disable-line no-empty
    }
  }, [regionModeColors, regions, loaded, mapData]);

  // Управление Map Features (инициализация и обновление)
  useEffect(() => {
    if (!mapRef.current || !loaded || !mapData) return;

    const m = mapRef.current;

    // 1. Инициализация источника и слоев, если их еще нет
    if (!m.getSource('map-features')) {
      m.addSource('map-features', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Слой иконок (звезды/точки с Canvas)
      m.addLayer({
        id: 'map-features-icons',
        type: 'symbol',
        source: 'map-features',
        layout: {
          // Временно скрыт (2026-07-18) — зум/размер не доработаны, иконки
          // мешают просмотру карты. Убрать 'none', когда займёмся Map Features.
          visibility: 'none',
          'icon-image': [
            'case',
            ['==', ['get', 'type'], 'capital'], 'capital-icon',
            'city-icon'
          ],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.7,
            8, 1.2
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Слой текстовых подписей городов ниже иконки
      m.addLayer({
        id: 'map-features-labels',
        type: 'symbol',
        source: 'map-features',
        layout: {
          // Временно скрыт вместе с map-features-icons, см. комментарий там.
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-font': ['IBM Plex Sans'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 9,
            8, 12
          ],
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#eae5d8',
          'text-halo-color': '#0c1016',
          'text-halo-width': 1.5,
        },
      });
    }

    // 2. Обновление данных
    const visibleFeatures = mapFeatures.filter(f => {
      if (f.visibleAtZoom === undefined) return true;
      return currentZoom >= f.visibleAtZoom;
    });

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: visibleFeatures
        .map(f => {
          let coords = f.coordinates;
          
          if (!coords && f.regionId != null && mapData) {
            const geoFeature = mapData.featureCollection.features.find(
              feat => feat.properties?.regionId === f.regionId
            );
            if (geoFeature) {
              const c = centroid(geoFeature);
              if (c && c.geometry && c.geometry.coordinates) {
                coords = c.geometry.coordinates as [number, number];
              }
            }
          }

          if (!coords) return null;

          const country = countries.find(c => c.id === f.ownerId);
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: coords,
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
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
    };

    const source = m.getSource('map-features') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(featureCollection);
    }
  }, [mapFeatures, countries, currentZoom, loaded, mapData]);

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

function createCapitalStarIcon(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;

  const cx = 8;
  const cy = 8;
  const spikes = 5;
  const outerRadius = 6;
  const innerRadius = 2.5;

  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    const outerX = cx + Math.cos(rot) * outerRadius;
    const outerY = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(outerX, outerY);
    rot += step;

    const innerX = cx + Math.cos(rot) * innerRadius;
    const innerY = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(innerX, innerY);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();

  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#0c1016';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return ctx.getImageData(0, 0, 16, 16);
}

function createCityDotIcon(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(5, 5, 2.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#0c1016';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  return ctx.getImageData(0, 0, 10, 10);
}


