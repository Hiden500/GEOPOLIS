import { type GameState, type WorldFactSource } from "@shared/types/GameState";
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
import { ALLY_RELATION_THRESHOLD } from "@shared/defines/diplomacy";
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
} from "./magnitude";
import {
  type AppliedPrimitive,
  type GroupImpactEffect,
  type IdeologyAxis,
  type IdeologyShiftEffect,
  type IncidentKind,
  type PoliticalCostEffect,
  type Primitive,
  type PrimitiveBatchResult,
  type PreconditionResult,
  type PrimitiveIntensity,
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
 *      объекта карты. В КАНАЛЕ ПАМЯТИ ВОЗДЕЙСТВИЙ скрытых и выдуманных эффектов
 *      не бывает: отчёт сверяется с фактическим дифом памяти по ключам и по
 *      величине, в обе стороны (см. `findMisreportedImpacts`). Остальные каналы
 *      — координаты идеологии, поддержка правительства, объекты карты и
 *      `nextFeatureId` — под эту сверку НЕ попадают: там правдивость держат
 *      палитра и дисциплина обработчика, проверяемые внешними тестами.
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
  const definition = game.ethnicGroups.find(g => g.id === groupId);
  return getText(definition?.names, LLM_LOCALE) || groupId;
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

function incidentKindOf(primitive: Primitive): IncidentKind {
  return primitive.params?.incidentKind ?? DEFAULT_INCIDENT_KIND;
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

function reformAxes(primitive: Primitive, step: number): ReformAxisRequest[] {
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
          reason:
            `Reform in ${countryId} would not move anything: ` +
            stuck
              .map(
                a =>
                  `the ${a.axis} axis is already at ${current[a.axis].toFixed(2)}, the ` +
                  `${a.delta < 0 ? IDEOLOGY_AXIS_MIN : IDEOLOGY_AXIS_MAX} bound of the spectrum ` +
                  `in the ${a.direction} direction`
              )
              .join("; "),
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

      // Предпосылки ПО ВИДУ инцидента (добавлено 2026-07-26 по внешнему аудиту).
      // До этого `incidentKind` не участвовал в валидации вовсе: на одном и том
      // же состоянии проходили и `protest`, и `uprising`, и `border_dispute` — с
      // одинаковой величиной. Качественный параметр превращал бытовое
      // недовольство в пограничный спор, а движок не возражал.
      const kind = incidentKindOf(primitive);

      if (kind === "uprising" && discontent < SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT) {
        return {
          valid: false,
          reason:
            `Discontent ${discontent.toFixed(2)} in ${regionLabel(region)} is enough for a ` +
            `protest (${SPAWN_INCIDENT_MIN_DISCONTENT}) but below the ` +
            `${SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT} an uprising needs`,
        };
      }

      if (kind === "border_dispute" && disputedNeighbourCountry(game, region) === undefined) {
        return {
          valid: false,
          reason:
            `${regionLabel(region)} has no border a dispute could be about: every neighbouring ` +
            `region is held by ${effectiveController(region)} itself or by an ally`,
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
      if (error) return { ok: false, reason: error };

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
      if (grantError) return { ok: false, reason: grantError };

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
      if (error) return { ok: false, reason: error };

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
      if (paymentError) return { ok: false, reason: paymentError };

      const shift = politicsCommands.shiftCountryIdeology(
        game,
        countryId,
        axes.find(a => a.axis === "economic")?.delta ?? 0,
        axes.find(a => a.axis === "political")?.delta ?? 0
      );
      const error = failIfCommandFailed([shift]);
      if (error) return { ok: false, reason: error };

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
        if (error) return { ok: false, reason: error };
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
export function pushPrimitiveRejectionFact(
  game: GameState,
  fact: { countryId: string; text: string; regionId?: number | undefined },
  source: WorldFactSource = "player"
): void {
  const listed = game.pendingWorldFacts.filter(
    f => f.kind === "primitive_rejected" && (f.source ?? "player") === source
  ).length;
  if (listed > MAX_PENDING_REJECTION_FACTS_PER_SOURCE) return;

  if (listed === MAX_PENDING_REJECTION_FACTS_PER_SOURCE) {
    game.pendingWorldFacts.push({
      countryId: fact.countryId,
      kind: "primitive_rejected",
      source,
      text:
        `(further rejected ${source} attempts are not listed this cycle: the diagnostic cap of ` +
        `${MAX_PENDING_REJECTION_FACTS_PER_SOURCE} entries was reached)`,
    });
    return;
  }

  game.pendingWorldFacts.push({ ...fact, kind: "primitive_rejected", source });
}

/**
 * Допуск сверки отчёта с дифом — на ошибку представления double, а не на
 * «примерно совпало».
 *
 * Обе стороны считают дельту вычитанием одних и тех же чисел, поэтому в
 * типичном случае они совпадают побитово. Разойтись на единицы ulp (~2e-16 при
 * значениях ≤ 1) они могут там, где примитив пишет в одну тройку несколько раз:
 * отчёт складывает шаги, а диф берёт разность концов. 1e-9 покрывает такое
 * накопление с запасом в миллионы раз и при этом на семь порядков меньше
 * минимальной величины любого коридора магнитуды — подменить эффект «в пределах
 * допуска» нельзя.
 */
const IMPACT_REPORT_EPSILON = 1e-9;

/** Суммарная дельта по каждой тройке (регион, группа, поле). */
function totalsByKey(
  entries: readonly { regionId: number; groupId: string; field: ImpactMemoryField; delta: number }[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = impactBudgetKey(entry);
    totals.set(key, (totals.get(key) ?? 0) + entry.delta);
  }
  return totals;
}

/** Расхождение отчёта примитива с тем, что он реально сделал с памятью. */
interface MisreportedImpact {
  key: string;
  reported: number;
  actual: number;
}

/**
 * Сверка отчёта с фактическим дифом памяти воздействий — в ОБЕ стороны и по
 * величине, а не по одному лишь набору ключей.
 *
 * Три вида лжи, которые она ловит:
 *   1. **скрытый эффект** — примитив изменил память и не сказал об этом
 *      (`reported` пуст, `actual` нет). Сессия B получила бы мир, о котором не
 *      знает, и нарратив разошёлся бы с состоянием молча;
 *   2. **выдуманный эффект** — примитив отчитался о сдвиге, которого не было
 *      (`actual` пуст, `reported` нет). Симметричная половина того же
 *      требования; до 2026-07-26 её не закрывал ни рантайм, ни палитра;
 *   3. **подменённая величина** — ключ тот, число другое (отчитался 0.001 там,
 *      где легло 0.4). Именно число уходит в нарратив, поэтому совпадения
 *      ключей мало.
 *
 * Отчёт с нулевой дельтой законен и совпадает с отсутствием ключа в дифе:
 * `impactDeltas` не выдаёт нулей, и обе стороны дают 0.
 */
function findMisreportedImpacts(
  reported: readonly GroupImpactEffect[],
  actual: readonly ImpactDelta[]
): MisreportedImpact[] {
  const reportedTotals = totalsByKey(reported);
  const actualTotals = totalsByKey(actual);
  return [...new Set([...reportedTotals.keys(), ...actualTotals.keys()])]
    .map(key => ({
      key,
      reported: reportedTotals.get(key) ?? 0,
      actual: actualTotals.get(key) ?? 0,
    }))
    .filter(m => Math.abs(m.reported - m.actual) > IMPACT_REPORT_EPSILON);
}

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
 *   (`pushPrimitiveRejectionFact`), не на применение.
 */
export function applyPrimitiveBatch(
  game: GameState,
  primitives: readonly Primitive[],
  source: WorldFactSource = "player"
): PrimitiveBatchResult {
  const applied: AppliedPrimitive[] = [];
  const rejected: RejectedPrimitive[] = [];

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
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason: `At most ${MAX_STRUCTURAL_PRIMITIVES_PER_TURN} structural primitive(s) per turn`,
      });
      continue;
    }
    if (!structural && softUsed >= MAX_SOFT_PRIMITIVES_PER_TURN) {
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason: `At most ${MAX_SOFT_PRIMITIVES_PER_TURN} soft primitives per turn`,
      });
      continue;
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
    // Без этого капа кламп магнитуды обходится частотой: десять `repress(mild)`
    // по одной паре (регион, группа) проходят валидацию целиком (контроль и
    // состав региона не меняются, палитра та же) и упирают поле памяти в
    // потолок — ровно то, что коридор запрещает делать одним примитивом.
    // Счёт идёт по ходу, поэтому неважно, пришли они одним батчем или десятью
    // отдельными запросами.
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

    const deltas = impactDeltas(before, working);

    // Отчёт правдив: то, что примитив записал в память воздействий, и то, о чём
    // он отчитался, совпадают — по набору ключей И по величине, в обе стороны
    // (см. `findMisreportedImpacts`). Сверяется с ФАКТИЧЕСКИМ дифом памяти, а не
    // с намерением обработчика, — то есть тем же способом, что и палитра.
    // Ключ строится ОДНОЙ функцией с обеих сторон, иначе проверка тихо
    // перестала бы срабатывать, оставаясь на вид реализованной.
    //
    // Граница гарантии названа явно: сверяется КАНАЛ ПАМЯТИ ВОЗДЕЙСТВИЙ. Сдвиг
    // координат идеологии, списанная поддержка правительства, объект карты и
    // `nextFeatureId` под неё не попадают — там правдивость отчёта держат
    // палитра (что вообще разрешено трогать) и внешние тесты «опубликованное
    // „стало“ = состояние мира». Расширять сверку на них — отдельная работа
    // (docs/PRIMITIVES.md §4, docs/TODO.md).
    const misreported = findMisreportedImpacts(impactEffectsOf(outcome.applied), deltas);
    if (misreported.length > 0) {
      restore(working, before);
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason:
          `Result of ${primitive.verb} disagrees with what it changed: ` +
          misreported
            .map(m => `${m.key} reported ${m.reported.toFixed(3)}, actually ${m.actual.toFixed(3)}`)
            .join("; "),
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
      rejected.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason:
          `Turn impact ceiling reached: ` +
          overflow
            .map(
              d =>
                `${impactBudgetKey(d)} would total ` +
                `${((impactUsed.get(impactBudgetKey(d)) ?? 0) + d.delta).toFixed(3)} ` +
                `(max ${IMPACT_FIELD_TURN_CEILING[d.field]} per turn)`
            )
            .join("; "),
      });
      continue;
    }

    // Ход тратится только ПРИМЕНЁННЫМ примитивом: откаченный (отказ команды
    // или нарушение палитры) состояния не изменил, и ни цель, ни слот хода за
    // ним запирать не за что.
    if (structural) structuralUsed += 1;
    else softUsed += 1;
    for (const entity of entities) {
      const key = targetUseKey(primitive, entity);
      targetUses.set(key, (targetUses.get(key) ?? 0) + 1);
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
  const structuralRejection = rejected.find(r => isStructural(r.verb));

  if (structuralRejection) {
    for (const rolledBack of applied) {
      rejected.push({
        verb: rolledBack.verb,
        sourceCountryId: rolledBack.sourceCountryId,
        reason:
          `Rolled back: the structural ${structuralRejection.verb} in the same batch was ` +
          `rejected (${structuralRejection.reason}), and a rejected structural primitive ` +
          `rejects the whole batch`,
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

  // Диагностика пишется ПОСЛЕ commit'а, прямо в боевое состояние: факты об
  // отказах не участвуют в откате и не должны быть перетёрты переносом. Кап на
  // число подробных записей держит `pushPrimitiveRejectionFact`.
  for (const rejection of rejected) {
    pushPrimitiveRejectionFact(
      game,
      {
        countryId: rejection.sourceCountryId,
        text: `Attempt rejected (${rejection.verb}): ${rejection.reason}`,
      },
      source
    );
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
