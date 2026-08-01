import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type War } from "@shared/types/War";
import { MapFeatureService } from "../../services/MapFeatureService";
import { getCombinedArmsMultiplier } from "@shared/utils/technology";
import { getEquipmentPower } from "@shared/utils/equipment";
import {
  EQUIPMENT_STRENGTH_WEIGHT,
  FLIP_THRESHOLD_RATIO,
  REGION_DEFENSE_INFRASTRUCTURE_WEIGHT,
  WAR_CASUALTY_BASE_PER_FRONT_REGION,
  MAX_MONTHLY_ARMY_LOSS_SHARE,
} from "@shared/defines/war";
import { effectiveController } from "@shared/utils/regionControl";
import { setRegionOccupation } from "./occupation";

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
    ownerId: effectiveController(region),
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

    const flips: { region: Region; newController: string; toAttackers: boolean }[] = [];

    // ПЕРВЫЙ ПРОХОД — из кого состоит фронт. Решение о флипе принимается только
    // во втором проходе: локальная мощь участка считается от ДОЛИ армии, а доля
    // неизвестна, пока не сосчитан весь фронт стороны.
    interface FrontRegion {
      region: Region;
      isAttackerRegion: boolean;
      /** Соседи под контролем противника — через них на регион давят. */
      enemyNeighbors: Region[];
    }
    const front: FrontRegion[] = [];

    for (const region of game.regions) {
      // Фронт идёт по факту контроля (docs/plans/08_WAR_WAVE1.md, Шаг 1), не
      // по легальному владению — иначе после первой же оккупации граница
      // "застревает" на довоенной линии вместо боевой.
      const controller = effectiveController(region);
      const isAttackerRegion = attackerSet.has(controller);
      const isDefenderRegion = defenderSet.has(controller);
      if (!isAttackerRegion && !isDefenderRegion) continue;

      const oppositeSet = isAttackerRegion ? defenderSet : attackerSet;
      const enemyNeighbors = region.neighboringRegionIds
        .map(nid => regionById.get(nid))
        .filter((n): n is Region => !!n && oppositeSet.has(effectiveController(n)));

      if (enemyNeighbors.length === 0) continue;

      front.push({ region, isAttackerRegion, enemyNeighbors });
      ensureBattalion(mapFeatureService, game, warTag, region);
    }

    const attackerFrontCount = front.filter(f => f.isAttackerRegion).length;
    const defenderFrontCount = front.length - attackerFrontCount;

    // Доля армии, приходящаяся на один участок фронта. Широкий фронт
    // размазывает силу — это и есть цена наступления по всей границе.
    const attackerPerRegion = attackerStrength / Math.max(1, attackerFrontCount);
    const defenderPerRegion = defenderStrength / Math.max(1, defenderFrontCount);

    // ВТОРОЙ ПРОХОД — решение по каждому участку отдельно (разбор модели у
    // REGION_DEFENSE_INFRASTRUCTURE_WEIGHT в shared/src/defines/war.ts).
    for (const { region, isAttackerRegion, enemyNeighbors } of front) {
      const ownPerRegion = isAttackerRegion ? attackerPerRegion : defenderPerRegion;
      const enemyPerRegion = isAttackerRegion ? defenderPerRegion : attackerPerRegion;

      // Давление — сумма долей противника со всех сторон, откуда по региону
      // бьют: выступ, окружённый с трёх сторон, держать втрое тяжелее.
      const pressure = enemyPerRegion * enemyNeighbors.length;

      // Оборона — своя доля армии плюс вклад самого региона (снабжение и
      // укреплённость, выражены его инфраструктурой).
      const defense =
        ownPerRegion * (1 + region.infrastructure * REGION_DEFENSE_INFRASTRUCTURE_WEIGHT);

      if (pressure > defense * FLIP_THRESHOLD_RATIO) {
        // Регион переходит к тому соседу, откуда давили. Их может быть
        // несколько — берётся первый: выбор «кому именно достанется» не влияет
        // ни на одну величину модели, обе стороны воюют коалициями.
        flips.push({
          region,
          newController: effectiveController(enemyNeighbors[0]!),
          toAttackers: !isAttackerRegion,
        });
      }
    }

    // Применяем флипы отдельным проходом — не в том же цикле, что их находит,
    // чтобы решение по каждому региону этого месяца не зависело от порядка
    // обхода (иначе только что отбитый регион мог бы каскадно засчитаться
    // "своим" для соседних решений в том же тике).
    for (const flip of flips) {
      // Флип двигает только оккупацию (occupiedBy), не ownerCountryId —
      // владение меняет только мирный договор (docs/plans/08_WAR_WAVE1.md,
      // Шаг 1). setRegionOccupation сам решает: newController совпал с
      // легальным владельцем → освобождение (occupiedBy снимается).
      setRegionOccupation(game, flip.region, flip.newController);
      if (flip.toAttackers) war.territoryFlips.toAttackers += 1;
      else war.territoryFlips.toDefenders += 1;
    }

    // Потери за месяц считаются ПОСЛЕ флипов, но по силе/фронту, снятым до них
    // (attackerStrength/*FrontCount зафиксированы выше) — исход и цена месяца
    // не зависят от порядка внутри тика.
    applyWarCasualties(game, war, attackerStrength, defenderStrength, attackerFrontCount, defenderFrontCount);
  }
}

/**
 * Помесячные людские потери сторон (docs/plans/08_WAR_WAVE1.md, Шаг 3).
 * Общий урон = база × число фронтовых регионов обеих сторон; делится между
 * сторонами по доле силы ПРОТИВНИКА (слабейший теряет больше). Без контакта
 * (нет фронта) потерь нет — война без соприкосновения никого не убивает.
 */
function applyWarCasualties(
  game: GameState,
  war: War,
  attackerStrength: number,
  defenderStrength: number,
  attackerFrontCount: number,
  defenderFrontCount: number
): void {
  const totalFront = attackerFrontCount + defenderFrontCount;
  if (totalFront === 0) return;

  const totalStrength = attackerStrength + defenderStrength;
  // Своя доля потерь = доля силы противника: сильнее враг → больше своих
  // потерь. При нулевой суммарной силе (вырожденный случай) — поровну.
  const attackerShare = totalStrength > 0 ? defenderStrength / totalStrength : 0.5;
  const defenderShare = totalStrength > 0 ? attackerStrength / totalStrength : 0.5;

  const attackerCasualties = Math.round(WAR_CASUALTY_BASE_PER_FRONT_REGION * totalFront * attackerShare);
  const defenderCasualties = Math.round(WAR_CASUALTY_BASE_PER_FRONT_REGION * totalFront * defenderShare);

  distributeSideCasualties(game, war, war.attackers, attackerCasualties);
  distributeSideCasualties(game, war, war.defenders, defenderCasualties);
}

/**
 * Распределяет потери стороны по её странам (пропорционально activePersonnel;
 * при нулевой активной армии — поровну) и списывает по каждой стране в порядке
 * activePersonnel → население фронтовых регионов → manpower:
 *  - military.activePersonnel в первую очередь (кадровые потери);
 *  - переполнение сверх activePersonnel уходит в Region.population регионов,
 *    которые страна контролирует (гражданские/мобилизационные жертвы);
 *  - military.manpower уменьшается на весь урон страны (мобилизационный пул
 *    ужимается и от павших солдат, и от погибших гражданских).
 */
function distributeSideCasualties(
  game: GameState,
  war: War,
  sideIds: string[],
  sideCasualties: number
): void {
  if (sideCasualties <= 0 || sideIds.length === 0) return;

  const sideCountries = sideIds
    .map(id => game.countries.find(c => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c);
  if (sideCountries.length === 0) return;

  const sideActive = sideCountries.reduce((sum, c) => sum + c.military.activePersonnel, 0);

  for (const country of sideCountries) {
    const share = sideActive > 0
      ? country.military.activePersonnel / sideActive
      : 1 / sideCountries.length;
    const countryCasualties = Math.round(sideCasualties * share);
    if (countryCasualties <= 0) continue;

    // Убыль АРМИИ ограничена долей её состава (MAX_MONTHLY_ARMY_LOSS_SHARE):
    // базовая интенсивность задана абсолютным числом на участок фронта и при
    // широком фронте съедала любую армию за считанные месяцы, после чего война
    // сваливалась в сравнение нулей. Ограничивается именно списание с
    // `activePersonnel` — общий урон войны прежний, превышение по-прежнему
    // уходит в население и мобилизационный пул.
    const armyLossCap = Math.floor(country.military.activePersonnel * MAX_MONTHLY_ARMY_LOSS_SHARE);
    const militaryLosses = Math.min(countryCasualties, armyLossCap);
    country.military.activePersonnel -= militaryLosses;

    const civilianOverflow = countryCasualties - militaryLosses;
    if (civilianOverflow > 0) {
      deductCivilianCasualties(game, country.id, civilianOverflow);
    }

    country.military.manpower = Math.max(0, country.military.manpower - countryCasualties);

    war.casualties[country.id] = (war.casualties[country.id] ?? 0) + countryCasualties;
  }
}

/**
 * Списывает гражданские потери с населения регионов, которые страна фактически
 * контролирует (effectiveController), пропорционально их населению. Пол — 0 по
 * каждому региону (население не уходит в минус).
 */
function deductCivilianCasualties(game: GameState, countryId: string, overflow: number): void {
  const held = game.regions.filter(r => effectiveController(r) === countryId && r.population > 0);
  const totalPop = held.reduce((sum, r) => sum + r.population, 0);
  if (totalPop <= 0) return;

  for (const region of held) {
    const regionShare = region.population / totalPop;
    const loss = Math.min(region.population, Math.round(overflow * regionShare));
    region.population -= loss;
  }
}
