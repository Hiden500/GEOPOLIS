import { type Country } from "@shared/types/Country";
import { DiplomacyService } from "../../services/DiplomacyService";
import {
  RELATION_DECAY_RATE,
  RELATION_DECAY_CAP,
  INFLUENCE_DECAY_RATE,
  INFLUENCE_DECAY_CAP,
  RIVAL_RELATION_THRESHOLD,
  ALLY_RELATION_THRESHOLD,
  RIVAL_RECONCILE_THRESHOLD,
  ALLY_BREAK_THRESHOLD,
  SPHERE_INFLUENCE_ENTER_THRESHOLD,
  SPHERE_INFLUENCE_EXIT_THRESHOLD,
} from "@shared/defines/diplomacy";

/**
 * DiplomacyTick - симуляция дипломатических изменений.
 * Отношения постепенно меняются на основе действий, идеологии и геополитики.
 * Баланс-константы — shared/src/defines/diplomacy.ts.
 */
export function diplomacyTick(
  countries: Country[]
): void {
  const diplomacyService = new DiplomacyService();

  for (const country of countries) {
    // Естественное затухание отношений (медленное движение к нейтральности)
    for (const [targetId, relation] of Object.entries(country.diplomacy.relations)) {
      if (relation > 0) {
        const decay = Math.min(RELATION_DECAY_CAP, relation * RELATION_DECAY_RATE);
        country.diplomacy.relations[targetId] = relation - decay;
      } else if (relation < 0) {
        const decay = Math.min(RELATION_DECAY_CAP, Math.abs(relation) * RELATION_DECAY_RATE);
        country.diplomacy.relations[targetId] = relation + decay;
      }
    }

    // Естественное затухание влияния
    for (const [targetId, influence] of Object.entries(country.diplomacy.influence)) {
      if (influence > 0) {
        const decay = Math.min(INFLUENCE_DECAY_CAP, influence * INFLUENCE_DECAY_RATE);
        country.diplomacy.influence[targetId] = Math.max(0, influence - decay);
      }
    }

    // Автоматические дипломатические действия на основе отношений
    for (const [targetId, relation] of Object.entries(country.diplomacy.relations)) {
      const targetCountry = countries.find(c => c.id === targetId);
      if (!targetCountry) continue;

      // Если отношения очень плохие, добавляем в соперники
      if (relation < RIVAL_RELATION_THRESHOLD && !country.diplomacy.rivals.includes(targetId)) {
        diplomacyService.addRival(countries, country.id, targetId);
      }

      // Если отношения очень хорошие, добавляем в союзники.
      // Союз — двусторонний договор: требуем, чтобы порог был пройден в обе
      // стороны, иначе одна страна может "зачислить" в союзники того, кто к
      // ней безразличен (relation = 0 по умолчанию) — это создавало
      // одностороннюю запись, которую removeAlly немедленно отменял на шаге
      // обработки второй страны в том же тике (см. docs/DECISIONS.md).
      if (relation > ALLY_RELATION_THRESHOLD && !country.diplomacy.allies.includes(targetId)) {
        const reciprocalRelation = targetCountry.diplomacy.relations[country.id] || 0;
        if (reciprocalRelation > ALLY_RELATION_THRESHOLD && areIdeologicallyCompatible(country, targetCountry)) {
          diplomacyService.addAlly(countries, country.id, targetId);
        }
      }

      // Если отношения улучшились, удаляем из соперников
      if (relation > RIVAL_RECONCILE_THRESHOLD && country.diplomacy.rivals.includes(targetId)) {
        diplomacyService.removeRival(countries, country.id, targetId);
      }

      // Если отношения ухудшились, удаляем из союзников
      if (relation < ALLY_BREAK_THRESHOLD && country.diplomacy.allies.includes(targetId)) {
        diplomacyService.removeAlly(countries, country.id, targetId);
      }
    }

    // Обновляем сферу влияния на основе текущего влияния
    for (const [targetId, influence] of Object.entries(country.diplomacy.influence)) {
      if (influence > SPHERE_INFLUENCE_ENTER_THRESHOLD && !country.diplomacy.sphereOfInfluence.includes(targetId)) {
        diplomacyService.addToSphereOfInfluence(countries, country.id, targetId);
      } else if (influence < SPHERE_INFLUENCE_EXIT_THRESHOLD && country.diplomacy.sphereOfInfluence.includes(targetId)) {
        diplomacyService.removeFromSphereOfInfluence(countries, country.id, targetId);
      }
    }
  }
}

/**
 * Проверяет идеологическую совместимость стран.
 */
function areIdeologicallyCompatible(country1: Country, country2: Country): boolean {
  const ideology1 = country1.politics.ideology?.toLowerCase() || '';
  const ideology2 = country2.politics.ideology?.toLowerCase() || '';

  // Совместимые идеологии
  const compatiblePairs = [
    ['democracy', 'democracy'],
    ['democracy', 'republic'],
    ['communism', 'communism'],
    ['socialism', 'socialism'],
    ['fascism', 'fascism'],
    ['monarchy', 'monarchy'],
  ];

  for (const [pair1, pair2] of compatiblePairs) {
    if (pair1 && pair2) {
      if (
        (ideology1.includes(pair1) && ideology2.includes(pair2)) ||
        (ideology1.includes(pair2) && ideology2.includes(pair1))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Рассчитывает влияние на основе торговли, географии и военной силы.
 */
export function calculateBaseInfluence(
  source: Country,
  target: Country
): number {
  let influence = 0;

  // Влияние на основе военной силы
  const militaryRatio = source.military.manpower / (target.military.manpower + 1);
  influence += militaryRatio * 10;

  // Влияние на основе экономической мощи
  const gdpRatio = source.economy.gdp / (target.economy.gdp + 1);
  influence += gdpRatio * 10;

  // Влияние на основе географической близости (упрощённо)
  // В реальности нужно проверять соседние регионы
  influence += 5;

  return Math.min(100, influence);
}
