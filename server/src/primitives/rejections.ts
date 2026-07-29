import { getText, LLM_LOCALE, type LocalizedText } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveRejectionRecord } from "@shared/types/politics/PrimitiveRejection";
import { type IdeologyAxis, type PrimitiveVerb } from "./types";

/**
 * Структурная причина отказа — код + типизированные параметры, а не строка
 * (docs/PRIMITIVES.md §3).
 *
 * ЗАЧЕМ. Причина отказа уходит ДВУМ потребителям с несовместимыми
 * требованиями: игроку (русский текст интерфейса, без величин несостоявшегося
 * действия) и в следующий промт модели (английский, с числами — иначе она не
 * поймёт, чего именно не хватило). Одна строка не может быть обоими сразу, и
 * до Милстоуна 1 побеждал промт: игрок читал «Turn impact ceiling reached:
 * suppression on region 68 / group estonians would total 0.238 (max 0.45 per
 * turn)» — сырые идентификаторы кода и магнитуду приказа, который НЕ
 * состоялся.
 *
 * ПОЧЕМУ ДИСКРИМИНИРОВАННЫЙ UNION, А НЕ `{code, values}`. Оба рендера обязаны
 * знать, какие параметры несёт код. При «мешке значений» забытый параметр
 * даёт `undefined` в тексте — молча и только в рантайме, у отказа, который по
 * определению происходит редко. Здесь ветка без обработчика не компилируется:
 * `switch` исчерпывающий, и добавление кода без английского рендера — ошибка
 * сборки, а не строка «undefined» в промте.
 *
 * ГРАНИЦА «ЧТО ВИДИТ ИГРОК». Правило одно: свойства МИРА и ПРАВИЛ — можно,
 * магнитуда несостоявшегося действия — нельзя. Порог, кап, текущее
 * недовольство региона, координата оси, уровень поддержки — свойства мира,
 * игрок их и так видит в интерфейсе. «Этот примитив добавил бы 0.238» —
 * магнитуда, которой не существует (её считает движок в момент применения), и
 * в `PrimitiveRejectionRecord` она не попадает: живёт только в английском
 * рендере для промта.
 */

/** Ось реформы, чей сдвиг недостижим: координата уже на краю спектра. */
export interface StuckReformAxis {
  axis: IdeologyAxis;
  direction: string;
  value: number;
  bound: number;
}

/** Цель, по которой кап «один verb на цель за ход» уже израсходован. */
export interface ExhaustedTarget {
  region?: LocalizedText | undefined;
  group?: LocalizedText | undefined;
  country?: LocalizedText | undefined;
}

export type PrimitiveRejection =
  // --- validate: существование сущностей ---
  | { code: "unknownSourceCountry"; countryId: string }
  | { code: "unknownRegion"; regionId: number }
  | { code: "unknownCountry"; countryId: string }
  | { code: "unknownGroup"; groupId: string }
  | { code: "groupNotInRegion"; group: LocalizedText; region: LocalizedText }
  | { code: "regionHasNoDemographics"; region: LocalizedText }

  // --- validate: предпосылки глаголов ---
  | { code: "regionNotControlled"; source: LocalizedText; region: LocalizedText }
  | {
      code: "ideologicalDistanceTooLow";
      group: LocalizedText;
      distance: number;
      threshold: number;
    }
  | { code: "reformNotDomestic"; source: LocalizedText; country: LocalizedText }
  | { code: "reformNoDirection"; country: LocalizedText }
  | {
      code: "reformSupportTooLow";
      country: LocalizedText;
      support: number;
      threshold: number;
    }
  | { code: "reformAxisAtSpectrumEdge"; country: LocalizedText; axes: StuckReformAxis[] }
  | {
      code: "incidentDiscontentTooLow";
      region: LocalizedText;
      discontent: number;
      threshold: number;
    }
  | {
      code: "uprisingDiscontentTooLow";
      region: LocalizedText;
      discontent: number;
      protestThreshold: number;
      uprisingThreshold: number;
    }
  | { code: "noDisputableBorder"; region: LocalizedText; controller: LocalizedText }
  | { code: "splitNotSelf"; source: LocalizedText; country: LocalizedText }
  | { code: "splitTooFewRegions"; country: LocalizedText; regions: number; required: number }
  | {
      code: "splitNoSeparatistRegion";
      country: LocalizedText;
      threshold: number;
      /** Наибольшее недовольство группы-большинства в стране — насколько не хватило. */
      best: number;
    }

  // --- validate: дипломатический блок ---
  //
  // Все пять кодов отвечают на вопрос «так не бывает», а не «мало». Отдельного
  // отказа «отношения на краю шкалы» здесь НЕТ намеренно: коридор в этом случае
  // схлопывается в свой минимум, команда клампит его в ноль, и результат
  // честно сообщает нулевую дельту — тот же путь, что у репрессии по группе на
  // потолке подавления. Отказывать за то, что состояние не оставило места,
  // значило бы завести два разных ответа на одно и то же положение мира.
  | { code: "bilateralSelfTarget"; verb: PrimitiveVerb; country: LocalizedText }
  | { code: "diplomacyNoDirection"; country: LocalizedText }
  | { code: "sanctionAlreadyImposed"; source: LocalizedText; target: LocalizedText; sanctionType: string }
  | { code: "alreadyAtWar"; source: LocalizedText; target: LocalizedText }
  | { code: "warOnAlly"; source: LocalizedText; target: LocalizedText }
  | { code: "noActiveWar"; source: LocalizedText; target: LocalizedText }

  // --- капы хода ---
  | { code: "softTurnCapReached"; cap: number }
  | { code: "structuralTurnCapReached"; cap: number }
  | { code: "targetTurnCapReached"; verb: PrimitiveVerb; cap: number; targets: ExhaustedTarget[] }
  | {
      code: "impactCeilingReached";
      field: string;
      region: LocalizedText;
      group: LocalizedText;
      ceiling: number;
      /** Магнитуда несостоявшегося приказа — ТОЛЬКО в промт (см. шапку модуля). */
      wouldTotal: number;
    }

  // --- внутренние гарантии движка ---
  | { code: "commandFailed"; verb: PrimitiveVerb; error: string }
  | { code: "paletteViolation"; verb: PrimitiveVerb; paths: string[] }
  | { code: "resultMisreported"; verb: PrimitiveVerb; mismatches: string[] }
  | { code: "structuralRollback"; structuralVerb: PrimitiveVerb }
  | { code: "postInvariantViolated"; details: string[] }

  // --- слои выше движка ---
  | { code: "agencyPlayerDecision"; verb: PrimitiveVerb; player: LocalizedText }
  | { code: "schemaInvalid"; position: number; detail: string }
  | { code: "malformedBatch"; detail: string }
  | { code: "duplicateResponse" };

export type PrimitiveRejectionCode = PrimitiveRejection["code"];

function name(text: LocalizedText): string {
  return getText(text, LLM_LOCALE);
}

function list(values: readonly string[]): string {
  return values.join("; ");
}

function targetLabel(target: ExhaustedTarget): string {
  const parts: string[] = [];
  if (target.country) parts.push(name(target.country));
  if (target.region) parts.push(name(target.region));
  if (target.group) parts.push(name(target.group));
  return parts.join(" / ");
}

/**
 * Английский текст причины ДЛЯ ПРОМТА (docs/PRIMITIVES.md §3 — «в следующий
 * промт LLM, чтобы не долбилась в невозможное»).
 *
 * Здесь и только здесь допустимы величины несостоявшегося действия: модели
 * нужно знать, на сколько именно она промахнулась мимо потолка, иначе
 * следующая попытка будет такой же наугад. Игроку тот же отказ приходит
 * записью `PrimitiveRejectionRecord` без этих чисел.
 *
 * `switch` исчерпывающий по построению: новый код без ветки не компилируется.
 */
export function rejectionPromptText(rejection: PrimitiveRejection): string {
  switch (rejection.code) {
    case "unknownSourceCountry":
      return `Unknown source country: ${rejection.countryId}`;
    case "unknownRegion":
      return `Unknown region: ${rejection.regionId}`;
    case "unknownCountry":
      return `Unknown country: ${rejection.countryId}`;
    case "unknownGroup":
      return `Unknown ethnic group: ${rejection.groupId}`;
    case "groupNotInRegion":
      return `${name(rejection.group)} does not live in ${name(rejection.region)}`;
    case "regionHasNoDemographics":
      return `${name(rejection.region)} has no mapped demographics`;

    case "regionNotControlled":
      return `${name(rejection.source)} does not control ${name(rejection.region)}`;
    case "ideologicalDistanceTooLow":
      return (
        `Ideological distance ${rejection.distance.toFixed(2)} between the authorities and ` +
        `${name(rejection.group)} is below the ${rejection.threshold} threshold`
      );
    case "reformNotDomestic":
      return (
        `${name(rejection.source)} cannot enact a reform in ${name(rejection.country)}: ` +
        `a reform is a domestic act of the country that pays for it`
      );
    case "reformNoDirection":
      return `enact_reform in ${name(rejection.country)} requires at least one direction`;
    case "reformSupportTooLow":
      return (
        `Government support ${rejection.support.toFixed(1)} in ${name(rejection.country)} is ` +
        `below the ${rejection.threshold} needed to push a reform through`
      );
    case "reformAxisAtSpectrumEdge":
      return (
        `Reform in ${name(rejection.country)} would not move anything: ` +
        list(
          rejection.axes.map(
            a =>
              `the ${a.axis} axis is already at ${a.value.toFixed(2)}, the ${a.bound} bound of ` +
              `the spectrum in the ${a.direction} direction`
          )
        )
      );
    case "incidentDiscontentTooLow":
      return (
        `Discontent ${rejection.discontent.toFixed(2)} in ${name(rejection.region)} is below ` +
        `the ${rejection.threshold} threshold for an incident`
      );
    case "uprisingDiscontentTooLow":
      return (
        `Discontent ${rejection.discontent.toFixed(2)} in ${name(rejection.region)} is enough ` +
        `for a protest (${rejection.protestThreshold}) but below the ` +
        `${rejection.uprisingThreshold} an uprising needs`
      );
    case "noDisputableBorder":
      return (
        `${name(rejection.region)} has no border a dispute could be about: every neighbouring ` +
        `region is held by ${name(rejection.controller)} itself or by an ally`
      );

    case "splitNotSelf":
      return (
        `${name(rejection.source)} cannot split ${name(rejection.country)}: a state falls apart ` +
        `from within, it is not split from outside (that is annexation or war)`
      );
    case "splitTooFewRegions":
      return (
        `${name(rejection.country)} holds ${rejection.regions} region(s) and cannot be split: ` +
        `at least ${rejection.required} are required`
      );
    case "splitNoSeparatistRegion":
      return (
        `No region of ${name(rejection.country)} is held by a discontented majority: the highest ` +
        `such discontent is ${rejection.best.toFixed(2)}, below the ` +
        `${rejection.threshold.toFixed(2)} secession threshold`
      );

    case "bilateralSelfTarget":
      return (
        `${rejection.verb} needs a target country other than the source: ` +
        `${name(rejection.country)} cannot address itself`
      );
    case "diplomacyNoDirection":
      return (
        `diplomacy towards ${name(rejection.country)} requires params.direction ` +
        `("improve" or "worsen"): the engine decides how far the relation moves, ` +
        `but not which way you meant it to`
      );
    case "sanctionAlreadyImposed":
      return (
        `${name(rejection.source)} already has ${rejection.sanctionType} in place against ` +
        `${name(rejection.target)}: imposing it again would change nothing`
      );
    case "alreadyAtWar":
      return `${name(rejection.source)} is already at war with ${name(rejection.target)}`;
    case "warOnAlly":
      return (
        `${name(rejection.source)} cannot declare war on its ally ${name(rejection.target)}: ` +
        `breaking an alliance is not modelled yet`
      );
    case "noActiveWar":
      return `There is no active war between ${name(rejection.source)} and ${name(rejection.target)}`;

    case "softTurnCapReached":
      return `At most ${rejection.cap} soft primitives per turn`;
    case "structuralTurnCapReached":
      return `At most ${rejection.cap} structural primitive(s) per turn`;
    case "targetTurnCapReached":
      return (
        `At most ${rejection.cap} ${rejection.verb} per target per turn; already acted on this ` +
        `turn: ${list(rejection.targets.map(targetLabel))}`
      );
    case "impactCeilingReached":
      return (
        `Turn impact ceiling reached: ${rejection.field} for ${name(rejection.group)} in ` +
        `${name(rejection.region)} would total ${rejection.wouldTotal.toFixed(3)} ` +
        `(max ${rejection.ceiling} per turn)`
      );

    case "commandFailed":
      return `${rejection.verb} could not be applied: ${rejection.error}`;
    case "paletteViolation":
      return `Effect outside the ${rejection.verb} palette: ${list(rejection.paths)}`;
    case "resultMisreported":
      return (
        `Result of ${rejection.verb} disagrees with what it changed: ` +
        list(rejection.mismatches)
      );
    case "structuralRollback":
      return (
        `Rolled back: the structural ${rejection.structuralVerb} in the same response was ` +
        `rejected, and a rejected structural primitive rejects the whole response`
      );
    case "postInvariantViolated":
      return (
        `The whole response was rolled back: applying it left the world in a state the engine ` +
        `refuses to commit (${list(rejection.details)})`
      );

    case "agencyPlayerDecision":
      return (
        `${rejection.verb} is a policy decision of ${name(rejection.player)}, the player's own ` +
        `country: the director may create the pressure, but never chooses the answer for the ` +
        `player. Offer it in the narrative instead.`
      );
    case "schemaInvalid":
      return `primitive #${rejection.position}: ${rejection.detail}`;
    case "malformedBatch":
      return rejection.detail;
    case "duplicateResponse":
      return "This response was already applied this month and was not applied again";
  }
}

/**
 * Та же причина ДЛЯ ИГРОКА — код + параметры, которые клиент подставит в свой
 * локализованный шаблон (`client/src/i18n/locales/<locale>/primitiveRejection.json`).
 *
 * Величины несостоявшегося действия сюда не попадают (см. шапку модуля):
 * `impactCeilingReached` отдаёт потолок правила, но не `wouldTotal`,
 * `paletteViolation` и `resultMisreported` не отдают внутренних путей и
 * расхождений движка вовсе — игроку они ничего не сообщают, а разбирать их
 * нужно по серверному логу и промту.
 */
export function rejectionRecord(
  rejection: PrimitiveRejection,
  verb?: PrimitiveVerb | undefined
): PrimitiveRejectionRecord {
  const base = { code: rejection.code, ...(verb === undefined ? {} : { verb }) };
  const of = (
    values?: Record<string, string | number>,
    names?: Record<string, LocalizedText>
  ): PrimitiveRejectionRecord => ({
    ...base,
    ...(values === undefined ? {} : { values }),
    ...(names === undefined ? {} : { names }),
  });

  switch (rejection.code) {
    case "unknownSourceCountry":
    case "unknownCountry":
      return of({ countryId: rejection.countryId });
    case "unknownRegion":
      return of({ regionId: rejection.regionId });
    case "unknownGroup":
      return of({ groupId: rejection.groupId });
    case "groupNotInRegion":
      return of(undefined, { group: rejection.group, region: rejection.region });
    case "regionHasNoDemographics":
      return of(undefined, { region: rejection.region });

    case "regionNotControlled":
      return of(undefined, { source: rejection.source, region: rejection.region });
    case "ideologicalDistanceTooLow":
      return of(
        { distance: rejection.distance.toFixed(2), threshold: rejection.threshold },
        { group: rejection.group }
      );
    case "reformNotDomestic":
      return of(undefined, { source: rejection.source, country: rejection.country });
    case "reformNoDirection":
      return of(undefined, { country: rejection.country });
    case "reformSupportTooLow":
      return of(
        { support: rejection.support.toFixed(1), threshold: rejection.threshold },
        { country: rejection.country }
      );
    case "reformAxisAtSpectrumEdge":
      return of(
        {
          // Оси перечисляются машинными именами: их ровно две, и клиент
          // подставляет их в свой словарь как ключи, а не как текст.
          axes: rejection.axes.map(a => a.axis).join(", "),
          count: rejection.axes.length,
        },
        { country: rejection.country }
      );
    case "incidentDiscontentTooLow":
      return of(
        { discontent: rejection.discontent.toFixed(2), threshold: rejection.threshold },
        { region: rejection.region }
      );
    case "uprisingDiscontentTooLow":
      return of(
        {
          discontent: rejection.discontent.toFixed(2),
          threshold: rejection.uprisingThreshold,
        },
        { region: rejection.region }
      );
    case "noDisputableBorder":
      return of(undefined, { region: rejection.region, controller: rejection.controller });

    case "splitNotSelf":
      return of(undefined, { source: rejection.source, country: rejection.country });
    case "splitTooFewRegions":
      return of(
        { regions: rejection.regions, required: rejection.required },
        { country: rejection.country }
      );
    case "splitNoSeparatistRegion":
      // Порог и текущее недовольство — свойства МИРА и ПРАВИЛ, игрок их видит
      // и в интерфейсе (см. шапку модуля); магнитуды здесь нет вовсе.
      return of(
        { threshold: rejection.threshold.toFixed(2), best: rejection.best.toFixed(2) },
        { country: rejection.country }
      );

    case "bilateralSelfTarget":
      return of({ verb: rejection.verb }, { country: rejection.country });
    case "diplomacyNoDirection":
      return of(undefined, { country: rejection.country });
    case "sanctionAlreadyImposed":
      // Вид санкции — машинное имя: клиент подставляет его в свой словарь как
      // ключ, ровно как оси у `reformAxisAtSpectrumEdge`.
      return of({ sanctionType: rejection.sanctionType }, {
        source: rejection.source,
        target: rejection.target,
      });
    case "alreadyAtWar":
    case "warOnAlly":
    case "noActiveWar":
      return of(undefined, { source: rejection.source, target: rejection.target });

    case "softTurnCapReached":
    case "structuralTurnCapReached":
      return of({ cap: rejection.cap });
    case "targetTurnCapReached":
      return of({ cap: rejection.cap, count: rejection.targets.length });
    case "impactCeilingReached":
      // Потолок — правило, его игрок видеть вправе. `wouldTotal` — магнитуда
      // приказа, которого не было, и она остаётся в промте.
      return of({ field: rejection.field, ceiling: rejection.ceiling }, {
        region: rejection.region,
        group: rejection.group,
      });

    case "commandFailed":
    case "paletteViolation":
    case "resultMisreported":
      return of();
    case "structuralRollback":
      return of({ structuralVerb: rejection.structuralVerb });
    case "postInvariantViolated":
      return of();

    case "agencyPlayerDecision":
      return of(undefined, { player: rejection.player });
    case "schemaInvalid":
      return of({ position: rejection.position });
    case "malformedBatch":
    case "duplicateResponse":
      return of();
  }
}
