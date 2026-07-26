import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type MapFeatureType } from "@shared/types/map/MapFeature";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import {
  findImpactMemory,
  ideologyDistance,
  regionDiscontent,
  resolveIdeologyCoordinates,
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
  SPAWN_INCIDENT_EMBOLDENMENT_MIN,
  SPAWN_INCIDENT_EMBOLDENMENT_MAX,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  ENACT_REFORM_COORDINATE_STEP_MIN,
  ENACT_REFORM_COORDINATE_STEP_MAX,
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
  magnitudeFromState,
  coerciveCapacity,
  repressSuppressionFactor,
  repressAlienationFactor,
  concessionFactor,
  neighbourEmboldenment,
  inciteFactor,
  incidentFactor,
  reformMandateFactor,
  shareWeightedMean,
} from "./magnitude";
import {
  type AppliedPrimitive,
  type IncidentKind,
  type Primitive,
  type PrimitiveBatchResult,
  type PreconditionResult,
  type PrimitiveIntensity,
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
 *      по своим намерениям.
 *   3. Палитра эффектов — изменённые пути состояния сверяются с whitelist'ом
 *      (palette.ts) в рантайме, а не только в тесте.
 *
 * Работа идёт на структурном клоне состояния; в настоящий `game` результат
 * попадает одним переносом в конце (commit, см. `restore` — он сохраняет
 * идентичность объектов, чтобы ссылки, взятые до вызова, оставались живыми).
 * Порядок массива — порядок
 * исполнения (§4): каждый следующий примитив видит эффект предыдущего.
 * Структурные исполняются последними, и их reject не откатывает уже
 * применённые мягкие (§4).
 */

function intensityHint(primitive: Primitive): PrimitiveIntensity {
  return primitive.params?.intensity ?? PRIMITIVE_DEFAULT_INTENSITY;
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

      // Эффективность подавления — способность власти применить силу
      // (стабильность + легитимность) против массы конкретной группы.
      // Отчуждение, наоборот, от умелости власти не зависит и растёт с долей.
      const capacity = coerciveCapacity(
        game.countries.find(c => c.id === effectiveController(region))
      );
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
          repressAlienationFactor(g.share),
          hint
        ),
      }));

      const error = failIfCommandFailed(
        perGroup.map(g =>
          politicsCommands.addGroupImpact(game, region.id, g.groupId, {
            suppression: g.suppression,
            alienation: g.alienation,
          })
        )
      );
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: shareWeightedMean(perGroup.map(g => ({ share: g.share, value: g.suppression }))),
          regionId: region.id,
          countryId: primitive.sourceCountryId,
          summary:
            `Security forces suppressed unrest in ${regionLabel(region)} ` +
            `(${perGroup.length} group(s)); resentment deepened`,
        },
      };
    }

    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId)!;
      const groups = targetedGroups(region, primitive.target.groupId);

      // Величина уступки — охват (доля группы) × остаток доверия: накопленное
      // отчуждение обесценивает жест, поэтому уступка после репрессий работает
      // слабее, чем та же уступка до них.
      const perGroup = groups.map(g => ({
        groupId: g.groupId,
        share: g.share,
        concession: magnitudeFromState(
          GRANT_AUTONOMY_CONCESSION_MIN,
          GRANT_AUTONOMY_CONCESSION_MAX,
          concessionFactor(g.share, findImpactMemory(game.groupImpactMemory, region.id, g.groupId)),
          hint
        ),
      }));

      const results: CommandResult[] = perGroup.map(g =>
        politicsCommands.addGroupImpact(game, region.id, g.groupId, { concession: g.concession })
      );

      // Цена уступки (docs/CONCEPT.md §5.2): та же группа в соседних регионах
      // осмелела — ровно настолько, насколько громкой была сама уступка.
      // Соседи, где этой группы нет, не затрагиваются — команда отказала бы,
      // поэтому их просто не трогаем, а не глотаем отказ.
      for (const neighbourId of region.neighboringRegionIds) {
        const neighbour = findRegion(game, neighbourId);
        if (!neighbour) continue;
        for (const g of perGroup) {
          if (!neighbour.demographics?.some(d => d.groupId === g.groupId)) continue;
          results.push(
            politicsCommands.addGroupImpact(game, neighbour.id, g.groupId, {
              emboldenment: neighbourEmboldenment(g.concession),
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
          magnitude: shareWeightedMean(perGroup.map(g => ({ share: g.share, value: g.concession }))),
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

      // Глубина реформы — политический мандат сверх минимума, при котором она
      // вообще проходит: широкая поддержка продавливает больший сдвиг за ту же
      // фиксированную цену. Мандат читается ДО списания цены.
      const country = game.countries.find(c => c.id === countryId)!;
      const step = magnitudeFromState(
        ENACT_REFORM_COORDINATE_STEP_MIN,
        ENACT_REFORM_COORDINATE_STEP_MAX,
        reformMandateFactor(country.politics.governmentSupport),
        hint
      );

      const deltaEconomic = economicDirection === undefined
        ? 0
        : (economicDirection === "right" ? step : -step);
      const deltaPolitical = politicalDirection === undefined
        ? 0
        : (politicalDirection === "democratic" ? step : -step);

      // Цена списывается первой и её результат проверяется ДО сдвига: если
      // платить нечем, координаты не двигаются вовсе. Последовательно, а не
      // массивом команд — иначе обе успели бы исполниться, и инвариант держался
      // бы только на внешнем откате. Сегодня ветка отказа недостижима
      // (ENACT_REFORM_MIN_GOVERNMENT_SUPPORT > ENACT_REFORM_POLITICAL_COST,
      // предпосылка отсеивает раньше) — поэтому и теста на неё нет; порядок
      // здесь стоит как страховка на случай пересмотра этих двух чисел.
      const paid = politicsCommands.spendGovernmentSupport(
        game, countryId, ENACT_REFORM_POLITICAL_COST
      );
      const paymentError = failIfCommandFailed([paid]);
      if (paymentError) return { ok: false, reason: paymentError };

      const error = failIfCommandFailed([
        politicsCommands.shiftCountryIdeology(game, countryId, deltaEconomic, deltaPolitical),
      ]);
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: step,
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

  // Commit: состояние переносится целиком одним шагом. Промежуточных
  // «полусостояний» настоящий game не видел ни разу. Пустой батч (или батч, где
  // всё отклонено) до состояния вообще не дотрагивается — `working` в этот
  // момент побайтно равен `game`.
  if (applied.length > 0) restore(game, working);

  // Диагностика пишется ПОСЛЕ commit'а, прямо в боевое состояние: факты об
  // отказах не участвуют в откате и не должны быть перетёрты переносом.
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
 * Идентичность сохраняется позиционно: элемент массива с индексом i остаётся
 * тем же объектом. Для примитивов среза этого достаточно — ни один из них не
 * переставляет и не удаляет регионы/страны. Верб, который начнёт это делать,
 * обязан будет пересобирать ссылки сам (и это стоит отдельной проверки).
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
    merged.length = sourceValue.length;
    for (let i = 0; i < sourceValue.length; i++) {
      merged[i] = mergeValue(merged[i], sourceValue[i]);
    }
    return merged;
  }

  if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
    assignInPlace(targetValue, sourceValue);
    return targetValue;
  }

  return sourceValue;
}
