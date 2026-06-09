import { type GameState } from "@shared/types/GameState";
import { resourceTick } from "./resources/ResourceTick";
import { researchTick } from "./research/ResearchTick";
import { economyTick } from "./economy/EconomyTick";
import { populationTick } from "./population/PopulationTick";
import { militaryTick } from "./military/MilitaryTick";

export function simulateMonth(
    game: GameState
): void {
    for (const country of game.countries) {

        economyTick(country);

        resourceTick(country, game.regions);

        researchTick(country);

        populationTick(country);

        militaryTick(country);
    }
}