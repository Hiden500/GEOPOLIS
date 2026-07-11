import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type War } from "@shared/types/War";
import { MapFeatureService } from "../../services/MapFeatureService";
import { getCombinedArmsMultiplier } from "@shared/utils/technology";
import { getEquipmentPower } from "@shared/utils/equipment";
import { EQUIPMENT_STRENGTH_WEIGHT, FLIP_THRESHOLD_RATIO } from "@shared/defines/war";

/**
 * Эффективная сила стороны в точке контакта — Phase 1 плейсхолдер:
 * `activePersonnel` (единственное реально растущее военное число сейчас,
 * см. MilitaryTick.ts — `armyStrength`/`navyStrength`/`airStrength` остаются
 * статичными нулями во всех сгенерированных странах, негодны как прокси),
 * умноженный на combined-arms бонус страны (2026-07-06, широта вложений в
 * военные домены — shared/src/utils/technology.ts), плюс вклад произведённой
 * техники по категориям (War Phase 2, 2026-07-06 —
 * shared/src/utils/equipment.ts, взвешено EQUIPMENT_STRENGTH_WEIGHT).
 */
function sideStrength(game: GameState, countryIds: string[]): number {
  return countryIds.reduce((sum, id) => {
    const country = game.countries.find(c => c.id === id);
    if (!country) return sum;
    return sum
      + country.military.activePersonnel * getCombinedArmsMultiplier(country)
      + getEquipmentPower(country) * EQUIPMENT_STRENGTH_WEIGHT;
  }, 0);
}

function ensureBattalion(
  mapFeatureService: MapFeatureService,
  game: GameState,
  warTag: string,
  region: Region
): void {
  const alreadyPlaced = game.mapFeatures.some(
    f => f.type === "battalion" && f.regionId === region.id && f.tags.includes(warTag)
  );
  if (alreadyPlaced) return;

  mapFeatureService.createMapFeature({
    type: "battalion",
    regionId: region.id,
    ownerId: region.ownerCountryId,
    tags: ["military", "battalion", warTag],
    visibleAtZoom: 4,
  });
}

/**
 * Фронт по контактным границам регионов (docs/WAR.md, Phase 1). Глобальный
 * тик (не по-страновой, война затрагивает несколько стран разом) —
 * вызывается один раз за месяц из SimulationEngine.ts после по-страновой
 * петли (нужны свежие military-числа) и до aiBehaviorTick.
 *
 * Явный пробел Phase 1: контакт ищется только через `neighboringRegionIds`
 * (сухопутное соседство) — войны против заморских/островных целей без общей
 * границы не находят точки контакта вообще (см. план, "морские десанты").
 */
export function warTick(game: GameState): void {
  const regionById = new Map<number, Region>(game.regions.map(r => [r.id, r]));
  const mapFeatureService = new MapFeatureService(game);

  for (const war of game.wars) {
    if (!war.active) continue;

    const attackerSet = new Set(war.attackers);
    const defenderSet = new Set(war.defenders);
    const attackerStrength = sideStrength(game, war.attackers);
    const defenderStrength = sideStrength(game, war.defenders);
    const warTag = `war:${war.id}`;

    const flips: { region: Region; newOwnerId: string; toAttackers: boolean }[] = [];

    for (const region of game.regions) {
      const isAttackerRegion = attackerSet.has(region.ownerCountryId);
      const isDefenderRegion = defenderSet.has(region.ownerCountryId);
      if (!isAttackerRegion && !isDefenderRegion) continue;

      const oppositeSet = isAttackerRegion ? defenderSet : attackerSet;
      const contactingNeighbor = region.neighboringRegionIds
        .map(nid => regionById.get(nid))
        .find((n): n is Region => !!n && oppositeSet.has(n.ownerCountryId));

      if (!contactingNeighbor) continue;

      ensureBattalion(mapFeatureService, game, warTag, region);

      const ownerSideStrength = isAttackerRegion ? attackerStrength : defenderStrength;
      const opposingSideStrength = isAttackerRegion ? defenderStrength : attackerStrength;

      if (opposingSideStrength > ownerSideStrength * FLIP_THRESHOLD_RATIO) {
        flips.push({
          region,
          newOwnerId: contactingNeighbor.ownerCountryId,
          toAttackers: !isAttackerRegion,
        });
      }
    }

    // Применяем флипы отдельным проходом — не в том же цикле, что их находит,
    // чтобы решение по каждому региону этого месяца не зависело от порядка
    // обхода (иначе только что отбитый регион мог бы каскадно засчитаться
    // "своим" для соседних решений в том же тике).
    for (const flip of flips) {
      flip.region.ownerCountryId = flip.newOwnerId;
      if (flip.toAttackers) war.territoryFlips.toAttackers += 1;
      else war.territoryFlips.toDefenders += 1;
    }
  }
}
