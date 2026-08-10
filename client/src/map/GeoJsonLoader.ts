import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type { Region } from '@shared/types/map/Region';
import type { Country } from '@shared/types/Country';
import { getText, type Locale } from '@shared/types/i18n/LocalizedText';

/**
 * Цвет воды — ПОДАЧА, а не данные: он одинаков у всех акваторий и в файле
 * карты ему делать нечего (решение 2026-08-09, контракт полей geojson —
 * `scripts/map/AGENTS.md`). До этого загрузчик читал `props.color`, которого в
 * `world_1946.geojson` не было ни разу, и всегда падал в этот же fallback.
 */
const OCEAN_COLOR = '#1a3a5c';

export interface MapRegionProperties {
  id: string;
  name: string;
  ownerCountryId: string | null;
  ownerColor: string;
  ownerName: string;
  population: number;
  type: string;
  color: string;
  regionId?: number;
}

export interface GameMapData {
  featureCollection: FeatureCollection<Polygon | MultiPolygon, MapRegionProperties>;
}

/**
 * Создаёт маппинг geoJsonId (= region_id из MAP) на регионы.
 * Зоны оккупации Германии и раздел Китая уже запечены в ownerCountryId при
 * импорте (scripts/map/import_to_game.py) — отдельный рантайм-оверлей не нужен.
 */
function buildRegionMapping(regions: Region[]): Map<string, Region> {
  const mapping = new Map<string, Region>();

  for (const region of regions) {
    mapping.set(region.geoJsonId, region);

    if (region.sourceAdm1Codes && region.sourceAdm1Codes.length > 0) {
      for (const sourceCode of region.sourceAdm1Codes) {
        mapping.set(sourceCode, region);
      }
    }
  }

  return mapping;
}

/**
 * Загружает GeoJSON (world_1946.geojson — region_id в properties) и обогащает
 * его игровыми данными из regions.json/countries.json.
 */
export async function loadGameMapData(
  geoJsonUrl: string,
  regions: Region[],
  countries: Country[],
  locale?: Locale
): Promise<GameMapData> {
  try {
    console.log('Loading GeoJSON from:', geoJsonUrl);
    const response = await fetch(geoJsonUrl);
    const geoJson: FeatureCollection = await response.json();

    const countryMap = new Map<string, Country>();
    countries.forEach(country => countryMap.set(country.id, country));

    const regionMapping = buildRegionMapping(regions);
    console.log('Region mapping size:', regionMapping.size);
    console.log('Regions count:', regions.length);
    console.log('GeoJSON features count:', geoJson.features.length);

    const enrichedFeatures = geoJson.features.map(feature => {
      const props = feature.properties || {};
      const name = (props.name || 'Unknown') as string;
      const type = (props.type || 'region') as string;
      const featureId = (props.region_id || '') as string;

      let ownerCountryId: string | null = null;
      let ownerColor = '#808080';
      let ownerName = 'Neutral';
      let regionId: number | undefined = undefined;
      let regionName = name;
      let regionPopulation = 0;

      if (type === 'region') {
        const matchedRegion = regionMapping.get(featureId);
        if (matchedRegion) {
          regionId = matchedRegion.id;
          regionName = getText(matchedRegion.names, locale);
          regionPopulation = matchedRegion.population;

          const country = countryMap.get(matchedRegion.ownerCountryId);
          if (country) {
            ownerCountryId = matchedRegion.ownerCountryId;
            ownerColor = country.color;
            ownerName = getText(country.name, locale);
          }
        }
      }

      if (type === 'ocean') {
        ownerColor = OCEAN_COLOR;
        ownerName = name;
      }

      return {
        type: 'Feature' as const,
        // Числовой id фичи переносится КАК ЕСТЬ: по нему MapView адресует
        // setFeatureState (hover, выделение, цвет режима карты), и он же —
        // id региона в regions.core.json. Загрузчик его терял, поэтому ни
        // одно feature-state состояние не доезжало ни до одной фичи.
        id: feature.id,
        properties: {
          id: featureId || name,
          name: regionName,
          ownerCountryId,
          ownerColor,
          ownerName,
          population: regionPopulation,
          type,
          color: OCEAN_COLOR,
          regionId
        },
        geometry: feature.geometry as Polygon | MultiPolygon
      } as Feature<Polygon | MultiPolygon, MapRegionProperties>;
    });

    return {
      featureCollection: {
        type: 'FeatureCollection',
        features: enrichedFeatures
      }
    };
  } catch (error) {
    console.error('Ошибка загрузки данных карты:', error);
    throw error;
  }
}

/**
 * Обновляет данные карты при изменении владельцев регионов
 */
export function updateMapData(
  featureCollection: FeatureCollection<Polygon | MultiPolygon, MapRegionProperties>,
  regions: Region[],
  countries: Country[],
  locale?: Locale
): FeatureCollection<Polygon | MultiPolygon, MapRegionProperties> {
  const countryMap = new Map<string, Country>();
  countries.forEach(country => countryMap.set(country.id, country));

  const regionMapping = buildRegionMapping(regions);

  const updatedFeatures = featureCollection.features.map(feature => {
    const props = feature.properties;
    if (props.type === 'ocean') return feature;

    const featureId = props.id || '';
    const matchedRegion = regionMapping.get(featureId);
    if (matchedRegion) {
      const country = countryMap.get(matchedRegion.ownerCountryId);
      if (country) {
        return {
          ...feature,
          properties: {
            ...props,
            ownerCountryId: matchedRegion.ownerCountryId,
            ownerColor: country.color,
            ownerName: getText(country.name, locale),
            name: getText(matchedRegion.names, locale),
            population: matchedRegion.population
          }
        };
      }
    }

    return feature;
  });

  return {
    type: 'FeatureCollection',
    features: updatedFeatures
  };
}
