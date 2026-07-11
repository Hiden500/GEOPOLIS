import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { ModifierAttribute } from "@shared/defines/modifierAttributes";
import { OCCUPATION_STABILITY_PENALTY } from "@shared/defines/occupation";
import * as modifierCommands from "../../commands/modifiers";

function occupationModifierSource(regionId: number): string {
  return `occupation:region-${regionId}`;
}

/**
 * Ставит/снимает оккупацию региона (docs/plans/08_WAR_WAVE1.md, Шаг 1) —
 * единая точка, которая держит occupiedBy и стабильность-модификатор в
 * согласованном состоянии. Не команда (WarTick/WarService — внутренние
 * детерминированные вызовы, не внешний инициатор — прецедент плана 03),
 * но переиспользует commands/modifiers.ts как единственный способ трогать
 * game.modifiers.
 */
export function setRegionOccupation(game: GameState, region: Region, newController: string): void {
  const existing = game.modifiers.find(m => m.source === occupationModifierSource(region.id));
  if (existing) {
    modifierCommands.removeModifier(game, existing.id);
  }

  if (newController === region.ownerCountryId) {
    region.occupiedBy = undefined;
    return;
  }

  region.occupiedBy = newController;
  modifierCommands.applyModifier(game, {
    source: occupationModifierSource(region.id),
    target: { kind: "region", id: region.id },
    attribute: ModifierAttribute.Stability,
    op: "add",
    value: OCCUPATION_STABILITY_PENALTY,
  });
}

/**
 * Снимает оккупацию, возникшую именно в этой войне — регионы, где
 * occupiedBy и ownerCountryId лежат по разные стороны war.attackers/
 * war.defenders. Не трогает оккупацию от другой параллельной войны между
 * другими странами. Вызывается из WarService.makePeace: без Шага 2
 * (аннексия по договору, отложен) вся оккупация войны снимается миром.
 */
export function revertOccupationForWar(
  game: GameState,
  war: { attackers: string[]; defenders: string[] }
): void {
  const attackerSet = new Set(war.attackers);
  const defenderSet = new Set(war.defenders);

  for (const region of game.regions) {
    if (!region.occupiedBy) continue;

    const ownerInAttackers = attackerSet.has(region.ownerCountryId);
    const ownerInDefenders = defenderSet.has(region.ownerCountryId);
    const occupierInAttackers = attackerSet.has(region.occupiedBy);
    const occupierInDefenders = defenderSet.has(region.occupiedBy);

    const isThisWarsOccupation =
      (ownerInDefenders && occupierInAttackers) || (ownerInAttackers && occupierInDefenders);
    if (!isThisWarsOccupation) continue;

    setRegionOccupation(game, region, region.ownerCountryId);
  }
}
