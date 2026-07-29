/**
 * Контракт примитива воздействия (docs/PRIMITIVES.md §1).
 *
 * Форма — `{ verb, target, params? }`, где:
 *   verb   — «буква» закрытого алфавита;
 *   target — на кого действует (страна / регион / демо-группа);
 *   params — КАЧЕСТВЕННЫЕ мета-параметры (направление, характер).
 *
 * `params` намеренно не содержит ни одного числового поля: величину эффекта
 * считает движок из состояния (docs/PRIMITIVES.md §1 — «LLM не задаёт
 * величины»). Это не соглашение в комментарии, а свойство типа и Zod-схемы,
 * проверяемое тестом.
 *
 * Тестовый v0 — четырнадцать глаголов из ~18 полного алфавита: пять
 * мягко-политических из вертикального среза, структурный `split_country`
 * (жизненный цикл), дипломатический блок `diplomacy`/`sanction`/`war`/`peace` и
 * мягкие воздействия `send_aid`/`capital_flight`/`condemn`/`support_proxy`.
 */

import { type ImpactMemoryField } from "@shared/types/politics/Demographics";
import { type SanctionType } from "@shared/types/DiplomacyState";
import { type SovereigntyStatus } from "@shared/types/politics/Government";
import { type LocalizedText } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveRejection } from "./rejections";

export const PRIMITIVE_VERBS = [
  "incite_unrest",
  "repress",
  "grant_autonomy",
  "enact_reform",
  "spawn_incident",
  "split_country",
  "diplomacy",
  "sanction",
  "war",
  "peace",
  "send_aid",
  "capital_flight",
  "condemn",
  "support_proxy",
  "puppet",
  "annex",
  "merge_countries",
] as const;

export type PrimitiveVerb = (typeof PRIMITIVE_VERBS)[number];

/**
 * Два класса примитивов (docs/PRIMITIVES.md §1): мягкие — сдвиги состояния,
 * свободно комбинируются; структурные — меняют устройство сущности, максимум
 * 1 на ответ, валидируются и коммитятся последними.
 *
 * `war`/`peace` структурные по таблице §2: они меняют устройство мира (создают
 * и закрывают войну, двигают границы по договору), и правило «отказ
 * структурного отклоняет весь ответ» им подходит — ответ «объявить войну и
 * сделать X» при несостоявшейся войне не должен делать X. Цена названа прямо:
 * `war`, `peace`, `enact_reform` и `split_country` делят ОДИН структурный слот
 * игрового месяца.
 */
export const STRUCTURAL_VERBS: readonly PrimitiveVerb[] = [
  "enact_reform",
  "split_country",
  "war",
  "peace",
  // Подчинение и поглощение меняют устройство мира так же необратимо, как
  // раскол: одно снимает с государства собственную внешнюю политику, другое
  // переносит землю между державами. Правило «отказ структурного отклоняет
  // весь ответ» им подходит по той же причине — ответ «аннексировать и затем
  // X» при несостоявшейся аннексии не должен делать X.
  "puppet",
  "annex",
  "merge_countries",
];

/**
 * Мягкие ДВУСТОРОННИЕ глаголы — те, что пишут в отношения пары стран.
 *
 * Перечислены отдельным списком, потому что на нём держится защита от обхода
 * коридора частотой: все они делят ОДИН слот капа «цель за ход» на
 * упорядоченную пару (`PrimitiveEngine.targetsOf`). Без общего слота
 * `diplomacy(worsen)` и `sanction` по одной паре за месяц прошли бы обоими
 * ключами и сложились бы в одной ячейке `relations` — то есть коридор
 * обходился бы сменой глагола (docs/PRIMITIVES.md §4).
 */
export const SOFT_BILATERAL_VERBS: readonly PrimitiveVerb[] = ["diplomacy", "sanction"];

export function isStructural(verb: PrimitiveVerb): boolean {
  return STRUCTURAL_VERBS.includes(verb);
}

/**
 * Качественный хинт силы. Число из него делает движок, не LLM. Словарь живёт в
 * `shared/src/types/politics/PrimitiveIntensity.ts`, потому что им типизирован
 * `PRIMITIVE_INTENSITY_POSITION` в `shared/src/defines/discontent.ts`; здесь —
 * реэкспорт, чтобы потребители движка импортировали всё из одного места.
 */
export {
  PRIMITIVE_INTENSITIES,
  type PrimitiveIntensity,
} from "@shared/types/politics/PrimitiveIntensity";

/** Направление реформы по экономической оси. */
export const REFORM_ECONOMIC_DIRECTIONS = ["left", "right"] as const;
export type ReformEconomicDirection = (typeof REFORM_ECONOMIC_DIRECTIONS)[number];

/** Направление реформы по политической оси. */
export const REFORM_POLITICAL_DIRECTIONS = ["authoritarian", "democratic"] as const;
export type ReformPoliticalDirection = (typeof REFORM_POLITICAL_DIRECTIONS)[number];

/** Характер инцидента — определяет тип объекта на карте, не его силу. */
export const INCIDENT_KINDS = ["protest", "uprising", "border_dispute"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/**
 * Направление дипломатического жеста — «в какую сторону», а не «насколько».
 *
 * Это ровно та развилка, которую модель ВПРАВЕ решать: сближение и разрыв —
 * разные события, а не разные величины одного. Величину обоих считает движок
 * из состояния пары.
 */
export const RELATION_DIRECTIONS = ["improve", "worsen"] as const;
export type RelationDirection = (typeof RELATION_DIRECTIONS)[number];

/**
 * Форма примитива живёт в `primitiveSchemas.ts` и выводится из Zod-схемы:
 * у каждого глагола своя цель и свои параметры (discriminated union по `verb`).
 * Здесь — только реэкспорт, чтобы потребители движка по-прежнему брали и вход,
 * и результат из одного места.
 *
 * Реэкспорт ТОЛЬКО типов (`export type`): он стирается компиляцией, поэтому
 * взаимный импорт `types ↔ primitiveSchemas` не образует рантайм-цикла —
 * значения (`PRIMITIVE_VERBS` и прочие enum'ы) ходят строго в одну сторону,
 * отсюда в схемы.
 */
export type { Primitive, PrimitiveOf } from "./primitiveSchemas";

// --------------------------------------------------------------------------
// Факт применения — материал для нарратива, который пишется ТОЛЬКО после commit
// --------------------------------------------------------------------------

/**
 * Одно ФАКТИЧЕСКОЕ изменение поля памяти воздействий: у кого, что, было → стало.
 *
 * `before`/`after`/`delta` вместе, а не одна дельта: нарратив должен уметь
 * сказать и «выросло на 0.14», и «дошло до потолка», не заглядывая в состояние
 * (docs/PRIMITIVES.md §4 — «движок возвращает LLM фактические величины»).
 *
 * `delta === 0` — законная запись, а не мусор: «примитив попытался, но не легло
 * ничего» тоже факт, и замалчивать его нельзя, иначе резюме снова начнёт
 * утверждать эффект, которого не было.
 */
export interface GroupImpactEffect {
  regionId: number;
  groupId: string;
  field: ImpactMemoryField;
  before: number;
  after: number;
  delta: number;
}

/** Ось координат идеологии, которую двигала реформа. */
export type IdeologyAxis = "economic" | "political";

/** Фактический сдвиг одной оси координат идеологии страны. */
export interface IdeologyShiftEffect {
  countryId: string;
  axis: IdeologyAxis;
  /** Качественное направление, которое запросил примитив. */
  direction: ReformEconomicDirection | ReformPoliticalDirection;
  before: number;
  after: number;
  delta: number;
}

/** Фактически уплаченная политическая цена (`governmentSupport`, шкала 0..100). */
export interface PoliticalCostEffect {
  countryId: string;
  field: "governmentSupport";
  before: number;
  after: number;
  /** Отрицательная: цена именно списывается. */
  delta: number;
}

/**
 * Скалярные поля страны, которые алфавит вправе двигать ВНЕ памяти воздействий.
 *
 * Перечисление, а не свободная строка: каждое имя обязано иметь ячейку в
 * разложении состояния (`reconciliation.ts`), иначе глагол смог бы заявить
 * канал, о котором сверка не спросит. Новое имя здесь не компилируется, пока
 * ему не назначен ключ ячейки.
 */
export const COUNTRY_SCALAR_FIELDS = [
  "governmentSupport",
  "legitimacy",
  "treasury",
  // Живая сила — Милстоун 1, `support_proxy`. Попала в ОБЩИЙ список скаляров, а
  // не в отдельный тип военного эффекта, по прямому следствию: раскол
  // государства делит `activePersonnel` метрополии, и с появлением ячейки
  // `personnel:` он обязан её ЗАЯВИТЬ — иначе его откатывала бы собственная
  // сверка за молчание о том, что он честно делает. Общий список даёт это одним
  // изменением, без второй копии «снимок → диф → отчёт».
  "activePersonnel",
] as const;
export type CountryScalarField = (typeof COUNTRY_SCALAR_FIELDS)[number];

/** Фактический сдвиг одного скалярного поля одной страны. */
export interface CountryScalarEffect {
  countryId: string;
  field: CountryScalarField;
  before: number;
  after: number;
  delta: number;
}

/**
 * Фактический сдвиг ОДНОЙ стороны двусторонних отношений.
 *
 * Сторон всегда две, и они не симметричны: `DiplomacyService.changeRelation`
 * пишет инициатору полную дельту, а адресату — половину. Поэтому запись хранит
 * пару «кто → о ком», а не одну «отношения пары»: нарратив, сказавший «стороны
 * сблизились на 12», соврал бы адресату.
 */
export interface RelationEffect {
  fromCountryId: string;
  toCountryId: string;
  before: number;
  after: number;
  delta: number;
}

/**
 * Общая часть факта применения.
 *
 * `summary` — человеческое резюме, а НЕ источник истины: оно обязано выводиться
 * из полей эффектов конкретного варианта ниже. До 2026-07-26 результат был
 * одним скаляром `magnitude` плюс заранее заготовленная строка, и строка врала:
 * `grant_autonomy` с нулевым откликом соседей всё равно сообщал, что соседние
 * общины «took heart», а реформа у края спектра — что «politics shifted
 * authoritarian», не сдвинув координату. Теперь по результату можно построить
 * правдивое описание, не заглядывая в состояние; резюме — производное от него.
 */
interface AppliedPrimitiveBase {
  sourceCountryId: string;
  summary: string;
}

export interface AppliedInciteUnrest extends AppliedPrimitiveBase {
  verb: "incite_unrest";
  regionId: number;
  groupId: string;
  targetEffects: GroupImpactEffect[];
}

export interface AppliedRepress extends AppliedPrimitiveBase {
  verb: "repress";
  regionId: number;
  targetEffects: GroupImpactEffect[];
}

export interface AppliedGrantAutonomy extends AppliedPrimitiveBase {
  verb: "grant_autonomy";
  regionId: number;
  targetEffects: GroupImpactEffect[];
  /**
   * Отклик той же группы в СОСЕДНИХ регионах — отдельным полем, а не в общей
   * куче: это цена уступки, и нарратив обязан отличать её от самой уступки.
   * Пустой массив означает буквально «соседи не сдвинулись».
   */
  neighbourEffects: GroupImpactEffect[];
}

export interface AppliedEnactReform extends AppliedPrimitiveBase {
  verb: "enact_reform";
  countryId: string;
  /** Только те оси, которые реформа просила двигать; все они реально сдвинулись. */
  ideologyShifts: IdeologyShiftEffect[];
  politicalCost: PoliticalCostEffect;
}

export interface AppliedSpawnIncident extends AppliedPrimitiveBase {
  verb: "spawn_incident";
  regionId: number;
  incidentKind: IncidentKind;
  /** id созданного объекта карты — чтобы нарратив ссылался на него, а не искал. */
  mapFeatureId: string;
  /** Страна по ту сторону спорной границы; только у `border_dispute`. */
  disputedWithCountryId?: string | undefined;
  targetEffects: GroupImpactEffect[];
}

/**
 * Факт применения раскола (docs/CONCEPT.md §7.1 — `PolityLifecycleResult`).
 *
 * Числовых каналов памяти воздействий у него нет вовсе: раскол меняет не
 * настроение, а состав государств. Поэтому в сверке результата с состоянием
 * (`reconciliation.ts`) он не заявляет ни одной ячейки — а факт создания стран
 * проверяют пост-инварианты, которым про смысл `countries` известно больше, чем
 * плоской карте числовых ячеек.
 */
export interface AppliedSplitCountry extends AppliedPrimitiveBase {
  verb: "split_country";
  /** Расколотая страна. */
  countryId: string;
  /** Возникшие государства: id, группа-сепаратист и забранные регионы. */
  shards: { countryId: string; groupId: string; regionIds: number[] }[];
  /**
   * Метрополия не пережила раскол (территории не осталось) — и кто принял её
   * ссылки. Отсутствие поля означает «метрополия жива», а не «неизвестно».
   */
  dissolved?: { countryId: string; successorCountryId: string } | undefined;
  /** Столица метрополии переехала: прежний регион ушёл с осколком. */
  capitalMoved?: { countryId: string; from: number; to: number } | undefined;
  /** Войны, потерявшие сторону и потому закрытые движком. */
  closedWarIds: string[];
  /**
   * Казна метрополии после деления между ней и осколками.
   *
   * Появилось Милстоуном 1 вместе с ячейкой `treasury:` в разложении состояния
   * (её потребовал `peace` со своими репарациями). Раскол казну делит всегда,
   * поэтому без этого заявления собственная сверка результата откатывала бы его
   * за молчание о том, что он честно сделал. Казна ОСКОЛКОВ сюда не входит:
   * страны, которых не было в снимке «до», из сверки исключены по построению.
   *
   * С появлением ячейки `personnel:` (Милстоун 1, `support_proxy`) сюда попала
   * и живая сила метрополии — по той же причине и тем же способом: раскол делит
   * `activePersonnel`, значит обязан о делении заявить.
   */
  countryScalarEffects: CountryScalarEffect[];
}

/**
 * Факт применения дипломатического жеста.
 *
 * `direction` — качественное намерение, которое назвала модель; фактический
 * знак дельт лежит в `relationEffects` и может от него отличаться нулём (пара
 * на краю шкалы). Хранятся оба, чтобы резюме не выдавало намерение за результат.
 */
export interface AppliedDiplomacy extends AppliedPrimitiveBase {
  verb: "diplomacy";
  targetCountryId: string;
  direction: RelationDirection;
  relationEffects: RelationEffect[];
}

/**
 * Факт применения санкции.
 *
 * `cutsTrade` — не украшение, а единственное честное место для НАЗВАННОЙ цены
 * механики: торговлю сегодня режет только `trade_embargo`
 * (`simulation/trade/TradeTick.ts`), остальные три вида — репутационные, то
 * есть меняют лишь отношения. Флаг обязан ехать в результат, иначе нарратив
 * рассказал бы о задушенной экономике там, где произошёл дипломатический жест.
 */
export interface AppliedSanction extends AppliedPrimitiveBase {
  verb: "sanction";
  targetCountryId: string;
  sanctionType: SanctionType;
  cutsTrade: boolean;
  relationEffects: RelationEffect[];
}

/** Факт объявления войны: кто с кем и кого втянула коалиция. */
export interface AppliedWar extends AppliedPrimitiveBase {
  verb: "war";
  targetCountryId: string;
  warId: string;
  /** Стороны ПОСЛЕ авто-втягивания союзников/гарантов/пуппетов (`WarService`). */
  attackers: string[];
  defenders: string[];
  relationEffects: RelationEffect[];
}

/**
 * Факт заключения мира — самый широкий след среди мягко-дипломатических
 * глаголов, и по одной причине: мир исполняет УСЛОВИЯ (`WarService.makePeace`),
 * а не только гасит флаг войны.
 *
 * Всё перечисленное обязано быть заявлено, потому что каждое поле имеет ячейку
 * в разложении состояния: скрытая репарация или скрытый штраф легитимности
 * откатили бы примитив сверкой (`reconciliation.ts`), и это правильное
 * поведение — нарратив о мире обязан знать его цену.
 */
export interface AppliedPeace extends AppliedPrimitiveBase {
  verb: "peace";
  targetCountryId: string;
  warId: string;
  relationEffects: RelationEffect[];
  /** Штраф легитимности/поддержки проигравшему и репарации — фактические. */
  countryScalarEffects: CountryScalarEffect[];
  /** Регионы, сменившие владельца по договору (аннексия победителя). */
  annexedRegionIds: number[];
  /** Столица, переехавшая потому, что прежняя ушла по договору. */
  capitalMoves: { countryId: string; from: number; to: number }[];
}

/**
 * Фактический сдвиг влияния ОДНОЙ стороны на другую.
 *
 * Направленная пара, как у отношений, но по другой причине: влияние
 * несимметрично ПО ОПРЕДЕЛЕНИЮ (`DiplomacyState.influence` — «влияние на другие
 * страны»), и обратной записи у него не бывает вовсе.
 */
export interface InfluenceEffect {
  fromCountryId: string;
  toCountryId: string;
  before: number;
  after: number;
  delta: number;
}

/** Фактический сдвиг ВВП одного региона. */
export interface RegionEconomyEffect {
  regionId: number;
  field: "gdp";
  before: number;
  after: number;
  delta: number;
}

/**
 * Факт помощи одного государства другому.
 *
 * Каналов ДВА, и они не дублируют друг друга: деньги переходят из казны в
 * казну, влияние донора растёт настолько, насколько помощь заметна получателю.
 * Отношений здесь нет НАМЕРЕННО — потепление приходит симуляцией, через порог
 * сферы влияния и член зависимости структурного тяготения, а не вторым прямым
 * сдвигом (см. `docs/PRIMITIVES.md` §2).
 */
export interface AppliedSendAid extends AppliedPrimitiveBase {
  verb: "send_aid";
  targetCountryId: string;
  /** Казна донора и получателя — фактические дельты обеих сторон. */
  countryScalarEffects: CountryScalarEffect[];
  influenceEffects: InfluenceEffect[];
}

/**
 * Факт оттока капитала из региона.
 *
 * Цель — РЕГИОН, а не страна, и это решение (`docs/ECONOMY.md`):
 * `country.economy.gdp` — агрегат, который `aggregateAllCountries`
 * перезаписывает из регионов каждый тик, поэтому удар, записанный туда,
 * исчезал бы к следующему месяцу. `region.gdp` живёт: `EconomyTick` растит его
 * мультипликативно от текущего значения, и отток уменьшает базу роста.
 */
export interface AppliedCapitalFlight extends AppliedPrimitiveBase {
  verb: "capital_flight";
  regionId: number;
  /** Чья казна пострадала — фактический контролёр региона. */
  countryId: string;
  regionEffects: RegionEconomyEffect[];
  countryScalarEffects: CountryScalarEffect[];
}

/**
 * Факт публичного осуждения.
 *
 * Единственный канал — легитимность цели. Отношений нет намеренно: это
 * «репутационный удар без материального» по спецификации, а запись в
 * `relations` затащила бы глагол в общий слот мягких двусторонних актов и
 * сделала бы осуждение взаимоисключающим с переговорами в тот же месяц.
 */
export interface AppliedCondemn extends AppliedPrimitiveBase {
  verb: "condemn";
  targetCountryId: string;
  /** Размер аудитории осуждающего — почему удар оказался таким. */
  audienceSize: number;
  countryScalarEffects: CountryScalarEffect[];
}

/**
 * Факт поддержки воюющего клиента.
 *
 * Патрон платит казной, клиент получает живую силу. Деньги и сила — ДВА
 * эффекта одного акта, а не конверсия: рынка вооружений в модели нет, и цена
 * единицы техники была бы калибровочной константой без второго потребителя.
 */
export interface AppliedSupportProxy extends AppliedPrimitiveBase {
  verb: "support_proxy";
  targetCountryId: string;
  /** Война клиента, ради которой поддержка и оказана. */
  warId: string;
  /** Казна патрона и живая сила клиента — обе стороны одним списком. */
  countryScalarEffects: CountryScalarEffect[];
}

/**
 * Факт подчинения одного государства другому.
 *
 * ДВА поля состояния одним актом, и это главное свойство глагола:
 * `diplomacy.puppets` (рантайм-отношение, по нему втягивают в войну и считают
 * тяготение пары) и `politics.sovereigntyStatus`/`overlordIds` (юридическое
 * положение). До этой сессии их синхронизировал только слой данных, и
 * подчинение, пришедшее из партии, оставляло юридический статус нетронутым —
 * см. `subordination.ts`.
 *
 * `leverage` — ЧЕМ подчинение обеспечено. Не украшение: у глагола два разных
 * пути к одной предпосылке (войска на земле либо влияние), и нарратив,
 * не знающий который сработал, рассказал бы о капитуляции там, где произошёл
 * дипломатический переход в сферу.
 */
export interface AppliedPuppet extends AppliedPrimitiveBase {
  verb: "puppet";
  targetCountryId: string;
  leverage: "occupation" | "influence";
  /** Юридический статус субъекта до и после — оба, потому что могли совпасть. */
  statusBefore: SovereigntyStatus;
  statusAfter: SovereigntyStatus;
}

/**
 * Факт поглощения: регионы цели, которые источник фактически держит,
 * переходят к нему во ВЛАДЕНИЕ.
 *
 * Страна-жертва при этом НЕ удаляется, даже потеряв последний регион.
 * Государство без территории — законное состояние по §7.1 («тотальное
 * поражение даёт переход в подчинённое положение, а не во владение
 * победителем»), и решение о конце партии принимает машина состояний кампании,
 * а не этот глагол: `campaignEnded` несёт её вердикт, если он изменился.
 */
export interface AppliedAnnex extends AppliedPrimitiveBase {
  verb: "annex";
  targetCountryId: string;
  /** Регионы, сменившие владельца. Пустым не бывает: пустое отклоняет предпосылка. */
  annexedRegionIds: number[];
  /** Осталось ли у цели хоть что-нибудь — от этого зависит и нарратив, и кампания. */
  targetRegionsLeft: number;
  /** Столица, переехавшая потому, что прежняя ушла победителю. */
  capitalMoves: { countryId: string; from: number; to: number }[];
  /**
   * Кампания перешла в терминальное состояние этим актом.
   *
   * Войн аннексия НЕ закрывает, и это заявление: стороны войны — государства, а
   * государство, потерявшее последний регион, не исчезает (§7.1). Война с
   * противником без территории продолжает существовать до мирного договора, и
   * гасить её здесь значило бы объявить капитуляцию за движок войны.
   */
  campaignEnded?: "defeated" | undefined;
}

/**
 * Факт объединения государств — ОБРАТНАЯ операция к расколу.
 *
 * Поглощённая страна исчезает, её ссылки переходят поглотителю, а делимое
 * имущество СКЛАДЫВАЕТСЯ. Заявляется прирост казны и живой силы поглотителя:
 * у обеих есть ячейка в разложении состояния, и молчание о честно сделанном
 * откатило бы примитив собственной сверкой — ровно то же требование, что у
 * раскола, делящего те же величины.
 */
export interface AppliedMergeCountries extends AppliedPrimitiveBase {
  verb: "merge_countries";
  /** Государство, перестающее существовать. */
  absorbedCountryId: string;
  /** Его имя — ссылки на страну в состоянии уже нет, а интерфейсу она нужна. */
  absorbedName: LocalizedText;
  /** Регионы, перешедшие поглотителю. */
  absorbedRegionIds: number[];
  /** Казна и живая сила поглотителя после сложения — фактические дельты. */
  countryScalarEffects: CountryScalarEffect[];
  /**
   * Влияние, ИСЧЕЗНУВШЕЕ вместе с поглощённой страной.
   *
   * Найдено проверкой на боевых данных 1946: у поглотителя было 85 влияния на
   * своего клиента, и после слияния запись снялась как самоссылка
   * (`countryRefs.ts` — влиять на себя нельзя). Ячейка `influence:` в разложении
   * состояния существует с `send_aid`, поэтому молчание об этом откатывало
   * примитив собственной сверкой — правильно: исчезновение влияния такой же
   * факт мира, как сложение казны.
   */
  influenceEffects: InfluenceEffect[];
  /** Столица поглотителя, если земля появилась у страны, её не имевшей. */
  capitalMoves: { countryId: string; from: number; to: number }[];
  /** Война, схлопнувшаяся в войну страны с самой собой, закрыта. */
  closedWarIds: string[];
}

/**
 * Discriminated union по глаголу: у каждого verb своя форма фактов, и лишнего
 * поля в ней нет. Общего скаляра «магнитуда» тут намеренно нет — один усреднённый
 * канал не описывает примитив, у которого их несколько (repress пишет и
 * подавление, и отчуждение), и именно на нём строилась ложь прежнего API.
 */
export type AppliedPrimitive =
  | AppliedInciteUnrest
  | AppliedRepress
  | AppliedGrantAutonomy
  | AppliedEnactReform
  | AppliedSpawnIncident
  | AppliedSplitCountry
  | AppliedDiplomacy
  | AppliedSanction
  | AppliedWar
  | AppliedPeace
  | AppliedSendAid
  | AppliedCapitalFlight
  | AppliedCondemn
  | AppliedSupportProxy
  | AppliedPuppet
  | AppliedAnnex
  | AppliedMergeCountries;

/**
 * Все следы примитива в памяти воздействий одним списком — и прямые, и побочные.
 *
 * Используется бюджетом накопления следа и как ЧАСТЬ общей сверки отчёта с
 * состоянием (`reconciliation.ts`), которая с Милстоуна 1 покрывает не только
 * память воздействий, но и координаты идеологии, поддержку правительства и
 * созданные объекты карты. Функция здесь, а не по месту, чтобы новый verb с
 * новым каналом памяти нельзя было забыть подключить — `switch` без ветки не
 * компилируется.
 */
export function impactEffectsOf(applied: AppliedPrimitive): GroupImpactEffect[] {
  switch (applied.verb) {
    case "grant_autonomy":
      return [...applied.targetEffects, ...applied.neighbourEffects];
    case "enact_reform":
    case "split_country":
    // Дипломатический блок в память воздействий не пишет вовсе: он действует
    // между ГОСУДАРСТВАМИ, а память ключуется парой (регион, группа).
    case "diplomacy":
    case "sanction":
    case "war":
    case "peace":
    // Мягкие воздействия Милстоуна 1 работают с деньгами, влиянием,
    // легитимностью и живой силой — ни один из этих каналов не ключуется парой
    // (регион, группа), поэтому в память воздействий они не пишут вовсе.
    case "send_aid":
    case "capital_flight":
    case "condemn":
    case "support_proxy":
    // Структурные глаголы подчинения и поглощения меняют состав и статус
    // государств, а не настроение групп: память воздействий ключуется парой
    // (регион, группа), и записи там у них нет по построению.
    case "puppet":
    case "annex":
    case "merge_countries":
      return [];
    case "incite_unrest":
    case "repress":
    case "spawn_incident":
      return applied.targetEffects;
  }
}

/**
 * Отклонение целиком — со СТРУКТУРНОЙ причиной (docs/PRIMITIVES.md §3).
 *
 * `rejection` — код + типизированные параметры (`rejections.ts`), а не строка:
 * причина уходит игроку по-русски и в промт по-английски, и одна строка не
 * может быть обеими сразу. Готового текста здесь нет вовсе, чтобы ни один
 * потребитель не мог случайно показать чужой.
 *
 * `verb` и `sourceCountryId` необязательны: запись, отклонённая структурной
 * схемой, может не нести ни того, ни другого. Движок заполняет оба всегда —
 * до него доезжает только разобранный примитив.
 */
export interface RejectedPrimitive {
  verb?: PrimitiveVerb | undefined;
  sourceCountryId?: string | undefined;
  rejection: PrimitiveRejection;
}

export interface PrimitiveBatchResult {
  applied: AppliedPrimitive[];
  rejected: RejectedPrimitive[];
}

/** Результат фазы validate: либо pass, либо структурная причина отказа. */
export type PreconditionResult = { valid: true } | { valid: false; rejection: PrimitiveRejection };
