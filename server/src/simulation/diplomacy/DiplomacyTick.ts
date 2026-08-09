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
  INFLUENCE_PROXIMITY_REACH,
  INFLUENCE_MILITARY_REACH,
  INFLUENCE_ECONOMIC_REACH,
  INFLUENCE_MILITARY_FULL_RATIO,
  INFLUENCE_ECONOMIC_FULL_RATIO,
  INFLUENCE_PROJECTION_BUDGET,
  INFLUENCE_CONTACTLESS_SALIENCE,
  COMMON_ENEMY_WAR_PRESSURE,
  COMMON_ENEMY_RIVAL_PRESSURE,
  DEPENDENCY_PUPPET_STRENGTH,
  DEPENDENCY_GUARANTEE_STRENGTH,
  DEPENDENCY_SPHERE_STRENGTH,
  PRESENCE_FLOOR_COMMITMENT,
  PRESENCE_FLOOR_VASSAL,
} from "@shared/defines/diplomacy";
import {
  type PairStanding,
  structuralAffinity,
  directedAffinity,
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
 * Пропуск остальных стоит на двух разных основаниях, и с 2026-07-31 они больше
 * не одно. Для СОЮЗА основание арифметическое: тяготение пары без канала и без
 * записи не превышает по модулю `IDEOLOGY_AFFINITY_SPAN/2 ×
 * CONTACTLESS_IDEOLOGY_SALIENCE` = 10 пунктов и до порога согласия не достаёт
 * ни при каких входах — это проверяется тестом на самих константах
 * (`affinity.test.ts`), а не обещанием здесь. Для СОПЕРНИЧЕСТВА того же
 * доказательства больше нет: порог опущен в достижимый диапазон
 * (`shared/src/defines/diplomacy.ts`), и пропуск держится продуктовым правилом —
 * соперник это отношение, а не рейтинг несходства, а двое без общей границы,
 * влияния и формальных связей друг другу посторонние.
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
    // Естественное затухание влияния — до пола, который держит взятое ходом
    // обязательство (`presenceFloor`). Без пола затухание доводило любую связь
    // до ровного нуля за конечное число месяцев, и авторский слой присутствия
    // растворялся к середине партии.
    for (const [targetId, influence] of Object.entries(country.diplomacy.influence)) {
      const floor = presenceFloor(country, targetId);
      if (influence > floor) {
        const decay = Math.min(INFLUENCE_DECAY_CAP, influence * INFLUENCE_DECAY_RATE);
        country.diplomacy.influence[targetId] = Math.max(floor, influence - decay);
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
export function foesOf(game: GameState): Map<string, Set<string>> {
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

/**
 * Ниже какого присутствия обязательство источника перед целью не даёт связи
 * опуститься. Ноль, если обязательства нет.
 *
 * Источники пола — только связи, СОЗДАННЫЕ ХОДОМ: вассалитет, гарантия, союз.
 * Сферы влияния среди них нет намеренно — она выведена движком из самого
 * влияния, и пол от неё замкнул бы ярлык на собственный вход (обоснование и
 * числа — `shared/src/defines/diplomacy.ts`, блок «Пол присутствия»).
 *
 * Пол только УДЕРЖИВАЕТ: влияние ниже пола он не поднимает, потому что поднять
 * присутствие способны лишь ход и помощь. Поэтому вассал, взятый силой при
 * нулевом влиянии, присутствия не получает.
 */
function presenceFloor(source: Country, targetId: string): number {
  const d = source.diplomacy;
  if (d.puppets.includes(targetId)) return PRESENCE_FLOOR_VASSAL;
  if (d.guarantees.includes(targetId) || d.allies.includes(targetId)) {
    return PRESENCE_FLOOR_COMMITMENT;
  }
  return 0;
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

/**
 * Бьют ли эти двое одного и того же третьего — шире со-воюющих в ОДНОЙ войне
 * (см. `foesOf`).
 */
export function sharesOpponentWith(
  aId: string,
  bId: string,
  foes: Map<string, Set<string>>
): boolean {
  const aFoes = foes.get(aId);
  const bFoes = foes.get(bId);
  if (!aFoes || !bFoes) return false;
  return [...aFoes].some(id => bFoes.has(id));
}

/**
 * Давление общего врага на пару, 0..1 — вход `allianceThreshold` и
 * `structuralAffinity`.
 *
 * Экспортируется потому, что порог согласия на союз читает не только тик:
 * предпосылка `spawn_incident(border_dispute)` судит союзничество той же меркой
 * (`alliedWith`, `server/src/primitives/PrimitiveEngine.ts`). Второе определение
 * формулы там означало бы ровно ту молчаливую расходимость, ради устранения
 * которой мерка и стала общей.
 */
export function commonEnemyPressure(
  a: Country,
  b: Country,
  foes: Map<string, Set<string>>
): number {
  return clamp01(
    (sharesOpponentWith(a.id, b.id, foes) ? COMMON_ENEMY_WAR_PRESSURE : 0) +
      COMMON_ENEMY_RIVAL_PRESSURE * sharedRivalCount(a, b)
  );
}

/** Положение пары без единого канала связи — для записей, оставшихся вне кандидатов. */
function contactlessStanding(a: Country, b: Country): PairStanding {
  return {
    ideologyDistance: ideologyDistanceBetween(a, b),
    contact: 0,
    dependency: 0,
    commonEnemyPressure: 0,
    atWarWithEachOther: false,
  };
}

/** Идеологическая дистанция пары стран 0..1 — вход обоих порогов союза. */
export function ideologyDistanceBetween(a: Country, b: Country): number {
  return ideologyDistance(
    resolveIdeologyCoordinates(a.politics),
    resolveIdeologyCoordinates(b.politics)
  );
}

/**
 * Кандидатные пары со всем, что нужно формулам. Собирается один раз на тик.
 *
 * Экспортируется РАДИ ТЕСТА достижимости порогов
 * (`thresholdReach.test.ts`), и это осознанное исключение из «тест не повторяет
 * реализацию». Тот тест сравнивает пороги переходов с диапазоном их
 * ФАКТИЧЕСКОГО входа; реплика набора кандидатов измеряла бы диапазон реплики, а
 * разошедшись с тиком — молча измеряла бы не то. Именно недостижимый порог
 * (`RIVAL_RELATION_THRESHOLD` до 2026-07-31) и есть тот дефект, который
 * переживает зелёные тесты, когда вход берут из фикстуры.
 */
export function collectPairStandings(
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
    const sharesOpponent = sharesOpponentWith(aId, bId, foes);

    const dependency = dependencyStrength(a, b);
    const pressure = commonEnemyPressure(a, b, foes);
    const contact = Math.max(
      borders.has(key) ? 1 : 0,
      dependency,
      atWarWithEachOther ? 1 : 0,
      sharesOpponent ? 1 : 0,
      a.diplomacy.allies.includes(bId) ? 1 : 0
    );

    standings.set(key, {
      ideologyDistance: ideologyDistanceBetween(a, b),
      contact,
      dependency,
      commonEnemyPressure: pressure,
      atWarWithEachOther,
    });
  }
  return standings;
}

/**
 * Насколько `subject` подчинён `dominator`, 0..1 — вход обиды.
 *
 * ЭТО ТА ЖЕ ВЕЛИЧИНА, ЧТО СЧИТАЕТ `dependencyStrength`, но взятая В ОДНУ
 * СТОРОНУ, и совпадение намеренное: приязнь патрона к клиенту и тяготение
 * клиента патроном обязаны расти из одного числа, иначе связь, дающая одному
 * плюс, давала бы другому минус по своей отдельной шкале — и баланс пары
 * зависел бы от того, какую из двух шкал калибровали последней.
 *
 * ГАРАНТИИ В ПОДЧИНЕНИИ НЕТ, хотя в зависимости она есть: гарантия — это
 * защита, а не власть над внешней политикой. Тяготиться защитой не за что.
 *
 * Считается по СОСТОЯВШЕМУСЯ подчинению, а не по потолку, который держала бы
 * одна разница в силе (`calculateBaseInfluence`). Разница содержательная:
 * потолок означал бы, что слабый обижен на сильного за одну лишь его
 * СПОСОБНОСТЬ подчинить, — это страх, а не обида, и он сделал бы соперниками
 * половину мира без единого чужого хода.
 */
export function subordinationTo(dominator: Country, subjectId: string): number {
  const d = dominator.diplomacy;
  return Math.max(
    d.puppets.includes(subjectId) ? DEPENDENCY_PUPPET_STRENGTH : 0,
    d.sphereOfInfluence.includes(subjectId) ? DEPENDENCY_SPHERE_STRENGTH : 0,
    clamp01((d.influence[subjectId] ?? 0) / INFLUENCE_SCALE_MAX)
  );
}

/**
 * Дрейф отношений к тяготению пары.
 *
 * Цель у сторон РАЗНАЯ с 2026-08-08: общая часть симметрична, а обида за
 * собственное подчинение — нет (`directedAffinity`). Каждая сторона к тому же
 * идёт со своего значения — асимметрию, накопленную делами, дрейф не стирает
 * разом.
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

    driftOneSide(a, bId, directedAffinity(standing, subordinationTo(b, aId)));
    driftOneSide(b, aId, directedAffinity(standing, subordinationTo(a, bId)));
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
 * Насыщающая доля перевеса — по ПОРЯДКУ, а не по величине: ноль при отсутствии
 * перевеса, единица при `ratio = fullRatio` (край живого распределения).
 * Обоснование формы — `INFLUENCE_ECONOMIC_FULL_RATIO`.
 */
function powerPull(ratio: number, fullRatio: number): number {
  if (!(ratio > 1)) return 0;
  return clamp01(Math.log(ratio) / Math.log(fullRatio));
}

/**
 * Есть ли у источника КАНАЛ к цели — присутствие, через которое перевес силы
 * вообще способен превратиться во влияние.
 *
 * ДВОИЧНО НАМЕРЕННО, хотя виды связи разной силы. Глубина канала — это и есть
 * само влияние, и умножать потолок влияния на текущее влияние значило бы
 * завести положительную обратную связь: у кого больше, тому можно ещё больше.
 * Проект уже ловил этот дефект в `RIVAL_ENTRY_RELATION_SHIFT` («выведенный
 * ярлык, двигающий собственный вход»). Здесь канал отвечает ровно на вопрос
 * «присутствуем ли мы там», а «насколько» отвечает влияние.
 *
 * Союз — канал наравне с зависимостью: союзники держат посольства, базы и
 * общие штабы. Сухопутной границы в списке нет, и это названное упрощение:
 * `calculateBaseInfluence` считается по паре стран без доступа к регионам
 * (`AiBehaviorTick` зовёт её на каждую страну мира), а соседство стоит прохода
 * по карте. География входит только плоским `INFLUENCE_PROXIMITY_REACH`, как и
 * до правки.
 */
function hasInfluenceChannel(source: Country, target: Country): boolean {
  const d = source.diplomacy;
  return (
    (d.influence[target.id] ?? 0) > 0 ||
    d.puppets.includes(target.id) ||
    d.guarantees.includes(target.id) ||
    d.sphereOfInfluence.includes(target.id) ||
    d.allies.includes(target.id)
  );
}

/**
 * ПОТОЛОК ВЛИЯНИЯ, который держит одна лишь разница в силе, — цель, к которой
 * влияние источника на цель растёт САМО (бандвагонинг, Правило B
 * `AiBehaviorTick`), и метрика доминирования для порога угрозы.
 *
 * Числа, их происхождение и замер до правки — `shared/src/defines/diplomacy.ts`,
 * блок «calculateBaseInfluence». Здесь — четыре вещи, которые формула делает, и
 * почему именно так.
 *
 * 1. ПЕРЕВЕС ВХОДИТ НАСЫЩАЯСЬ, а не линейно со срезом на сотне. Прежняя формула
 *    отдавала ровно 100 всякому, кто сильнее цели примерно вчетверо, — то есть
 *    трём четвертям мира для сверхдержавы, и разница между «сильнее вчетверо» и
 *    «сильнее в тысячу раз» стиралась.
 *
 * 2. ПЕРЕВЕС ЗНАЧИТ ТОЛЬКО ТАМ, ГДЕ ЕСТЬ КАНАЛ (`hasInfluenceChannel`). Насыщение
 *    по паре чинит различимость, но не охват: при разбросе ВВП в шесть порядков
 *    держава дотягивается до каждого, кто беднее. Именно канал и делает так,
 *    что бандвагонинг УГЛУБЛЯЕТ присутствие, а не создаёт его из ничего.
 *
 * 3. ВНИМАНИЕ КОНЕЧНО. Потолок умножается на СВОБОДНУЮ долю бюджета внимания
 *    источника: чем больше стран он уже держит, тем меньше остаётся на
 *    следующую. Это единственный член, связывающий цели между собой, — то есть
 *    единственная защита, которую нельзя обойти, открывая каналы по одному.
 *
 *    Своя собственная связь из «занятого» вычитается намеренно: иначе цель
 *    снижала бы свой же потолок, и удержание превращалось бы в колебание.
 *
 * 4. ФОРМУЛА НЕ СНОСИТ ТО, ЧЕГО НЕ СТРОИЛА. Результат не опускается ниже уже
 *    существующего влияния. Причина в том, как значение потребляется: Правило B
 *    ТЯНЕТ влияние к нему в обе стороны, поэтому потолок ниже текущего значения
 *    означал бы снос — а сносить эту связь формуле силы нечем и не за что.
 *    Влияние на старте партии расставил автор (`influence.json`, 300 связей),
 *    остальное куплено помощью (`send_aid`) и вассалитетом; за убыль отвечает
 *    отдельный и единственный механизм — затухание `INFLUENCE_DECAY_RATE`, оно
 *    работает каждый тик и на все связи. Без этого пола первый же месяц
 *    переписывал бы авторскую разметку числом из формулы про ВВП.
 */
export function calculateBaseInfluence(
  source: Country,
  target: Country
): number {
  const militaryRatio = source.military.manpower / (target.military.manpower + 1);
  const gdpRatio = source.economy.gdp / (target.economy.gdp + 1);

  const power =
    INFLUENCE_PROXIMITY_REACH +
    INFLUENCE_MILITARY_REACH * powerPull(militaryRatio, INFLUENCE_MILITARY_FULL_RATIO) +
    INFLUENCE_ECONOMIC_REACH * powerPull(gdpRatio, INFLUENCE_ECONOMIC_FULL_RATIO);

  const salience = hasInfluenceChannel(source, target) ? 1 : INFLUENCE_CONTACTLESS_SALIENCE;

  const held = source.diplomacy.influence[target.id] ?? 0;
  let committed = -held;
  for (const value of Object.values(source.diplomacy.influence)) committed += value;
  const free = clamp01(1 - committed / INFLUENCE_PROJECTION_BUDGET);

  return Math.min(INFLUENCE_SCALE_MAX, Math.max(held, power * salience * free));
}
