import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type LocalizedText } from "@shared/types/i18n/LocalizedText";
import { type IdeologyCoordinates } from "@shared/types/politics/Ideology";
import { type PrimitiveIntensity } from "@shared/types/politics/PrimitiveIntensity";
import { createEmptyDiplomacyState } from "@shared/defines/createEmptyDiplomacyState";
import {
  IDEOLOGY_FALLBACK_COORDINATES,
  IDEOLOGY_LABEL_COORDINATES,
  PRIMITIVE_INTENSITY_POSITION,
  SPLIT_MIN_GROUP_SHARE,
  SPLIT_MIN_DISCONTENT_LOOSE,
  SPLIT_MIN_DISCONTENT_STRICT,
} from "@shared/defines/discontent";
import {
  groupDiscontent,
  regionAuthority,
  regionWelfare,
  resolveIdeologyCoordinates,
  findImpactMemory,
} from "@shared/utils/discontent";
import { aggregateCountryFromRegions } from "@shared/utils/aggregateCountryData";
import { remapCountryReferences } from "./countryRefs";
import { setDivisibleAssets } from "../commands/lifecycle";

/**
 * Жизненный цикл государств — создание, роспуск, раскол (docs/CONCEPT.md §7.1).
 *
 * ЧТО ЭТОТ МОДУЛЬ ГАРАНТИРУЕТ. Любая операция оставляет мир ЦЕЛЫМ: суммы
 * (население, казна, живая сила, число регионов) сходятся, идентификаторы
 * уникальны, висячих ссылок ноль. Первые два — арифметика этого модуля,
 * третье — свойство `countryRefs.ts`: перенос ссылок делает ОДИН объявленный
 * обход, а не перечисление мест по памяти автора.
 *
 * ЧТО ЗДЕСЬ НЕ РЕШАЕТСЯ. Кто теперь игрок и окончена ли партия — вопрос
 * КАМПАНИИ, а не мира (`campaign.ts`). Разделение намеренное: раскол страны, за
 * которую играет человек, и раскол страны на другом континенте — одна и та же
 * операция над состоянием мира, и только одна из них меняет состояние партии.
 */

// --------------------------------------------------------------------------
// Результат операции
// --------------------------------------------------------------------------

/** Один осколок: новая страна и регионы, которые она забрала. */
export interface LifecycleShard {
  countryId: string;
  /** Группа, чьё недовольство увело эти регионы. */
  groupId: string;
  regionIds: number[];
}

/**
 * `PolityLifecycleResult` из §7.1 — ЧТО операция сделала со ссылками, одной
 * структурой. Материал для квитанции и для отклика игроку; ни один потребитель
 * не пересчитывает это по состоянию заново.
 */
export interface PolityLifecycleResult {
  shards: LifecycleShard[];
  /** Страна, распустившаяся целиком (все её регионы ушли), либо `undefined`. */
  dissolvedCountryId?: string | undefined;
  /** Имя распустившейся страны — для интерфейса, когда ссылки на неё уже нет. */
  dissolvedName?: LocalizedText | undefined;
  /** Кто принял на себя ссылки распустившейся страны (правопреемник). */
  successorCountryId?: string | undefined;
  /** Столицы, переназначенные операцией (столица ушла с осколком). */
  capitalReassignments: { countryId: string; from: number; to: number }[];
  /** Войны, закрытые операцией: сторона исчезла целиком либо схлопнулась в одну. */
  closedWarIds: string[];
}

// --------------------------------------------------------------------------
// Порог отделения
// --------------------------------------------------------------------------

/**
 * Порог недовольства, начиная с которого группа-большинство уводит регион.
 *
 * Хинт двигает ПОРОГ, а не величину: у структурного глагола «величины» нет —
 * есть решение «уходит или нет» по каждому региону. Направление обратное
 * привычному (`severe` СНИЖАЕТ порог), потому что «сильнее» здесь означает «шире
 * захватывает», а не «сильнее бьёт». Коридор жёсткий: `severe` не опускает порог
 * ниже `SPLIT_MIN_DISCONTENT_LOOSE`, то есть модель не может расколоть спокойную
 * страну, назвав раскол severe.
 */
export function splitDiscontentThreshold(intensity: PrimitiveIntensity): number {
  const position = PRIMITIVE_INTENSITY_POSITION[intensity];
  return (
    SPLIT_MIN_DISCONTENT_STRICT -
    (SPLIT_MIN_DISCONTENT_STRICT - SPLIT_MIN_DISCONTENT_LOOSE) * position
  );
}

/**
 * Группа-сепаратист региона: большинство, чьё недовольство перешло порог.
 * `undefined` — регион остаётся в составе.
 *
 * Правило ОДНО (доля + недовольство самой группы), а не «общее недовольство
 * региона плюс отдельно кто его унёс»: два правила разошлись бы на первом же
 * регионе, где порог перешла смесь групп, ни одна из которых не большинство.
 */
export function separatistGroupOf(
  game: GameState,
  region: Region,
  threshold: number
): string | undefined {
  if (!region.demographics || region.demographics.length === 0) return undefined;

  const authority = regionAuthority(game, region);
  // Тот же фолбэк, что у остального вывода недовольства: центр спектра, а не
  // выдуманный уклон. Ключа "unknown" в словаре ярлыков нет вовсе — обращение к
  // нему дало бы `undefined` и падение на первом же чтении координаты.
  const coordinates = authority
    ? resolveIdeologyCoordinates(authority.politics)
    : IDEOLOGY_FALLBACK_COORDINATES;
  const welfare = regionWelfare(region, authority);

  // Детерминированный порядок: доля по убыванию, при равенстве — id по
  // возрастанию. Раскол обязан быть воспроизводим бит-в-бит.
  const candidates = [...region.demographics]
    .filter(entry => entry.share >= SPLIT_MIN_GROUP_SHARE)
    .sort((a, b) => b.share - a.share || a.groupId.localeCompare(b.groupId));

  for (const entry of candidates) {
    const definition = game.ethnicGroups.find(g => g.id === entry.groupId);
    if (!definition) continue;
    const memory = findImpactMemory(game.groupImpactMemory, region.id, entry.groupId);
    const discontent = groupDiscontent(
      coordinates,
      definition.desiredIdeology,
      welfare,
      memory
    );
    if (discontent >= threshold) return entry.groupId;
  }
  return undefined;
}

/** План раскола: какие регионы уходят и к какой группе. Пусто — раскола нет. */
export function planSplit(
  game: GameState,
  countryId: string,
  intensity: PrimitiveIntensity
): { groupId: string; regionIds: number[] }[] {
  const threshold = splitDiscontentThreshold(intensity);
  const byGroup = new Map<string, number[]>();

  for (const region of game.regions) {
    if (region.ownerCountryId !== countryId) continue;
    const groupId = separatistGroupOf(game, region, threshold);
    if (groupId === undefined) continue;
    const bucket = byGroup.get(groupId);
    if (bucket) bucket.push(region.id);
    else byGroup.set(groupId, [region.id]);
  }

  return [...byGroup.entries()]
    .map(([groupId, regionIds]) => ({ groupId, regionIds: [...regionIds].sort((a, b) => a - b) }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
}

// --------------------------------------------------------------------------
// Создание страны-осколка
// --------------------------------------------------------------------------

/**
 * Палитра цветов осколков — фиксированный список, выбор по хешу id группы.
 *
 * Детерминированно и без RNG: `Math.random` в движке запрещён правилом
 * детерминизма, а цвет обязан быть одинаковым при повторной загрузке того же
 * сейва. Совпадение цвета с существующей страной допустимо: цвет — свойство
 * отображения, а не идентичности.
 */
const SHARD_COLORS = [
  "#c94f4f", "#4f8cc9", "#4fc98c", "#c9a24f", "#9a4fc9",
  "#4fc9c2", "#c94f9a", "#7fc94f", "#c96f4f", "#4f5ac9",
] as const;

/** Множитель классического строкового хеша — не баланс, а арифметика. */
const HASH_MULTIPLIER = 31;

/** Предел перебора суффиксов при коллизии id — страховка от бесконечного цикла. */
const MAX_ID_SUFFIX_ATTEMPTS = 1000;

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * HASH_MULTIPLIER + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Свободный идентификатор для осколка — из id группы, детерминированно.
 *
 * Трёхбуквенная форма повторяет конвенцию сценария (`SUN`, `USA`). Столкновение
 * разрешается суффиксом-цифрой, а не случайностью: два прогона одного и того же
 * сейва обязаны дать один и тот же id, иначе воспроизводимость кампании
 * теряется молча.
 */
export function shardCountryId(taken: ReadonlySet<string>, groupId: string): string {
  const base = groupId.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < MAX_ID_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${base.slice(0, 3 - String(suffix).length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`No free country id derived from group ${groupId}`);
}

/** Ближайший именованный ярлык идеологии к координатам — для читаемости UI. */
function nearestIdeologyLabel(coordinates: IdeologyCoordinates): string {
  let best = "unknown";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [label, position] of Object.entries(IDEOLOGY_LABEL_COORDINATES)) {
    const distance = Math.hypot(
      position.economic - coordinates.economic,
      position.political - coordinates.political
    );
    // Строгое «меньше» плюс сортированный порядок ключей дали бы зависимость от
    // порядка объявления; сравнение с tie-break по имени делает выбор
    // независимым от него.
    if (distance < bestDistance || (distance === bestDistance && label < best)) {
      best = label;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Целочисленное деление величины по долям с ТОЧНЫМ сохранением суммы.
 *
 * Остаток от округления достаётся получателю с наибольшей долей (при равенстве —
 * первому по порядку). Без этого «суммы сходятся» из §7.1 выполнялось бы с
 * точностью до копеек — то есть не выполнялось бы: проверка либо ловила бы
 * расхождение, либо требовала допуска, за которым спряталась бы настоящая
 * утечка.
 */
export function splitAmount(total: number, shares: readonly number[]): number[] {
  const sum = shares.reduce((acc, s) => acc + s, 0);
  if (sum <= 0 || shares.length === 0) return shares.map(() => 0);

  const parts = shares.map(share => Math.floor((total * share) / sum));
  const distributed = parts.reduce((acc, p) => acc + p, 0);

  let largest = 0;
  for (let i = 1; i < shares.length; i++) if (shares[i]! > shares[largest]!) largest = i;
  parts[largest] = parts[largest]! + (total - distributed);
  return parts;
}

// --------------------------------------------------------------------------
// Операции
// --------------------------------------------------------------------------

/**
 * Закрывает войны, потерявшие смысл после изменения состава стран.
 *
 * Два случая, и оба возникают именно от переноса ссылок: сторона опустела
 * (все её участники исчезли) либо одна и та же страна оказалась по обе стороны
 * (участник одной стороны стал правопреемником участника другой). Война,
 * оставленная в таком виде, продолжила бы тикать фронтом и копить потери
 * стороны, которой нет.
 */
export function closeBrokenWars(game: GameState): string[] {
  const closed: string[] = [];
  for (const war of game.wars) {
    if (!war.active) continue;
    const bothSides = war.attackers.some(id => war.defenders.includes(id));
    if (war.attackers.length === 0 || war.defenders.length === 0 || bothSides) {
      war.active = false;
      closed.push(war.id);
    }
  }
  return closed;
}

/**
 * Возвращает столице страны валидность, если она ушла вместе с осколком.
 *
 * Новая столица — самый населённый из оставшихся регионов (при равенстве —
 * меньший id). Страна без регионов вовсе столицу не меняет: её судьбу решает
 * вызывающий (роспуск), а выдумывать столицу несуществующей территории незачем.
 *
 * Экспортирована Милстоуном 1 (дипломатический блок): столицу теряет не только
 * расколовшаяся страна, но и проигравшая войну — `WarService.applyPeaceTerms`
 * передаёт оккупированные регионы победителю и столицу при этом не двигает.
 * Пока мир заключался старым каналом `actions`, это оставалось незаметным: тот
 * применялся мимо пост-инвариантов. Примитив `peace` через них проходит, и
 * страна со столицей вне своих регионов откатила бы ВЕСЬ ответ. Второй копии
 * правила «где теперь столица» заводить нельзя — она разошлась бы с этой.
 */
export function reassignCapitalIfLost(
  game: GameState,
  country: Country
): { countryId: string; from: number; to: number } | undefined {
  const owned = game.regions.filter(r => r.ownerCountryId === country.id);
  if (owned.length === 0) return undefined;
  if (owned.some(r => r.id === country.capitalRegionId)) return undefined;

  const next = [...owned].sort((a, b) => b.population - a.population || a.id - b.id)[0]!;
  const from = country.capitalRegionId;
  country.capitalRegionId = next.id;
  return { countryId: country.id, from, to: next.id };
}

/**
 * Убирает страну из мира, передав ВСЕ ссылки на неё правопреемнику.
 *
 * `successorId === undefined` означает «ссылки снимаются, а не переносятся», и
 * это законно только там, где снятие законно: владение регионом и
 * `playerCountryId` в такой список не входят, и попытка удалить страну, за
 * которой ещё числится регион, кончается исключением из `countryRefs.ts`.
 * Громкий отказ здесь лучше тихого: регион без владельца — не состояние мира.
 */
export function removeCountry(
  game: GameState,
  countryId: string,
  successorId: string | undefined
): void {
  remapCountryReferences(game, id => (id === countryId ? successorId : id));
  game.countries = game.countries.filter(c => c.id !== countryId);
}

export interface SplitParams {
  countryId: string;
  intensity: PrimitiveIntensity;
}

/**
 * Раскол страны: регионы, где недовольная группа составляет большинство,
 * уходят в новые государства — по одному на группу.
 *
 * Порядок шагов существен и объяснён по месту: сначала считается план (по
 * состоянию ДО изменений), затем создаются осколки, затем переезжают регионы,
 * затем — и только затем — переносятся ссылки распустившейся страны, если та
 * осталась без территории.
 */
export function splitCountry(game: GameState, params: SplitParams): PolityLifecycleResult {
  const source = game.countries.find(c => c.id === params.countryId);
  if (!source) throw new Error(`split_country: unknown country ${params.countryId}`);

  const plan = planSplit(game, source.id, params.intensity);
  if (plan.length === 0) throw new Error(`split_country: nothing to split off ${source.id}`);

  const ownedBefore = game.regions.filter(r => r.ownerCountryId === source.id);
  const secedingIds = new Set(plan.flatMap(p => p.regionIds));
  const rumpRegions = ownedBefore.filter(r => !secedingIds.has(r.id));

  // Доли для деления НЕДЕЛИМОГО по регионам (казна, живая сила) — по населению.
  // Население и ВВП делить не нужно: они пересчитываются из регионов, и это
  // единственный источник истины для них (`aggregateCountryFromRegions`).
  const populationOf = (regionIds: readonly number[]): number =>
    regionIds.reduce(
      (sum, id) => sum + (game.regions.find(r => r.id === id)?.population ?? 0),
      0
    );

  const rumpShare = rumpRegions.reduce((sum, r) => sum + r.population, 0);
  const shares = [rumpShare, ...plan.map(p => populationOf(p.regionIds))];

  const treasury = splitAmount(source.economy.treasury, shares);
  const manpower = splitAmount(source.military.manpower, shares);
  const active = splitAmount(source.military.activePersonnel, shares);
  const reserve = splitAmount(source.military.reservePersonnel, shares);

  const taken = new Set(game.countries.map(c => c.id));
  const shards: LifecycleShard[] = [];

  plan.forEach((entry, index) => {
    const group = game.ethnicGroups.find(g => g.id === entry.groupId);
    if (!group) throw new Error(`split_country: unknown group ${entry.groupId}`);

    const id = shardCountryId(taken, entry.groupId);
    taken.add(id);

    const regions = entry.regionIds
      .map(regionId => game.regions.find(r => r.id === regionId)!)
      .sort((a, b) => b.population - a.population || a.id - b.id);

    const shard: Country = {
      id,
      // Осколок носит имя ГРУППЫ: имён гипотетических государств в состоянии
      // нет, и выдумывать их движок не вправе. Цена названа в docs/PRIMITIVES.md.
      name: { ...group.names },
      shortName: { ...group.names },
      color: SHARD_COLORS[hashOf(entry.groupId) % SHARD_COLORS.length]!,
      // Новорождённое государство — minor; следующий годовой пересчёт тира
      // (`TierTick`) поставит настоящее значение из ВВП/армии/влияния.
      tier: "minor",
      capitalRegionId: regions[0]!.id,
      population: 0,
      economyProfile: structuredClone(source.economyProfile),
      economy: {
        ...structuredClone(source.economy),
        gdp: 0,
        // Делимое выставляется командой ниже, после появления страны в мире:
        // запись в `.economy`/`.military` мимо `commands/` нарушает правило 2
        // (docs/plans/03_MODIFIERS_COMMANDS.md).
        treasury: 0,
      },
      economyType: source.economyType,
      technology: structuredClone(source.technology),
      researchedTechnologyIds: [...source.researchedTechnologyIds],
      military: {
        ...structuredClone(source.military),
        manpower: 0,
        activePersonnel: 0,
        reservePersonnel: 0,
        // Именные соединения и ядерный арсенал по населению не делятся:
        // батальон и боеголовка — штучные объекты, а не величина. Остаются у
        // метрополии (либо у правопреемника, если та распустилась). Названо в
        // docs/PRIMITIVES.md как граница, а не забыто.
        units: [],
        nuclearWarheads: 0,
      },
      // Дипломатия НОВОГО государства пуста: союзов, гарантий и отношений оно
      // ещё не заводило, а наследовать их у метрополии, от которой оно только
      // что откололось, значило бы сделать отделение бесплатным.
      diplomacy: createEmptyDiplomacyState(),
      politics: {
        ...structuredClone(source.politics),
        // Осколок воплощает то, ради чего он отделился, — желаемую позицию
        // своей группы. Это и есть механическое содержание раскола: дистанция
        // «власть ↔ группа», гнавшая недовольство, схлопывается в ноль.
        ideologyCoordinates: { ...group.desiredIdeology },
        ideology: nearestIdeologyLabel(group.desiredIdeology),
      },
      stockpile: structuredClone(source.stockpile),
      goals: [],
      aiTraits: { ...source.aiTraits },
    };

    game.countries.push(shard);
    setDivisibleAssets(game, id, {
      treasury: treasury[index + 1]!,
      manpower: manpower[index + 1]!,
      activePersonnel: active[index + 1]!,
      reservePersonnel: reserve[index + 1]!,
    });
    for (const region of regions) region.ownerCountryId = id;
    shards.push({ countryId: id, groupId: entry.groupId, regionIds: entry.regionIds });
  });

  setDivisibleAssets(game, source.id, {
    treasury: treasury[0]!,
    manpower: manpower[0]!,
    activePersonnel: active[0]!,
    reservePersonnel: reserve[0]!,
  });

  const result: PolityLifecycleResult = {
    shards,
    capitalReassignments: [],
    closedWarIds: [],
  };

  if (rumpRegions.length === 0) {
    // Метрополия не пережила раскол: территории не осталось. Правопреемником
    // становится САМЫЙ НАСЕЛЁННЫЙ осколок (при равенстве — меньший id) — на
    // него переезжают все ссылки, включая войны, союзы и долги.
    const successor = [...shards].sort(
      (a, b) => populationOf(b.regionIds) - populationOf(a.regionIds) ||
        a.countryId.localeCompare(b.countryId)
    )[0]!;

    result.dissolvedCountryId = source.id;
    result.dissolvedName = { ...source.name };
    result.successorCountryId = successor.countryId;
    removeCountry(game, source.id, successor.countryId);
  } else {
    const reassigned = reassignCapitalIfLost(game, source);
    if (reassigned) result.capitalReassignments.push(reassigned);
  }

  // Пересчёт агрегатов ЗАТРОНУТЫХ стран, а не всего мира: население и ВВП
  // выводятся из регионов, и осколок без пересчёта остался бы с нулями,
  // а метрополия — с числами за отданные регионы.
  for (const shard of shards) {
    const country = game.countries.find(c => c.id === shard.countryId);
    if (country) aggregateCountryFromRegions(country, game.regions);
  }
  const rump = game.countries.find(c => c.id === source.id);
  if (rump) aggregateCountryFromRegions(rump, game.regions);

  result.closedWarIds = closeBrokenWars(game);
  return result;
}
