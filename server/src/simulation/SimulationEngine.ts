import { type GameState } from "@shared/types/GameState";
import { resourceTick } from "./resources/ResourceTick";
import { researchTick } from "./research/ResearchTick";
import { getDomainTier } from "@shared/utils/technology";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
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
import { discontentTick } from "./politics/DiscontentTick";
import { tradeTick } from "./trade/TradeTick";
import { chronicleTick } from "./chronicle/ChronicleTick";
import { removeExpiredModifiers } from "../commands/modifiers";
import { objectiveTick } from "./ObjectiveTick";
import { STABILITY_HIGH_INFLATION_THRESHOLD, POLITICAL_CRISIS_STABILITY_THRESHOLD } from "@shared/defines/politics";
import { DEBT_CRISIS_GDP_THRESHOLD } from "@shared/defines/economy";

export function simulateMonth(
    game: GameState
): void {
    for (const country of game.countries) {

        // Снимок до economyTick/politicsTick — обнаружение пересечения порога
        // в кризисную зону (экономический кризис/переворот, независимый
        // гейм-дизайн разбор, 2026-07-06) — тот же паттерн pendingWorldFacts,
        // что пересечение тира технологий ниже. Однонаправленно (только вход
        // в кризис, не выход) — как и тир, который тоже не понижается.
        const inflationBefore = country.economy.inflation;
        const stabilityBefore = country.politics.stability;
        const debtBurdenBefore = country.economy.gdp > 0
            ? country.economy.debt / country.economy.gdp
            : 0;

        economyTick(country, game.regions);

        resourceTick(country, game.regions, game.modifiers);

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
                    kind: "technology_tier",
                    text: `${getText(country.name, LLM_LOCALE)} technology reached tier ${tierAfter} in ${domain}`,
                });
            }
        }

        populationTick(country, game.regions);

        militaryTick(country, game.regions);

        politicsTick(country);

        // Экономический кризис: inflation впервые пересекает уже
        // существующий порог "высокой инфляции" (STABILITY_HIGH_INFLATION_THRESHOLD,
        // тот же, что использует stabilityEquilibrium для штрафа — не дублирует
        // новым числом уже установленный смысл "плохо").
        if (
            inflationBefore <= STABILITY_HIGH_INFLATION_THRESHOLD &&
            country.economy.inflation > STABILITY_HIGH_INFLATION_THRESHOLD
        ) {
            game.pendingWorldFacts.push({
                countryId: country.id,
                kind: "economic_crisis",
                text: `${getText(country.name, LLM_LOCALE)} inflation surged past crisis levels (${country.economy.inflation.toFixed(1)})`,
            });
        }

        // Политический кризис/переворот: stability впервые проваливается ниже
        // кризисного порога (строже рутинного "низкого" STABILITY_LOW=40 из
        // ai.ts, который уже управляет routine welfare-нуджем — кризис-факт
        // не должен спамить с той же частотой).
        if (
            stabilityBefore >= POLITICAL_CRISIS_STABILITY_THRESHOLD &&
            country.politics.stability < POLITICAL_CRISIS_STABILITY_THRESHOLD
        ) {
            game.pendingWorldFacts.push({
                countryId: country.id,
                kind: "political_crisis",
                text: `${getText(country.name, LLM_LOCALE)} stability collapsed to crisis levels (${country.politics.stability.toFixed(1)}) — unrest, possible upheaval`,
            });
        }

        // Долговой кризис: долг/ВВП впервые пересекает порог "на грани дефолта"
        // (тот же паттерн pendingWorldFacts, что инфляция/стабильность выше).
        // Сам дефолт — нарратив/действие LLM (план 02, шаг 4), движок только
        // даёт факт. ВВП в этом тике ещё довоенный (агрегация ниже), сравнение
        // до/после по одному ВВП — ловит скачок долга, не шум роста.
        const debtBurdenAfter = country.economy.gdp > 0
            ? country.economy.debt / country.economy.gdp
            : 0;
        if (
            debtBurdenBefore <= DEBT_CRISIS_GDP_THRESHOLD &&
            debtBurdenAfter > DEBT_CRISIS_GDP_THRESHOLD
        ) {
            game.pendingWorldFacts.push({
                countryId: country.id,
                kind: "debt_crisis",
                text: `${getText(country.name, LLM_LOCALE)} is on the brink of default (debt ${(debtBurdenAfter * 100).toFixed(0)}% of GDP)`,
            });
        }
    }

    // Агрегируем данные от регионов к странам после всех тиков. НЕ пересчитывает
    // region.gdp — иначе стирался бы рост, который EconomyTick только что
    // применил (см. shared/src/utils/aggregateCountryData.ts).
    aggregateAllCountries(game.countries, game.regions);

    // Недовольство регионов (docs/CONCEPT.md §4.1/§4.2) — после агрегации:
    // относительное благосостояние региона считается против ВВП на душу его
    // страны, а тот становится актуальным только здесь. Само недовольство не
    // хранится; тик гасит память воздействий и ловит пересечение кризисного
    // порога.
    discontentTick(game);

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

    // Очищаем истёкшие модификаторы (docs/plans/03_MODIFIERS_COMMANDS.md,
    // Шаг 2) — сравнение с game.currentDate, не wall-clock.
    removeExpiredModifiers(game);

    // Целевой слой (docs/OBJECTIVES.md): позиция игрока в рейтинге силы + оценка
    // самопоставленных целей — после боевых тиков, по состоянию на конец месяца.
    objectiveTick(game);

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