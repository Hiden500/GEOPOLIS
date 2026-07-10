import { type GameState } from "@shared/types/GameState";
import { resourceTick } from "./resources/ResourceTick";
import { researchTick } from "./research/ResearchTick";
import { getDomainTier } from "@shared/utils/technology";
import { economyTick } from "./economy/EconomyTick";
import { populationTick } from "./population/PopulationTick";
import { militaryTick } from "./military/MilitaryTick";
import { aggregateAllCountries } from "@shared/utils/aggregateCountryData";
import { MapFeatureService } from "../services/MapFeatureService";
import { diplomacyTick } from "./diplomacy/DiplomacyTick";
import { warTick } from "./war/WarTick";
import { aiBehaviorTick } from "./ai/AiBehaviorTick";
import { tierTick } from "./tier/TierTick";
import { politicsTick } from "./politics/PoliticsTick";
import { tradeTick } from "./trade/TradeTick";
import { chronicleTick } from "./chronicle/ChronicleTick";

export function simulateMonth(
    game: GameState
): void {
    for (const country of game.countries) {

        economyTick(country, game.regions);

        resourceTick(country, game.regions);

        // Торговля v1 (независимый гейм-дизайн разбор, 2026-07-06) — после
        // resourceTick, чтобы продавать излишек этого месяца. Перезаписывает
        // economy.exportIncome; из-за порядка цикла эффект на бюджет виден
        // начиная со следующего economyTick, не в этом же месяце — тот же
        // лаг в один тик, что у годового пересчёта tier.
        tradeTick(game, country);

        // Снимок тиров до исследовательского тика — обнаружение пересечения
        // порога (независимый гейм-дизайн разбор, 2026-07-06) для
        // pendingWorldFacts. Реализует принцип из docs/DECISIONS.md
        // ("движок детектирует... даёт LLM факт"), который до этого был
        // только текстовым правилом в промте, не кодом.
        const tiersBeforeResearch = Object.fromEntries(
            Object.entries(country.technology.domains).map(
                ([domain, progress]) => [domain, getDomainTier(progress)]
            )
        );

        researchTick(country, game.regions);

        for (const [domain, tierBefore] of Object.entries(tiersBeforeResearch)) {
            const tierAfter = getDomainTier(country.technology.domains[domain] ?? 0);
            if (tierAfter > tierBefore) {
                game.pendingWorldFacts.push({
                    countryId: country.id,
                    text: `${country.name} technology reached tier ${tierAfter} in ${domain}`,
                });
            }
        }

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

    // Фронт активных войн (docs/WAR.md, Phase 1) — до aiBehaviorTick, чтобы
    // новые войны от ИИ-порога стартовали с чистого состояния фронта.
    warTick(game);

    // Детерминированное поведение ИИ-стран (аустерити + ответ на угрозу + порог войны).
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

    // Раз в год (январь) пересчитываем тиры по актуальным данным и
    // склеиваем летопись завершившегося года (docs/plans/02_LLM_CONTRACT.md,
    // Шаг 3) — порядок между ними не важен, независимые домены.
    if (nextMonth === 1) {
        tierTick(game.countries);
        chronicleTick(game);
    }
}