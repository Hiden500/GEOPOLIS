import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type MapFeatureType } from "@shared/types/map/MapFeature";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import {
  ideologyDistance,
  regionDiscontent,
  resolveIdeologyCoordinates,
} from "@shared/utils/discontent";
import {
  PRIMITIVE_INTENSITY_MULTIPLIER,
  PRIMITIVE_DEFAULT_INTENSITY,
  INCITE_UNREST_MIN_DISTANCE,
  INCITE_UNREST_EMBOLDENMENT_BASE,
  REPRESS_SUPPRESSION_BASE,
  REPRESS_ALIENATION_BASE,
  GRANT_AUTONOMY_CONCESSION_BASE,
  GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_BASE,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_EMBOLDENMENT_BASE,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  ENACT_REFORM_COORDINATE_STEP,
  ENACT_REFORM_POLITICAL_COST,
  MAX_SOFT_PRIMITIVES_PER_BATCH,
  MAX_STRUCTURAL_PRIMITIVES_PER_BATCH,
} from "@shared/defines/discontent";
import { MapFeatureService } from "../services/MapFeatureService";
import * as politicsCommands from "../commands/politics";
import { type CommandResult } from "../commands/types";
import { collectChangedPaths } from "./statePaths";
import { findPaletteViolations } from "./palette";
import {
  type AppliedPrimitive,
  type IncidentKind,
  type Primitive,
  type PrimitiveBatchResult,
  type PreconditionResult,
  type RejectedPrimitive,
  isStructural,
} from "./types";

/**
 * Движок примитивов — «сердце сложности» (docs/PRIMITIVES.md §3).
 *
 * Три фазы на примитив: **Validate** (предпосылки → pass / reject целиком) →
 * **Compute** (магнитуду считает движок из состояния и качественных params) →
 * **Apply** (только поля палитры, атомарно).
 *
 * Три защиты, которые здесь реализованы буквально:
 *   1. Reject целиком, не частично — примитив, упавший на любом шаге,
 *      откатывается к снимку до себя; «полусобытий» не бывает.
 *   2. Нарратив только после commit — движок возвращает `applied[]` с
 *      фактическими величинами; текст пишет вызывающий по этому списку, а не
 *      по своим намерениям.
 *   3. Палитра эффектов — изменённые пути состояния сверяются с whitelist'ом
 *      (palette.ts) в рантайме, а не только в тесте.
 *
 * Работа идёт на структурном клоне состояния; в настоящий `game` результат
 * попадает одним присваиванием в конце (commit). Порядок массива — порядок
 * исполнения (§4): каждый следующий примитив видит эффект предыдущего.
 * Структурные исполняются последними, и их reject не откатывает уже
 * применённые мягкие (§4).
 */

function intensityMultiplier(primitive: Primitive): number {
  const hint = primitive.params?.intensity ?? PRIMITIVE_DEFAULT_INTENSITY;
  return PRIMITIVE_INTENSITY_MULTIPLIER[hint] ?? PRIMITIVE_INTENSITY_MULTIPLIER[PRIMITIVE_DEFAULT_INTENSITY]!;
}

function findRegion(game: GameState, regionId: number | undefined): Region | undefined {
  if (regionId === undefined) return undefined;
  return game.regions.find(r => r.id === regionId);
}

function regionLabel(region: Region): string {
  return getText(region.names, LLM_LOCALE) || `region ${region.id}`;
}

/**
 * Группы региона, на которые действует примитив: явно названная — только она,
 * иначе всё население региона (репрессии/уступки адресуются и региону тоже,
 * docs/PRIMITIVES.md §2 — target «регион/группа»).
 */
function targetedGroups(region: Region, groupId: string | undefined): string[] {
  const present = (region.demographics ?? []).map(d => d.groupId);
  if (groupId === undefined) return present;
  return present.includes(groupId) ? [groupId] : [];
}

const INCIDENT_FEATURE_TYPE: Record<IncidentKind, MapFeatureType> = {
  protest: "protest",
  uprising: "uprising",
  border_dispute: "border_dispute",
};

const DEFAULT_INCIDENT_KIND: IncidentKind = "protest";

// --------------------------------------------------------------------------
// Фаза 1 — Validate
// --------------------------------------------------------------------------

function validate(game: GameState, primitive: Primitive): PreconditionResult {
  const source = game.countries.find(c => c.id === primitive.sourceCountryId);
  if (!source) return { valid: false, reason: `Unknown source country: ${primitive.sourceCountryId}` };

  switch (primitive.verb) {
    case "incite_unrest": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) return { valid: false, reason: `Unknown region: ${primitive.target.regionId}` };
      if (!primitive.target.groupId) {
        return { valid: false, reason: "incite_unrest requires a target group" };
      }
      if (!region.demographics?.some(d => d.groupId === primitive.target.groupId)) {
        return {
          valid: false,
          reason: `Group ${primitive.target.groupId} does not live in ${regionLabel(region)}`,
        };
      }
      const definition = game.ethnicGroups.find(g => g.id === primitive.target.groupId);
      if (!definition) {
        return { valid: false, reason: `Unknown ethnic group: ${primitive.target.groupId}` };
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
          reason:
            `Ideological distance ${distance.toFixed(2)} between the authorities and ` +
            `${primitive.target.groupId} is below the ${INCITE_UNREST_MIN_DISTANCE} threshold`,
        };
      }
      return { valid: true };
    }

    case "repress":
    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) return { valid: false, reason: `Unknown region: ${primitive.target.regionId}` };

      // Предпосылка обоих глаголов — контроль над регионом: нельзя ни
      // подавлять, ни давать автономию там, где ты не власть.
      if (effectiveController(region) !== primitive.sourceCountryId) {
        return {
          valid: false,
          reason: `${primitive.sourceCountryId} does not control ${regionLabel(region)}`,
        };
      }
      if (targetedGroups(region, primitive.target.groupId).length === 0) {
        return {
          valid: false,
          reason: primitive.target.groupId
            ? `Group ${primitive.target.groupId} does not live in ${regionLabel(region)}`
            : `${regionLabel(region)} has no mapped demographics`,
        };
      }
      return { valid: true };
    }

    case "enact_reform": {
      const countryId = primitive.target.countryId ?? primitive.sourceCountryId;
      const country = game.countries.find(c => c.id === countryId);
      if (!country) return { valid: false, reason: `Unknown country: ${countryId}` };

      const { economicDirection, politicalDirection } = primitive.params ?? {};
      if (!economicDirection && !politicalDirection) {
        return { valid: false, reason: "enact_reform requires at least one direction" };
      }

      // Политическая цена (docs/PRIMITIVES.md §2): реформа не проходит на
      // пустом политическом капитале.
      if (country.politics.governmentSupport < ENACT_REFORM_MIN_GOVERNMENT_SUPPORT) {
        return {
          valid: false,
          reason:
            `Government support ${country.politics.governmentSupport.toFixed(1)} is below the ` +
            `${ENACT_REFORM_MIN_GOVERNMENT_SUPPORT} needed to push a reform through`,
        };
      }
      return { valid: true };
    }

    case "spawn_incident": {
      const region = findRegion(game, primitive.target.regionId);
      if (!region) return { valid: false, reason: `Unknown region: ${primitive.target.regionId}` };

      // Предпосылка — контекст (docs/PRIMITIVES.md §2): инцидент вырастает из
      // уже существующего напряжения, а не из пустого места.
      const discontent = regionDiscontent(game, region);
      if (discontent === undefined) {
        return { valid: false, reason: `${regionLabel(region)} has no mapped demographics` };
      }
      if (discontent < SPAWN_INCIDENT_MIN_DISCONTENT) {
        return {
          valid: false,
          reason:
            `Discontent ${discontent.toFixed(2)} in ${regionLabel(region)} is below the ` +
            `${SPAWN_INCIDENT_MIN_DISCONTENT} threshold for an incident`,
        };
      }
      return { valid: true };
    }
  }
}

// --------------------------------------------------------------------------
// Фазы 2-3 — Compute + Apply
// --------------------------------------------------------------------------

/** Результат применения: либо факт с величиной, либо причина отказа команды. */
type ApplyOutcome = { ok: true; applied: AppliedPrimitive } | { ok: false; reason: string };

function failIfCommandFailed(results: CommandResult[]): string | undefined {
  const failed = results.find(r => !r.success);
  return failed?.error ?? (failed ? "command rejected" : undefined);
}

function apply(game: GameState, primitive: Primitive): ApplyOutcome {
  const multiplier = intensityMultiplier(primitive);

  switch (primitive.verb) {
    case "incite_unrest": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groupId = primitive.target.groupId!;
      const magnitude = INCITE_UNREST_EMBOLDENMENT_BASE * multiplier;

      const error = failIfCommandFailed([
        politicsCommands.addGroupImpact(game, region.id, groupId, { emboldenment: magnitude }),
      ]);
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude,
          regionId: region.id,
          countryId: primitive.sourceCountryId,
          summary: `Agitators emboldened ${groupId} in ${regionLabel(region)}`,
        },
      };
    }

    case "repress": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groups = targetedGroups(region, primitive.target.groupId);
      const suppression = REPRESS_SUPPRESSION_BASE * multiplier;
      const alienation = REPRESS_ALIENATION_BASE * multiplier;

      const error = failIfCommandFailed(
        groups.map(groupId =>
          politicsCommands.addGroupImpact(game, region.id, groupId, { suppression, alienation })
        )
      );
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: suppression,
          regionId: region.id,
          countryId: primitive.sourceCountryId,
          summary:
            `Security forces suppressed unrest in ${regionLabel(region)} ` +
            `(${groups.length} group(s)); resentment deepened`,
        },
      };
    }

    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groups = targetedGroups(region, primitive.target.groupId);
      const concession = GRANT_AUTONOMY_CONCESSION_BASE * multiplier;
      const neighbourEffect = GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_BASE * multiplier;

      const results: CommandResult[] = groups.map(groupId =>
        politicsCommands.addGroupImpact(game, region.id, groupId, { concession })
      );

      // Цена уступки (docs/CONCEPT.md §5.2): та же группа в соседних регионах
      // осмелела. Соседи, где этой группы нет, не затрагиваются — команда
      // отказала бы, поэтому их просто не трогаем, а не глотаем отказ.
      for (const neighbourId of region.neighboringRegionIds) {
        const neighbour = findRegion(game, neighbourId);
        if (!neighbour) continue;
        for (const groupId of groups) {
          if (!neighbour.demographics?.some(d => d.groupId === groupId)) continue;
          results.push(
            politicsCommands.addGroupImpact(game, neighbour.id, groupId, {
              emboldenment: neighbourEffect,
            })
          );
        }
      }

      const error = failIfCommandFailed(results);
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: concession,
          regionId: region.id,
          countryId: primitive.sourceCountryId,
          summary:
            `Autonomy granted in ${regionLabel(region)}; kindred communities ` +
            `in neighbouring regions took heart`,
        },
      };
    }

    case "enact_reform": {
      const countryId = primitive.target.countryId ?? primitive.sourceCountryId;
      const { economicDirection, politicalDirection } = primitive.params ?? {};

      const deltaEconomic = economicDirection === undefined
        ? 0
        : (economicDirection === "right" ? ENACT_REFORM_COORDINATE_STEP : -ENACT_REFORM_COORDINATE_STEP);
      const deltaPolitical = politicalDirection === undefined
        ? 0
        : (politicalDirection === "democratic" ? ENACT_REFORM_COORDINATE_STEP : -ENACT_REFORM_COORDINATE_STEP);

      // Цена списывается первой: если платить нечем, координаты не сдвинутся
      // вовсе (примитив отклоняется целиком и откатывается вызывающим).
      const error = failIfCommandFailed([
        politicsCommands.spendGovernmentSupport(game, countryId, ENACT_REFORM_POLITICAL_COST),
        politicsCommands.shiftCountryIdeology(game, countryId, deltaEconomic, deltaPolitical),
      ]);
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: ENACT_REFORM_COORDINATE_STEP,
          countryId,
          summary:
            `Reform enacted in ${countryId}: ` +
            `${economicDirection ? `economy shifted ${economicDirection}` : "economy unchanged"}, ` +
            `${politicalDirection ? `politics shifted ${politicalDirection}` : "politics unchanged"}`,
        },
      };
    }

    case "spawn_incident": {
      const region = findRegion(game, primitive.target.regionId)!;
      const kind = primitive.params?.incidentKind ?? DEFAULT_INCIDENT_KIND;
      const magnitude = SPAWN_INCIDENT_EMBOLDENMENT_BASE * multiplier;

      const mapFeatures = new MapFeatureService(game);
      // expiresAt намеренно не выставляется: MapFeatureService.removeExpiredFeatures()
      // сравнивает его с wall-clock (`new Date()`), поэтому игровая дата 1946
      // была бы «просрочена» немедленно. Предсуществующий дефект, зафиксирован
      // в docs/TODO.md; чинить его — не в этом срезе.
      mapFeatures.createMapFeature({
        type: INCIDENT_FEATURE_TYPE[kind],
        regionId: region.id,
        ownerId: effectiveController(region),
        name: `${kind} in ${regionLabel(region)}`,
        tags: ["incident", kind],
      });

      // Инцидент подогревает недовольство самой массовой группы региона —
      // событие меняет предпосылки, а не только украшает карту.
      const dominant = [...(region.demographics ?? [])].sort((a, b) => b.share - a.share)[0];
      if (dominant) {
        const error = failIfCommandFailed([
          politicsCommands.addGroupImpact(game, region.id, dominant.groupId, {
            emboldenment: magnitude,
          }),
        ]);
        if (error) return { ok: false, reason: error };
      }

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude,
          regionId: region.id,
          countryId: primitive.sourceCountryId,
          summary: `A ${kind} broke out in ${regionLabel(region)}`,
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
 * (docs/PRIMITIVES.md §4). Возвращает пары «примитив + его позиция», чтобы
 * диагностика ссылалась на исходный порядок.
 */
function orderForExecution(primitives: readonly Primitive[]): Primitive[] {
  const soft = primitives.filter(p => !isStructural(p.verb));
  const structural = primitives.filter(p => isStructural(p.verb));
  return [...soft, ...structural];
}

/**
 * Применяет батч примитивов к состоянию партии.
 *
 * Единственная точка входа для любого источника примитивов — LLM-путь, кнопка
 * игрока, тест. Ничего не мутирует до финального commit'а и никогда не бросает
 * исключений: всё, что не прошло, возвращается в `rejected` с причиной и
 * дополнительно попадает в `pendingWorldFacts` как диагностический факт
 * (docs/PRIMITIVES.md §3 — «чтобы не долбилась в невозможное»).
 */
export function applyPrimitiveBatch(
  game: GameState,
  primitives: readonly Primitive[]
): PrimitiveBatchResult {
  const applied: AppliedPrimitive[] = [];
  const rejected: RejectedPrimitive[] = [];

  const ordered = orderForExecution(primitives);
  let softBudget = MAX_SOFT_PRIMITIVES_PER_BATCH;
  let structuralBudget = MAX_STRUCTURAL_PRIMITIVES_PER_BATCH;

  // Клон всего состояния: примитивы видят эффекты друг друга, но настоящий
  // game не меняется, пока батч не досчитан.
  const working: GameState = structuredClone(game);

  for (const primitive of ordered) {
    const structural = isStructural(primitive.verb);
    if (structural) {
      if (structuralBudget <= 0) {
        rejected.push({
          verb: primitive.verb,
          sourceCountryId: primitive.sourceCountryId,
          reason: `At most ${MAX_STRUCTURAL_PRIMITIVES_PER_BATCH} structural primitive(s) per response`,
        });
        continue;
      }
      structuralBudget -= 1;
    } else {
      if (softBudget <= 0) {
        rejected.push({
          verb: primitive.verb,
          sourceCountryId: primitive.sourceCountryId,
          reason: `At most ${MAX_SOFT_PRIMITIVES_PER_BATCH} soft primitives per response`,
        });
        continue;
      }
      softBudget -= 1;
    }

    // Предпосылки пересчитываются на актуальном состоянии, а не на состоянии
    // начала батча — иначе второй примитив в цепочке проходил бы по
    // устаревшим данным (TOCTOU, docs/PRIMITIVES.md §3).
    const verdict = validate(working, primitive);
    if (!verdict.valid) {
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason: verdict.reason,
      });
      continue;
    }

    // Снимок до примитива: и точка отката, и база для проверки палитры.
    const before: GameState = structuredClone(working);
    const outcome = apply(working, primitive);

    if (!outcome.ok) {
      restore(working, before);
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason: outcome.reason,
      });
      continue;
    }

    const violations = findPaletteViolations(primitive.verb, collectChangedPaths(before, working));
    if (violations.length > 0) {
      restore(working, before);
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason: `Effect outside the ${primitive.verb} palette: ${violations.join(", ")}`,
      });
      continue;
    }

    applied.push(outcome.applied);
  }

  // Commit: состояние подменяется целиком одним шагом. Промежуточных
  // «полусостояний» настоящий game не видел ни разу.
  restore(game, working);

  // Диагностика — уже в закоммиченное состояние, поэтому переживает подмену.
  for (const rejection of rejected) {
    game.pendingWorldFacts.push({
      countryId: rejection.sourceCountryId,
      kind: "primitive_rejected",
      text: `Attempt rejected (${rejection.verb}): ${rejection.reason}`,
    });
  }

  return { applied, rejected };
}

/**
 * Переносит содержимое `source` в `target` по верхнеуровневым ключам. Именно
 * так выглядит атомарный commit/rollback для plain-JSON состояния: ссылка на
 * сам объект `game` остаётся прежней (её держат сервисы), а всё содержимое
 * заменяется разом.
 */
function restore(target: GameState, source: GameState): void {
  Object.assign(target, source);
}
