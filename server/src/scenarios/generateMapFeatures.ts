import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type MapFeature } from "@shared/types/map/MapFeature";
import { MapFeatureService } from "../services/MapFeatureService";
import { type GameState } from "@shared/types/GameState";
import { getText } from "@shared/types/i18n/LocalizedText";

/**
 * Генерирует начальные Map Features для сценария.
 * Создаёт столицы, крупные города, порты и базовую промышленность.
 */
export function generateInitialMapFeatures(
  game: GameState
): MapFeature[] {
  const mapFeatureService = new MapFeatureService(game);
  const features: MapFeature[] = [];

  // Курированные имена и точные координаты столиц для основных держав 1946 года
  const CAPITAL_OVERRIDES: Record<string, { name: string; coordinates?: [number, number] }> = {
    SUN: { name: "Москва", coordinates: [37.6173, 55.7558] },
    USA: { name: "Вашингтон", coordinates: [-77.0369, 38.8951] },
    GBR: { name: "Лондон", coordinates: [-0.1278, 51.5074] },
    FRA: { name: "Париж", coordinates: [2.3522, 48.8566] },
    DNK: { name: "Копенгаген", coordinates: [12.5683, 55.6761] },
    CAN: { name: "Оттава", coordinates: [-75.6972, 45.4215] },
    BRA: { name: "Рио-де-Жанейро", coordinates: [-43.1729, -22.9068] },
    ITA: { name: "Рим", coordinates: [12.4964, 41.9028] },
    JPN: { name: "Токио", coordinates: [139.6917, 35.6895] },
    TWN: { name: "Нанкин", coordinates: [118.7969, 32.0603] },
    CHN: { name: "Яньань", coordinates: [109.4897, 36.5855] },
    AFG: { name: "Кабул", coordinates: [69.1725, 34.5553] },
    EGY: { name: "Каир", coordinates: [31.2357, 30.0444] },
  };

  // Генерируем столицы
  for (const country of game.countries) {
    const capitalRegion = game.regions.find(r => r.id === country.capitalRegionId);
    if (capitalRegion) {
      const override = CAPITAL_OVERRIDES[country.id];
      const name = override ? override.name : getText(capitalRegion.names);
      const coordinates = override ? override.coordinates : undefined;

      const capital = mapFeatureService.createMapFeature({
        type: 'capital',
        regionId: capitalRegion.id,
        ownerId: country.id,
        name,
        ...(coordinates ? { coordinates } : {}),
        tags: ['capital', 'settlement'],
        visibleAtZoom: 0, // видна на любом зуме
      });
      features.push(capital);
    }
  }

  // Генерируем крупные города (население > 1M)
  for (const region of game.regions) {
    if (region.population > 1000000) {
      // Проверяем, что это не столица
      const isCapital = game.countries.some(c => c.capitalRegionId === region.id);
      if (isCapital) continue;

      const cityType = region.population > 5000000 ? 'megacity' : 'city';
      const city = mapFeatureService.createMapFeature({
        type: cityType,
        regionId: region.id,
        ownerId: region.ownerCountryId,
        name: getText(region.names),
        tags: ['settlement', cityType],
        visibleAtZoom: cityType === 'megacity' ? 3 : 6,
      });
      features.push(city);
    }
  }

  // Генерируем порты в прибрежных регионах
  for (const region of game.regions) {
    if (isCoastalRegion(region)) {
      const port = mapFeatureService.createMapFeature({
        type: 'port',
        regionId: region.id,
        ownerId: region.ownerCountryId,
        name: `${getText(region.names)} Port`,
        tags: ['infrastructure', 'port'],
        visibleAtZoom: 6,
      });
      features.push(port);
    }
  }

  // Генерируем базовую промышленность в развитых регионах
  for (const region of game.regions) {
    if (region.development > 0.5 && region.infrastructure > 0.5) {
      const factory = mapFeatureService.createMapFeature({
        type: 'factory',
        regionId: region.id,
        ownerId: region.ownerCountryId,
        name: `${getText(region.names)} Industrial Zone`,
        tags: ['industry', 'factory'],
        visibleAtZoom: 9,
      });
      features.push(factory);
    }
  }

  return features;
}

/**
 * Проверяет, является ли регион прибрежным — по наличию водных соседей,
 * посчитанных геометрией на этапе экспорта сценария (К-6), а не живым
 * geojson-запросом.
 */
function isCoastalRegion(region: Region): boolean {
  return region.adjacentWaterIds.length > 0;
}
