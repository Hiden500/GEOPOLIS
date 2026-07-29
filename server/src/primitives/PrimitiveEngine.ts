import {
  type GameState,
  type RejectionFactKind,
  type WorldFactSource,
} from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type MapFeatureType } from "@shared/types/map/MapFeature";
import {
  IMPACT_MEMORY_FIELDS,
  type GroupImpactMemory,
  type ImpactMemoryField,
} from "@shared/types/politics/Demographics";
import {
  IDEOLOGY_AXIS_MIN,
  IDEOLOGY_AXIS_MAX,
  type IdeologyCoordinates,
} from "@shared/types/politics/Ideology";
import {
  ALLY_RELATION_THRESHOLD,
  VASSALAGE_MIN_HELD_SHARE,
  VASSALAGE_MIN_INFLUENCE,
} from "@shared/defines/diplomacy";
import { aggregateCountryFromRegions } from "@shared/utils/aggregateCountryData";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import {
  findImpactMemory,
  ideologyDistance,
  regionDiscontent,
  resolveIdeologyCoordinates,
  groupDiscontent,
  regionWelfare,
} from "@shared/utils/discontent";
import {
  PRIMITIVE_DEFAULT_INTENSITY,
  INCITE_UNREST_MIN_DISTANCE,
  INCITE_UNREST_EMBOLDENMENT_MIN,
  INCITE_UNREST_EMBOLDENMENT_MAX,
  REPRESS_SUPPRESSION_MIN,
  REPRESS_SUPPRESSION_MAX,
  REPRESS_ALIENATION_MIN,
  REPRESS_ALIENATION_MAX,
  GRANT_AUTONOMY_CONCESSION_MIN,
  GRANT_AUTONOMY_CONCESSION_MAX,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
  SPAWN_INCIDENT_EMBOLDENMENT_MIN,
  SPAWN_INCIDENT_EMBOLDENMENT_MAX,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  ENACT_REFORM_COORDINATE_STEP_MIN,
  ENACT_REFORM_COORDINATE_STEP_MAX,
  ENACT_REFORM_POLITICAL_COST,
  MAX_SOFT_PRIMITIVES_PER_TURN,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PRIMITIVES_PER_TARGET_PER_TURN,
  IMPACT_FIELD_TURN_CEILING,
  IMPACT_FIELD_TURN_CEILING_TOLERANCE,
  MAX_PENDING_REJECTION_FACTS_PER_SOURCE,
} from "@shared/defines/discontent";
import {
  emptyPrimitiveTurnBudget,
  type PrimitiveTurnBudget,
} from "@shared/types/politics/PrimitiveTurnBudget";
import { SANCTION_TYPES, TRADE_CUTTING_SANCTION, type SanctionType } from "@shared/types/DiplomacyState";
import {
  DIPLOMACY_RELATION_MIN,
  DIPLOMACY_RELATION_MAX,
  SANCTION_RELATION_MIN,
  SANCTION_RELATION_MAX,
  WAR_DECLARATION_RELATION_PENALTY,
  PEACE_RELATION_RELIEF,
  SEND_AID_MIN_TREASURY_SHARE,
  SEND_AID_SHARE_MIN,
  SEND_AID_SHARE_MAX,
  SEND_AID_INFLUENCE_MIN,
  SEND_AID_INFLUENCE_MAX,
  CONDEMN_LEGITIMACY_MIN,
  CONDEMN_LEGITIMACY_MAX,
  SUPPORT_PROXY_SHARE_MIN,
  SUPPORT_PROXY_SHARE_MAX,
  SUPPORT_PROXY_PERSONNEL_MIN_SHARE,
  SUPPORT_PROXY_PERSONNEL_MAX_SHARE,
} from "@shared/defines/diplomacy";
import {
  CAPITAL_FLIGHT_MAX_STABILITY,
  CAPITAL_FLIGHT_GDP_MIN,
  CAPITAL_FLIGHT_GDP_MAX,
  CAPITAL_FLIGHT_TREASURY_MIN,
  CAPITAL_FLIGHT_TREASURY_MAX,
} from "@shared/defines/economy";
import { MapFeatureService } from "../services/MapFeatureService";
import { WarService } from "../services/WarService";
import * as politicsCommands from "../commands/politics";
import * as diplomacyCommands from "../commands/diplomacy";
import * as economyCommands from "../commands/economy";
import * as militaryCommands from "../commands/military";
import * as warCommands from "../commands/war";
import { type CommandResult } from "../commands/types";
import { collectChangedPaths } from "./statePaths";
import { findPaletteViolations } from "./palette";
import {
  countryNames as countryNamesOf,
  groupNames as groupNamesOf,
  regionNames as regionNamesOf,
} from "./entityNames";
import { findMisreportedChanges } from "./reconciliation";
import { elementIdentity, identityIndex } from "./elementIdentity";
import {
  mergeCountries,
  planSplit,
  reassignCapitalIfLost,
  splitCountry,
  splitDiscontentThreshold,
} from "./polityLifecycle";
import { pruneTurnBudgetTargets } from "./countryRefs";
import { applyVassalage, overlordChainOf } from "./subordination";
import { SPLIT_MIN_GROUP_SHARE, SPLIT_MIN_REGIONS } from "@shared/defines/discontent";
import { applyLifecycleToCampaign, evaluateCampaign } from "./campaign";
import {
  type ExhaustedTarget,
  type PrimitiveRejection,
  rejectionPromptText,
} from "./rejections";
import {
  magnitudeFromState,
  coerciveCapacity,
  repressSuppressionFactor,
  repressAlienationFactor,
  concessionFactor,
  neighbourEmboldenment,
  inciteFactor,
  incidentFactor,
  reformMandateFactor,
  relationRoom,
  diplomaticGrip,
  sanctionBite,
  donorFiscalRoom,
  aidScale,
  aidVisibility,
  influenceRoom,
  capitalFlightExposure,
  legitimacyRoom,
  podiumReach,
  proxyTie,
  proxyUrgency,
  type DiplomaticTies,
} from "./magnitude";
import {
  type AppliedPrimitive,
  type CountryScalarEffect,
  type CountryScalarField,
  type GroupImpactEffect,
  type IdeologyAxis,
  type IdeologyShiftEffect,
  type IncidentKind,
  type InfluenceEffect,
  type RegionEconomyEffect,
  type PoliticalCostEffect,
  type Primitive,
  type RelationDirection,
  type RelationEffect,
  type PrimitiveOf,
  type PrimitiveBatchResult,
  type PreconditionResult,
  type PrimitiveIntensity,
  type PrimitiveVerb,
  type ReformEconomicDirection,
  type ReformPoliticalDirection,
  type RejectedPrimitive,
  impactEffectsOf,
  isStructural,
} from "./types";

/**
 * Движок примитивов — «сердце сложности» (docs/PRIMITIVES.md §3).
 *
 * Три фазы на примитив: **Validate** (предпосылки → pass / reject целиком) →
 * **Compute** (магнитуду считает движок из состояния и качественных params) →
 * **Apply** (только поля палитры, атомарно).
 *
 * Фаза Compute вынесена в `magnitude.ts`: величина каждого эффекта — коридор
 * `[MIN, MAX]`, потолок которого определяет состояние мира, а качественный хинт
 * LLM выбирает лишь позицию внутри разрешённого. При «пустом» состоянии коридор
 * схлопывается, и `severe` не отличается от `mild` (docs/PRIMITIVES.md §1 —
 * «хинт клампится»).
 *
 * Три защиты, которые здесь реализованы буквально:
 *   1. Reject целиком, не частично — примитив, упавший на любом шаге,
 *      откатывается к снимку до себя; «полусобытий» не бывает.
 *   2. Нарратив только после commit — движок возвращает `applied[]` с
 *      фактическими величинами; текст пишет вызывающий по этому списку, а не
 *      по своим намерениям. «Фактическими» здесь буквально: в результате лежит
 *      то, что вернула команда ПОСЛЕ клампов, а не то, что посчитала фаза
 *      Compute. У насыщенного поля памяти эти два числа расходятся в разы.
 *      Форма результата — discriminated union по глаголу (types.ts): по каждому
 *      затронутому полю и каждой цели «было → стало → дельта», отдельно
 *      политическая цена, отдельно эффекты на соседей, отдельно id созданного
 *      объекта карты. Скрытых и выдуманных эффектов не бывает НИ В ОДНОМ
 *      числовом канале алфавита: отчёт сверяется с фактическим дифом состояния
 *      по ключам и по величине, в обе стороны (`reconciliation.ts` —
 *      `findMisreportedChanges`). С Милстоуна 1 сверка покрывает память
 *      воздействий, координаты идеологии, поддержку правительства и факт
 *      создания объекта карты. Вне её остался `nextFeatureId` — счётчик, а не
 *      заявление о мире; его держит палитра.
 *   3. Палитра эффектов — изменённые пути состояния сверяются с whitelist'ом
 *      (palette.ts) в рантайме, а не только в тесте.
 *
 * Капы ХОДА (§4) — четыре штуки: ≤10 мягких, ≤1 структурный, «один verb на
 * цель за ход» и потолок накопления следа в одной тройке (регион, группа,
 * поле). Третий закрывает обход коридора магнитуды частотой в лоб: без него
 * десять `mild`-примитивов по одной цели дают то, что один `severe` дать не
 * может (ключи целей — `targetEntities`). Четвёртый закрывает тот же обход
 * через побочный эффект: у `grant_autonomy` отклик соседей в ключи целей не
 * входит намеренно, каждая уступка — законная отдельная цель, но записи всех
 * уступок сходятся в одну пару. Он считает не примитивы, а величину, и берёт
 * её из фактического дифа памяти (`impactDeltas`), поэтому не зависит ни от
 * числа примитивов, ни от их формы.
 *
 * Все четыре считаются НА ИГРОВОЙ ХОД, а не на вызов: счётчики читаются из
 * `game.primitiveTurnBudget` и дописываются туда же после commit'а. Это не
 * деталь реализации, а сама гарантия. Пока счётчики жили в локальных `Map`,
 * «ход» молча означал «вызов», и десять кликов игрока в одном месяце давали то,
 * что коридор магнитуды запрещает одному примитиву (замер на данных 1946:
 * регион 68 / `estonians`, `suppression` 0.238 одним батчем против 1.000
 * десятью вызовами). Бюджет намеренно НЕ параметр функции: необязательный
 * параметр со значением по умолчанию «без ограничений» — ровно тот способ
 * потерять кап, каким он и был потерян. Новый вызывающий получает кап потому,
 * что бюджет лежит в состоянии, а не потому, что вызывающий о нём вспомнил.
 *
 * Работа идёт на структурном клоне состояния; в настоящий `game` результат
 * попадает одним переносом в конце (commit, см. `restore` — он сохраняет
 * идентичность объектов, чтобы ссылки, взятые до вызова, оставались живыми).
 * Порядок массива — порядок
 * исполнения (§4): каждый следующий примитив видит эффект предыдущего.
 * Структурные исполняются последними, и их reject не откатывает уже
 * применённые мягкие (§4).
 */

/**
 * Качественный хинт силы — у глаголов, которые его принимают.
 *
 * Промежуточная переменная нужна с появлением структурных `war`/`peace`: у них
 * `params.intensity` НЕ СУЩЕСТВУЕТ вовсе (у события нет величины), и обращение
 * к полю прямо на union'е перестало компилироваться. Это не досадное
 * препятствие, а ровно то, ради чего форма объявляется по глаголу: значение
 * по умолчанию здесь возвращается для глаголов, которые хинт читают, и не
 * притворяется, что война бывает «умеренной».
 */
function intensityHint(primitive: Primitive): PrimitiveIntensity {
  const params = primitive.params;
  if (params && "intensity" in params && params.intensity) return params.intensity;
  return PRIMITIVE_DEFAULT_INTENSITY;
}

function findRegion(game: GameState, regionId: number | undefined): Region | undefined {
  if (regionId === undefined) return undefined;
  return game.regions.find(r => r.id === regionId);
}

function regionLabel(region: Region): string {
  return getText(region.names, LLM_LOCALE) || `region ${region.id}`;
}

/**
 * Локализованное имя региона по id — для фактов о СОСЕДНИХ регионах, ссылки на
 * которые у места вызова нет. Сырой `region 187` в резюме — такой же
 * необработанный идентификатор кода, как сырой `groupId` (см. `groupLabel`).
 */
function regionLabelById(game: GameState, regionId: number): string {
  const region = findRegion(game, regionId);
  return region ? regionLabel(region) : `region ${regionId}`;
}

/**
 * Локализованное имя демо-группы для резюме.
 *
 * Резюме уходит в промт, и «for lithuanians» рядом с локализованным «in
 * Šiauliai» в одном предложении выдаёт идентификатор кода за человеческое имя.
 * У групп есть `names: LocalizedText` (docs/LOCALIZATION.md) — берём оттуда;
 * фолбэк на id остаётся, чтобы группа без имени не превращала факт в пустоту.
 */
function groupLabel(game: GameState, groupId: string): string {
  return getText(groupNamesOf(game, groupId), LLM_LOCALE) || groupId;
}

/**
 * Группы региона, на которые действует примитив: явно названная — только она,
 * иначе всё население региона (репрессии/уступки адресуются и региону тоже,
 * docs/PRIMITIVES.md §2 — target «регион/группа»).
 *
 * Возвращаются пары «группа + её доля»: доля — вход магнитуды, а не украшение.
 * Один и тот же приказ по региону бьёт по 88 % доминанта и по 12 % меньшинству
 * с разной силой, поэтому величина считается для каждой группы отдельно.
 */
function targetedGroups(
  region: Region,
  groupId: string | undefined
): { groupId: string; share: number }[] {
  const present = region.demographics ?? [];
  if (groupId === undefined) return present.map(d => ({ groupId: d.groupId, share: d.share }));
  return present
    .filter(d => d.groupId === groupId)
    .map(d => ({ groupId: d.groupId, share: d.share }));
}

const INCIDENT_FEATURE_TYPE: Record<IncidentKind, MapFeatureType> = {
  protest: "protest",
  uprising: "uprising",
  border_dispute: "border_dispute",
};

const DEFAULT_INCIDENT_KIND: IncidentKind = "protest";

function incidentKindOf(primitive: PrimitiveOf<"spawn_incident">): IncidentKind {
  return primitive.params?.incidentKind ?? DEFAULT_INCIDENT_KIND;
}

/**
 * Умолчание вида санкции — то же, что было у старого канала
 * (`economic_sanctions`), и намеренно НЕ `trade_embargo`.
 *
 * Умолчание обязано быть мягчайшим из вариантов: назвать неуточнённую санкцию
 * торговой блокадой значило бы, что модель, не выбравшая вид, получает
 * сильнейшую меру. Цена этого умолчания названа прямо и живёт в результате
 * (`AppliedSanction.cutsTrade`): торговлю сегодня режет только
 * `trade_embargo`, поэтому неуточнённая санкция — репутационная.
 */
const DEFAULT_SANCTION_TYPE: SanctionType = "economic_sanctions";

function sanctionKindOf(primitive: PrimitiveOf<"sanction">): SanctionType {
  return primitive.params?.sanctionType ?? DEFAULT_SANCTION_TYPE;
}

/**
 * Союзник ли — в смысле, при котором пограничный спор перестаёт быть осмысленным.
 *
 * Читается односторонне, глазами контролёра региона: спор поднимают на его
 * стороне границы, и значение имеет то, как ОН относится к соседу. Формальный
 * союз (`diplomacy.allies`) и «отношения не хуже союзнических» — два входа,
 * потому что заполняться они могут независимо.
 *
 * Фактическое состояние данных 1946 (прямой подсчёт, 2026-07-26): из 157 стран
 * НИ ОДНА не имеет ни непустого `diplomacy.allies`, ни непустого `relations`;
 * заполнены только `puppets` и `sphereOfInfluence` (по 14 стран), а их
 * `alliedWith` не читает. Значит, на единственном поставляемом сценарии этот
 * фильтр не срабатывает никогда, и пограничный кризис СССР — Польша в январе
 * 1946 проходит. Код при этом верен; недостаёт стартовой дипломатии в данных —
 * зафиксировано в `docs/TODO.md`. Живёт ветка сегодня только на фикстуре.
 */
function alliedWith(controller: Country | undefined, otherId: string): boolean {
  if (!controller) return false;
  if (controller.diplomacy.allies.includes(otherId)) return true;
  return (controller.diplomacy.relations[otherId] ?? 0) >= ALLY_RELATION_THRESHOLD;
}

/**
 * Страна по ту сторону границы, спор с которой осмыслен, — опора предпосылки
 * `spawn_incident(border_dispute)`.
 *
 * «Осмыслен» операционно: (1) у региона есть сосед под ЧУЖИМ фактическим
 * контролем — то есть спорная граница вообще существует; (2) этот контролёр не
 * союзник. Второе — узкий фильтр намеренно: спор между холодными соседями и
 * даже между нейтралами историчен, а вот пограничный кризис с формальным
 * союзником — нет, и именно его модель могла бы поставить, назвав внутреннее
 * напряжение «border_dispute».
 *
 * Выбор детерминирован (сортировка по id): результат попадает в факт применения
 * и в текст резюме, поэтому обязан быть воспроизводим.
 */
function disputedNeighbourCountry(game: GameState, region: Region): string | undefined {
  const controllerId = effectiveController(region);
  const controller = game.countries.find(c => c.id === controllerId);

  const foreign = new Set<string>();
  for (const neighbourId of region.neighboringRegionIds) {
    const neighbour = findRegion(game, neighbourId);
    if (!neighbour) continue;
    const other = effectiveController(neighbour);
    if (other !== controllerId) foreign.add(other);
  }

  return [...foreign].sort().find(id => !alliedWith(controller, id));
}

function clampAxis(value: number): number {
  return Math.max(IDEOLOGY_AXIS_MIN, Math.min(IDEOLOGY_AXIS_MAX, value));
}

/**
 * Глубина реформы по каждой затронутой оси — мандат правительства сверх
 * минимума, позиция внутри коридора — от качественного хинта.
 *
 * Считается ОДНОЙ функцией для validate и apply: предпосылка «сдвиг достижим»
 * проверяет ровно тот шаг, который потом и применится. Два независимых расчёта
 * разъехались бы молча, и реформа снова начала бы списывать цену за ничто.
 */
function reformStep(country: Country, hint: PrimitiveIntensity): number {
  return magnitudeFromState(
    ENACT_REFORM_COORDINATE_STEP_MIN,
    ENACT_REFORM_COORDINATE_STEP_MAX,
    reformMandateFactor(country.politics.governmentSupport),
    hint
  );
}

/** Ось, которую реформа просит двигать, с её знаковой дельтой. */
interface ReformAxisRequest {
  axis: IdeologyAxis;
  direction: ReformEconomicDirection | ReformPoliticalDirection;
  delta: number;
}

function reformAxes(primitive: PrimitiveOf<"enact_reform">, step: number): ReformAxisRequest[] {
  const { economicDirection, politicalDirection } = primitive.params ?? {};
  const axes: ReformAxisRequest[] = [];
  if (economicDirection !== undefined) {
    axes.push({
      axis: "economic",
      direction: economicDirection,
      delta: economicDirection === "right" ? step : -step,
    });
  }
  if (politicalDirection !== undefined) {
    axes.push({
      axis: "political",
      direction: politicalDirection,
      delta: politicalDirection === "democratic" ? step : -step,
    });
  }
  return axes;
}

/** Оси, по которым сдвиг недостижим: координата уже упёрта в край спектра. */
function unreachableAxes(
  current: IdeologyCoordinates,
  axes: readonly ReformAxisRequest[]
): ReformAxisRequest[] {
  return axes.filter(a => clampAxis(current[a.axis] + a.delta) === current[a.axis]);
}

// --------------------------------------------------------------------------
// Дипломатический блок: связи пары, из которых движок выводит ширину коридора
// --------------------------------------------------------------------------

/**
 * Есть ли у двух стран общая сухопутная граница.
 *
 * Считается по ЛЕГАЛЬНОМУ владению (`ownerCountryId`), а не по фактическому
 * контролю: оккупация — временное положение фронта, а «дотягивается ли слово
 * до этой столицы» — свойство устойчивое, и менять ширину дипломатического
 * коридора каждым сдвигом линии фронта незачем.
 *
 * ЦЕНА НАЗВАНА ПРЯМО: один проход по регионам на построение карты владения плюс
 * обход регионов источника. Это допустимо здесь и было бы недопустимо в тике:
 * дипломатических примитивов за игровой МЕСЯЦ бывает не больше капа хода
 * (11), а не по одному на страну на тик.
 */
function sharesLandBorder(game: GameState, countryA: string, countryB: string): boolean {
  const ownerOf = new Map(game.regions.map(r => [r.id, r.ownerCountryId]));
  for (const region of game.regions) {
    if (region.ownerCountryId !== countryA) continue;
    if (region.neighboringRegionIds.some(id => ownerOf.get(id) === countryB)) return true;
  }
  return false;
}

/**
 * Формальное обязательство между странами — В ЛЮБУЮ сторону.
 *
 * Односторонности здесь нет намеренно, в отличие от `alliedWith` у
 * пограничного спора: там вопрос «как контролёр региона смотрит на соседа»,
 * здесь — «существует ли между этими двумя канал, по которому слово доходит».
 * Сюзерен слышен пуппету ровно так же, как пуппет сюзерену.
 */
function hasFormalTie(a: Country | undefined, b: Country | undefined): boolean {
  const linked = (from: Country | undefined, toId: string | undefined): boolean => {
    if (!from || toId === undefined) return false;
    return (
      from.diplomacy.allies.includes(toId) ||
      from.diplomacy.guarantees.includes(toId) ||
      from.diplomacy.puppets.includes(toId) ||
      from.diplomacy.sphereOfInfluence.includes(toId)
    );
  };
  return linked(a, b?.id) || linked(b, a?.id);
}

/** Как две страны стоят друг к другу в активных войнах. */
function warStanding(
  game: GameState,
  a: string,
  b: string
): { atWarWithEachOther: boolean; coBelligerent: boolean } {
  let atWarWithEachOther = false;
  let coBelligerent = false;
  for (const war of game.wars) {
    if (!war.active) continue;
    const aAttacks = war.attackers.includes(a);
    const aDefends = war.defenders.includes(a);
    const bAttacks = war.attackers.includes(b);
    const bDefends = war.defenders.includes(b);
    if ((aAttacks && bDefends) || (aDefends && bAttacks)) atWarWithEachOther = true;
    if ((aAttacks && bAttacks) || (aDefends && bDefends)) coBelligerent = true;
  }
  return { atWarWithEachOther, coBelligerent };
}

/**
 * Живые связи пары — вход множителя «хватки» (`magnitude.diplomaticGrip`).
 *
 * Собирается здесь, а не в `magnitude.ts`, по правилу того модуля: он про
 * арифметику коридоров и состояния не разбирает. Читать состояние — работа
 * движка.
 */
function diplomaticTiesOf(game: GameState, sourceId: string, targetId: string): DiplomaticTies {
  const source = game.countries.find(c => c.id === sourceId);
  const target = game.countries.find(c => c.id === targetId);
  const standing = warStanding(game, sourceId, targetId);
  return {
    sharesBorder: sharesLandBorder(game, sourceId, targetId),
    influence: source?.diplomacy.influence[targetId] ?? 0,
    formalTie: hasFormalTie(source, target),
    coBelligerent: standing.coBelligerent,
    atWarWithEachOther: standing.atWarWithEachOther,
  };
}

function relationBetween(game: GameState, fromId: string, toId: string): number {
  return game.countries.find(c => c.id === fromId)?.diplomacy.relations[toId] ?? 0;
}

/**
 * Двигает отношения и возвращает ФАКТИЧЕСКИЕ сдвиги ОБЕИХ сторон.
 *
 * Обеих, потому что `DiplomacyService.changeRelation` пишет инициатору полную
 * дельту, а адресату половину: отчитаться одной стороной значило бы скрыть
 * половину эффекта от сверки, а нарративу дать неверную симметрию. Обе записи
 * попадают в результат даже при нулевой дельте — «пара уже на краю шкалы» тоже
 * факт, и правило «нулевой канал называется нулевым» здесь то же, что у памяти
 * воздействий.
 */
function shiftRelation(
  game: GameState,
  fromId: string,
  toId: string,
  delta: number
): { effects: RelationEffect[]; error: string | undefined } {
  const beforeForward = relationBetween(game, fromId, toId);
  const beforeBack = relationBetween(game, toId, fromId);

  const result = diplomacyCommands.setRelation(game, fromId, toId, delta);
  const error = failIfCommandFailed([result]);
  if (error) return { effects: [], error };

  const afterForward = relationBetween(game, fromId, toId);
  const afterBack = relationBetween(game, toId, fromId);
  return {
    effects: [
      {
        fromCountryId: fromId,
        toCountryId: toId,
        before: beforeForward,
        after: afterForward,
        delta: afterForward - beforeForward,
      },
      {
        fromCountryId: toId,
        toCountryId: fromId,
        before: beforeBack,
        after: afterBack,
        delta: afterBack - beforeBack,
      },
    ],
    error: undefined,
  };
}

/** Знаковая величина дипломатического сдвига: направление задаёт знак, коридор — модуль. */
function signedByDirection(magnitude: number, direction: RelationDirection): number {
  return direction === "improve" ? magnitude : -magnitude;
}

/** Скалярные поля страны, за которыми следит сверка, — снимком по всем странам. */
function countryScalars(game: GameState): Map<string, number> {
  const values = new Map<string, number>();
  for (const country of game.countries) {
    values.set(`${country.id}|governmentSupport`, country.politics.governmentSupport);
    values.set(`${country.id}|legitimacy`, country.politics.legitimacy);
    values.set(`${country.id}|treasury`, country.economy.treasury);
    // Живая сила — Милстоун 1 (`support_proxy`). Стоит в ОБЩЕМ снимке, а не в
    // отдельном: тогда раскол государства, делящий `activePersonnel`
    // метрополии, заявляет её тем же кодом, каким уже заявляет казну, — иначе
    // ячейка `personnel:` откатывала бы его за молчание.
    values.set(`${country.id}|activePersonnel`, country.military.activePersonnel);
  }
  return values;
}

/**
 * Влияние всех пар стран — снимком, тем же приёмом, что `countryScalars`.
 *
 * Нужен структурным глаголам жизненного цикла: страна, исчезнувшая из мира,
 * уносит с собой и записи влияния НА неё, и запись влияния поглотителя на
 * поглощённого (она снимается как самоссылка). Обе — ячейки `influence:` в
 * разложении состояния, и обе обязаны быть заявлены.
 */
function countryInfluences(game: GameState): Map<string, number> {
  const values = new Map<string, number>();
  for (const country of game.countries) {
    for (const [targetId, value] of Object.entries(country.diplomacy.influence)) {
      values.set(`${country.id}|${targetId}`, value);
    }
  }
  return values;
}

/**
 * Фактические изменения влияния между снимками.
 *
 * Пары, которых нет в снимке «после», считаются ушедшими в ноль: ячейка,
 * которой не стало, и ячейка со значением ноль — одно утверждение о мире (та же
 * трактовка, что у `cellChanges` в сверке).
 */
function influenceDiff(
  before: Map<string, number>,
  after: Map<string, number>
): InfluenceEffect[] {
  const effects: InfluenceEffect[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key) ?? 0;
    const now = after.get(key) ?? 0;
    if (was === now) continue;
    const [fromCountryId, toCountryId] = key.split("|") as [string, string];
    effects.push({ fromCountryId, toCountryId, before: was, after: now, delta: now - was });
  }
  return effects;
}

/** Доля в 0..1 — вход множителей состояния, приходящий из деления величин мира. */
function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Человеческое описание фактических сдвигов скалярных полей стран.
 *
 * Общее на четыре мягких глагола Милстоуна 1 и на мир: у всех у них результат
 * строится из ДИФА снимка, поэтому и текст обязан строиться из того же списка,
 * а не из знания о том, какие поля глагол собирался тронуть.
 */
function describeScalars(game: GameState, effects: readonly CountryScalarEffect[]): string[] {
  return effects.map(
    effect =>
      `${effect.field} of ${countryLabel(game, effect.countryId)} ${signed(effect.delta)} ` +
      `(${effect.before.toFixed(1)} → ${effect.after.toFixed(1)})`
  );
}

/**
 * Человеческое описание фактических сдвигов влияния.
 *
 * Нулевая дельта называется нулевой — то же правило гранулярности правдивости,
 * что у отношений и памяти воздействий: донор, чьё влияние уже на потолке, не
 * должен читать в резюме, что помощь его усилила.
 */
function describeInfluence(game: GameState, effects: readonly InfluenceEffect[]): string[] {
  return effects.map(effect => {
    const pair = `${countryLabel(game, effect.fromCountryId)} → ` +
      `${countryLabel(game, effect.toCountryId)}`;
    return effect.delta === 0
      ? `influence ${pair} unchanged (${effect.after.toFixed(1)})`
      : `influence ${pair} ${signed(effect.delta)} ` +
        `(${effect.before.toFixed(1)} → ${effect.after.toFixed(1)})`;
  });
}

/**
 * Что реально изменилось в скалярных полях стран между двумя снимками.
 *
 * Отчёт СТРОИТСЯ ИЗ ДИФА, а не из знания о том, что делает вызванный сервис, и
 * это осознанный выбор для `peace`. Мирный договор исполняет условия
 * (`WarService.makePeace`): штраф легитимности проигравшему, репарации при
 * решительной победе, аннексия оккупированного. Перечислять эти эффекты по
 * памяти значило бы завести ВТОРОЕ мнение о том, что сделал сервис, и первое же
 * изменение его правил разошлось бы с отчётом молча.
 *
 * Что при этом теряется, названо прямо: сверка результата с состоянием на этих
 * ячейках становится тождеством и лжи поймать не может. Границу здесь держит
 * палитра — она ограничивает, ЧТО мир вправе тронуть, — а не сверка, которая
 * следит лишь за согласием отчёта с состоянием.
 */
function countryScalarDiff(
  before: Map<string, number>,
  after: Map<string, number>
): CountryScalarEffect[] {
  const effects: CountryScalarEffect[] = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    if (was === undefined || was === now) continue;
    const [countryId, field] = key.split("|") as [string, CountryScalarField];
    effects.push({ countryId, field, before: was, after: now, delta: now - was });
  }
  return effects;
}

// --------------------------------------------------------------------------
// Фаза 1 — Validate
// --------------------------------------------------------------------------

function validate(game: GameState, primitive: Primitive): PreconditionResult {
  const source = game.countries.find(c => c.id === primitive.sourceCountryId);
  if (!source) {
    return {
      valid: false,
      rejection: { code: "unknownSourceCountry", countryId: primitive.sourceCountryId },
    };
  }

  switch (primitive.verb) {
    case "incite_unrest": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) {
        return { valid: false, rejection: { code: "unknownRegion", regionId: primitive.target.regionId } };
      }
      const definition = game.ethnicGroups.find(g => g.id === primitive.target.groupId);
      if (!definition) {
        return { valid: false, rejection: { code: "unknownGroup", groupId: primitive.target.groupId } };
      }
      if (!region.demographics?.some(d => d.groupId === primitive.target.groupId)) {
        return {
          valid: false,
          rejection: {
            code: "groupNotInRegion",
            group: definition.names,
            region: region.names,
          },
        };
      }

      // Единственная предпосылка глагола по docs/PRIMITIVES.md §2: разжечь
      // можно только там, где уже есть идеологический разрыв «власть ↔ группа».
      const controllerId = effectiveController(region);
      const controller = game.countries.find(c => c.id === controllerId);
      const authority = controller
        ? resolveIdeologyCoordinates(controller.politics)
        : resolveIdeologyCoordinates(source.politics);
      const distance = ideologyDistance(authority, definition.desiredIdeology);
      if (distance < INCITE_UNREST_MIN_DISTANCE) {
        return {
          valid: false,
          rejection: {
            code: "ideologicalDistanceTooLow",
            group: definition.names,
            distance,
            threshold: INCITE_UNREST_MIN_DISTANCE,
          },
        };
      }
      return { valid: true };
    }

    case "repress":
    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) {
        return { valid: false, rejection: { code: "unknownRegion", regionId: primitive.target.regionId } };
      }

      // Предпосылка обоих глаголов — контроль над регионом: нельзя ни
      // подавлять, ни давать автономию там, где ты не власть.
      if (effectiveController(region) !== primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "regionNotControlled", source: source.name, region: region.names },
        };
      }
      const groupId = primitive.target.groupId;
      if (targetedGroups(region, groupId).length === 0) {
        return {
          valid: false,
          rejection: groupId
            ? { code: "groupNotInRegion", group: groupNamesOf(game, groupId), region: region.names }
            : { code: "regionHasNoDemographics", region: region.names },
        };
      }
      return { valid: true };
    }

    case "enact_reform": {
      const countryId = primitive.target.countryId;
      const country = game.countries.find(c => c.id === countryId);
      if (!country) return { valid: false, rejection: { code: "unknownCountry", countryId } };

      // Реформа — внутриполитический акт (docs/PRIMITIVES.md §2: «страна;
      // политическая цена»). Без этой предпосылки SUN проводил реформу в USA:
      // координаты идеологии США уезжали, а `governmentSupport` списывался у
      // НИХ, то есть цену платил не тот, кто действует. Сменить курс чужой
      // страны алфавит позволяет иначе — через `stage_coup`, `support_proxy`,
      // давление на предпосылки, — но не приказом извне.
      if (countryId !== primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "reformNotDomestic", source: source.name, country: country.name },
        };
      }

      const { economicDirection, politicalDirection } = primitive.params ?? {};
      if (!economicDirection && !politicalDirection) {
        return { valid: false, rejection: { code: "reformNoDirection", country: country.name } };
      }

      // Политическая цена (docs/PRIMITIVES.md §2): реформа не проходит на
      // пустом политическом капитале.
      if (country.politics.governmentSupport < ENACT_REFORM_MIN_GOVERNMENT_SUPPORT) {
        return {
          valid: false,
          rejection: {
            code: "reformSupportTooLow",
            country: country.name,
            support: country.politics.governmentSupport,
            threshold: ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
          },
        };
      }

      // Достижимость сдвига (добавлено 2026-07-26 по внешнему аудиту). До этого
      // реформа в сторону, куда координата уже не движется (`political = -1` и
      // направление `authoritarian`), проходила: цена списывалась, состояние не
      // менялось, а результат сообщал «politics shifted authoritarian». Проверка
      // стоит ДО списания цены — платить за сдвиг, которого не будет, незачем.
      //
      // Отклоняется весь примитив, даже если вторая ось сдвинуться могла бы:
      // «полусобытий» не бывает (§3, защита №1), а «реформа прошла наполовину»
      // — это ровно полусобытие.
      const current = resolveIdeologyCoordinates(country.politics);
      const stuck = unreachableAxes(
        current,
        reformAxes(primitive, reformStep(country, intensityHint(primitive)))
      );
      if (stuck.length > 0) {
        return {
          valid: false,
          rejection: {
            code: "reformAxisAtSpectrumEdge",
            country: country.name,
            axes: stuck.map(a => ({
              axis: a.axis,
              direction: a.direction,
              value: current[a.axis],
              bound: a.delta < 0 ? IDEOLOGY_AXIS_MIN : IDEOLOGY_AXIS_MAX,
            })),
          },
        };
      }
      return { valid: true };
    }

    case "spawn_incident": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) {
        return { valid: false, rejection: { code: "unknownRegion", regionId: primitive.target.regionId } };
      }

      // Предпосылка — контекст (docs/PRIMITIVES.md §2): инцидент вырастает из
      // уже существующего напряжения, а не из пустого места.
      const discontent = regionDiscontent(game, region);
      if (discontent === undefined) {
        return { valid: false, rejection: { code: "regionHasNoDemographics", region: region.names } };
      }
      if (discontent < SPAWN_INCIDENT_MIN_DISCONTENT) {
        return {
          valid: false,
          rejection: {
            code: "incidentDiscontentTooLow",
            region: region.names,
            discontent,
            threshold: SPAWN_INCIDENT_MIN_DISCONTENT,
          },
        };
      }

      // Предпосылки ПО ВИДУ инцидента (добавлено 2026-07-26 по внешнему аудиту).
      // До этого `incidentKind` не участвовал в валидации вовсе: на одном и том
      // же состоянии проходили и `protest`, и `uprising`, и `border_dispute` — с
      // одинаковой величиной. Качественный параметр превращал бытовое
      // недовольство в пограничный спор, а движок не возражал.
      const kind = incidentKindOf(primitive);

      if (kind === "uprising" && discontent < SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT) {
        return {
          valid: false,
          rejection: {
            code: "uprisingDiscontentTooLow",
            region: region.names,
            discontent,
            protestThreshold: SPAWN_INCIDENT_MIN_DISCONTENT,
            uprisingThreshold: SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
          },
        };
      }

      if (kind === "border_dispute" && disputedNeighbourCountry(game, region) === undefined) {
        return {
          valid: false,
          rejection: {
            code: "noDisputableBorder",
            region: region.names,
            controller: countryNamesOf(game, effectiveController(region)),
          },
        };
      }
      return { valid: true };
    }

    case "split_country": {
      const target = game.countries.find(c => c.id === primitive.target.countryId);
      if (!target) {
        return {
          valid: false,
          rejection: { code: "unknownCountry", countryId: primitive.target.countryId },
        };
      }

      // Государство распадается ИЗНУТРИ. Раскол чужой страны извне — это
      // аннексия или война, у них свои глаголы и своя цена; разрешить его здесь
      // значило бы дать бесплатный способ разбирать соседей на части
      // (docs/CONCEPT.md §5.5).
      if (target.id !== primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "splitNotSelf", source: source.name, country: target.name },
        };
      }

      const owned = game.regions.filter(r => r.ownerCountryId === target.id);
      if (owned.length < SPLIT_MIN_REGIONS) {
        return {
          valid: false,
          rejection: {
            code: "splitTooFewRegions",
            country: target.name,
            regions: owned.length,
            required: SPLIT_MIN_REGIONS,
          },
        };
      }

      // Нетривиальная предпосылка: должен существовать хотя бы один регион, где
      // группа-БОЛЬШИНСТВО перешла порог недовольства. Это то же «сердце
      // сложности», что у `incite_unrest`, но на уровне государства: раскол
      // выводится из демо-геометрии, а не объявляется моделью.
      const threshold = splitDiscontentThreshold(intensityHint(primitive));
      if (planSplit(game, target.id, intensityHint(primitive)).length === 0) {
        // Причина называет, НАСКОЛЬКО не хватило: без числа модель повторит ту
        // же попытку вслепую (docs/PRIMITIVES.md §3).
        let best = 0;
        for (const region of owned) {
          for (const candidate of region.demographics ?? []) {
            if (candidate.share < SPLIT_MIN_GROUP_SHARE) continue;
            const definition = game.ethnicGroups.find(g => g.id === candidate.groupId);
            if (!definition) continue;
            const discontent = groupDiscontent(
              resolveIdeologyCoordinates(target.politics),
              definition.desiredIdeology,
              regionWelfare(region, target),
              findImpactMemory(game.groupImpactMemory, region.id, candidate.groupId)
            );
            if (discontent > best) best = discontent;
          }
        }
        return {
          valid: false,
          rejection: {
            code: "splitNoSeparatistRegion",
            country: target.name,
            threshold,
            best,
          },
        };
      }
      return { valid: true };
    }

    case "diplomacy":
    case "sanction":
    case "war":
    case "peace": {
      // Общая часть всех четырёх: цель существует и не равна источнику.
      // Равенство отклоняется ЗДЕСЬ, а не схемой, потому что `.refine()`
      // превращает ветку в `ZodEffects`, а `z.discriminatedUnion` и схема
      // провайдера работают с объектными ветками (то же ограничение, что у
      // «хотя бы одного направления» реформы).
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId);
      if (!target) return { valid: false, rejection: { code: "unknownCountry", countryId: targetId } };
      if (targetId === primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "bilateralSelfTarget", verb: primitive.verb, country: source.name },
        };
      }

      if (primitive.verb === "diplomacy") {
        // Направление — единственное, что модель здесь решает, и умолчания у
        // него быть не может: «улучшить» и «ухудшить» — разные события, а не
        // разные величины одного, и угадывать намерение движок не вправе.
        if (primitive.params?.direction === undefined) {
          return { valid: false, rejection: { code: "diplomacyNoDirection", country: target.name } };
        }
        return { valid: true };
      }

      if (primitive.verb === "sanction") {
        // Уже действующий режим повторно не накладывается: состояние от этого
        // не меняется, а примитив, ничего не изменивший, не вправе считаться
        // применённым (docs/PRIMITIVES.md §3, прецедент `annex`/`puppet`).
        const kind = sanctionKindOf(primitive);
        if (source.diplomacy.sanctions[targetId]?.includes(kind)) {
          return {
            valid: false,
            rejection: {
              code: "sanctionAlreadyImposed",
              source: source.name,
              target: target.name,
              sanctionType: kind,
            },
          };
        }
        return { valid: true };
      }

      const activeWar = new WarService(game).getActiveWarBetween(primitive.sourceCountryId, targetId);

      if (primitive.verb === "war") {
        if (activeWar) {
          return {
            valid: false,
            rejection: { code: "alreadyAtWar", source: source.name, target: target.name },
          };
        }
        // Правило перенесено из `LLMResponseValidator` вместе с глаголом:
        // разрыв союза не смоделирован (docs/WAR.md, Phase 1), поэтому война
        // с союзником — не «жёсткое решение», а состояние, которого движок не
        // умеет описать.
        if (source.diplomacy.allies.includes(targetId)) {
          return {
            valid: false,
            rejection: { code: "warOnAlly", source: source.name, target: target.name },
          };
        }
        // ПОВОД (casus belli) НЕ проверяется, и это заявление, а не пропуск.
        // Претензий, спорных территорий и обид в состоянии не существует
        // вовсе — та же граница, что у `border_dispute`: движок отказывается
        // изобретать историчность, которой в мире нет. Единственный кандидат в
        // повод, отношения, в поставляемом сценарии 1946 у всех 157 стран
        // равен нулю, поэтому порог по нему был бы либо пустым, либо запирал
        // бы войну во всём мире (`docs/TODO.md`).
        return { valid: true };
      }

      if (!activeWar) {
        return {
          valid: false,
          rejection: { code: "noActiveWar", source: source.name, target: target.name },
        };
      }
      return { valid: true };
    }

    case "send_aid":
    case "condemn":
    case "support_proxy": {
      // Общая часть трёх: цель существует и не равна источнику — помочь,
      // осудить и поддержать самого себя нельзя ни в каком смысле.
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId);
      if (!target) return { valid: false, rejection: { code: "unknownCountry", countryId: targetId } };
      if (targetId === primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "bilateralSelfTarget", verb: primitive.verb, country: source.name },
        };
      }

      if (primitive.verb === "send_aid") {
        // Единственная предпосылка спецификации: «донор платёжеспособен».
        // Выражена ДОЛЕЙ казны от ВВП, а не абсолютной суммой: абсолютный порог
        // означал бы, что помощь способны оказывать только крупные экономики
        // независимо от их фискального положения.
        const gdp = source.economy.gdp;
        const treasuryShare = gdp > 0 ? source.economy.treasury / gdp : 0;
        if (treasuryShare < SEND_AID_MIN_TREASURY_SHARE) {
          return {
            valid: false,
            rejection: {
              code: "donorInsolvent",
              source: source.name,
              treasuryShare,
              threshold: SEND_AID_MIN_TREASURY_SHARE,
            },
          };
        }
        return { valid: true };
      }

      if (primitive.verb === "condemn") {
        // ТРИБУНА (docs/PRIMITIVES.md §2). Прошлая сессия отложила глагол
        // именно за отсутствием этого входа; слой влияния его дал. Предпосылка
        // не формальность: прямой подсчёт по сценарию 1946 даёт 110 стран из
        // 157 без единой связи вовсе — то есть она реально отсекает.
        if (audienceOf(source) === 0) {
          return { valid: false, rejection: { code: "noPodium", source: source.name } };
        }
        return { valid: true };
      }

      // support_proxy — три предпосылки, и каждая отвечает за своё слово в
      // «патрон поддерживает воюющего клиента, не воюя сам».
      const clientWar = game.wars.find(
        w => w.active && (w.attackers.includes(targetId) || w.defenders.includes(targetId))
      );
      if (!clientWar) {
        return { valid: false, rejection: { code: "proxyNotAtWar", target: target.name } };
      }
      if (
        clientWar.attackers.includes(primitive.sourceCountryId) ||
        clientWar.defenders.includes(primitive.sourceCountryId)
      ) {
        return {
          valid: false,
          rejection: {
            code: "proxyPatronIsBelligerent",
            source: source.name,
            target: target.name,
          },
        };
      }
      if (
        (source.diplomacy.influence[targetId] ?? 0) <= 0 &&
        !hasFormalTie(source, target)
      ) {
        return {
          valid: false,
          rejection: { code: "proxyNoPatronage", source: source.name, target: target.name },
        };
      }
      return { valid: true };
    }

    case "capital_flight": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) {
        return { valid: false, rejection: { code: "unknownRegion", regionId: primitive.target.regionId } };
      }

      // Предпосылка ДОБАВЛЕНА к спецификации (она предпосылки не требует), и
      // это названо явно. Без неё глагол — бесплатное оружие по любому региону
      // мира: тот же класс дефекта, что общий порог `spawn_incident` до
      // разделения по видам инцидента. Капитал бежит оттуда, где доверие уже
      // сломано, а не откуда прикажут.
      if (region.stability >= CAPITAL_FLIGHT_MAX_STABILITY) {
        return {
          valid: false,
          rejection: {
            code: "regionTooStableForFlight",
            region: region.names,
            stability: region.stability,
            threshold: CAPITAL_FLIGHT_MAX_STABILITY,
          },
        };
      }
      return { valid: true };
    }

    case "puppet": {
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId);
      if (!target) return { valid: false, rejection: { code: "unknownCountry", countryId: targetId } };
      if (targetId === primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "bilateralSelfTarget", verb: primitive.verb, country: source.name },
        };
      }
      if (source.diplomacy.puppets.includes(targetId)) {
        return {
          valid: false,
          rejection: { code: "alreadyVassal", source: source.name, target: target.name },
        };
      }
      // Цикл запрещён на ЦЕПОЧКЕ, а не только на прямой паре: A → B → C → A
      // ломает `WarService.findCoalitionFor` и тяготение пары ровно так же, как
      // взаимное подчинение двоих, и обход по цепочке стоит одного прохода по
      // ростеру.
      if (overlordChainOf(game, primitive.sourceCountryId).has(targetId)) {
        return {
          valid: false,
          rejection: { code: "vassalageCycle", source: source.name, target: target.name },
        };
      }

      // РЫЧАГ: подчинение следует либо за войсками на земле, либо за долго
      // построенным влиянием. Третьего входа в состоянии нет — отношения в
      // сценарии 1946 у всех нули, и порог по ним был бы либо пустым, либо
      // всеобщим (та же граница, что у повода войны).
      const heldShare = heldShareOf(game, primitive.sourceCountryId, targetId);
      const influence = source.diplomacy.influence[targetId] ?? 0;
      if (heldShare < VASSALAGE_MIN_HELD_SHARE && influence < VASSALAGE_MIN_INFLUENCE) {
        return {
          valid: false,
          rejection: {
            code: "noVassalageLeverage",
            source: source.name,
            target: target.name,
            heldShare,
            heldThreshold: VASSALAGE_MIN_HELD_SHARE,
            influence,
            influenceThreshold: VASSALAGE_MIN_INFLUENCE,
          },
        };
      }
      return { valid: true };
    }

    case "annex": {
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId);
      if (!target) return { valid: false, rejection: { code: "unknownCountry", countryId: targetId } };
      if (targetId === primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "bilateralSelfTarget", verb: primitive.verb, country: source.name },
        };
      }

      // ЕДИНСТВЕННАЯ предпосылка, и она же — вся семантика глагола: аннексия
      // превращает землю, которую ты ДЕРЖИШЬ, в землю, которой ты ВЛАДЕЕШЬ.
      // Повода войны она не требует по той же причине, что и `war` (претензий
      // и обид в состоянии нет вовсе), но и захватом на расстоянии не является:
      // оккупация возникает только войной, поэтому фактический контроль и есть
      // проверяемое движком «ты за это воевал».
      if (heldRegionsOf(game, primitive.sourceCountryId, targetId).length === 0) {
        return {
          valid: false,
          rejection: { code: "annexNothingHeld", source: source.name, target: target.name },
        };
      }
      return { valid: true };
    }

    case "merge_countries": {
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId);
      if (!target) return { valid: false, rejection: { code: "unknownCountry", countryId: targetId } };
      if (targetId === primitive.sourceCountryId) {
        return {
          valid: false,
          rejection: { code: "bilateralSelfTarget", verb: primitive.verb, country: source.name },
        };
      }

      // СТРАНА ИГРОКА НЕ ПОГЛОЩАЕТСЯ, и это граница, а не осторожность.
      // Объединение переносит ссылки поглощённой страны поглотителю, включая
      // `playerCountryId`, — то есть человек молча продолжил бы партию за
      // другую державу. §6 называет ровно один способ потерять своё
      // государство: лишиться всей земли. Раскол предлагает выбор осколка,
      // аннексия ведёт к вердикту кампании; у слияния такого пути нет.
      if (targetId === game.playerCountryId) {
        return { valid: false, rejection: { code: "mergePlayerCountry", target: target.name } };
      }

      // ЕДИНСТВЕННАЯ содержательная предпосылка: поглощается тот, чью внешнюю
      // политику ты уже ведёшь. Она живая на данных 1946 (77 пар), выражает
      // ступень «сначала подчини, потом присоедини» и закрывает главный обход —
      // мирное поглощение соседа, с которым тебя ничего не связывает.
      // Отношения порогом быть не могут: в сценарии они нули у всех.
      if (!source.diplomacy.puppets.includes(targetId)) {
        return {
          valid: false,
          rejection: { code: "mergeNotVassal", source: source.name, target: target.name },
        };
      }
      return { valid: true };
    }
  }
}

/**
 * Регионы, которыми цель ВЛАДЕЕТ, а источник фактически КОНТРОЛИРУЕТ.
 *
 * Ровно то, что аннексия вправе перевести во владение, и ровно то, из чего
 * считается доля удержанного для подчинения, — одна функция на предпосылку и
 * на эффект, чтобы «что держит держава» не могло означать разное в отказе и в
 * применении.
 */
function heldRegionsOf(game: GameState, holderId: string, ownerId: string): Region[] {
  return game.regions.filter(
    r => r.ownerCountryId === ownerId && effectiveController(r) === holderId
  );
}

/** Доля территории цели под фактическим контролем источника; ноль у страны без земли. */
function heldShareOf(game: GameState, holderId: string, ownerId: string): number {
  const owned = game.regions.filter(r => r.ownerCountryId === ownerId).length;
  if (owned === 0) return 0;
  return heldRegionsOf(game, holderId, ownerId).length / owned;
}

/**
 * Размер аудитории государства — сколько стран его вообще слышат.
 *
 * Влияние ИЛИ формальная связь, по множеству (страна, на которую есть и то, и
 * другое, считается один раз): «сколько адресатов», а не «сколько каналов».
 * Это и предпосылка `condemn`, и вход его коридора — одна функция на оба, чтобы
 * отказ и величина не могли разойтись в понимании того, что такое трибуна.
 */
function audienceOf(country: Country): number {
  const heard = new Set<string>();
  for (const [targetId, value] of Object.entries(country.diplomacy.influence)) {
    if (value > 0) heard.add(targetId);
  }
  for (const id of [
    ...country.diplomacy.allies,
    ...country.diplomacy.guarantees,
    ...country.diplomacy.puppets,
    ...country.diplomacy.sphereOfInfluence,
  ]) {
    heard.add(id);
  }
  return heard.size;
}

/**
 * Доля территории страны под ЧУЖОЙ оккупацией — вход срочности `support_proxy`.
 *
 * Считается по владению и фактическому контролю вместе: регион, которым страна
 * владеет, но который держит противник, — это и есть потерянная земля. Страна
 * без территории даёт ноль, а не деление на ноль.
 */
function occupiedShareOf(game: GameState, countryId: string): number {
  let owned = 0;
  let lost = 0;
  for (const region of game.regions) {
    if (region.ownerCountryId !== countryId) continue;
    owned++;
    if (effectiveController(region) !== countryId) lost++;
  }
  return owned > 0 ? lost / owned : 0;
}

// --------------------------------------------------------------------------
// Фазы 2-3 — Compute + Apply
// --------------------------------------------------------------------------

/** Результат применения: либо факт с величиной, либо структурная причина отказа. */
type ApplyOutcome =
  | { ok: true; applied: AppliedPrimitive }
  | { ok: false; rejection: PrimitiveRejection };

/**
 * Параметризация — `unknown`: движку здесь важен только флаг успеха, а полезная
 * нагрузка `applied` у разных команд разная (дельты полей памяти, сдвиг
 * координат, списанная поддержка). Без `unknown` каждый вызов пришлось бы
 * приводить к типу конкретной команды ради проверки, которая типа не касается.
 */
function failIfCommandFailed(results: readonly CommandResult<unknown>[]): string | undefined {
  const failed = results.find(r => !r.success);
  return failed?.error ?? (failed ? "command rejected" : undefined);
}

/**
 * Отказ КОМАНДЫ — внутренний сбой применения, а не невыполненная предпосылка.
 *
 * Текст команды сохраняется как есть и уходит только в промт: он написан для
 * разработчика («governmentSupport is not finite»), и переводить его игроку
 * незачем — игрок получает код `commandFailed` и общую формулировку.
 */
function commandFailure(verb: PrimitiveVerb, error: string): ApplyOutcome {
  return { ok: false, rejection: { code: "commandFailed", verb, error } };
}

/**
 * ФАКТИЧЕСКИЕ эффекты одного вызова `addGroupImpact` в форме отчёта.
 *
 * Именно фактические, а не запрошенные: команда клампит поле в 0..1, и у
 * насыщенной группы из запрошенных 0.41 приживается 0.02. Отчитаться намерением
 * — значит отдать сессии B выдуманное число для нарратива, ровно против
 * docs/PRIMITIVES.md §4 («цифры правдивые, не выдуманные»).
 *
 * `after` читается из состояния ПОСЛЕ команды, `before` восстанавливается
 * вычитанием принятой дельты — команда возвращает разницу после клампа, поэтому
 * пара точна, а не приблизительна.
 *
 * В список попадает КАЖДОЕ поле, которое команда пыталась изменить, включая
 * поля с нулевой дельтой: «попытались подавить, но подавлять уже некуда» — тоже
 * факт, и нарратив обязан его видеть, а не додумывать.
 */
function impactEffects(
  game: GameState,
  regionId: number,
  groupId: string,
  result: CommandResult<politicsCommands.AppliedImpact>
): GroupImpactEffect[] {
  const memory = findImpactMemory(game.groupImpactMemory, regionId, groupId);
  const effects: GroupImpactEffect[] = [];
  for (const field of IMPACT_MEMORY_FIELDS) {
    const delta = result.applied?.[field];
    if (delta === undefined) continue;
    const after = memory?.[field] ?? 0;
    effects.push({ regionId, groupId, field, before: after - delta, after, delta });
  }
  return effects;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
}

/**
 * Человеческое описание фактических следов: по каждому полю — каждая цель и то,
 * насколько она сдвинулась (или что не сдвинулась вовсе).
 *
 * Гранулярность — ПАРА (цель, поле), а не поле. До 2026-07-26 нулевую дельту
 * называли нулём только тогда, когда поле не сдвинулось ни у одной цели; стоило
 * сдвинуться хоть у кого-то — цели с нулём молча выпадали из текста. На боевых
 * данных это давало ложь ровно того класса, ради которого результат и
 * переделывался: `repress` по региону 187, где доминант (`lithuanians`, доля
 * 0.94) стоял на потолке обоих полей, печатал «moved against 4 group(s) …
 * suppression +0.420 for Russians, +0.424 for Latvians, +0.424 for Jews» — и
 * доминанта, по которому удар не прошёл, в тексте не было ВООБЩЕ. Сессия,
 * пишущая нарратив по такому тексту, сказала бы, что репрессия обрушилась на
 * литовцев.
 *
 * Поэтому правило без исключений: каждая пара (цель, поле), попавшая в
 * `effects`, попадает и в текст — сдвинувшаяся с дельтой, несдвинувшаяся со
 * словом `unchanged` и текущим значением. Умолчать о цели текст не может
 * (docs/PRIMITIVES.md §4).
 */
function describeImpacts(
  game: GameState,
  effects: readonly GroupImpactEffect[],
  options: { withRegion?: boolean } = {}
): string[] {
  const parts: string[] = [];
  for (const field of IMPACT_MEMORY_FIELDS) {
    const ofField = effects.filter(e => e.field === field);
    if (ofField.length === 0) continue;

    parts.push(
      `${field} ` +
      ofField
        .map(e =>
          (e.delta === 0 ? "unchanged" : signed(e.delta)) +
          ` for ${groupLabel(game, e.groupId)}` +
          (options.withRegion ? ` in ${regionLabelById(game, e.regionId)}` : "") +
          (e.delta === 0
            ? ` (${e.after.toFixed(3)})`
            : ` (${e.before.toFixed(3)} → ${e.after.toFixed(3)})`)
        )
        .join(", ")
    );
  }
  return parts;
}

/**
 * Хвост заголовка «сколько адресатов осталось нетронутыми» — из ДЕЛЬТ, а не из
 * числа адресатов.
 *
 * Без него заголовок `repress` («moved against 4 group(s)») считался по составу
 * региона и утверждал воздействие там, где его не было. Пустая строка, когда
 * сдвинулись все: в обычном случае хвост — шум.
 */
function untouchedNote(effects: readonly GroupImpactEffect[], addressed: number): string {
  const moved = new Set(effects.filter(e => e.delta !== 0).map(e => e.groupId)).size;
  return moved === addressed ? "" : ` (${addressed - moved} unaffected)`;
}

/** Сшивка резюме: заголовок + перечисление фактов; пустой список не даёт хвоста. */
function joinSummary(head: string, details: readonly string[]): string {
  return details.length > 0 ? `${head}: ${details.join("; ")}` : head;
}

/**
 * Локализованное имя страны для резюме — по той же причине, что `groupLabel`:
 * резюме уходит в промт, и сырой `SUN` рядом с локализованным именем региона
 * выдавал бы идентификатор кода за человеческое имя.
 */
function countryLabel(game: GameState, countryId: string): string {
  return getText(countryNamesOf(game, countryId), LLM_LOCALE) || countryId;
}

/**
 * Человеческое описание фактических сдвигов отношений — по КАЖДОЙ стороне.
 *
 * Обе стороны названы всегда, включая нулевую: у отношений та же гранулярность
 * правдивости, что у памяти воздействий, — пара (цель, поле), — и умолчать о
 * стороне, у которой не сдвинулось ничего, значит дать нарративу симметрию,
 * которой не было.
 */
function describeRelations(game: GameState, effects: readonly RelationEffect[]): string[] {
  return effects.map(effect => {
    const pair = `${countryLabel(game, effect.fromCountryId)} → ` +
      `${countryLabel(game, effect.toCountryId)}`;
    return effect.delta === 0
      ? `relations ${pair} unchanged (${effect.after.toFixed(1)})`
      : `relations ${pair} ${signed(effect.delta)} ` +
        `(${effect.before.toFixed(1)} → ${effect.after.toFixed(1)})`;
  });
}

function apply(game: GameState, primitive: Primitive): ApplyOutcome {
  const hint = intensityHint(primitive);

  switch (primitive.verb) {
    case "incite_unrest": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groupId = primitive.target.groupId!;

      // Горючесть материала — ширина идеологического разрыва «власть ↔ группа»
      // сверх порога, который примитив уже прошёл на validate. У самого порога
      // запас нулевой, и `severe` не поднимет эффект выше минимума.
      const definition = game.ethnicGroups.find(g => g.id === groupId)!;
      const controller = game.countries.find(c => c.id === effectiveController(region));
      const source = game.countries.find(c => c.id === primitive.sourceCountryId)!;
      const authority = resolveIdeologyCoordinates((controller ?? source).politics);
      const distance = ideologyDistance(authority, definition.desiredIdeology);
      const magnitude = magnitudeFromState(
        INCITE_UNREST_EMBOLDENMENT_MIN,
        INCITE_UNREST_EMBOLDENMENT_MAX,
        inciteFactor(distance),
        hint
      );

      const impact = politicsCommands.addGroupImpact(game, region.id, groupId, {
        emboldenment: magnitude,
      });
      const error = failIfCommandFailed([impact]);
      if (error) return commandFailure(primitive.verb, error);

      const targetEffects = impactEffects(game, region.id, groupId, impact);
      return {
        ok: true,
        applied: {
          verb: "incite_unrest",
          sourceCountryId: primitive.sourceCountryId,
          regionId: region.id,
          groupId,
          targetEffects,
          summary: joinSummary(
            `Agitators worked on ${groupLabel(game, groupId)} in ${regionLabel(region)}`,
            describeImpacts(game, targetEffects)
          ),
        },
      };
    }

    case "repress": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groups = targetedGroups(region, primitive.target.groupId);

      // Эффективность подавления — способность власти применить силу
      // (стабильность + легитимность) против массы конкретной группы.
      // Отчуждение считается по другой связке: охват × дефицит мандата, — и
      // легитимность работает в нём в ОБРАТНУЮ сторону (см. magnitude.ts).
      const controller = game.countries.find(c => c.id === effectiveController(region));
      const capacity = coerciveCapacity(controller);
      const legitimacy = controller?.politics.legitimacy ?? 0;
      const perGroup = groups.map(g => ({
        groupId: g.groupId,
        share: g.share,
        suppression: magnitudeFromState(
          REPRESS_SUPPRESSION_MIN,
          REPRESS_SUPPRESSION_MAX,
          repressSuppressionFactor(capacity, g.share),
          hint
        ),
        alienation: magnitudeFromState(
          REPRESS_ALIENATION_MIN,
          REPRESS_ALIENATION_MAX,
          repressAlienationFactor(g.share, legitimacy),
          hint
        ),
      }));

      const results = perGroup.map(g =>
        politicsCommands.addGroupImpact(game, region.id, g.groupId, {
          suppression: g.suppression,
          alienation: g.alienation,
        })
      );
      const error = failIfCommandFailed(results);
      if (error) return commandFailure(primitive.verb, error);

      const targetEffects = perGroup.flatMap((g, i) =>
        impactEffects(game, region.id, g.groupId, results[i]!)
      );
      return {
        ok: true,
        applied: {
          verb: "repress",
          sourceCountryId: primitive.sourceCountryId,
          regionId: region.id,
          targetEffects,
          summary: joinSummary(
            `Security forces moved against ${perGroup.length} group(s) in ` +
            `${regionLabel(region)}${untouchedNote(targetEffects, perGroup.length)}`,
            describeImpacts(game, targetEffects)
          ),
        },
      };
    }

    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groups = targetedGroups(region, primitive.target.groupId);

      // Величина уступки — охват (доля группы) × остаток доверия ×
      // правдоподобность обещания: накопленное отчуждение обесценивает жест, а
      // режим без мандата не убеждает, что доживёт до исполнения обещанного.
      const legitimacy =
        game.countries.find(c => c.id === effectiveController(region))?.politics.legitimacy ?? 0;
      const perGroup = groups.map(g => ({
        groupId: g.groupId,
        share: g.share,
        concession: magnitudeFromState(
          GRANT_AUTONOMY_CONCESSION_MIN,
          GRANT_AUTONOMY_CONCESSION_MAX,
          concessionFactor(
            g.share,
            findImpactMemory(game.groupImpactMemory, region.id, g.groupId),
            legitimacy
          ),
          hint
        ),
      }));

      const grants = perGroup.map(g =>
        politicsCommands.addGroupImpact(game, region.id, g.groupId, { concession: g.concession })
      );
      const grantError = failIfCommandFailed(grants);
      if (grantError) return commandFailure(primitive.verb, grantError);

      // Цена уступки (docs/CONCEPT.md §5.2): та же группа в соседних регионах
      // осмелела — ровно настолько, насколько громкой была сама уступка.
      // Вход здесь ФАКТИЧЕСКИЙ, а не запрошенный: соседи видят, что реально
      // дали. Группе, у которой поле уступок уже под потолком, добавить нечего —
      // и отклик соседей обязан это отражать.
      // Соседи, где этой группы нет, не затрагиваются — команда отказала бы,
      // поэтому их просто не трогаем, а не глотаем отказ.
      const spillover: CommandResult<politicsCommands.AppliedImpact>[] = [];
      const neighbourEffects: GroupImpactEffect[] = [];
      for (const neighbourId of region.neighboringRegionIds) {
        const neighbour = findRegion(game, neighbourId);
        if (!neighbour) continue;
        for (let i = 0; i < perGroup.length; i++) {
          const g = perGroup[i]!;
          if (!neighbour.demographics?.some(d => d.groupId === g.groupId)) continue;
          const echo = neighbourEmboldenment(grants[i]?.applied?.concession ?? 0);
          // Нулевой отклик не пишется вовсе: иначе у соседа заводилась бы
          // пустая запись памяти на жест, которого не было.
          if (echo <= 0) continue;
          const result = politicsCommands.addGroupImpact(
            game, neighbour.id, g.groupId, { emboldenment: echo }
          );
          spillover.push(result);
          if (result.success) {
            neighbourEffects.push(...impactEffects(game, neighbour.id, g.groupId, result));
          }
        }
      }

      const error = failIfCommandFailed(spillover);
      if (error) return commandFailure(primitive.verb, error);

      const targetEffects = perGroup.flatMap((g, i) =>
        impactEffects(game, region.id, g.groupId, grants[i]!)
      );
      // Про соседей резюме говорит ровно то, что произошло. До 2026-07-26 здесь
      // стояло безусловное «kindred communities took heart» — фраза уходила
      // наружу и при нулевом отклике, то есть при жесте, которого не было.
      //
      // Шапка нарочно нейтральная («in neighbouring regions», не «responded»):
      // список теперь содержит и соседей с нулевой дельтой (сосед, чьё поле уже
      // на потолке), и утверждать отклик за всех перечисленных она не вправе.
      const neighbourNote = neighbourEffects.length > 0
        ? describeImpacts(game, neighbourEffects, { withRegion: true }).map(
            part => `kindred communities in neighbouring regions — ${part}`
          )
        : ["no kindred community in neighbouring regions moved"];

      return {
        ok: true,
        applied: {
          verb: "grant_autonomy",
          sourceCountryId: primitive.sourceCountryId,
          regionId: region.id,
          targetEffects,
          neighbourEffects,
          summary: joinSummary(`Autonomy granted in ${regionLabel(region)}`, [
            ...describeImpacts(game, targetEffects),
            ...neighbourNote,
          ]),
        },
      };
    }

    case "enact_reform": {
      const countryId = primitive.target.countryId ?? primitive.sourceCountryId;

      // Глубина реформы — политический мандат сверх минимума, при котором она
      // вообще проходит: широкая поддержка продавливает больший сдвиг за ту же
      // фиксированную цену. Мандат читается ДО списания цены.
      const country = game.countries.find(c => c.id === countryId)!;
      const axes = reformAxes(primitive, reformStep(country, hint));

      // Читаются ДО команд: координаты могут материализоваться из ярлыка, а
      // поддержка — списаться, и «было» после этого уже не узнать.
      const coordinatesBefore = resolveIdeologyCoordinates(country.politics);
      const supportBefore = country.politics.governmentSupport;

      // Цена списывается первой и её результат проверяется ДО сдвига: если
      // платить нечем, координаты не двигаются вовсе. Последовательно, а не
      // массивом команд — иначе обе успели бы исполниться, и инвариант держался
      // бы только на внешнем откате.
      //
      // Ветка отказа платежа ДОСТИЖИМА, вопреки арифметике порогов
      // (ENACT_REFORM_MIN_GOVERNMENT_SUPPORT > ENACT_REFORM_POLITICAL_COST): при
      // неконечном `governmentSupport` предпосылка `NaN < 25` ложна и примитив
      // её проходит, а команда отказывает по проверке конечности. Тест —
      // «неконечная поддержка правительства не уезжает в координаты идеологии»
      // (PrimitiveEngine.test.ts); порядок здесь и есть то, что не даёт NaN
      // доехать до координат.
      const paid = politicsCommands.spendGovernmentSupport(
        game, countryId, ENACT_REFORM_POLITICAL_COST
      );
      const paymentError = failIfCommandFailed([paid]);
      if (paymentError) return commandFailure(primitive.verb, paymentError);

      const shift = politicsCommands.shiftCountryIdeology(
        game,
        countryId,
        axes.find(a => a.axis === "economic")?.delta ?? 0,
        axes.find(a => a.axis === "political")?.delta ?? 0
      );
      const error = failIfCommandFailed([shift]);
      if (error) return commandFailure(primitive.verb, error);

      // Отчёт — ФАКТИЧЕСКИЕ сдвиги по тем осям, которые реформа просила двигать.
      // Недостижимую ось сюда не пропускает предпосылка (validate), поэтому
      // каждая запись здесь — реально состоявшееся движение; но формулируется
      // она всё равно от дельты, а не от направления в params.
      const ideologyShifts: IdeologyShiftEffect[] = axes.map(a => {
        const delta = shift.applied?.[a.axis] ?? 0;
        return {
          countryId,
          axis: a.axis,
          direction: a.direction,
          before: coordinatesBefore[a.axis],
          after: coordinatesBefore[a.axis] + delta,
          delta,
        };
      });
      const politicalCost: PoliticalCostEffect = {
        countryId,
        field: "governmentSupport",
        before: supportBefore,
        after: country.politics.governmentSupport,
        delta: country.politics.governmentSupport - supportBefore,
      };

      const shiftNotes = ideologyShifts.map(s =>
        s.delta === 0
          ? `${s.axis} axis did not move (${s.before.toFixed(2)})`
          : `${s.axis} axis shifted ${s.direction} by ${Math.abs(s.delta).toFixed(3)} ` +
            `(${s.before.toFixed(2)} → ${s.after.toFixed(2)})`
      );
      return {
        ok: true,
        applied: {
          verb: "enact_reform",
          sourceCountryId: primitive.sourceCountryId,
          countryId,
          ideologyShifts,
          politicalCost,
          summary: joinSummary(`Reform enacted in ${countryId}`, [
            ...shiftNotes,
            `political cost ${Math.abs(politicalCost.delta).toFixed(1)} government support ` +
            `(${politicalCost.before.toFixed(1)} → ${politicalCost.after.toFixed(1)})`,
          ]),
        },
      };
    }

    case "spawn_incident": {
      const region = findRegion(game, primitive.target.regionId)!;
      const kind = incidentKindOf(primitive);
      // Тот же расчёт, что и в предпосылке: у `border_dispute` он уже гарантированно
      // даёт страну, у остальных видов — не вызывается на результат.
      const disputedWith = kind === "border_dispute"
        ? disputedNeighbourCountry(game, region)
        : undefined;

      // Крупность события — запас недовольства над порогом, который примитив
      // уже прошёл на validate: регион на самой границе даёт минимум, кипящий —
      // максимум коридора.
      const magnitude = magnitudeFromState(
        SPAWN_INCIDENT_EMBOLDENMENT_MIN,
        SPAWN_INCIDENT_EMBOLDENMENT_MAX,
        incidentFactor(regionDiscontent(game, region) ?? 0),
        hint
      );

      const mapFeatures = new MapFeatureService(game);
      // expiresAt намеренно не выставляется: MapFeatureService.removeExpiredFeatures()
      // сравнивает его с wall-clock (`new Date()`), поэтому игровая дата 1946
      // была бы «просрочена» немедленно. Предсуществующий дефект, зафиксирован
      // в docs/TODO.md; чинить его — не в этом срезе.
      const feature = mapFeatures.createMapFeature({
        type: INCIDENT_FEATURE_TYPE[kind],
        regionId: region.id,
        ownerId: effectiveController(region),
        name: `${kind} in ${regionLabel(region)}`,
        tags: ["incident", kind],
      });

      // Инцидент подогревает недовольство самой массовой группы региона —
      // событие меняет предпосылки, а не только украшает карту.
      const dominant = [...(region.demographics ?? [])].sort((a, b) => b.share - a.share)[0];
      const targetEffects: GroupImpactEffect[] = [];
      if (dominant) {
        const impact = politicsCommands.addGroupImpact(game, region.id, dominant.groupId, {
          emboldenment: magnitude,
        });
        const error = failIfCommandFailed([impact]);
        if (error) return commandFailure(primitive.verb, error);
        targetEffects.push(...impactEffects(game, region.id, dominant.groupId, impact));
      }

      return {
        ok: true,
        applied: {
          verb: "spawn_incident",
          sourceCountryId: primitive.sourceCountryId,
          regionId: region.id,
          incidentKind: kind,
          mapFeatureId: feature.id,
          ...(disputedWith === undefined ? {} : { disputedWithCountryId: disputedWith }),
          targetEffects,
          summary: joinSummary(
            `A ${kind} broke out in ${regionLabel(region)}` +
            (disputedWith === undefined ? "" : ` against ${disputedWith}`),
            describeImpacts(game, targetEffects)
          ),
        },
      };
    }

    case "split_country": {
      const target = game.countries.find(c => c.id === primitive.target.countryId)!;
      const name = getText(target.name, LLM_LOCALE);
      // Снимок казны ДО деления: раскол делит её между метрополией и осколками,
      // и заявить фактическую дельту иначе нечем (см. поле
      // `countryScalarEffects` в `types.ts`).
      const scalarsBefore = countryScalars(game);

      // Вся работа со ссылками, суммами и войнами живёт в `polityLifecycle.ts`,
      // а не здесь: обработчик глагола обязан оставаться переводом «примитив →
      // операция», иначе жизненный цикл размажется по switch'у и второй его
      // потребитель (`merge_countries`) получит собственную копию правил.
      const result = splitCountry(game, {
        countryId: target.id,
        intensity: intensityHint(primitive),
      });

      // Состояние КАМПАНИИ пересчитывается тем же ходом, а не следующим тиком:
      // «за кого играет человек» не должно ни на мгновение указывать в пустоту,
      // а решение о преемнике §7.1 привязывает именно к моменту распада.
      applyLifecycleToCampaign(game, result);

      const shardSummary = result.shards
        .map(s => `${s.countryId} (${s.regionIds.length} region(s))`)
        .join(", ");

      return {
        ok: true,
        applied: {
          verb: "split_country",
          sourceCountryId: primitive.sourceCountryId,
          countryId: target.id,
          shards: result.shards,
          ...(result.dissolvedCountryId === undefined || result.successorCountryId === undefined
            ? {}
            : {
                dissolved: {
                  countryId: result.dissolvedCountryId,
                  successorCountryId: result.successorCountryId,
                },
              }),
          ...(result.capitalReassignments[0] === undefined
            ? {}
            : { capitalMoved: result.capitalReassignments[0] }),
          closedWarIds: result.closedWarIds,
          // Казна метрополии поделена между ней и осколками — заявляется, потому
          // что у неё есть ячейка в разложении состояния. Осколки в сверку не
          // попадают: стран, которых не было в снимке «до», она исключает.
          countryScalarEffects: countryScalarDiff(scalarsBefore, countryScalars(game)).filter(
            effect => effect.countryId === target.id
          ),
          summary: joinSummary(
            result.dissolvedCountryId === undefined
              ? `${name} split: ${shardSummary} seceded`
              : `${name} fell apart into ${shardSummary}`,
            result.closedWarIds.length > 0
              ? [`wars closed: ${result.closedWarIds.join(", ")}`]
              : []
          ),
        },
      };
    }

    case "diplomacy": {
      const targetId = primitive.target.countryId;
      // Направление гарантировано предпосылкой: без него примитив сюда не
      // доезжает (`diplomacyNoDirection`).
      const direction = primitive.params!.direction!;

      // КОРИДОР ОТ СОСТОЯНИЯ, ПОЗИЦИЯ ОТ ХИНТА (docs/PRIMITIVES.md §1).
      // Ширину задают два множителя: сколько шкале осталось в запрошенную
      // сторону и насколько слово источника вообще долетает до этой цели.
      // Хинт выбирает позицию внутри того, что состояние разрешило, и вытолкнуть
      // эффект за коридор не может ничем.
      const current = relationBetween(game, primitive.sourceCountryId, targetId);
      const ties = diplomaticTiesOf(game, primitive.sourceCountryId, targetId);
      const magnitude = magnitudeFromState(
        DIPLOMACY_RELATION_MIN,
        DIPLOMACY_RELATION_MAX,
        relationRoom(current, direction) * diplomaticGrip(ties, direction),
        hint
      );

      const shift = shiftRelation(
        game,
        primitive.sourceCountryId,
        targetId,
        signedByDirection(magnitude, direction)
      );
      if (shift.error) return commandFailure(primitive.verb, shift.error);

      return {
        ok: true,
        applied: {
          verb: "diplomacy",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          direction,
          relationEffects: shift.effects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} moved to ${direction} relations ` +
            `with ${countryLabel(game, targetId)}`,
            describeRelations(game, shift.effects)
          ),
        },
      };
    }

    case "sanction": {
      const targetId = primitive.target.countryId;
      const kind = sanctionKindOf(primitive);

      // Укус санкции — экономический вес санкционера для цели; коридор при этом
      // всё равно ограничен тем, сколько шкале отношений осталось вниз.
      const current = relationBetween(game, primitive.sourceCountryId, targetId);
      const source = game.countries.find(c => c.id === primitive.sourceCountryId);
      const target = game.countries.find(c => c.id === targetId);
      const magnitude = magnitudeFromState(
        SANCTION_RELATION_MIN,
        SANCTION_RELATION_MAX,
        relationRoom(current, "worsen") *
          sanctionBite(source?.economy.gdp ?? 0, target?.economy.gdp ?? 0),
        hint
      );

      const imposed = diplomacyCommands.applySanction(game, primitive.sourceCountryId, targetId, kind);
      const imposeError = failIfCommandFailed([imposed]);
      if (imposeError) return commandFailure(primitive.verb, imposeError);

      const shift = shiftRelation(game, primitive.sourceCountryId, targetId, -magnitude);
      if (shift.error) return commandFailure(primitive.verb, shift.error);

      const cutsTrade = kind === TRADE_CUTTING_SANCTION;
      return {
        ok: true,
        applied: {
          verb: "sanction",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          sanctionType: kind,
          cutsTrade,
          relationEffects: shift.effects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} imposed ${kind} on ` +
            `${countryLabel(game, targetId)}`,
            [
              cutsTrade
                ? "exports of the target are cut from the next month on"
                : "no trade effect: only a trade_embargo cuts exports today",
              ...describeRelations(game, shift.effects),
            ]
          ),
        },
      };
    }

    case "war": {
      const targetId = primitive.target.countryId;

      const declaration = warCommands.declareWar(
        game,
        primitive.sourceCountryId,
        targetId,
        primitive.params?.warGoal
      );
      const declareError = failIfCommandFailed([declaration]);
      if (declareError || !declaration.applied) {
        return commandFailure(primitive.verb, declareError ?? "war was not created");
      }
      const war = declaration.applied;

      // Обвал отношений — КОНСТАНТА события, а не коридор: у структурного
      // глагола величины нет (тот же принцип, что у `split_country`).
      const shift = shiftRelation(
        game,
        primitive.sourceCountryId,
        targetId,
        WAR_DECLARATION_RELATION_PENALTY
      );
      if (shift.error) return commandFailure(primitive.verb, shift.error);

      const dragged = war.attackers.length + war.defenders.length - 2;
      return {
        ok: true,
        applied: {
          verb: "war",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          warId: war.id,
          attackers: [...war.attackers],
          defenders: [...war.defenders],
          relationEffects: shift.effects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} declared war on ` +
            `${countryLabel(game, targetId)}` +
            (dragged > 0 ? ` (${dragged} further state(s) dragged in by treaty)` : ""),
            describeRelations(game, shift.effects)
          ),
        },
      };
    }

    case "peace": {
      const targetId = primitive.target.countryId;

      // Снимки ДО договора: мир исполняет условия (аннексия, штраф
      // легитимности, репарации), и отчёт о них строится из дифа, а не из
      // знания о внутренностях `WarService` (см. `countryScalarDiff`).
      const scalarsBefore = countryScalars(game);
      const ownersBefore = new Map(game.regions.map(r => [r.id, r.ownerCountryId]));

      const peace = warCommands.makePeaceBetween(game, primitive.sourceCountryId, targetId);
      const peaceError = failIfCommandFailed([peace]);
      if (peaceError || peace.applied === undefined) {
        return commandFailure(primitive.verb, peaceError ?? "no war was closed");
      }

      // Столица, ушедшая по договору, переезжает. Без этого мир, отдавший
      // столицу победителю, ронял бы пост-инвариант «столица среди своих
      // регионов» и откатывал ВЕСЬ ответ — правило существует, а состояние,
      // которого оно требует, никто бы не восстановил.
      const capitalMoves: { countryId: string; from: number; to: number }[] = [];
      for (const country of game.countries) {
        const moved = reassignCapitalIfLost(game, country);
        if (moved) capitalMoves.push(moved);
      }

      const shift = shiftRelation(game, primitive.sourceCountryId, targetId, PEACE_RELATION_RELIEF);
      if (shift.error) return commandFailure(primitive.verb, shift.error);

      const annexedRegionIds = game.regions
        .filter(r => ownersBefore.get(r.id) !== r.ownerCountryId)
        .map(r => r.id);

      const countryScalarEffects = countryScalarDiff(scalarsBefore, countryScalars(game));
      const scalarNotes = countryScalarEffects.map(
        effect =>
          `${effect.field} of ${countryLabel(game, effect.countryId)} ${signed(effect.delta)} ` +
          `(${effect.before.toFixed(1)} → ${effect.after.toFixed(1)})`
      );

      return {
        ok: true,
        applied: {
          verb: "peace",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          warId: peace.applied,
          relationEffects: shift.effects,
          countryScalarEffects,
          annexedRegionIds,
          capitalMoves,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} and ${countryLabel(game, targetId)} ` +
            `made peace (war ${peace.applied})`,
            [
              annexedRegionIds.length > 0
                ? `${annexedRegionIds.length} region(s) changed hands by treaty`
                : "the border did not move",
              ...scalarNotes,
              ...describeRelations(game, shift.effects),
            ]
          ),
        },
      };
    }

    case "send_aid": {
      const targetId = primitive.target.countryId;
      const source = game.countries.find(c => c.id === primitive.sourceCountryId)!;
      const target = game.countries.find(c => c.id === targetId)!;

      // КОРИДОР ОТ СОСТОЯНИЯ. Два множителя, каждый со своим вопросом:
      // «может ли донор дать» (запас казны над порогом платёжеспособности) и
      // «насколько велика задача» (доля получателя в ВВП пары). Второй — живой
      // на поставляемых данных, первый на них почти константа и потому не
      // единственный (см. `magnitude.ts`).
      const share = magnitudeFromState(
        SEND_AID_SHARE_MIN,
        SEND_AID_SHARE_MAX,
        donorFiscalRoom(source.economy.treasury, source.economy.gdp) *
          aidScale(source.economy.gdp, target.economy.gdp),
        hint
      );

      const scalarsBefore = countryScalars(game);
      const transfer = economyCommands.transferTreasury(
        game,
        primitive.sourceCountryId,
        targetId,
        Math.max(0, source.economy.treasury) * share
      );
      const transferError = failIfCommandFailed([transfer]);
      if (transferError) return commandFailure(primitive.verb, transferError);

      // Влияние растёт настолько, насколько помощь ЗАМЕТНА получателю, и вход
      // здесь фактический — сумма, которую вернула команда после клампа, а не
      // та, что просили. Тот же принцип, что у отклика соседей на уступку:
      // получатель видит, что реально пришло.
      const moved = transfer.applied ?? 0;
      const currentInfluence = source.diplomacy.influence[targetId] ?? 0;
      const influenceGain = magnitudeFromState(
        SEND_AID_INFLUENCE_MIN,
        SEND_AID_INFLUENCE_MAX,
        influenceRoom(currentInfluence) * aidVisibility(moved, target.economy.gdp),
        hint
      );
      const influenceResult = diplomacyCommands.setInfluence(
        game,
        primitive.sourceCountryId,
        targetId,
        influenceGain
      );
      const influenceError = failIfCommandFailed([influenceResult]);
      if (influenceError) return commandFailure(primitive.verb, influenceError);

      const afterInfluence =
        game.countries.find(c => c.id === primitive.sourceCountryId)!.diplomacy.influence[targetId] ?? 0;
      const influenceEffects: InfluenceEffect[] = [
        {
          fromCountryId: primitive.sourceCountryId,
          toCountryId: targetId,
          before: currentInfluence,
          after: afterInfluence,
          delta: afterInfluence - currentInfluence,
        },
      ];
      const countryScalarEffects = countryScalarDiff(scalarsBefore, countryScalars(game));

      return {
        ok: true,
        applied: {
          verb: "send_aid",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          countryScalarEffects,
          influenceEffects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} sent aid to ` +
            `${countryLabel(game, targetId)}`,
            [
              ...describeScalars(game, countryScalarEffects),
              ...describeInfluence(game, influenceEffects),
            ]
          ),
        },
      };
    }

    case "capital_flight": {
      const region = findRegion(game, primitive.target.regionId)!;
      const controllerId = effectiveController(region);
      const controller = game.countries.find(c => c.id === controllerId);

      // КОРИДОР ОТ СОСТОЯНИЯ: сколько капитала вообще есть (развитость) и
      // насколько сломано доверие (запас стабильности вниз от порога
      // предпосылки). Оба входа живые на поставляемых данных.
      const exposure = capitalFlightExposure(region.development, region.stability);
      const gdpShare = magnitudeFromState(
        CAPITAL_FLIGHT_GDP_MIN,
        CAPITAL_FLIGHT_GDP_MAX,
        exposure,
        hint
      );

      const gdpBefore = region.gdp;
      const drain = economyCommands.drainRegionGdp(game, region.id, gdpShare);
      const drainError = failIfCommandFailed([drain]);
      if (drainError) return commandFailure(primitive.verb, drainError);

      // Удар по казне — отдельный коридор, но взвешенный ВЕСОМ РЕГИОНА в
      // экономике контролёра: паника в одной провинции империи не опустошает
      // её бюджет. Без этого веса `capital_flight` по любому окраинному региону
      // стоил бы державе столько же, сколько по её промышленному ядру.
      const scalarsBefore = countryScalars(game);
      if (controller) {
        const regionWeight =
          controller.economy.gdp > 0 ? clampShare(gdpBefore / controller.economy.gdp) : 1;
        const treasuryShare = magnitudeFromState(
          CAPITAL_FLIGHT_TREASURY_MIN,
          CAPITAL_FLIGHT_TREASURY_MAX,
          exposure * regionWeight,
          hint
        );
        const treasuryDrain = economyCommands.drainTreasury(
          game,
          controller.id,
          Math.max(0, controller.economy.treasury) * treasuryShare
        );
        const treasuryError = failIfCommandFailed([treasuryDrain]);
        if (treasuryError) return commandFailure(primitive.verb, treasuryError);
      }

      const regionEffects: RegionEconomyEffect[] = [
        {
          regionId: region.id,
          field: "gdp",
          before: gdpBefore,
          after: region.gdp,
          delta: region.gdp - gdpBefore,
        },
      ];
      const countryScalarEffects = countryScalarDiff(scalarsBefore, countryScalars(game));

      return {
        ok: true,
        applied: {
          verb: "capital_flight",
          sourceCountryId: primitive.sourceCountryId,
          regionId: region.id,
          countryId: controllerId,
          regionEffects,
          countryScalarEffects,
          summary: joinSummary(
            `Capital fled ${regionLabel(region)}`,
            [
              `regional output ${signed(regionEffects[0]!.delta)} ` +
              `(${gdpBefore.toFixed(0)} → ${region.gdp.toFixed(0)})`,
              ...describeScalars(game, countryScalarEffects),
            ]
          ),
        },
      };
    }

    case "condemn": {
      const targetId = primitive.target.countryId;
      const source = game.countries.find(c => c.id === primitive.sourceCountryId)!;
      const target = game.countries.find(c => c.id === targetId)!;

      // КОРИДОР ОТ СОСТОЯНИЯ: что цели терять (её легитимность) и есть ли кому
      // слушать (аудитория источника). Второй множитель живой — слой влияния
      // наполнен, и именно он превратил `condemn` из глагола без входов в
      // глагол с проверяемой предпосылкой.
      const audienceSize = audienceOf(source);
      const damage = magnitudeFromState(
        CONDEMN_LEGITIMACY_MIN,
        CONDEMN_LEGITIMACY_MAX,
        legitimacyRoom(target.politics.legitimacy) * podiumReach(audienceSize),
        hint
      );

      const scalarsBefore = countryScalars(game);
      const hit = politicsCommands.spendLegitimacy(game, targetId, damage);
      const hitError = failIfCommandFailed([hit]);
      if (hitError) return commandFailure(primitive.verb, hitError);

      const countryScalarEffects = countryScalarDiff(scalarsBefore, countryScalars(game));
      return {
        ok: true,
        applied: {
          verb: "condemn",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          audienceSize,
          countryScalarEffects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} condemned ` +
            `${countryLabel(game, targetId)} before ${audienceSize} state(s) that hear it`,
            describeScalars(game, countryScalarEffects)
          ),
        },
      };
    }

    case "support_proxy": {
      const targetId = primitive.target.countryId;
      const source = game.countries.find(c => c.id === primitive.sourceCountryId)!;
      const target = game.countries.find(c => c.id === targetId)!;
      // Война гарантирована предпосылкой: без неё примитив сюда не доезжает.
      const clientWar = game.wars.find(
        w => w.active && (w.attackers.includes(targetId) || w.defenders.includes(targetId))
      )!;

      // КОРИДОР ОТ СОСТОЯНИЯ: есть ли канал патронажа (влияние либо формальная
      // связь — живой вход и источник достижимого схлопывания) и насколько
      // клиент прижат (доля его земли под оккупацией, с полом больше нуля).
      const stateFactor =
        proxyTie(source.diplomacy.influence[targetId] ?? 0, hasFormalTie(source, target)) *
        proxyUrgency(occupiedShareOf(game, targetId));

      const scalarsBefore = countryScalars(game);

      // Патрон платит. Деньги и сила — ДВА эффекта одного акта, а не конверсия:
      // рынка вооружений в модели нет, и цена единицы техники была бы
      // калибровочной константой без второго потребителя.
      const cost =
        Math.max(0, source.economy.treasury) *
        magnitudeFromState(SUPPORT_PROXY_SHARE_MIN, SUPPORT_PROXY_SHARE_MAX, stateFactor, hint);
      const payment = economyCommands.drainTreasury(game, primitive.sourceCountryId, cost);
      const paymentError = failIfCommandFailed([payment]);
      if (paymentError) return commandFailure(primitive.verb, paymentError);

      // Клиент получает живую силу. База — его НАСЕЛЕНИЕ, а не его армия:
      // `activePersonnel` в поставляемом сценарии ноль у всех 157 стран, и
      // доля от нуля дала бы ноль в любом мире.
      const reinforcement =
        target.population *
        magnitudeFromState(
          SUPPORT_PROXY_PERSONNEL_MIN_SHARE,
          SUPPORT_PROXY_PERSONNEL_MAX_SHARE,
          stateFactor,
          hint
        );
      const reinforced = militaryCommands.reinforcePersonnel(game, targetId, reinforcement);
      const reinforcedError = failIfCommandFailed([reinforced]);
      if (reinforcedError) return commandFailure(primitive.verb, reinforcedError);

      const countryScalarEffects = countryScalarDiff(scalarsBefore, countryScalars(game));
      return {
        ok: true,
        applied: {
          verb: "support_proxy",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          warId: clientWar.id,
          countryScalarEffects,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} backed ` +
            `${countryLabel(game, targetId)} in war ${clientWar.id} without joining it`,
            describeScalars(game, countryScalarEffects)
          ),
        },
      };
    }

    case "puppet": {
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId)!;

      // Чем подчинение обеспечено — считается ЗДЕСЬ ЖЕ, а не берётся из
      // предпосылки: между validate и apply лежит применение предыдущих
      // примитивов батча, и рычаг мог смениться. Отчёт обязан называть тот,
      // что сработал в момент акта.
      const leverage =
        heldShareOf(game, primitive.sourceCountryId, targetId) >= VASSALAGE_MIN_HELD_SHARE
          ? "occupation"
          : "influence";

      // ОБА представления зависимости одним вызовом — в этом весь глагол.
      // Юридический статус и рантайм-отношение расходились именно потому, что
      // менять их было принято по отдельности (`subordination.ts`).
      const change = applyVassalage(game, primitive.sourceCountryId, targetId);
      if (!change) {
        const overlord = game.countries.find(c => c.id === primitive.sourceCountryId)!;
        // Предпосылка это уже проверила; сюда попасть можно только если
        // состояние сдвинулось между фазами. Тихо «применить ничего» нельзя —
        // ответ считался бы изменившим мир и канонизировал бы нарратив.
        return {
          ok: false,
          rejection: { code: "alreadyVassal", source: overlord.name, target: target.name },
        };
      }

      return {
        ok: true,
        applied: {
          verb: "puppet",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          leverage,
          statusBefore: change.statusBefore,
          statusAfter: change.statusAfter,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} subjected ` +
            `${countryLabel(game, targetId)} by ${leverage}`,
            change.statusBefore === change.statusAfter
              ? [`legal status unchanged (${change.statusAfter})`]
              : [`legal status ${change.statusBefore} -> ${change.statusAfter}`]
          ),
        },
      };
    }

    case "annex": {
      const targetId = primitive.target.countryId;
      const target = game.countries.find(c => c.id === targetId)!;
      const held = heldRegionsOf(game, primitive.sourceCountryId, targetId);

      const transfers = held.map(region =>
        warCommands.transferRegion(game, region.id, primitive.sourceCountryId)
      );
      const transferError = failIfCommandFailed(transfers);
      if (transferError) return commandFailure(primitive.verb, transferError);

      // Столица, ушедшая победителю, переезжает в крупнейший оставшийся регион.
      // Та же функция, которой двигают столицу раскол и мирный договор: второй
      // копии правила «где теперь столица» быть не может — она разошлась бы.
      const capitalMoves: { countryId: string; from: number; to: number }[] = [];
      const moved = reassignCapitalIfLost(game, target);
      if (moved) capitalMoves.push(moved);

      // Население и ВВП выводятся из регионов и обязаны быть пересчитаны у
      // ОБЕИХ сторон — иначе держава осталась бы с числами за чужую землю.
      aggregateCountryFromRegions(game.countries.find(c => c.id === primitive.sourceCountryId)!, game.regions);
      aggregateCountryFromRegions(target, game.regions);

      // ЦЕЛЬ НЕ УДАЛЯЕТСЯ, даже потеряв последний регион. Государство без
      // территории — законное состояние (§7.1: тотальное поражение даёт переход
      // в подчинённое положение, а не во владение победителем), и решение о
      // конце партии принимает машина состояний кампании, а не этот глагол.
      // Считается тем же ходом, а не следующим тиком: аннексия последнего
      // региона страны игрока обязана привести к вердикту немедленно, иначе
      // между актом и его последствием лежал бы целый игровой месяц.
      const campaignBefore = game.campaign.status;
      const campaign = evaluateCampaign(game);
      const targetRegionsLeft = game.regions.filter(r => r.ownerCountryId === targetId).length;

      return {
        ok: true,
        applied: {
          verb: "annex",
          sourceCountryId: primitive.sourceCountryId,
          targetCountryId: targetId,
          annexedRegionIds: held.map(r => r.id),
          targetRegionsLeft,
          capitalMoves,
          ...(campaign.status === "defeated" && campaignBefore !== "defeated"
            ? { campaignEnded: "defeated" as const }
            : {}),
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} annexed ${held.length} region(s) ` +
            `from ${countryLabel(game, targetId)}`,
            targetRegionsLeft === 0
              ? [`${countryLabel(game, targetId)} holds no territory left`]
              : [`${targetRegionsLeft} region(s) remain under ${countryLabel(game, targetId)}`]
          ),
        },
      };
    }

    case "merge_countries": {
      const targetId = primitive.target.countryId;
      const absorbedName = countryLabel(game, targetId);
      const absorbedRegionIds = game.regions
        .filter(r => r.ownerCountryId === targetId)
        .map(r => r.id);
      // Снимок ДО сложения: заявить фактический прирост казны и живой силы
      // иначе нечем, а не заявить — значит быть откаченным собственной сверкой.
      const scalarsBefore = countryScalars(game);
      const influencesBefore = countryInfluences(game);

      // Вся работа со ссылками, суммами и войнами — в `polityLifecycle.ts`, той
      // же машинерией, что у раскола. Обратная операция обязана пользоваться
      // тем же жизненным циклом, иначе «суммы сходятся» означало бы разное на
      // делении и на сложении.
      const result = mergeCountries(game, {
        absorberId: primitive.sourceCountryId,
        absorbedId: targetId,
      });

      return {
        ok: true,
        applied: {
          verb: "merge_countries",
          sourceCountryId: primitive.sourceCountryId,
          absorbedCountryId: targetId,
          absorbedName: result.dissolvedName ?? { en: targetId },
          absorbedRegionIds,
          countryScalarEffects: countryScalarDiff(scalarsBefore, countryScalars(game)),
          // Влияние поглотителя НА поглощённого снимается как самоссылка, а
          // влияние третьих стран на неё уходит вместе со страной. Обе дельты
          // реальны, обе имеют ячейку, обе заявляются.
          influenceEffects: influenceDiff(influencesBefore, countryInfluences(game)),
          capitalMoves: result.capitalReassignments,
          closedWarIds: result.closedWarIds,
          summary: joinSummary(
            `${countryLabel(game, primitive.sourceCountryId)} absorbed ${absorbedName} ` +
            `(${absorbedRegionIds.length} region(s))`,
            result.closedWarIds.length > 0
              ? [`wars closed: ${result.closedWarIds.join(", ")}`]
              : []
          ),
        },
      };
    }
  }
}

// --------------------------------------------------------------------------
// Батч
// --------------------------------------------------------------------------

/**
 * Порядок исполнения: мягкие в порядке массива, структурные — последними
 * (docs/PRIMITIVES.md §4, «структурный валидируется/коммитится последним»).
 * Относительный порядок внутри каждого класса сохраняется — `filter` стабилен.
 *
 * Это осознанное расхождение с соседним требованием той же §4 («Движок не
 * переупорядочивает»): два требования взаимоисключающи, выбрано более
 * операционное. Цена расхождения и решение — `docs/DECISIONS.md` 2026-07-26.
 */
function orderForExecution(primitives: readonly Primitive[]): Primitive[] {
  const soft = primitives.filter(p => !isStructural(p.verb));
  const structural = primitives.filter(p => isStructural(p.verb));
  return [...soft, ...structural];
}

/**
 * Сущности, на которые примитив действует НАПРЯМУЮ, — ключи капа «один verb на
 * цель за ход» (docs/PRIMITIVES.md §4).
 *
 * Ключ обязан совпадать с тем, что глагол реально меняет, иначе кап либо не
 * ловит спам, либо запрещает законную комбинацию:
 *   - `enact_reform` меняет страну целиком → ключ страны;
 *   - `spawn_incident` ставит объект в регион → ключ региона;
 *   - `repress` / `grant_autonomy` / `incite_unrest` пишут в память пары
 *     (регион, группа) → ключ на КАЖДУЮ затронутую пару.
 *
 * Последнее — не мелочь. Приказ по региону без названной группы бьёт по всем её
 * группам (см. `targetedGroups`), поэтому он занимает все их ключи: иначе
 * `repress(регион)` + `repress(регион, группа)` прошли бы оба и ударили бы по
 * одной группе дважды. При этом `repress(регион, A)` и `repress(регион, B)`
 * остаются законной комбинацией — ключи разные.
 *
 * Отклик соседей у `grant_autonomy` в ключи НЕ входит: сосед — побочный эффект,
 * а не цель. Иначе уступка в двух соседних регионах за ход стала бы невозможной.
 * Величину, которая приходит в пару этим каналом, ограничивает не этот кап, а
 * потолок накопления следа (`IMPACT_FIELD_TURN_CEILING`): сюда её тащить
 * нельзя, туда — можно, потому что тот кап считает не цели, а дельты.
 *
 * Вызывается только после успешного `validate`, поэтому регион и группы заведомо
 * существуют.
 */
/**
 * Цель капа — машинный КЛЮЧ счётчика плюс её локализованное ИМЯ.
 *
 * Вместе, а не двумя функциями: ключ живёт в сейве (`primitiveTurnBudget`) и
 * обязан быть стабильным независимо от языка и переименований, а причина
 * отказа обязана называть цель по-человечески — до Милстоуна 1 игрок читал в
 * ней сырое `region 68 / group estonians`. Две функции разъехались бы, и
 * отказ называл бы не ту цель, чей счётчик исчерпан.
 */
interface PrimitiveTarget {
  key: string;
  label: ExhaustedTarget;
}

/**
 * Ключ счётчика ДЛЯ ОДНОГО ГЛАГОЛА — то, что было общим шаблоном до
 * дипломатического блока.
 *
 * Отдельной функцией, а не шаблоном по месту: проверка и занятие цели обязаны
 * строить ключ ОДИНАКОВО, иначе кап тихо перестаёт срабатывать, оставаясь на
 * вид реализованным.
 */
function verbScopedKey(verb: PrimitiveVerb, entity: string): string {
  return `${verb} -> ${entity}`;
}

/**
 * Ключ счётчика, ОБЩИЙ для мягких двусторонних глаголов.
 *
 * Верб в ключ не входит намеренно, и это и есть защита от обхода коридора
 * сменой глагола: `diplomacy(worsen)` и `sanction` по одной упорядоченной паре
 * пишут в ОДНУ ячейку `relations`, поэтому раздельные ключи позволили бы
 * сложить два коридора за месяц. Общий ключ даёт доказуемую границу — за
 * игровой месяц по одной упорядоченной паре проходит не более одного мягкого
 * дипломатического акта.
 *
 * Пара УПОРЯДОЧЕННАЯ: `USA → SUN` и `SUN → USA` — разные акты разных
 * государств, и запирать одно другим было бы не защитой, а запретом отвечать.
 * Спилловера в чужие ячейки у этого домена нет по построению (отношения
 * ключуются парой), поэтому одного слота на пару достаточно — в отличие от
 * `grant_autonomy`, где отклик соседей приходит в чужие пары и потребовал
 * второго капа по величине.
 */
function bilateralPairKey(sourceCountryId: string, targetCountryId: string): string {
  return `diplomatic pair ${sourceCountryId} -> ${targetCountryId}`;
}

function targetsOf(game: GameState, primitive: Primitive): PrimitiveTarget[] {
  switch (primitive.verb) {
    case "enact_reform":
    case "split_country":
      return [
        {
          key: verbScopedKey(primitive.verb, `country ${primitive.target.countryId}`),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];

    case "spawn_incident":
      return [
        {
          key: verbScopedKey(primitive.verb, `region ${primitive.target.regionId}`),
          label: { region: regionNamesOf(game, primitive.target.regionId) },
        },
      ];

    case "incite_unrest":
      return [
        {
          key: verbScopedKey(
            primitive.verb,
            `region ${primitive.target.regionId} / group ${primitive.target.groupId}`
          ),
          label: {
            region: regionNamesOf(game, primitive.target.regionId),
            group: groupNamesOf(game, primitive.target.groupId),
          },
        },
      ];

    case "repress":
    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId)!;
      return targetedGroups(region, primitive.target.groupId).map(g => ({
        key: verbScopedKey(primitive.verb, `region ${region.id} / group ${g.groupId}`),
        label: { region: region.names, group: groupNamesOf(game, g.groupId) },
      }));
    }

    // Мягкие двусторонние — ОДИН общий слот на пару (см. `bilateralPairKey`).
    case "diplomacy":
    case "sanction":
      return [
        {
          key: bilateralPairKey(primitive.sourceCountryId, primitive.target.countryId),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];

    // Война и мир держат СВОИ ключи, а не общий слот пары. Иначе мягкий
    // примитив, применённый раньше в том же месяце, отклонял бы структурный по
    // капу цели — а отказ структурного уносит весь ответ. Своей защитой им
    // служит кап «один структурный за ход», который строже общего слота.
    case "war":
    case "peace":
      return [
        {
          key: verbScopedKey(
            primitive.verb,
            bilateralPairKey(primitive.sourceCountryId, primitive.target.countryId)
          ),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];

    // ПОМОЩЬ И ПАТРОНАЖ — ключ на упорядоченную ПАРУ, с глаголом.
    //
    // Ячейки этих двух либо парные по построению (`influence:A->B`), либо
    // оплачены СОБСТВЕННОЙ казной источника. Поэтому складывать их нескольким
    // донорам законно: десять государств, помогающих одному, — это десять
    // государств, каждое из которых заплатило само, а не десять коридоров,
    // сложенных в одну бесплатную ячейку.
    case "send_aid":
    case "support_proxy":
      return [
        {
          key: verbScopedKey(
            primitive.verb,
            bilateralPairKey(primitive.sourceCountryId, primitive.target.countryId)
          ),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];

    // ОСУЖДЕНИЕ И ОТТОК КАПИТАЛА — ключ БЕЗ ИСТОЧНИКА, и это защита, а не
    // экономия символов.
    //
    // Их ячейки принадлежат ЦЕЛИ, а не паре (`legitimacy:<цель>`,
    // `regionGdp:<регион>`), и стоят источнику НОЛЬ. Ключ с источником означал
    // бы, что десять разных государств в одном ответе складывают десять
    // коридоров в одну ячейку бесплатно, — тот же спилловер, что у отклика
    // соседей `grant_autonomy`, но здесь он выразим прямо в ключе цели и
    // потому не требует второго капа по величине.
    //
    // Цена названа: за игровой месяц осудить одну страну может только ОДИН
    // источник, и второе осуждение той же страны отклоняется, даже придя от
    // другого государства. Это сознательно — «сколько раз мир вправе ударить
    // по одной репутации за месяц» важнее, чем «кто именно ударил».
    case "condemn":
      return [
        {
          key: verbScopedKey(primitive.verb, `country ${primitive.target.countryId}`),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];

    case "capital_flight":
      return [
        {
          key: verbScopedKey(primitive.verb, `region ${primitive.target.regionId}`),
          label: { region: regionNamesOf(game, primitive.target.regionId) },
        },
      ];

    // ПОДЧИНЕНИЕ И ПОГЛОЩЕНИЕ держат СВОИ ключи на упорядоченную пару — по той
    // же причине, что `war`/`peace`, и с той же ценой: общий слот пары означал
    // бы, что мягкий дипломатический акт, применённый раньше в том же месяце,
    // отклоняет структурный по капу цели, а отказ структурного уносит ВЕСЬ
    // ответ. Их собственная защита строже общего слота: один структурный
    // примитив на игровой месяц на всю партию.
    case "puppet":
    case "annex":
    case "merge_countries":
      return [
        {
          key: verbScopedKey(
            primitive.verb,
            bilateralPairKey(primitive.sourceCountryId, primitive.target.countryId)
          ),
          label: { country: countryNamesOf(game, primitive.target.countryId) },
        },
      ];
  }
}

/** Фактический след примитива в одной тройке (регион, группа, поле памяти). */
interface ImpactDelta {
  regionId: number;
  groupId: string;
  field: ImpactMemoryField;
  delta: number;
}

/**
 * Что примитив РЕАЛЬНО дописал в память воздействий — разница снимков «до» и
 * «после», а не то, что он собирался записать.
 *
 * Дифом, а не суммой намерений глагола, по трём причинам: сюда сами собой
 * попадают побочные записи (отклик соседей у `grant_autonomy`), учитываются
 * клампы команды (у насыщенного поля запрошенные 0.41 превращаются в 0.02), и
 * новый verb попадает под кап без единой правки этого места.
 *
 * Возвращаются ВСЕ ненулевые дельты, включая отрицательные: диф служит двум
 * потребителям сразу — бюджету накопления (тот берёт только прирост, см. ниже)
 * и проверке полноты отчёта, которой убыль важна ровно так же, как прирост.
 */
function impactDeltas(before: GameState, after: GameState): ImpactDelta[] {
  const pairKey = (regionId: number, groupId: string): string => `${regionId}/${groupId}`;
  const previous = new Map<string, GroupImpactMemory>();
  for (const memory of before.groupImpactMemory) {
    previous.set(pairKey(memory.regionId, memory.groupId), memory);
  }

  const deltas: ImpactDelta[] = [];
  for (const memory of after.groupImpactMemory) {
    const was = previous.get(pairKey(memory.regionId, memory.groupId));
    for (const field of IMPACT_MEMORY_FIELDS) {
      const delta = memory[field] - (was?.[field] ?? 0);
      if (delta !== 0) {
        deltas.push({ regionId: memory.regionId, groupId: memory.groupId, field, delta });
      }
    }
  }
  return deltas;
}

/** Ключ бюджета накопления — тройка (регион, группа, поле). */
function impactBudgetKey(impact: ImpactDelta): string {
  return `${impact.field} on region ${impact.regionId} / group ${impact.groupId}`;
}

/**
 * Бюджет капов для ТЕКУЩЕГО игрового хода.
 *
 * Бюджет чужой даты читается как пустой: смена `currentDate` и есть смена хода,
 * и никакого отдельного «обнулить счётчики» в тике не требуется. Явный reset
 * был бы вторым источником истины о том, что такое ход, — а любой путь,
 * двигающий дату мимо него, молча унёс бы остатки прошлого месяца в новый.
 *
 * ОТСУТСТВИЕ поля — единственный случай, когда движок бросает исключение, и это
 * сделано намеренно. Тип объявляет поле обязательным, поэтому состояние без
 * него — не «старый сейв» (те отклоняются по `SAVE_VERSION`), а собранный мимо
 * `CreateGame` объект. Фолбэк «нет поля — считаем бюджет пустым» выглядел бы
 * дружелюбнее, но означал бы, что каждый вызов начинает счёт заново, — ровно тот
 * обход капов «за вызов вместо за ход», ради закрытия которого бюджет и переехал
 * в состояние. Громкий отказ лучше тихо снятой защиты; сообщение называет
 * причину, чтобы это не выглядело случайным `TypeError`.
 */
function turnBudgetFor(game: GameState): PrimitiveTurnBudget {
  // Приведение осознанное: тип обещает поле, но состояние приходит из JSON и
  // из тестовых фикстур, где обещание может не выполняться.
  const stored = game.primitiveTurnBudget as PrimitiveTurnBudget | undefined;
  if (!stored) {
    throw new Error(
      "GameState.primitiveTurnBudget is missing: per-turn primitive caps have no counters to " +
        "read. Refusing to fall back to an empty budget — that would silently restore the " +
        "per-call bypass the turn budget exists to prevent (docs/PRIMITIVES.md §4)."
    );
  }
  return stored.date === game.currentDate ? stored : emptyPrimitiveTurnBudget(game.currentDate);
}

/**
 * Дописывает диагностический факт об отказе с КАПОМ на число подробных записей.
 *
 * Единственная точка записи `primitive_rejected` — и движка, и LLM-пути: два
 * места с одинаковым правилом разъехались бы, а кап, который держит только один
 * канал, не кап вовсе.
 *
 * Почему кап нужен. Факты вычищаются ТОЛЬКО генерацией промта, а пишутся на
 * каждый отказ; между двумя промтами движок зовут сколько угодно раз (каждый
 * клик игрока — отдельный вызов). Замер ревью 2026-07-26: 50 отклонённых
 * приказов раздували следующий промт с 13 118 до 41 086 символов при бюджете
 * `docs/CONCEPT.md` §7 «PROMPT < ~8–10k токенов».
 *
 * Хвост не замалчивается: на первой записи сверх капа вместо подробностей
 * кладётся одна агрегатная строка — тот же приём, что `renderHiddenCrises` для
 * кризисов, и по той же причине (молчание о хвосте читалось бы как «отказов
 * ровно столько»). Дальнейшие отказы уже ничего не добавляют: агрегат сам
 * занимает слот `MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1`, поэтому счётчик
 * подробных записей больше не совпадёт с капом ни разу и второго агрегата не
 * появится — отдельного признака «агрегат уже есть» для этого не требуется.
 *
 * Считается кап ПО ИСТОЧНИКУ (2026-07-26, внешний аудит). Общая куча делала
 * точную диагностику вытесняемым ресурсом: игрок, отдавший одиннадцать заведомо
 * невозможных приказов до обработки ответа модели, занимал все подробные слоты,
 * и причина отказа примитива МОДЕЛИ приходила к ней агрегатом «хвост есть» —
 * то есть без глагола и предпосылки, из-за которых отказ и произошёл. Модель
 * после этого повторяет ту же попытку. Разделение источников делает эту
 * подмену невозможной в обе стороны: ни один канал не тратит слоты другого.
 *
 * `source` по умолчанию `"player"` намеренно: прямой вызов движка — это путь
 * приказа игрока (`routes/primitives.ts`) и тесты, а единственный канал, чья
 * диагностика защищается, обязан назвать себя явно. Новый канал, забывший
 * параметр, попадает в НЕзарезервированную корзину — безопасная сторона ошибки.
 */
export function pushRejectionFact(
  game: GameState,
  kind: RejectionFactKind,
  fact: { countryId: string; text: string; regionId?: number | undefined },
  source: WorldFactSource = "player"
): void {
  const listed = game.pendingWorldFacts.filter(
    f => f.kind === kind && (f.source ?? "player") === source
  ).length;
  if (listed > MAX_PENDING_REJECTION_FACTS_PER_SOURCE) return;

  if (listed === MAX_PENDING_REJECTION_FACTS_PER_SOURCE) {
    game.pendingWorldFacts.push({
      countryId: fact.countryId,
      kind,
      source,
      text:
        `(further rejected ${source} attempts are not listed this cycle: the diagnostic cap of ` +
        `${MAX_PENDING_REJECTION_FACTS_PER_SOURCE} entries was reached)`,
    });
    return;
  }

  game.pendingWorldFacts.push({ ...fact, kind, source });
}

/**
 * Сверка отчёта примитива с фактическим дифом состояния переехала в
 * `reconciliation.ts` и с Милстоуна 1 покрывает не только память воздействий,
 * а все числовые каналы, которые алфавит вправе менять, плюс созданные объекты
 * карты. Здесь остаётся только вызов — `findMisreportedChanges`.
 */

/**
 * Применяет батч примитивов к состоянию партии.
 *
 * Единственная точка входа для любого источника примитивов — LLM-путь, кнопка
 * игрока, тест. Ничего не мутирует до финального commit'а. Ни один примитив не
 * способен уронить вызов: всё, что не прошло, возвращается в `rejected` с
 * причиной и дополнительно попадает в `pendingWorldFacts` как диагностический
 * факт (docs/PRIMITIVES.md §3 — «чтобы не долбилась в невозможное»).
 *
 * Исключение ровно одно и не про примитивы, а про состояние: `GameState` без
 * `primitiveTurnBudget` отклоняется громко (см. `turnBudgetFor`), потому что
 * тихий фолбэк на пустой бюджет снял бы капы хода. Прежняя формулировка
 * «никогда не бросает исключений» была сильнее кода: такое состояние роняло
 * вызов `TypeError`'ом ещё до первого примитива.
 *
 * **Отказ структурного примитива отклоняет ВЕСЬ батч** (2026-07-26, внешний
 * аудит) — см. `structuralRejection` ниже.
 *
 * @param source канал, отдавший батч. Влияет только на учёт диагностики
 *   (`pushRejectionFact`), не на применение.
 */
export function applyPrimitiveBatch(
  game: GameState,
  primitives: readonly Primitive[],
  source: WorldFactSource = "player"
): PrimitiveBatchResult {
  const applied: AppliedPrimitive[] = [];
  const rejected: RejectedPrimitive[] = [];

  /**
   * Одна точка записи отказа: глагол и источник берутся из самого примитива,
   * а не переписываются на каждом из десяти мест. Пока их переписывали руками,
   * достаточно было опечатки, чтобы отказ пришёл с чужим глаголом.
   */
  const reject = (primitive: Primitive, rejection: PrimitiveRejection): void => {
    rejected.push({
      verb: primitive.verb,
      sourceCountryId: primitive.sourceCountryId,
      rejection,
    });
  };

  const ordered = orderForExecution(primitives);

  // Счётчики продолжают счёт ХОДА, а не начинаются заново на каждом вызове:
  // ответ модели и приказ игрока в одном месяце тратят общий бюджет. Локальные
  // копии — чтобы отклонённый примитив не оставлял следа в состоянии до
  // commit'а; итог дописывается обратно в `game` после переноса.
  const budget = turnBudgetFor(game);
  let softUsed = budget.softUsed;
  let structuralUsed = budget.structuralUsed;

  // Счётчик применений на пару «глагол + сущность» — кап §4 против спама.
  // Счётчик, а не множество: `MAX_PRIMITIVES_PER_TARGET_PER_TURN` — константа
  // калибровки, и её смягчение до 2 не должно требовать переписывания движка.
  const targetUses = new Map<string, number>(Object.entries(budget.targetUses));

  // Накопленный след по тройкам (регион, группа, поле) — второй кап, считающий
  // не примитивы, а величину. Нужен потому, что первый ключуется ПРЯМОЙ целью,
  // а часть эффектов приходит в пару побочно (отклик соседей у уступки) и в
  // ключи не входит намеренно. Каждая уступка — законная отдельная цель,
  // счётчик не срабатывает ни разу, но записи сходятся в одну пару.
  const impactUsed = new Map<string, number>(Object.entries(budget.impactAccrued));

  // Клон всего состояния: примитивы видят эффекты друг друга, но настоящий
  // game не меняется, пока батч не досчитан.
  const working: GameState = structuredClone(game);

  for (const primitive of ordered) {
    // Бюджет ПРОВЕРЯЕТСЯ здесь, а СПИСЫВАЕТСЯ ниже — только применённым
    // примитивом (там же, где занимается цель). До переезда счётчиков в
    // состояние хода списание на попытке было безобидным: батч был ходом, и
    // «десять предложений, восемь отказов» законно исчерпывали одно событие.
    // На горизонте хода это ломает игрока: отклонённая реформа (координата уже
    // на упоре) съедала бы ЕДИНСТВЕННЫЙ структурный слот месяца, и следующая —
    // законная — реформа получала бы «At most 1 structural per turn» при том,
    // что структурного в этом ходу не произошло вообще ничего.
    const structural = isStructural(primitive.verb);
    if (structural && structuralUsed >= MAX_STRUCTURAL_PRIMITIVES_PER_TURN) {
      reject(primitive, { code: "structuralTurnCapReached", cap: MAX_STRUCTURAL_PRIMITIVES_PER_TURN });
      continue;
    }
    if (!structural && softUsed >= MAX_SOFT_PRIMITIVES_PER_TURN) {
      reject(primitive, { code: "softTurnCapReached", cap: MAX_SOFT_PRIMITIVES_PER_TURN });
      continue;
    }

    // Предпосылки пересчитываются на актуальном состоянии, а не на состоянии
    // начала батча — иначе второй примитив в цепочке проходил бы по
    // устаревшим данным (TOCTOU, docs/PRIMITIVES.md §3).
    const verdict = validate(working, primitive);
    if (!verdict.valid) {
      reject(primitive, verdict.rejection);
      continue;
    }

    // Кап «один verb на цель за ход» (docs/PRIMITIVES.md §4). Стоит ПОСЛЕ
    // validate: примитив, невозможный по предпосылкам, должен получить
    // настоящую причину отказа, а не «дубль», и не должен занимать цель.
    //
    // Без этого капа кламп магнитуды обходится частотой: десять `repress(mild)`
    // по одной паре (регион, группа) проходят валидацию целиком (контроль и
    // состав региона не меняются, палитра та же) и упирают поле памяти в
    // потолок — ровно то, что коридор запрещает делать одним примитивом.
    // Счёт идёт по ходу, поэтому неважно, пришли они одним батчем или десятью
    // отдельными запросами.
    const targets = targetsOf(working, primitive);
    const exhausted = targets.filter(
      t => (targetUses.get(t.key) ?? 0) >= MAX_PRIMITIVES_PER_TARGET_PER_TURN
    );
    if (exhausted.length > 0) {
      reject(primitive, {
        code: "targetTurnCapReached",
        verb: primitive.verb,
        cap: MAX_PRIMITIVES_PER_TARGET_PER_TURN,
        targets: exhausted.map(t => t.label),
      });
      continue;
    }

    // Снимок до примитива: и точка отката, и база для проверки палитры.
    const before: GameState = structuredClone(working);
    const outcome = apply(working, primitive);

    if (!outcome.ok) {
      restore(working, before);
      reject(primitive, outcome.rejection);
      continue;
    }

    const violations = findPaletteViolations(primitive.verb, collectChangedPaths(before, working));
    if (violations.length > 0) {
      restore(working, before);
      reject(primitive, { code: "paletteViolation", verb: primitive.verb, paths: violations });
      continue;
    }

    const deltas = impactDeltas(before, working);

    // Отчёт правдив: то, о чём примитив отчитался, и то, что он реально
    // изменил, совпадают — по набору ключей И по величине, в обе стороны
    // (`reconciliation.ts`). Сверяется с ФАКТИЧЕСКИМ дифом состояния, а не с
    // намерением обработчика, — то есть тем же способом, что и палитра.
    //
    // С Милстоуна 1 сверка покрывает ВСЕ числовые каналы алфавита, а не только
    // память воздействий: координаты идеологии, поддержка правительства и факт
    // создания объекта карты входят в неё наравне. До этого обработчик, соврав
    // о сдвиге координат, ловился внешним тестом, но не откатом. Вне сверки
    // остаётся `nextFeatureId` — счётчик, а не заявление о мире.
    const misreported = findMisreportedChanges(outcome.applied, before, working);
    if (misreported.length > 0) {
      restore(working, before);
      reject(primitive, {
        code: "resultMisreported",
        verb: primitive.verb,
        mismatches: misreported,
      });
      continue;
    }

    // Кап накопления следа. Считается по ФАКТИЧЕСКОМУ дифу, поэтому ловит и
    // прямые записи, и побочные (соседи), и любой будущий verb. Проверяется
    // после apply — раньше фактической дельты просто не существует, — и при
    // переполнении примитив откатывается ЦЕЛИКОМ (§3, защита №1), а не
    // подрезается до остатка бюджета: «полусобытий» не бывает.
    //
    // В бюджет идёт только ПРИРОСТ. Убыль не возвращается: ни один verb сегодня
    // память не уменьшает, а если такой появится, «сначала сбить поле, потом
    // накачать заново» не должно становиться способом обойти потолок.
    const accrued = deltas.filter(d => d.delta > 0);
    const overflow = accrued.filter(
      d =>
        (impactUsed.get(impactBudgetKey(d)) ?? 0) + d.delta >
        IMPACT_FIELD_TURN_CEILING[d.field] + IMPACT_FIELD_TURN_CEILING_TOLERANCE
    );
    if (overflow.length > 0) {
      restore(working, before);
      // Названа ОДНА переполнившаяся тройка, а не все: причина уходит и
      // игроку, и в промт, а перечисление десятка ключей раздувает секцию
      // отказов ровно тем, ради ограничения чего заведены капы длины.
      const worst = overflow[0]!;
      reject(primitive, {
        code: "impactCeilingReached",
        field: worst.field,
        region: regionNamesOf(working, worst.regionId),
        group: groupNamesOf(working, worst.groupId),
        ceiling: IMPACT_FIELD_TURN_CEILING[worst.field],
        wouldTotal: (impactUsed.get(impactBudgetKey(worst)) ?? 0) + worst.delta,
      });
      continue;
    }

    // Ход тратится только ПРИМЕНЁННЫМ примитивом: откаченный (отказ команды
    // или нарушение палитры) состояния не изменил, и ни цель, ни слот хода за
    // ним запирать не за что.
    if (structural) structuralUsed += 1;
    else softUsed += 1;
    for (const target of targets) {
      targetUses.set(target.key, (targetUses.get(target.key) ?? 0) + 1);
    }
    for (const impact of accrued) {
      const key = impactBudgetKey(impact);
      impactUsed.set(key, (impactUsed.get(key) ?? 0) + impact.delta);
    }
    applied.push(outcome.applied);
  }

  // Отказ СТРУКТУРНОГО примитива отклоняет весь батч (docs/PRIMITIVES.md §3,
  // «структурные — весь ответ reject»; исправлено 2026-07-26 по внешнему
  // аудиту).
  //
  // Почему нельзя было оставить как было. Структурный валидируется последним,
  // поэтому к моменту его отказа мягкие примитивы того же ответа уже лежат на
  // `working` — и коммитились вместе с ним. Ответ «поднять волнения + провести
  // реформу» применял волнения, отклонял реформу и оставлял мир в состоянии,
  // которого модель не предлагала: реформа была ЦЕНОЙ волнений в её замысле, а
  // получилась только цена без реформы. Это то же «полусобытие», которое §3
  // запрещает защитой №1, только собранное из двух примитивов вместо одного.
  //
  // Найденное здесь расходится с фразой §4 «его reject не откатывает уже
  // применённые мягкие». Две фразы одного документа взаимоисключающи; выбрана
  // §3, потому что она формулирует ПРАВИЛО класса, а §4 описывала порядок
  // исполнения и лишь мимоходом его продолжала. Текст §4 приведён к §3.
  //
  // Цена решения названа прямо: структурный, отклонённый по капу хода (слот уже
  // потратил игрок), уносит с собой мягкие примитивы того же ответа. Это
  // осознанно — «весь ответ reject» без исключений проще объяснить и модели, и
  // игроку, чем набор оговорок, а модель получает причину диагностическим
  // фактом и следующий ход предлагает уже без структурного.
  const structuralRejection = rejected.find(r => r.verb !== undefined && isStructural(r.verb));
  const structuralVerb = structuralRejection?.verb;

  if (structuralVerb !== undefined) {
    // Причина отката ССЫЛАЕТСЯ на отказавший структурный, но не пересказывает
    // его причину: сама эта причина уже лежит в том же списке отдельной
    // записью, и дублировать её значило бы показать один отказ дважды — и
    // игроку, и в промте, где место считано.
    for (const rolledBack of applied) {
      rejected.push({
        verb: rolledBack.verb,
        sourceCountryId: rolledBack.sourceCountryId,
        rejection: { code: "structuralRollback", structuralVerb },
      });
    }
    applied.length = 0;
  }

  // Commit: состояние переносится целиком одним шагом. Промежуточных
  // «полусостояний» настоящий game не видел ни разу. Пустой батч (или батч, где
  // всё отклонено, в том числе откаченный структурным отказом) до состояния
  // вообще не дотрагивается.
  if (applied.length > 0) restore(game, working);

  // Бюджет хода пишется ПОСЛЕ commit'а по той же причине, по какой ниже
  // пишется диагностика: `working` — клон, снятый ДО этого вызова, и перенос
  // вернул бы в состояние прежние счётчики, обнулив весь смысл учёта.
  //
  // Пишется всегда, а не только при `applied.length > 0`: дата бюджета обязана
  // догнать текущий ход даже там, где применять было нечего, иначе состояние
  // осталось бы помечено прошлым месяцем.
  //
  // При откате структурным отказом возвращаются счётчики НАЧАЛА вызова: ход
  // тратит только применённый примитив, а после отката применённых нет ни
  // одного (то же правило, что и для отдельного отклонённого примитива, просто
  // на весь батч).
  game.primitiveTurnBudget = structuralRejection
    ? { ...budget, date: game.currentDate }
    : {
        date: game.currentDate,
        softUsed,
        structuralUsed,
        targetUses: Object.fromEntries(targetUses),
        impactAccrued: Object.fromEntries(impactUsed),
      };

  // Счётчики целей, ключуемые исчезнувшей страной, снимаются здесь: бюджет
  // пишется после commit'а из локальных копий, снятых ДО применения, и общий
  // перенос ссылок до него не достаёт (см. `pruneTurnBudgetTargets`).
  pruneTurnBudgetTargets(game);

  // Диагностика пишется ПОСЛЕ commit'а, прямо в боевое состояние: факты об
  // отказах не участвуют в откате и не должны быть перетёрты переносом. Кап на
  // число подробных записей держит `pushRejectionFact`.
  for (const rejection of rejected) {
    pushRejectionFact(
      game,
      "primitive_rejected",
      {
        // Только СУЩЕСТВУЮЩАЯ страна: источник примитива приходит от модели и
        // вполне может не существовать — ровно за это отказ `unknownSourceCountry`
        // и выдан. Висячая ссылка в диагностике уронила бы пост-инварианты
        // (§7.1) и откатила весь ответ, а сам факт всё равно не доехал бы до
        // промта: секции у несуществующей страны нет.
        countryId:
          rejection.sourceCountryId !== undefined &&
          game.countries.some(c => c.id === rejection.sourceCountryId)
            ? rejection.sourceCountryId
            : game.playerCountryId,
        text: rejectionFactText(rejection),
      },
      source
    );
  }

  return { applied, rejected };
}

/**
 * Строка диагностического факта об отказе — ОДНА для всех слоёв.
 *
 * Отказ схемы, границы агентности и предпосылки движка приходят в промт одной
 * секцией и не должны отличаться формой: модель узнаёт правило из текста, а не
 * из того, кто его написал (docs/PRIMITIVES.md §3). Английский рендер берётся
 * из `rejections.ts` — там же, где живёт русский для игрока, чтобы у кода
 * отказа не завелось третьего представления.
 */
export function rejectionFactText(rejected: RejectedPrimitive): string {
  const verb = rejected.verb ?? "malformed primitive";
  return `Attempt rejected (${verb}): ${rejectionPromptText(rejected.rejection)}`;
}

/**
 * Атомарный commit/rollback для plain-JSON состояния: значения `source`
 * переносятся в `target` **на месте**, без подмены объектов и массивов.
 *
 * Почему не `Object.assign`, как было до 2026-07-26: он подменял каждый
 * верхнеуровневый объект клоном, и любая ссылка, взятая до вызова
 * (`const region = game.regions.find(...)`), после commit'а указывала на
 * отсоединённый объект — запись в неё терялась молча, чтение отдавало
 * устаревшее. Сессия B зовёт движок из роутов и `LLMService` посреди хода,
 * то есть ровно в этой ситуации. Второй дефект того же места: `Object.assign`
 * не удаляет ключи, поэтому первый же verb, лениво заводящий новое поле в
 * `GameState`, получал бы неполный откат.
 *
 * Идентичность элементов массивов сохраняется ПО СТАБИЛЬНОМУ КЛЮЧУ, а не по
 * позиции (Милстоун 1, сессия жизненного цикла — `elementIdentity.ts`). До
 * этого элемент с индексом i считался тем же объектом, что элемент с индексом
 * i, и глагол, вставляющий страну в середину ростера или удаляющий её оттуда,
 * молча переселял бы взятые ранее ссылки на СОСЕДНЮЮ страну. Прежний JSDoc
 * честно называл это ограничением и требовал от такого глагола пересобирать
 * ссылки самому; жизненный цикл делает такие глаголы штатными, и требование
 * «каждый автор помнит сам» перестаёт быть выполнимым.
 *
 * Теперь: элемент, найденный по ключу в обоих снимках, переносится НА МЕСТЕ
 * (ссылка на него остаётся живой, где бы он ни оказался в массиве); элемент,
 * которого в цели нет, берётся из источника как есть; элемент, которого нет в
 * источнике, исчезает. Массивы без идентичности (`string[]`, `number[]`)
 * остаются позиционными — у их элементов идентичности действительно нет.
 *
 * Экспортируется ради прямого теста инвариантов переноса (удаление ключей,
 * сохранение ссылок); снаружи движка вызывать её незачем.
 */
export function restore(target: GameState, source: GameState): void {
  assignInPlace(target as unknown as Record<string, unknown>, source as unknown as Record<string, unknown>);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assignInPlace(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }

  for (const [key, sourceValue] of Object.entries(source)) {
    target[key] = mergeValue(target[key], sourceValue);
  }
}

function mergeValue(targetValue: unknown, sourceValue: unknown): unknown {
  if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
    const merged = targetValue as unknown[];
    const index = identityIndex(merged);

    // Массив без идентичности элементов (`string[]`, `number[]`) — позиционно:
    // это не уступка, а верное сравнение для значений без ключа.
    if (!index) {
      merged.length = sourceValue.length;
      for (let i = 0; i < sourceValue.length; i++) {
        merged[i] = mergeValue(merged[i], sourceValue[i]);
      }
      return merged;
    }

    const next: unknown[] = [];
    for (const item of sourceValue) {
      const key = elementIdentity(item);
      const existing = key === undefined ? undefined : index.get(key);
      // Найденный по ключу элемент переносится НА МЕСТЕ: внешняя ссылка на
      // него остаётся живой, куда бы он ни переехал в массиве.
      next.push(existing === undefined ? item : mergeValue(existing, item));
    }
    merged.length = 0;
    merged.push(...next);
    return merged;
  }

  if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
    assignInPlace(targetValue, sourceValue);
    return targetValue;
  }

  return sourceValue;
}
