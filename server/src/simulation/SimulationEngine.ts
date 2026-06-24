import { type GameState } from "@shared/types/GameState";
import { resourceTick } from "./resources/ResourceTick";
import { researchTick } from "./research/ResearchTick";
import { economyTick } from "./economy/EconomyTick";
import { populationTick } from "./population/PopulationTick";
import { militaryTick } from "./military/MilitaryTick";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";
import { MapFeatureService } from "../services/MapFeatureService";
import { diplomacyTick } from "./diplomacy/DiplomacyTick";
import { aiBehaviorTick } from "./ai/AiBehaviorTick";

export function simulateMonth(
    game: GameState
): void {
    for (const country of game.countries) {

        economyTick(country, game.regions);

        resourceTick(country, game.regions, game.regionIndex);

        researchTick(country, game.regions);

        populationTick(country, game.regions);

        militaryTick(country, game.regions);
    }

    // Агрегируем данные от регионов к странам после всех тиков
    updateAllRegionsAndAggregate(game.countries, game.regions);

    // Дипломатические изменения
    diplomacyTick(game.countries);

    // Детерминированное поведение ИИ-стран (аустерити + ответ на угрозу).
    // После диплом. тика: реагирует на актуальные отношения/влияние/силу.
    aiBehaviorTick(game);

    // Очищаем истёкшие Map Features
    const mapFeatureService = new MapFeatureService(game);
    mapFeatureService.removeExpiredFeatures();
}