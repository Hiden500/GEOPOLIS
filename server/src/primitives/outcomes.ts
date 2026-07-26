import { type GameState } from "@shared/types/GameState";
import { type LocalizedText } from "@shared/types/i18n/LocalizedText";
import {
  type PrimitiveOutcomeLine,
  type PrimitiveOutcomeRecord,
} from "@shared/types/politics/PrimitiveOutcome";
import { type AppliedPrimitive, type GroupImpactEffect, type Primitive } from "./types";

/**
 * Перевод результата примитива в локализуемый отклик игроку
 * (docs/PRIMITIVES.md §4, docs/LOCALIZATION.md).
 *
 * Строится ТОЛЬКО из структурных полей `AppliedPrimitive` — `before`/`after`/
 * `delta` по каждой паре (цель, поле), политическая цена, эффекты на соседей,
 * id созданного объекта карты. Поле `summary` движка здесь не читается вовсе, и
 * это не вкусовщина: документ прямо называет его вспомогательным человеческим
 * резюме, которое НЕ является полным отображением эффектов, а сверх того оно
 * сырое английское — в локализованный интерфейс его не пустить.
 *
 * Три правила, которые слой обязан удержать (иначе ложь просто переезжает на
 * уровень выше):
 *   1. Числа — фактические. Берутся из результата, который движок вернул ПОСЛЕ
 *      commit'а и после клампов команд, а не из того, что примитив запрашивал.
 *   2. Гранулярность правдивости — пара (цель, поле). Каждая пара из результата
 *      попадает в текст: сдвинувшаяся — с дельтой, несдвинувшаяся — со словом
 *      «без изменений» и текущим значением. Умолчать о цели нельзя: репрессия
 *      по региону, где доминант уже на потолке, обязана назвать доминанта, а не
 *      перечислить одни меньшинства.
 *   3. Ни одного утверждения сверх результата. Пустой список эффектов на
 *      соседей означает буквально «соседи не сдвинулись» и так и называется.
 */

/** Три знака после запятой — тот же масштаб, в котором живут поля памяти 0..1. */
function fixed(value: number): string {
  return value.toFixed(3);
}

/** Знаковая дельта: «+0.420» / «−0.041». Минус — типографский, как в резюме движка. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
}

/** Две знаковые цифры — масштаб координат идеологии и поддержки 0..100. */
function coordinate(value: number): string {
  return value.toFixed(2);
}

function regionNames(game: GameState, regionId: number): LocalizedText {
  const region = game.regions.find(r => r.id === regionId);
  // Фолбэк — не выдуманное имя, а честный идентификатор: регион без имени не
  // должен превращать строку отклика в пустоту.
  return region?.names ?? { en: `region ${regionId}`, ru: `регион ${regionId}` };
}

function groupNames(game: GameState, groupId: string): LocalizedText {
  const definition = game.ethnicGroups.find(g => g.id === groupId);
  return definition?.names ?? { en: groupId, ru: groupId };
}

function countryNames(game: GameState, countryId: string): LocalizedText {
  const country = game.countries.find(c => c.id === countryId);
  return country?.name ?? { en: countryId, ru: countryId };
}

/**
 * Строки по фактическим следам в памяти воздействий.
 *
 * `scope` разделяет прямую цель и отклик соседей: у соседа в строке обязано
 * стоять имя ЕГО региона, иначе уступка в одном регионе и её эхо в другом
 * читались бы как одно и то же событие.
 */
function impactLines(
  game: GameState,
  effects: readonly GroupImpactEffect[],
  scope: "target" | "neighbour"
): PrimitiveOutcomeLine[] {
  const prefix = scope === "neighbour" ? "impactNeighbour" : "impact";

  return effects.map(effect => {
    const names: Record<string, LocalizedText> = { group: groupNames(game, effect.groupId) };
    if (scope === "neighbour") names.region = regionNames(game, effect.regionId);

    return effect.delta === 0
      ? {
          key: `${prefix}.${effect.field}.unchanged`,
          values: { value: fixed(effect.after) },
          names,
        }
      : {
          key: `${prefix}.${effect.field}.changed`,
          values: {
            delta: signed(effect.delta),
            before: fixed(effect.before),
            after: fixed(effect.after),
          },
          names,
        };
  });
}

/** Сколько адресатов примитив реально сдвинул — считается по дельтам, не по составу региона. */
function movedGroupCount(effects: readonly GroupImpactEffect[]): number {
  return new Set(effects.filter(e => e.delta !== 0).map(e => e.groupId)).size;
}

function addressedGroupCount(effects: readonly GroupImpactEffect[]): number {
  return new Set(effects.map(e => e.groupId)).size;
}

/** Отклик по одному применённому примитиву. */
export function buildPrimitiveOutcome(
  game: GameState,
  applied: AppliedPrimitive
): PrimitiveOutcomeRecord {
  switch (applied.verb) {
    case "incite_unrest":
      return {
        verb: applied.verb,
        headline: {
          key: "inciteUnrest.headline",
          names: {
            group: groupNames(game, applied.groupId),
            region: regionNames(game, applied.regionId),
          },
        },
        details: impactLines(game, applied.targetEffects, "target"),
      };

    case "repress": {
      const addressed = addressedGroupCount(applied.targetEffects);
      return {
        verb: applied.verb,
        headline: {
          key: "repress.headline",
          values: {
            addressed,
            unaffected: addressed - movedGroupCount(applied.targetEffects),
          },
          names: { region: regionNames(game, applied.regionId) },
        },
        details: impactLines(game, applied.targetEffects, "target"),
      };
    }

    case "grant_autonomy": {
      // Пустой список соседей — не «нет данных», а факт: отклика не было.
      // Прежняя версия движка утверждала обратное безусловной фразой, и именно
      // на этом канале внешний аудит поймал ложь.
      const neighbours: PrimitiveOutcomeLine[] =
        applied.neighbourEffects.length > 0
          ? impactLines(game, applied.neighbourEffects, "neighbour")
          : [{ key: "grantAutonomy.noNeighbourResponse" }];

      return {
        verb: applied.verb,
        headline: {
          key: "grantAutonomy.headline",
          names: { region: regionNames(game, applied.regionId) },
        },
        details: [...impactLines(game, applied.targetEffects, "target"), ...neighbours],
      };
    }

    case "enact_reform": {
      const shifts: PrimitiveOutcomeLine[] = applied.ideologyShifts.map(shift =>
        shift.delta === 0
          ? {
              key: `reform.${shift.direction}.unchanged`,
              values: { value: coordinate(shift.before) },
            }
          : {
              key: `reform.${shift.direction}.changed`,
              values: {
                delta: Math.abs(shift.delta).toFixed(3),
                before: coordinate(shift.before),
                after: coordinate(shift.after),
              },
            }
      );

      return {
        verb: applied.verb,
        headline: {
          key: "enactReform.headline",
          names: { country: countryNames(game, applied.countryId) },
        },
        details: [
          ...shifts,
          {
            key: "reform.cost",
            values: {
              delta: Math.abs(applied.politicalCost.delta).toFixed(1),
              before: applied.politicalCost.before.toFixed(1),
              after: applied.politicalCost.after.toFixed(1),
            },
          },
        ],
      };
    }

    case "spawn_incident": {
      const details: PrimitiveOutcomeLine[] = [];
      if (applied.disputedWithCountryId !== undefined) {
        details.push({
          key: "incident.disputedWith",
          names: { country: countryNames(game, applied.disputedWithCountryId) },
        });
      }
      details.push(...impactLines(game, applied.targetEffects, "target"));

      return {
        verb: applied.verb,
        headline: {
          key: `spawnIncident.headline.${applied.incidentKind}`,
          values: { mapFeatureId: applied.mapFeatureId },
          names: { region: regionNames(game, applied.regionId) },
        },
        details,
      };
    }
  }
}

export function buildPrimitiveOutcomes(
  game: GameState,
  applied: readonly AppliedPrimitive[]
): PrimitiveOutcomeRecord[] {
  return applied.map(a => buildPrimitiveOutcome(game, a));
}

// --------------------------------------------------------------------------
// «Показ распознанного» — то, что игрок подтверждает ДО применения
// --------------------------------------------------------------------------

/**
 * Локализуемое описание НАМЕРЕНИЯ примитива (docs/PRIMITIVES.md §1: «LLM
 * переводит в примитивы, показывает распознанное на подтверждение»).
 *
 * Принципиально отличается от отклика выше и не должно с ним смешиваться: здесь
 * НЕТ ни одной величины. Их ещё не существует — примитив не применён, а
 * магнитуду движок посчитает из состояния в момент применения. Показать сейчас
 * «подавление +0.42» значило бы пообещать число, которое затем может оказаться
 * другим (поле у потолка) или не случиться вовсе (примитив отклонят). Игрок
 * подтверждает НАМЕРЕНИЕ — «подавить русских в Шяуляе, жёстко», — а числа
 * видит после, и уже фактические.
 */
export function buildPrimitivePreview(
  game: GameState,
  primitives: readonly Primitive[]
): PrimitiveOutcomeRecord[] {
  return primitives.map(primitive => {
    const details: PrimitiveOutcomeLine[] = [];
    const names: Record<string, LocalizedText> = {};

    if (primitive.target.regionId !== undefined) {
      names.region = regionNames(game, primitive.target.regionId);
    }
    if (primitive.target.groupId !== undefined) {
      names.group = groupNames(game, primitive.target.groupId);
    }

    let key: string;
    switch (primitive.verb) {
      case "enact_reform": {
        names.country = countryNames(
          game,
          primitive.target.countryId ?? primitive.sourceCountryId
        );
        key = "preview.enact_reform";
        if (primitive.params?.economicDirection) {
          details.push({ key: `preview.direction.${primitive.params.economicDirection}` });
        }
        if (primitive.params?.politicalDirection) {
          details.push({ key: `preview.direction.${primitive.params.politicalDirection}` });
        }
        break;
      }
      case "spawn_incident":
        key = `preview.spawn_incident.${primitive.params?.incidentKind ?? "protest"}`;
        break;
      case "incite_unrest":
        key = "preview.incite_unrest";
        break;
      default:
        // repress / grant_autonomy адресуются либо группе, либо региону целиком,
        // и разница для игрока существенная — приказ по региону бьёт по всем.
        key = `preview.${primitive.verb}.${primitive.target.groupId ? "group" : "region"}`;
    }

    // Интенсивность — качественный хинт, а не сила: подписывается словом и
    // только тем, что модель действительно указала.
    if (primitive.params?.intensity) {
      details.push({ key: `preview.intensity.${primitive.params.intensity}` });
    }

    return { verb: primitive.verb, headline: { key, names }, details };
  });
}
