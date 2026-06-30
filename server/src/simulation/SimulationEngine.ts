import { type GameState } from "@shared/types/GameState";
import { resourceTick } from "./resources/ResourceTick";
import { researchTick } from "./research/ResearchTick";
import { economyTick } from "./economy/EconomyTick";
import { populationTick } from "./population/PopulationTick";
import { militaryTick } from "./military/MilitaryTick";
import { aggregateAllCountries } from "@shared/utils/aggregateCountryData";
import { MapFeatureService } from "../services/MapFeatureService";
import { diplomacyTick } from "./diplomacy/DiplomacyTick";
import { aiBehaviorTick } from "./ai/AiBehaviorTick";
import { tierTick } from "./tier/TierTick";
import { politicsTick } from "./politics/PoliticsTick";

export function simulateMonth(
    game: GameState
): void {
    for (const country of game.countries) {

        economyTick(country, game.regions);

        resourceTick(country, game.regions, game.regionIndex);

        researchTick(country, game.regions);

        populationTick(country, game.regions);

        militaryTick(country, game.regions);

        politicsTick(country);
    }

    // Агрегируем данные от регионов к странам после всех тиков. НЕ пересчитывает
    // region.gdp — иначе стирался бы рост, который EconomyTick только что
    // применил (см. shared/src/utils/aggregateCountryData.ts).
    aggregateAllCountries(game.countries, game.regions);

    // Дипломатические изменения
    diplomacyTick(game.countries);

    // Детерминированное поведение ИИ-стран (аустерити + ответ на угрозу).
    // После диплом. тика: реагирует на актуальные отношения/влияние/силу.
    aiBehaviorTick(game);

    // Очищаем истёкшие Map Features
    const mapFeatureService = new MapFeatureService(game);
    mapFeatureService.removeExpiredFeatures();

    // Продвигаем дату на один месяц
    const parts = game.currentDate.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    game.currentDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

    // Раз в год (январь) пересчитываем тиры по актуальным данным
    if (nextMonth === 1) {
        tierTick(game.countries);
    }
}