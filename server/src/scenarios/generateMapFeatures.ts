import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type MapFeature } from "@shared/types/map/MapFeature";
import { MapFeatureService } from "../services/MapFeatureService";
import { type GameState } from "@shared/types/GameState";

/**
 * Генерирует начальные Map Features для сценария.
 * Создаёт столицы, крупные города, порты и базовую промышленность.
 */
export function generateInitialMapFeatures(
  game: GameState
): MapFeature[] {
  const mapFeatureService = new MapFeatureService(game);
  const features: MapFeature[] = [];

  // Генерируем столицы
  for (const country of game.countries) {
    const capitalRegion = game.regions.find(r => r.id === country.capitalRegionId);
    if (capitalRegion) {
      // Столица
      const capital = mapFeatureService.createMapFeature({
        type: 'capital',
        regionId: capitalRegion.id,
        ownerId: country.id,
        name: capitalRegion.name,
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
        name: region.name,
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
        name: `${region.name} Port`,
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
        name: `${region.name} Industrial Zone`,
        tags: ['industry', 'factory'],
        visibleAtZoom: 9,
      });
      features.push(factory);
    }
  }

  return features;
}

/**
 * Проверяет, является ли регион прибрежным.
 * В реальной реализации это должно проверяться по геометрии GeoJSON.
 */
function isCoastalRegion(region: Region): boolean {
  // Временная упрощённая проверка
  // В реальности нужно проверять граничит ли регион с океаном
  return false;
}
