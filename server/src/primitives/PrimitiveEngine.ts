import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type MapFeatureType } from "@shared/types/map/MapFeature";
import {
  IMPACT_MEMORY_FIELDS,
  type GroupImpactMemory,
  type ImpactMemoryField,
} from "@shared/types/politics/Demographics";
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
  MAX_PRIMITIVES_PER_TARGET_PER_TURN,
  IMPACT_FIELD_BATCH_CEILING,
  IMPACT_FIELD_BATCH_CEILING_TOLERANCE,
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
 *      по своим намерениям. «Фактическими» здесь буквально: `magnitude` — это
 *      то, что вернула команда ПОСЛЕ клампов, а не то, что посчитала фаза
 *      Compute. У насыщенного поля памяти эти два числа расходятся в разы.
 *   3. Палитра эффектов — изменённые пути состояния сверяются с whitelist'ом
 *      (palette.ts) в рантайме, а не только в тесте.
 *
 * Капы батча (§4) — четыре штуки: ≤10 мягких, ≤1 структурный, «один verb на
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

      // Реформа — внутриполитический акт (docs/PRIMITIVES.md §2: «страна;
      // политическая цена»). Без этой предпосылки SUN проводил реформу в USA:
      // координаты идеологии США уезжали, а `governmentSupport` списывался у
      // НИХ, то есть цену платил не тот, кто действует. Сменить курс чужой
      // страны алфавит позволяет иначе — через `stage_coup`, `support_proxy`,
      // давление на предпосылки, — но не приказом извне.
      if (countryId !== primitive.sourceCountryId) {
        return {
          valid: false,
          reason:
            `${primitive.sourceCountryId} cannot enact a reform in ${countryId}: ` +
            `a reform is a domestic act of the country that pays for it`,
        };
      }

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
 * Средняя по долям ФАКТИЧЕСКАЯ дельта поля памяти.
 *
 * Именно фактическая, а не запрошенная: `addGroupImpact` клампит поле в 0..1, и
 * у насыщенной группы из запрошенных 0.41 приживается 0.02. Отчитаться
 * намерением — значит отдать сессии B выдуманное число для нарратива, ровно
 * против docs/PRIMITIVES.md §4 («цифры правдивые, не выдуманные»).
 */
function actualMean(
  perGroup: readonly { share: number }[],
  results: readonly CommandResult<politicsCommands.AppliedImpact>[],
  field: politicsCommands.ImpactField
): number {
  return shareWeightedMean(
    perGroup.map((g, i) => ({ share: g.share, value: results[i]?.applied?.[field] ?? 0 }))
  );
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
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: impact.applied?.emboldenment ?? 0,
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
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: actualMean(perGroup, results, "suppression"),
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
      if (grantError) return { ok: false, reason: grantError };

      // Цена уступки (docs/CONCEPT.md §5.2): та же группа в соседних регионах
      // осмелела — ровно настолько, насколько громкой была сама уступка.
      // Вход здесь ФАКТИЧЕСКИЙ, а не запрошенный: соседи видят, что реально
      // дали. Группе, у которой поле уступок уже под потолком, добавить нечего —
      // и отклик соседей обязан это отражать.
      // Соседи, где этой группы нет, не затрагиваются — команда отказала бы,
      // поэтому их просто не трогаем, а не глотаем отказ.
      const spillover: CommandResult<politicsCommands.AppliedImpact>[] = [];
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
          spillover.push(
            politicsCommands.addGroupImpact(game, neighbour.id, g.groupId, { emboldenment: echo })
          );
        }
      }

      const error = failIfCommandFailed(spillover);
      if (error) return { ok: false, reason: error };

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: actualMean(perGroup, grants, "concession"),
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

      const shift = politicsCommands.shiftCountryIdeology(
        game, countryId, deltaEconomic, deltaPolitical
      );
      const error = failIfCommandFailed([shift]);
      if (error) return { ok: false, reason: error };

      // Фактическая глубина реформы — среднее ФАКТИЧЕСКИХ сдвигов по тем осям,
      // которые реформа просила двигать. Ось у края спектра (`political = -1`
      // при авторитарном направлении) не сдвинется вовсе, и отчёт запрошенным
      // шагом был бы про неё выдумкой.
      const actualShifts: number[] = [];
      if (economicDirection !== undefined) actualShifts.push(Math.abs(shift.applied?.economic ?? 0));
      if (politicalDirection !== undefined) actualShifts.push(Math.abs(shift.applied?.political ?? 0));

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude:
            actualShifts.reduce((sum, v) => sum + v, 0) / Math.max(1, actualShifts.length),
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
      let actualEmboldenment = 0;
      if (dominant) {
        const impact = politicsCommands.addGroupImpact(game, region.id, dominant.groupId, {
          emboldenment: magnitude,
        });
        const error = failIfCommandFailed([impact]);
        if (error) return { ok: false, reason: error };
        actualEmboldenment = impact.applied?.emboldenment ?? 0;
      }

      return {
        ok: true,
        applied: {
          verb: primitive.verb,
          magnitude: actualEmboldenment,
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
 * потолок накопления следа (`IMPACT_FIELD_BATCH_CEILING`): сюда её тащить
 * нельзя, туда — можно, потому что тот кап считает не цели, а дельты.
 *
 * Вызывается только после успешного `validate`, поэтому регион и группы заведомо
 * существуют.
 */
function targetEntities(game: GameState, primitive: Primitive): string[] {
  switch (primitive.verb) {
    case "enact_reform":
      return [`country ${primitive.target.countryId ?? primitive.sourceCountryId}`];

    case "spawn_incident":
      return [`region ${primitive.target.regionId}`];

    case "incite_unrest":
    case "repress":
    case "grant_autonomy": {
      const region = findRegion(game, primitive.target.regionId)!;
      return targetedGroups(region, primitive.target.groupId).map(
        g => `region ${region.id} / group ${g.groupId}`
      );
    }
  }
}

/**
 * Ключ счётчика капа. Отдельной функцией, а не двумя одинаковыми шаблонами по
 * месту: проверка и занятие цели обязаны строить ключ ОДИНАКОВО, иначе кап
 * тихо перестаёт срабатывать, оставаясь на вид реализованным.
 */
function targetUseKey(primitive: Primitive, entity: string): string {
  return `${primitive.verb} -> ${entity}`;
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
 * Учитываются только положительные дельты. Убыль в бюджет не возвращается: ни
 * один verb сегодня память не уменьшает, а если такой появится, «сначала
 * сбить поле, потом накачать заново» не должно становиться способом обойти
 * потолок.
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
      if (delta > 0) {
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

  // Счётчик применений на пару «глагол + сущность» — кап §4 против спама.
  // Счётчик, а не множество: `MAX_PRIMITIVES_PER_TARGET_PER_TURN` — константа
  // калибровки, и её смягчение до 2 не должно требовать переписывания движка.
  const targetUses = new Map<string, number>();

  // Накопленный след по тройкам (регион, группа, поле) — второй кап, считающий
  // не примитивы, а величину. Нужен потому, что первый ключуется ПРЯМОЙ целью,
  // а часть эффектов приходит в пару побочно (отклик соседей у уступки) и в
  // ключи не входит намеренно. Каждая уступка — законная отдельная цель,
  // счётчик не срабатывает ни разу, но записи сходятся в одну пару.
  const impactUsed = new Map<string, number>();

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

    // Кап «один verb на цель за ход» (docs/PRIMITIVES.md §4). Стоит ПОСЛЕ
    // validate: примитив, невозможный по предпосылкам, должен получить
    // настоящую причину отказа, а не «дубль», и не должен занимать цель.
    //
    // Без этого капа кламп магнитуды обходится частотой: батч из десяти
    // `repress(mild)` по одной паре (регион, группа) проходит валидацию целиком
    // (контроль и состав региона не меняются, палитра та же) и упирает поле
    // памяти в потолок — ровно то, что коридор запрещает делать одним примитивом.
    const entities = targetEntities(working, primitive);
    const exhausted = entities.filter(
      e => (targetUses.get(targetUseKey(primitive, e)) ?? 0) >= MAX_PRIMITIVES_PER_TARGET_PER_TURN
    );
    if (exhausted.length > 0) {
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason:
          `At most ${MAX_PRIMITIVES_PER_TARGET_PER_TURN} ${primitive.verb} per target per turn; ` +
          `already acted on this turn: ${exhausted.join(", ")}`,
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

    // Кап накопления следа. Считается по ФАКТИЧЕСКОМУ дифу, поэтому ловит и
    // прямые записи, и побочные (соседи), и любой будущий verb. Проверяется
    // после apply — раньше фактической дельты просто не существует, — и при
    // переполнении примитив откатывается ЦЕЛИКОМ (§3, защита №1), а не
    // подрезается до остатка бюджета: «полусобытий» не бывает.
    const deltas = impactDeltas(before, working);
    const overflow = deltas.filter(
      d =>
        (impactUsed.get(impactBudgetKey(d)) ?? 0) + d.delta >
        IMPACT_FIELD_BATCH_CEILING[d.field] + IMPACT_FIELD_BATCH_CEILING_TOLERANCE
    );
    if (overflow.length > 0) {
      restore(working, before);
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason:
          `Batch impact ceiling reached: ` +
          overflow
            .map(
              d =>
                `${impactBudgetKey(d)} would total ` +
                `${((impactUsed.get(impactBudgetKey(d)) ?? 0) + d.delta).toFixed(3)} ` +
                `(max ${IMPACT_FIELD_BATCH_CEILING[d.field]} per batch)`
            )
            .join("; "),
      });
      continue;
    }

    // Цель занимается только ПРИМЕНЁННЫМ примитивом: откаченный (отказ команды
    // или нарушение палитры) состояния не изменил, и запирать за ним цель не за что.
    for (const entity of entities) {
      const key = targetUseKey(primitive, entity);
      targetUses.set(key, (targetUses.get(key) ?? 0) + 1);
    }
    for (const impact of deltas) {
      const key = impactBudgetKey(impact);
      impactUsed.set(key, (impactUsed.get(key) ?? 0) + impact.delta);
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
