import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { DiplomacyService } from "../../services/DiplomacyService";
import { ideologyDistance, resolveIdeologyCoordinates } from "@shared/utils/discontent";
import {
  INFLUENCE_DECAY_RATE,
  INFLUENCE_DECAY_CAP,
  INFLUENCE_SCALE_MAX,
  RELATION_MATERIALIZE_MIN,
  RIVAL_RELATION_THRESHOLD,
  RIVAL_RECONCILE_THRESHOLD,
  SPHERE_INFLUENCE_ENTER_THRESHOLD,
  SPHERE_INFLUENCE_EXIT_THRESHOLD,
  MILITARY_RATIO_INFLUENCE_WEIGHT,
  GDP_RATIO_INFLUENCE_WEIGHT,
  GEOGRAPHIC_PROXIMITY_INFLUENCE_BONUS,
  COMMON_ENEMY_WAR_PRESSURE,
  COMMON_ENEMY_RIVAL_PRESSURE,
  DEPENDENCY_PUPPET_STRENGTH,
  DEPENDENCY_GUARANTEE_STRENGTH,
  DEPENDENCY_SPHERE_STRENGTH,
} from "@shared/defines/diplomacy";
import {
  type PairStanding,
  structuralAffinity,
  allianceThreshold,
  allianceBreakThreshold,
  driftedRelation,
} from "./affinity";

/**
 * DiplomacyTick — симуляция дипломатических изменений.
 * Баланс-константы — shared/src/defines/diplomacy.ts, арифметика — ./affinity.ts.
 *
 * ЧТО ИЗМЕНИЛОСЬ 2026-07-28. Раньше тик делал две вещи: тянул существующие
 * отношения к нулю и на пороге 70 проверял `areIdeologicallyCompatible` —
 * булев гейт по подстрокам текстового ярлыка идеологии. Гейта больше нет:
 * идеология вошла в ЦЕЛЬ дрейфа и в ПОРОГ согласия на союз, наравне с общим
 * врагом, соседством и зависимостью (`docs/DECISIONS.md`, 2026-07-27).
 *
 * ОТКУДА БЕРУТСЯ ОТНОШЕНИЯ У ПАР, КОТОРЫХ НЕТ В СОСТОЯНИИ. Прежний тик обходил
 * только существующие записи `relations`, а в сценарии 1946 они пусты у всех
 * 157 стран — дрейфовать было нечему. Полную матрицу (12 246 пар) заводить
 * нельзя: сейв. Поэтому пара становится КАНДИДАТОМ, когда у неё есть канал —
 * общая граница, зависимость/формальная связь, влияние, участие в войне (своей
 * или против общего врага) — либо когда запись уже есть, то есть кто-то по паре
 * действовал. На старте 1946 это 344 пары из 12 246.
 *
 * Пропуск остальных — не приближение. У пары без канала и без записи тяготение
 * не превышает по модулю `IDEOLOGY_AFFINITY_SPAN/2 ×
 * CONTACTLESS_IDEOLOGY_SALIENCE` = 10 пунктов, то есть заведомо не достаёт ни
 * до порога союза, ни до порога соперничества. Это проверяется тестом на самих
 * константах, а не обещанием в комментарии.
 *
 * ОБЩИЕ СОПЕРНИКИ НЕ ДЕЛАЮТ ПАРУ КАНДИДАТОМ — они лишь усиливают давление у
 * пары, у которой канал уже есть. Иначе полсотни стран, назначивших соперником
 * одну сверхдержаву, дали бы полную матрицу через чёрный ход.
 */
export function diplomacyTick(game: GameState): void {
  const diplomacyService = new DiplomacyService();
  const countries = game.countries;
  const byId = new Map(countries.map(c => [c.id, c]));
  const standings = collectPairStandings(game, byId);

  driftRelations(byId, standings);

  for (const country of countries) {
    // Естественное затухание влияния
    for (const [targetId, influence] of Object.entries(country.diplomacy.influence)) {
      if (influence > 0) {
        const decay = Math.min(INFLUENCE_DECAY_CAP, influence * INFLUENCE_DECAY_RATE);
        country.diplomacy.influence[targetId] = Math.max(0, influence - decay);
      }
    }

    // Автоматические дипломатические действия на основе отношений
    for (const [targetId, relation] of Object.entries(country.diplomacy.relations)) {
      const targetCountry = byId.get(targetId);
      if (!targetCountry) continue;

      const standing =
        standings.get(pairKey(country.id, targetId)) ?? contactlessStanding(country, targetCountry);

      // Если отношения очень плохие, добавляем в соперники
      if (relation < RIVAL_RELATION_THRESHOLD && !country.diplomacy.rivals.includes(targetId)) {
        diplomacyService.addRival(countries, country.id, targetId);
      }

      // Союз — двусторонний договор: требуем, чтобы порог был пройден в обе
      // стороны, иначе одна страна может "зачислить" в союзники того, кто к
      // ней безразличен (relation = 0 по умолчанию) — это создавало
      // одностороннюю запись, которую removeAlly немедленно отменял на шаге
      // обработки второй страны в том же тике (см. docs/DECISIONS.md).
      //
      // Порог теперь СВОЙ У КАЖДОЙ ПАРЫ: родственные идеологически
      // договариваются раньше, антиподы позже, общий враг опускает планку обеим
      // (`allianceThreshold`). Запрета нет ни для какой пары — порог по
      // построению не достаёт до края шкалы.
      const formation = allianceThreshold(standing.ideologyDistance, standing.commonEnemyPressure);
      if (relation > formation && !country.diplomacy.allies.includes(targetId)) {
        const reciprocalRelation = targetCountry.diplomacy.relations[country.id] || 0;
        if (reciprocalRelation > formation) {
          diplomacyService.addAlly(countries, country.id, targetId);
        }
      }

      // Если отношения улучшились, удаляем из соперников
      if (relation > RIVAL_RECONCILE_THRESHOLD && country.diplomacy.rivals.includes(targetId)) {
        diplomacyService.removeRival(countries, country.id, targetId);
      }

      // Если отношения ухудшились, удаляем из союзников. Порог распада тоже
      // парный и шире по дистанции, чем порог согласия: антиподам труднее
      // сойтись и легче разойтись.
      if (
        relation < allianceBreakThreshold(standing.ideologyDistance) &&
        country.diplomacy.allies.includes(targetId)
      ) {
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

// --------------------------------------------------------------------------
// Кандидатные пары и их положение
// --------------------------------------------------------------------------

/** Ключ неупорядоченной пары. Идентификаторы стран — латиница без разделителя. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Пары, у которых есть общая сухопутная граница.
 *
 * Считается ОДНИМ проходом по регионам на весь тик, а не запросом на пару.
 * Поштучный `sharesLandBorder` (`server/src/primitives/PrimitiveEngine.ts`)
 * сам оговаривает, что его цена «была бы недопустима в тике»: там проход по
 * миру приходится на один примитив за месяц, здесь пришёлся бы на каждую пару.
 *
 * По ЛЕГАЛЬНОМУ владению, как и там: оккупация — временное положение фронта, а
 * «соседи ли эти двое» — свойство устойчивое.
 */
function borderingPairs(game: GameState): Set<string> {
  const ownerOf = new Map(game.regions.map(r => [r.id, r.ownerCountryId]));
  const pairs = new Set<string>();
  for (const region of game.regions) {
    const owner = region.ownerCountryId;
    if (!owner) continue;
    for (const neighbourId of region.neighboringRegionIds) {
      const neighbourOwner = ownerOf.get(neighbourId);
      if (!neighbourOwner || neighbourOwner === owner) continue;
      pairs.add(pairKey(owner, neighbourOwner));
    }
  }
  return pairs;
}

/**
 * Кто с кем воюет: для каждой страны — множество тех, кто воюет ПРОТИВ неё.
 *
 * Из него выводятся оба военных признака пары: «воюют друг с другом» (один
 * состоит во множестве другого) и «воюют против одного третьего» (пересечение
 * непусто). Второе шире со-воюющих в одной войне и покрывает случай, когда две
 * страны бьют общего врага в РАЗНЫХ войнах, — а именно так выглядит
 * складывающаяся коалиция до того, как она оформлена.
 */
function foesOf(game: GameState): Map<string, Set<string>> {
  const foes = new Map<string, Set<string>>();
  const link = (victim: string, enemy: string): void => {
    const set = foes.get(victim) ?? new Set<string>();
    set.add(enemy);
    foes.set(victim, set);
  };
  for (const war of game.wars) {
    if (!war.active) continue;
    for (const attacker of war.attackers) {
      for (const defender of war.defenders) {
        link(attacker, defender);
        link(defender, attacker);
      }
    }
  }
  return foes;
}

/** Формальная зависимость пары — максимум по видам связи в ОБЕ стороны. */
function dependencyStrength(a: Country, b: Country): number {
  const oneWay = (from: Country, toId: string): number =>
    Math.max(
      from.diplomacy.puppets.includes(toId) ? DEPENDENCY_PUPPET_STRENGTH : 0,
      from.diplomacy.guarantees.includes(toId) ? DEPENDENCY_GUARANTEE_STRENGTH : 0,
      from.diplomacy.sphereOfInfluence.includes(toId) ? DEPENDENCY_SPHERE_STRENGTH : 0,
      clamp01((from.diplomacy.influence[toId] ?? 0) / INFLUENCE_SCALE_MAX)
    );
  return Math.max(oneWay(a, b.id), oneWay(b, a.id));
}

/** Сколько общих соперников записано у пары (соперничество одностороннее). */
function sharedRivalCount(a: Country, b: Country): number {
  const other = new Set(b.diplomacy.rivals);
  return a.diplomacy.rivals.filter(id => other.has(id)).length;
}

/** Положение пары без единого канала связи — для записей, оставшихся вне кандидатов. */
function contactlessStanding(a: Country, b: Country): PairStanding {
  return {
    ideologyDistance: distanceBetween(a, b),
    contact: 0,
    dependency: 0,
    commonEnemyPressure: 0,
    atWarWithEachOther: false,
  };
}

function distanceBetween(a: Country, b: Country): number {
  return ideologyDistance(
    resolveIdeologyCoordinates(a.politics),
    resolveIdeologyCoordinates(b.politics)
  );
}

/**
 * Кандидатные пары со всем, что нужно формулам. Собирается один раз на тик.
 */
function collectPairStandings(
  game: GameState,
  byId: Map<string, Country>
): Map<string, PairStanding> {
  const borders = borderingPairs(game);
  const foes = foesOf(game);

  const candidates = new Set<string>(borders);
  const consider = (a: string, b: string): void => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    candidates.add(pairKey(a, b));
  };

  for (const country of game.countries) {
    const d = country.diplomacy;
    for (const targetId of Object.keys(d.relations)) consider(country.id, targetId);
    for (const targetId of Object.keys(d.influence)) consider(country.id, targetId);
    for (const targetId of [...d.allies, ...d.puppets, ...d.sphereOfInfluence, ...d.guarantees]) {
      consider(country.id, targetId);
    }
  }

  // Война: и противники, и все, кто бьёт одного и того же третьего. Набор
  // ограничен участниками войн, поэтому квадрат здесь не становится квадратом
  // по числу стран мира.
  for (const [victim, enemies] of foes) {
    const list = [...enemies];
    for (const enemy of list) consider(victim, enemy);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) consider(list[i]!, list[j]!);
    }
  }

  const standings = new Map<string, PairStanding>();
  for (const key of candidates) {
    const [aId, bId] = key.split("|") as [string, string];
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const atWarWithEachOther = foes.get(aId)?.has(bId) ?? false;
    const aFoes = foes.get(aId);
    const bFoes = foes.get(bId);
    const sharesOpponent =
      aFoes !== undefined && bFoes !== undefined && [...aFoes].some(id => bFoes.has(id));

    const dependency = dependencyStrength(a, b);
    const commonEnemyPressure = clamp01(
      (sharesOpponent ? COMMON_ENEMY_WAR_PRESSURE : 0) +
        COMMON_ENEMY_RIVAL_PRESSURE * sharedRivalCount(a, b)
    );
    const contact = Math.max(
      borders.has(key) ? 1 : 0,
      dependency,
      atWarWithEachOther ? 1 : 0,
      sharesOpponent ? 1 : 0,
      a.diplomacy.allies.includes(bId) ? 1 : 0
    );

    standings.set(key, {
      ideologyDistance: distanceBetween(a, b),
      contact,
      dependency,
      commonEnemyPressure,
      atWarWithEachOther,
    });
  }
  return standings;
}

/**
 * Дрейф отношений к структурному тяготению пары.
 *
 * Обе стороны тянутся к ОДНОЙ цели (тяготение симметрично), но каждая со
 * своего значения — асимметрию, накопленную делами, дрейф не стирает разом.
 */
function driftRelations(
  byId: Map<string, Country>,
  standings: Map<string, PairStanding>
): void {
  for (const [key, standing] of standings) {
    const [aId, bId] = key.split("|") as [string, string];
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const target = structuralAffinity(standing);
    driftOneSide(a, bId, target);
    driftOneSide(b, aId, target);
  }
}

/**
 * Один направленный дрейф с материализацией/уборкой записи.
 *
 * Запись не заводится и удаляется, когда И текущее значение, И цель ничтожны:
 * иначе каждая пара с общей границей и близкой к нулю целью навсегда поселилась
 * бы в сейве числом вида 0.0007.
 */
function driftOneSide(country: Country, otherId: string, target: number): void {
  const stored = country.diplomacy.relations[otherId];
  const next = driftedRelation(stored ?? 0, target);

  if (Math.abs(next) < RELATION_MATERIALIZE_MIN && Math.abs(target) < RELATION_MATERIALIZE_MIN) {
    if (stored !== undefined) delete country.diplomacy.relations[otherId];
    return;
  }
  country.diplomacy.relations[otherId] = next;
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
  influence += militaryRatio * MILITARY_RATIO_INFLUENCE_WEIGHT;

  // Влияние на основе экономической мощи
  const gdpRatio = source.economy.gdp / (target.economy.gdp + 1);
  influence += gdpRatio * GDP_RATIO_INFLUENCE_WEIGHT;

  // Влияние на основе географической близости (упрощённо)
  // В реальности нужно проверять соседние регионы
  influence += GEOGRAPHIC_PROXIMITY_INFLUENCE_BONUS;

  return Math.min(INFLUENCE_SCALE_MAX, influence);
}
