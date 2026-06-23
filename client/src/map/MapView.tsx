import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Region } from '@shared/types/map/Region';
import type { Country } from '@shared/types/Country';
import type { MapFeature } from '@shared/types/map/MapFeature';
import { loadGameMapData, updateMapData, type GameMapData } from './GeoJsonLoader';

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
        // TEMP: /1world-map-full.geojson не существует пока карта в работе у пользователя.
        // game_map.json — временная подмена только для прототипа интерфейса.
        const data = await loadGameMapData('/game_map.json', regions, countries);
        setMapData(data);

        if (m.getSource('regions')) {
          (m.getSource('regions') as maplibregl.GeoJSONSource).setData(data.featureCollection);
        } else {
          m.addSource('regions', {
            type: 'geojson',
            data: data.featureCollection,
            maxzoom: 8
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
                '#334155'
              ],
              'line-width': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                2,
                ['boolean', ['feature-state', 'selected'], false],
                2.5,
                0.5
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
