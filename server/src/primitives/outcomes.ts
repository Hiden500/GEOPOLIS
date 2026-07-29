import { type GameState } from "@shared/types/GameState";
import { getText, LLM_LOCALE, type LocalizedText } from "@shared/types/i18n/LocalizedText";
import {
  type PrimitiveOutcomeLine,
  type PrimitiveOutcomeRecord,
} from "@shared/types/politics/PrimitiveOutcome";
import {
  type AppliedPrimitive,
  type CountryScalarEffect,
  type CountryScalarField,
  type GroupImpactEffect,
  type InfluenceEffect,
  type Primitive,
  type RelationEffect,
} from "./types";
import { countryNames, groupNames, regionNames } from "./entityNames";

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

// Резолверы имён живут в `entityNames.ts`: их использует не только отклик, но и
// структурная причина отказа в движке.

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

/**
 * Строки по фактическим сдвигам отношений — по КАЖДОЙ стороне пары.
 *
 * Обе стороны и нулевые дельты называются по тому же правилу, что у памяти
 * воздействий: умолчать о стороне значит дать игроку симметрию, которой не
 * было (`changeRelation` пишет адресату половину дельты инициатора).
 */
function relationLines(
  game: GameState,
  effects: readonly RelationEffect[]
): PrimitiveOutcomeLine[] {
  return effects.map(effect => {
    const names: Record<string, LocalizedText> = {
      source: countryNames(game, effect.fromCountryId),
      country: countryNames(game, effect.toCountryId),
    };
    return effect.delta === 0
      ? { key: "relation.unchanged", values: { value: effect.after.toFixed(1) }, names }
      : {
          key: "relation.changed",
          values: {
            delta: signed(effect.delta),
            before: effect.before.toFixed(1),
            after: effect.after.toFixed(1),
          },
          names,
        };
  });
}

/**
 * Строки по фактическим сдвигам скалярных полей стран (казна, легитимность,
 * живая сила).
 *
 * Ключ i18n строится ИЗ ИМЕНИ ПОЛЯ, а не по глаголу: одно и то же поле должно
 * читаться игроком одинаково, чьей бы рукой его ни сдвинули. Нулевая дельта
 * сюда не приходит вовсе — эти строки собираются из ДИФА состояния, а диф
 * нулевых записей не содержит; «ничего не сдвинулось» глагол обязан назвать
 * сам, своей строкой (см. `condemn.nothingToLose`).
 */
function scalarLines(
  game: GameState,
  effects: readonly CountryScalarEffect[]
): PrimitiveOutcomeLine[] {
  return effects.map(effect => ({
    key: `scalar.${effect.field}`,
    values: {
      delta: signedAmount(effect.field, effect.delta),
      before: amountOf(effect.field, effect.before),
      after: amountOf(effect.field, effect.after),
    },
    names: { country: countryNames(game, effect.countryId) },
  }));
}

/** Строки по фактическим сдвигам влияния — нулевая дельта называется нулевой. */
function influenceLines(
  game: GameState,
  effects: readonly InfluenceEffect[]
): PrimitiveOutcomeLine[] {
  return effects.map(effect => {
    const names: Record<string, LocalizedText> = {
      source: countryNames(game, effect.fromCountryId),
      country: countryNames(game, effect.toCountryId),
    };
    return effect.delta === 0
      ? { key: "influence.unchanged", values: { value: effect.after.toFixed(1) }, names }
      : {
          key: "influence.changed",
          values: {
            delta: signed(effect.delta),
            before: effect.before.toFixed(1),
            after: effect.after.toFixed(1),
          },
          names,
        };
  });
}

/**
 * Денежные и людские величины — целыми, без дробей.
 *
 * Шкалы здесь разные по природе: легитимность живёт в 0..100 и осмысленна с
 * десятыми, казна измеряется миллиардами, а живая сила — людьми. Одно
 * форматирование на все три давало бы либо «treasury −0.001», либо
 * «legitimacy −3».
 */
function money(value: number): string {
  return Math.round(value).toString();
}

function amountOf(field: CountryScalarField, value: number): string {
  return field === "treasury" || field === "activePersonnel" ? money(value) : value.toFixed(1);
}

function signedAmount(field: CountryScalarField, value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${amountOf(field, Math.abs(value))}`;
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

    case "diplomacy":
      return {
        verb: applied.verb,
        headline: {
          key: `diplomacy.headline.${applied.direction}`,
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details: relationLines(game, applied.relationEffects),
      };

    case "sanction":
      return {
        verb: applied.verb,
        headline: {
          key: "sanction.headline",
          values: { sanctionType: applied.sanctionType },
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details: [
          // Названо прямо, а не умолчано: три из четырёх видов санкций сегодня
          // репутационные, и отклик обязан отличать блокаду от заявления.
          { key: applied.cutsTrade ? "sanction.cutsTrade" : "sanction.reputationOnly" },
          ...relationLines(game, applied.relationEffects),
        ],
      };

    case "war": {
      const dragged = applied.attackers.length + applied.defenders.length - 2;
      return {
        verb: applied.verb,
        headline: {
          key: "war.headline",
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details: [
          // Втянутые договорами стороны — факт, который игрок обязан увидеть
          // сразу: он не выбирал их, но воюет теперь и с ними.
          ...(dragged > 0 ? [{ key: "war.draggedIn", values: { count: dragged } }] : []),
          ...relationLines(game, applied.relationEffects),
        ],
      };
    }

    case "peace": {
      const details: PrimitiveOutcomeLine[] = [
        applied.annexedRegionIds.length > 0
          ? { key: "peace.annexed", values: { count: applied.annexedRegionIds.length } }
          : { key: "peace.borderUnchanged" },
      ];
      for (const move of applied.capitalMoves) {
        details.push({
          key: "peace.capitalMoved",
          names: {
            country: countryNames(game, move.countryId),
            region: regionNames(game, move.to),
          },
        });
      }
      for (const effect of applied.countryScalarEffects) {
        details.push({
          key: `peace.${effect.field}`,
          values: {
            delta: signed(effect.delta),
            before: effect.before.toFixed(1),
            after: effect.after.toFixed(1),
          },
          names: { country: countryNames(game, effect.countryId) },
        });
      }
      details.push(...relationLines(game, applied.relationEffects));

      return {
        verb: applied.verb,
        headline: {
          key: "peace.headline",
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details,
      };
    }

    case "send_aid":
      return {
        verb: applied.verb,
        headline: {
          key: "sendAid.headline",
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details: [
          ...scalarLines(game, applied.countryScalarEffects),
          ...influenceLines(game, applied.influenceEffects),
        ],
      };

    case "capital_flight": {
      const region = applied.regionEffects[0];
      return {
        verb: applied.verb,
        headline: {
          key: "capitalFlight.headline",
          names: { region: regionNames(game, applied.regionId) },
        },
        details: [
          // Региональный ВВП называется всегда, включая нулевую дельту: у
          // отчёта та же гранулярность правдивости, что у памяти воздействий.
          ...(region
            ? [
                region.delta === 0
                  ? { key: "capitalFlight.output.unchanged", values: { value: money(region.after) } }
                  : {
                      key: "capitalFlight.output.changed",
                      values: {
                        delta: money(Math.abs(region.delta)),
                        before: money(region.before),
                        after: money(region.after),
                      },
                    },
              ]
            : []),
          ...scalarLines(game, applied.countryScalarEffects),
        ],
      };
    }

    case "condemn":
      return {
        verb: applied.verb,
        headline: {
          key: "condemn.headline",
          values: { audience: applied.audienceSize },
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        // Пустой список — не «нет данных», а факт: легитимности цели уже
        // нечего терять, и отклик обязан сказать это словом.
        details:
          applied.countryScalarEffects.length > 0
            ? scalarLines(game, applied.countryScalarEffects)
            : [{ key: "condemn.nothingToLose" }],
      };

    case "support_proxy":
      return {
        verb: applied.verb,
        headline: {
          key: "supportProxy.headline",
          names: {
            source: countryNames(game, applied.sourceCountryId),
            country: countryNames(game, applied.targetCountryId),
          },
        },
        details: [
          // Названо прямо: патрон не стал стороной войны. Это ГЛАВНОЕ свойство
          // глагола, и умолчать о нём значило бы дать игроку повод думать, что
          // он только что вступил в войну.
          { key: "supportProxy.notBelligerent" },
          ...scalarLines(game, applied.countryScalarEffects),
        ],
      };

    case "split_country": {
      // Отклик перечисляет ФАКТ, а не оценку: сколько государств возникло,
      // сколько регионов каждое забрало, пережила ли метрополия раскол.
      const details: PrimitiveOutcomeLine[] = applied.shards.map(shard => ({
        key: "split.shard",
        values: { regions: shard.regionIds.length },
        names: {
          country: countryNames(game, shard.countryId),
          group: groupNames(game, shard.groupId),
        },
      }));

      if (applied.dissolved) {
        details.push({
          key: "split.dissolved",
          names: { country: countryNames(game, applied.dissolved.successorCountryId) },
        });
      }
      if (applied.capitalMoved) {
        details.push({
          key: "split.capitalMoved",
          names: { region: regionNames(game, applied.capitalMoved.to) },
        });
      }
      if (applied.closedWarIds.length > 0) {
        details.push({
          key: "split.warsClosed",
          values: { count: applied.closedWarIds.length },
        });
      }

      return {
        verb: applied.verb,
        headline: {
          key: "splitCountry.headline",
          values: { shards: applied.shards.length },
          // Имя расколотой страны берётся из состояния, а распустившейся —
          // из результата: в состоянии её уже нет, и резолвер имён вернул бы
          // сырой идентификатор.
          names: { country: countryNames(game, applied.countryId) },
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

/**
 * Тот же результат — одной строкой для ПРОМТА (летопись, `ChronicleTick`).
 *
 * Читает готовые записи выше и ничего не строит из состояния заново: второй
 * построитель «факты → текст» означал бы второе мнение о том, что произошло.
 * Отсюда и форма: глагол движка + место, взятое из имён самой записи. Ничего,
 * чего в записи нет, строка сказать не может — а именно это от неё и нужно,
 * потому что в летопись она попадает вместо заголовка, которому доверия нет
 * (docs/PRIMITIVES.md §3).
 *
 * Словарь намеренно машинный, а не художественный. Во-первых, глаголы алфавита
 * промт уже знает — контракт примитивов и секция отказов говорят ими же
 * («Attempt rejected (repress)»), так что читателю строки объяснять нечего.
 * Во-вторых, художественная фраза потребовала бы английского каталога фраз на
 * сервере — копии клиентского словаря `primitiveOutcome`, которая разошлась бы
 * с ним при первой же правке.
 *
 * Имена разрешаются `LLM_LOCALE`, как и остальные имена мира в промте, —
 * независимо от локали партии.
 */
export function describeOutcomesForPrompt(
  records: readonly PrimitiveOutcomeRecord[]
): string {
  return records
    .map(record => {
      const names = record.headline.names ?? {};
      // Место события: регион для четырёх глаголов, страна для реформы —
      // общегосударственного акта без места (см. `placeHistoryEntries`).
      const where = names.region ?? names.country;
      return where ? `${record.verb} in ${getText(where, LLM_LOCALE)}` : record.verb;
    })
    .join(", ");
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

    // Имена берутся ПО ВЕТКЕ union'а, а не по «если поле есть»: у каждого
    // глагола своя цель, и общего мешка полей больше не существует.
    let key: string;
    switch (primitive.verb) {
      case "enact_reform": {
        names.country = countryNames(game, primitive.target.countryId);
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
        names.region = regionNames(game, primitive.target.regionId);
        key = `preview.spawn_incident.${primitive.params?.incidentKind ?? "protest"}`;
        break;
      case "incite_unrest":
        names.region = regionNames(game, primitive.target.regionId);
        names.group = groupNames(game, primitive.target.groupId);
        key = "preview.incite_unrest";
        break;
      case "repress":
      case "grant_autonomy":
        // Адресуются либо группе, либо региону целиком, и разница для игрока
        // существенная — приказ по региону бьёт по всем его группам.
        names.region = regionNames(game, primitive.target.regionId);
        if (primitive.target.groupId !== undefined) {
          names.group = groupNames(game, primitive.target.groupId);
        }
        key = `preview.${primitive.verb}.${primitive.target.groupId ? "group" : "region"}`;
        break;
      case "split_country":
        // В показе распознанного НЕТ ни числа осколков, ни их состава: их
        // выведет движок из состояния в момент применения, и обещать их заранее
        // значило бы соврать при первом же изменении недовольства.
        names.country = countryNames(game, primitive.target.countryId);
        key = "preview.split_country";
        break;
      case "diplomacy":
        // Направление — часть НАМЕРЕНИЯ и потому показывается; величина сдвига
        // не показывается, потому что её ещё не существует.
        names.country = countryNames(game, primitive.target.countryId);
        key = `preview.diplomacy.${primitive.params?.direction ?? "unspecified"}`;
        break;
      case "sanction":
        names.country = countryNames(game, primitive.target.countryId);
        key = "preview.sanction";
        details.push({
          key: `preview.sanctionType.${primitive.params?.sanctionType ?? "default"}`,
        });
        break;
      case "war":
        names.country = countryNames(game, primitive.target.countryId);
        key = "preview.war";
        break;
      case "peace":
        names.country = countryNames(game, primitive.target.countryId);
        key = "preview.peace";
        break;
      // Мягкие воздействия Милстоуна 1. Величин в показе нет ни у одного, как и
      // у всех остальных: сумму помощи, глубину оттока и силу удара по
      // репутации движок посчитает из состояния в момент применения.
      case "send_aid":
      case "condemn":
      case "support_proxy":
        names.country = countryNames(game, primitive.target.countryId);
        key = `preview.${primitive.verb}`;
        break;
      case "capital_flight":
        names.region = regionNames(game, primitive.target.regionId);
        key = "preview.capital_flight";
        break;
    }

    // Интенсивность — качественный хинт, а не сила: подписывается словом и
    // только тем, что модель действительно указала. Читается через
    // промежуточную переменную: у структурных `war`/`peace` поля `intensity` в
    // форме нет вовсе, и это заявление о том, что у события величины не бывает.
    const params = primitive.params;
    if (params && "intensity" in params && params.intensity) {
      details.push({ key: `preview.intensity.${params.intensity}` });
    }

    return { verb: primitive.verb, headline: { key, names }, details };
  });
}
