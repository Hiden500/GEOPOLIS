import { type GameState } from "../types/GameState";
import { type Region } from "../types/map/Region";
import { type Country } from "../types/Country";
import { type PoliticsState } from "../types/PoliticsState";
import { type IdeologyCoordinates } from "../types/politics/Ideology";
import { IDEOLOGY_MAX_DISTANCE } from "../types/politics/Ideology";
import {
  type EthnicGroupDefinition,
  type GroupImpactMemory,
} from "../types/politics/Demographics";
import { effectiveController } from "./regionControl";
import {
  IDEOLOGY_LABEL_COORDINATES,
  IDEOLOGY_FALLBACK_COORDINATES,
  DISCONTENT_BASE,
  DISCONTENT_DISTANCE_WEIGHT,
  DISCONTENT_WELFARE_WEIGHT,
  DISCONTENT_EMBOLDENMENT_WEIGHT,
  DISCONTENT_SUPPRESSION_WEIGHT,
  DISCONTENT_CONCESSION_WEIGHT,
  ALIENATION_DISTANCE_WEIGHT,
  WELFARE_COUNTRY_PARITY_RATIO,
  WELFARE_PARITY,
  WELFARE_SATURATION_RATIO,
  DISCONTENT_PROSPERITY_RELIEF,
} from "../defines/discontent";

/**
 * Вывод недовольства — чистые функции над состоянием (docs/CONCEPT.md §4.1:
 * «настроение/недовольство НЕ хранится, движок ВЫВОДИТ его»). Ничего не
 * мутирует и ничего не кэширует: единственное хранимое — память воздействий
 * (GameState.groupImpactMemory), которую двигают примитивы, а гасит
 * DiscontentTick.
 *
 * Живёт в `shared/`, а не в `server/src/simulation/`, чтобы клиент мог
 * показать то же число теми же правилами, не дублируя формулу.
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Координаты власти: явные, если есть в данных; иначе — читаются с именованного
 * ярлыка идеологии (частичное покрытие сценария — штатное состояние).
 */
export function resolveIdeologyCoordinates(politics: PoliticsState): IdeologyCoordinates {
  if (politics.ideologyCoordinates) return politics.ideologyCoordinates;
  return IDEOLOGY_LABEL_COORDINATES[politics.ideology] ?? IDEOLOGY_FALLBACK_COORDINATES;
}

/**
 * Евклидова дистанция между двумя позициями спектра, нормированная в 0..1
 * делением на диагональ квадрата [-1,1]² (docs/CONCEPT.md §4.2 — «геометрия
 * недовольства», не таблица «нация X при режиме Y»).
 */
export function ideologyDistance(a: IdeologyCoordinates, b: IdeologyCoordinates): number {
  const dEconomic = a.economic - b.economic;
  const dPolitical = a.political - b.political;
  return clamp01(Math.hypot(dEconomic, dPolitical) / IDEOLOGY_MAX_DISTANCE);
}

/**
 * Относительное положение региона 0..1: ВВП на душу региона против ВВП на душу
 * его страны, по ЛОГАРИФМИЧЕСКОЙ шкале с паритетом в `WELFARE_PARITY` (0.5).
 * Мера относительная — недовольство рождает отставание от своей же страны, а не
 * абсолютная бедность 1946 года. Дышит от EconomyTick (тот растит region.gdp с
 * посекторным бонусом, то есть неравномерно), в отличие от region.development,
 * который тиками не меняется вовсе.
 *
 * ДВУСТОРОННЯЯ: 0.5 — ровно средний по стране, ниже — отстающий, выше —
 * опережающий. До 2026-08-01 мера была `clamp01(отношение)`, и весь верх шкалы
 * срезался в 1: у 536 регионов из 1399 экономический член недовольства был
 * тождественным нулём (обоснование и замер — `WELFARE_PARITY` в
 * `shared/src/defines/discontent.ts`).
 *
 * `country` здесь — ЭКОНОМИЧЕСКИЙ ориентир региона, а не его власть. При
 * оккупации это разные страны, и путать их нельзя: агрегат оккупанта данный
 * регион не включает вовсе (`ownerCountryId` — источник истины для агрегации),
 * поэтому деление на его подушевой ВВП сравнивало бы регион с множеством, в
 * которое он не входит. Кого подставлять — решает `regionWelfareReference`.
 *
 * Ориентир неизвестен или вырожден — возвращается ПАРИТЕТ, а не 1: единица
 * теперь означает «регион втрое богаче своей страны» и дала бы такому региону
 * максимальную скидку к недовольству из ниоткуда.
 */
export function regionWelfare(region: Region, country: Country | undefined): number {
  if (!country || region.population <= 0 || country.population <= 0) return WELFARE_PARITY;

  const countryPerCapita = country.economy.gdp / country.population;
  if (countryPerCapita <= 0) return WELFARE_PARITY;

  const regionPerCapita = region.gdp / region.population;
  const ratio = regionPerCapita / (countryPerCapita * WELFARE_COUNTRY_PARITY_RATIO);
  if (ratio <= 0) return 0;

  const offset = Math.log(ratio) / Math.log(WELFARE_SATURATION_RATIO);
  return clamp01(WELFARE_PARITY + WELFARE_PARITY * offset);
}

/** Память воздействий на пару (регион, группа); undefined — следов нет. */
export function findImpactMemory(
  memory: readonly GroupImpactMemory[],
  regionId: number,
  groupId: string
): GroupImpactMemory | undefined {
  return memory.find(m => m.regionId === regionId && m.groupId === groupId);
}

/**
 * Эффективная идеологическая дистанция: геометрия спектра плюс накопленное
 * отчуждение. Именно здесь живёт «подавил → загнал вглубь»: репрессия сбивает
 * недовольство через `suppression` (гаснет быстро), но поднимает `alienation`
 * (почти не гаснет) — и равновесие уезжает вверх, а не возвращается на место.
 */
export function effectiveDistance(
  authority: IdeologyCoordinates,
  desired: IdeologyCoordinates,
  memory: GroupImpactMemory | undefined
): number {
  const geometric = ideologyDistance(authority, desired);
  const alienation = memory?.alienation ?? 0;
  return clamp01(geometric + alienation * ALIENATION_DISTANCE_WEIGHT);
}

/** Недовольство одной группы в одном регионе, 0..1. */
export function groupDiscontent(
  authority: IdeologyCoordinates,
  desired: IdeologyCoordinates,
  welfare: number,
  memory: GroupImpactMemory | undefined
): number {
  // Экономика входит ДВУСТОРОННЕ, но двумя РАЗНЫМИ способами, и это не
  // симметрия ради красоты (см. `DISCONTENT_PROSPERITY_RELIEF`):
  //   отставание ДОБАВЛЯЕТ недовольство — нищета зла сама по себе;
  //   опережение УМНОЖАЕТ имеющееся на долю < 1 — благополучие не создаёт
  //   довольство из ничего, оно смягчает то, что уже есть.
  const standing = clamp01(welfare);
  const shortfall = Math.max(0, (WELFARE_PARITY - standing) / WELFARE_PARITY);
  const surplus = Math.max(0, (standing - WELFARE_PARITY) / WELFARE_PARITY);

  const raw =
    DISCONTENT_BASE +
    DISCONTENT_DISTANCE_WEIGHT * effectiveDistance(authority, desired, memory) +
    DISCONTENT_WELFARE_WEIGHT * shortfall +
    DISCONTENT_EMBOLDENMENT_WEIGHT * (memory?.emboldenment ?? 0) -
    DISCONTENT_SUPPRESSION_WEIGHT * (memory?.suppression ?? 0) -
    DISCONTENT_CONCESSION_WEIGHT * (memory?.concession ?? 0);

  return clamp01(raw * (1 - DISCONTENT_PROSPERITY_RELIEF * surplus));
}

/** Разложение недовольства региона по группам — для UI, промта и диагностики. */
export interface GroupDiscontentBreakdown {
  groupId: string;
  share: number;
  discontent: number;
}

/**
 * Контекст региона для вывода недовольства: кто здесь власть (с учётом
 * оккупации) и насколько регион экономически отстал.
 */
export function regionAuthority(game: GameState, region: Region): Country | undefined {
  const controllerId = effectiveController(region);
  return game.countries.find(c => c.id === controllerId);
}

/**
 * С кем регион СРАВНИВАЕТ свой уровень жизни — легальный владелец, а не
 * фактический контролёр.
 *
 * Оккупация меняет власть (чью идеологию население терпит), но не меняет
 * систему отсчёта достатка: житель оккупированной провинции сопоставляет себя
 * со своей страной, а не со страной оккупанта. У этого есть и арифметическая
 * причина: `country.economy.gdp` агрегируется по `ownerCountryId`, поэтому
 * агрегат оккупанта оккупированный регион НЕ включает — деление на него
 * сравнивало бы регион с множеством, в которое он не входит. Аудит формул
 * 2026-07-30 намерил цену этой подмены: бедный регион под богатой державой
 * получал до +0.25 недовольства ниоткуда, и ровно столько же скачком терял при
 * освобождении.
 *
 * Владельца в партии не осталось (страну поглотили — `split_country`/аннексия) —
 * откатываемся на контролёра: сравнивать не с чем, а паритет по умолчанию
 * прятал бы реальную нищету присоединённой территории.
 */
export function regionWelfareReference(game: GameState, region: Region): Country | undefined {
  return (
    game.countries.find(c => c.id === region.ownerCountryId) ?? regionAuthority(game, region)
  );
}

/**
 * Недовольство по каждой группе региона. Пустой массив — регион не размечен
 * демографией (частичное покрытие данных) либо в нём нет известных групп.
 */
export function regionGroupDiscontent(
  game: GameState,
  region: Region
): GroupDiscontentBreakdown[] {
  if (!region.demographics || region.demographics.length === 0) return [];

  const country = regionAuthority(game, region);
  const authority = country
    ? resolveIdeologyCoordinates(country.politics)
    : IDEOLOGY_FALLBACK_COORDINATES;
  // Власть и экономический ориентир — РАЗНЫЕ страны при оккупации, см.
  // regionWelfareReference.
  const welfare = regionWelfare(region, regionWelfareReference(game, region));

  const groupsById = new Map<string, EthnicGroupDefinition>(
    game.ethnicGroups.map(g => [g.id, g])
  );

  const breakdown: GroupDiscontentBreakdown[] = [];
  for (const entry of region.demographics) {
    const definition = groupsById.get(entry.groupId);
    // Группа без определения в каталоге не выдумывается: её доля просто не
    // участвует (Zod-схема загрузки такого не пропустит, но сейв/тест — могут).
    if (!definition) continue;

    const memory = findImpactMemory(game.groupImpactMemory, region.id, entry.groupId);
    breakdown.push({
      groupId: entry.groupId,
      share: entry.share,
      discontent: groupDiscontent(authority, definition.desiredIdeology, welfare, memory),
    });
  }
  return breakdown;
}

/**
 * Недовольство региона 0..1 — доля-взвешенная сумма недовольства групп.
 * `undefined` для неразмеченного региона: это «неизвестно», а не «ноль»
 * (регион без демо-состава не должен выглядеть образцово спокойным).
 */
export function regionDiscontent(game: GameState, region: Region): number | undefined {
  const breakdown = regionGroupDiscontent(game, region);
  if (breakdown.length === 0) return undefined;

  const totalShare = breakdown.reduce((sum, g) => sum + g.share, 0);
  if (totalShare <= 0) return undefined;

  const weighted = breakdown.reduce((sum, g) => sum + g.share * g.discontent, 0);
  return clamp01(weighted / totalShare);
}
