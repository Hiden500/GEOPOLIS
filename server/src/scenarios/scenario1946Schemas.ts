import { z } from "zod";
import { RESOURCE_IDS } from "@shared/data/resources/resourceCatalog";
import {
  POWER_STRUCTURES,
  SOVEREIGNTY_STATUSES,
  SOVEREIGN_STATUS,
  CONDOMINIUM_STATUS,
} from "@shared/types/politics/Government";
import {
  INFLUENCE_SCALE_MAX,
  RELATION_SCALE_MIN,
  RELATION_SCALE_MAX,
} from "@shared/defines/diplomacy";

/**
 * Схемы расслоённых файлов сценария 1946 (docs/plans/05_DATA_LAYOUT.md).
 * Ключи deposits/extraction ограничены каталогом ресурсов — единственным
 * источником истины (shared/src/data/resources/resourceCatalog.ts). Партиальность
 * (Partial<Record<ResourceType, number>>) требует z.record(z.string(), ...) +
 * refine — z.record(z.enum(...), ...) в Zod v4 требует ВСЕ ключи enum (полный
 * record), не подходит для частичной записи.
 */
const RESOURCE_ID_SET = new Set<string>(RESOURCE_IDS);
const resourceRecordSchema = z.record(z.string(), z.number()).refine(
  (rec) => Object.keys(rec).every((k) => RESOURCE_ID_SET.has(k)),
  { message: `Ключи должны быть из каталога ресурсов: ${RESOURCE_IDS.join(", ")}` }
);

// LocalizedText (shared/src/types/i18n/LocalizedText.ts): en всегда есть
// (generate_country_registry.py гарантирует), ru — только если известен.
const localizedTextSchema = z.object({
  en: z.string().min(1),
  ru: z.string().min(1).optional(),
});

export const regionCoreSchema = z.object({
  id: z.number().int().positive(),
  geoJsonId: z.string().min(1),
  area: z.number().nonnegative(),
  neighboringRegionIds: z.array(z.number().int()),
  sourceAdm1Codes: z.array(z.string()).optional(),
});
export type RegionCoreEntry = z.infer<typeof regionCoreSchema>;
export const regionCoreFileSchema = z.array(regionCoreSchema);

export const regionStateSchema = z.object({
  id: z.number().int().positive(),
  ownerCountryId: z.string().min(1),
  occupiedBy: z.string().min(1).optional(),
  population: z.number().nonnegative(),
  urbanization: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  infrastructure: z.number().min(0).max(1),
  development: z.number().min(0).max(1),
  gdp: z.number().nonnegative(),
  deposits: resourceRecordSchema,
  extraction: resourceRecordSchema,
});
export type RegionStateEntry = z.infer<typeof regionStateSchema>;
export const regionStateFileSchema = z.array(regionStateSchema);

/**
 * Демо-состав и координаты идеологии (docs/CONCEPT.md §4.1/§4.2) — три файла,
 * генерируемые scripts/map/generate_demographics_1946.py. Отдельными слоями, а
 * не полями в countries.json/regions.state.json: тот же принцип расслоения
 * (docs/plans/05_DATA_LAYOUT.md), безопасное параллельное наполнение и
 * СОЗНАТЕЛЬНО частичное покрытие — регион без записи считается неразмеченным,
 * страна без координат читает фолбэк по ярлыку politics.ideology.
 *
 * Инварианты дублируют scripts/map/validate_demographics_1946.py намеренно:
 * там — до запуска игры, здесь — на загрузке сейва/сценария.
 */
const ideologyAxisSchema = z.number().min(-1).max(1);

const ideologyCoordinatesSchema = z.object({
  economic: ideologyAxisSchema,
  political: ideologyAxisSchema,
});

export const ethnicGroupSchema = z.object({
  id: z.string().min(1),
  names: localizedTextSchema,
  desiredIdeology: ideologyCoordinatesSchema,
});
export const groupsFileSchema = z.object({
  groups: z.array(ethnicGroupSchema).nonempty(),
});
export type GroupsFile = z.infer<typeof groupsFileSchema>;

/** Доминант + до 3 меньшинств (§4.1), сумма долей = 1.0 ± 0.001. */
const SHARE_SUM_TOLERANCE = 0.001;
export const MAX_GROUPS_PER_REGION = 4;

export const regionDemographicsSchema = z.object({
  regionId: z.number().int().positive(),
  groups: z
    .array(z.object({
      groupId: z.string().min(1),
      share: z.number().gt(0).max(1),
    }))
    .nonempty()
    .max(MAX_GROUPS_PER_REGION)
    .refine(
      (groups) => Math.abs(groups.reduce((sum, g) => sum + g.share, 0) - 1) <= SHARE_SUM_TOLERANCE,
      { message: `Сумма долей групп региона должна быть 1.0 ± ${SHARE_SUM_TOLERANCE}` }
    )
    .refine(
      (groups) => new Set(groups.map(g => g.groupId)).size === groups.length,
      { message: "Группа не может встречаться в регионе дважды" }
    ),
});
export type RegionDemographicsEntry = z.infer<typeof regionDemographicsSchema>;
export const demographicsFileSchema = z.object({
  regions: z.array(regionDemographicsSchema),
});
export type DemographicsFile = z.infer<typeof demographicsFileSchema>;

export const countryIdeologySchema = z.object({
  countryId: z.string().min(1),
  economic: ideologyAxisSchema,
  political: ideologyAxisSchema,
});
export const ideologyFileSchema = z.object({
  countries: z.array(countryIdeologySchema),
});
export type IdeologyFile = z.infer<typeof ideologyFileSchema>;

/**
 * Именованные точки спектра эпохи (`ideology_zones.json`). Радиус ограничен
 * сверху половиной оси: якорь шире накрыл бы четверть спектра и подменил бы
 * собой шкалу, ради выразительности которой он и заведён.
 */
export const ideologyAnchorSchema = z.object({
  id: z.string().min(1),
  center: ideologyCoordinatesSchema,
  radius: z.number().gt(0).max(0.5),
  name: localizedTextSchema,
});
export const ideologyZonesFileSchema = z.object({
  anchors: z.array(ideologyAnchorSchema),
});
export type IdeologyZonesFile = z.infer<typeof ideologyZonesFileSchema>;

/**
 * Формы правления и юридический статус (`government.json`).
 *
 * Перечни берутся из shared (`POWER_STRUCTURES`/`SOVEREIGNTY_STATUSES`), а не
 * переписываются здесь: `z.enum()` умеет вывести литералы из `as const`
 * массива, и второй копии списка, способной разойтись с типом, не заводится
 * (тот же приём, что у `SANCTION_TYPES`).
 *
 * Форма подчинения проверяется схемой, а не только валидатором пайплайна:
 * пайплайн стоит до запуска игры, схема — на загрузке сценария и сейва. Файл,
 * собранный мимо пайплайна, обязан отвергаться так же.
 */
export const countryGovernmentSchema = z.object({
  countryId: z.string().min(1),
  powerStructure: z.enum(POWER_STRUCTURES),
  sovereigntyStatus: z.enum(SOVEREIGNTY_STATUSES),
  overlordIds: z.array(z.string().min(1)),
}).superRefine((entry, ctx) => {
  const { sovereigntyStatus: status, overlordIds: overlords, countryId } = entry;
  const expected = status === SOVEREIGN_STATUS ? 0 : status === CONDOMINIUM_STATUS ? 2 : 1;
  if (overlords.length !== expected) {
    ctx.addIssue({
      code: "custom",
      message:
        `"${countryId}": статус "${status}" требует ${expected} сюзерен(ов), ` +
        `указано ${overlords.length}`,
    });
  }
  if (new Set(overlords).size !== overlords.length) {
    ctx.addIssue({ code: "custom", message: `"${countryId}": дубль в overlordIds` });
  }
  if (overlords.includes(countryId)) {
    ctx.addIssue({ code: "custom", message: `"${countryId}": страна назначена сюзереном самой себе` });
  }
});
/**
 * Стартовое влияние держав (`influence.json`).
 *
 * Влияние НАПРАВЛЕННОЕ и несимметричное: СССР влияет на Польшу сильно, Польша
 * на СССР — почти никак, и обе стороны, если значимы, записываются отдельно.
 *
 * Нижняя граница 10 — не техническая, а смысловая: связь слабее в движке
 * неотличима от её отсутствия, поэтому запись со значением 3 означала бы
 * данные, которые никто не прочтёт. Ноль тоже запрещён — отсутствие связи
 * выражается отсутствием ключа, а не нулём (иначе разреженная карта перестаёт
 * быть разреженной).
 */
export const INFLUENCE_MIN_RECORDED = 10;

export const countryInfluenceSchema = z.object({
  sourceCountryId: z.string().min(1),
  targets: z.record(
    z.string().min(1),
    z.number().int().min(INFLUENCE_MIN_RECORDED).max(INFLUENCE_SCALE_MAX)
  ),
}).superRefine((entry, ctx) => {
  if (entry.targets[entry.sourceCountryId] !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: `"${entry.sourceCountryId}": страна влияет сама на себя`,
    });
  }
  if (Object.keys(entry.targets).length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `"${entry.sourceCountryId}": источник без единой цели — запись без смысла`,
    });
  }
});
export const influenceFileSchema = z.object({
  influence: z.array(countryInfluenceSchema),
});
export type InfluenceFile = z.infer<typeof influenceFileSchema>;

export const governmentFileSchema = z.object({
  countries: z.array(countryGovernmentSchema),
});
export type GovernmentFile = z.infer<typeof governmentFileSchema>;

/**
 * Стартовый дипломатический слой (`diplomacy.json`, docs/DIPLOMACY.md — раздел
 * «Стартовый слой»). Заполняет то, что в сценарии пусто у всех стран:
 * отношения, союзы, соперничества и гарантии. Слой разреженный, как
 * `influence.json`: полная матрица 157 стран — 24 649 пар против правила о
 * размере сохранений.
 *
 * ПАРА, А НЕ НАПРАВЛЕНИЕ. В состоянии `relations` направленные
 * (`Record<countryId, number>` у каждой страны), но `driftRelations` ведёт ОБЕ
 * стороны к одной цели `structuralAffinity` — два разных стартовых числа на
 * пару движок сотрёт за несколько тиков. Поэтому запись одна, а порядок кодов в
 * ней не значим: `["SUN","POL"]` и `["POL","SUN"]` — одна и та же связь, и
 * вторая из них отвергается как дубль. Гарантии, наоборот, направленные по
 * своей природе: гарант и защищаемый не взаимозаменяемы.
 *
 * ГРАНИЦА С `validate_demographics_1946.py`, НАЗВАННАЯ ПРЯМО. Там проверяется
 * класс «данные, которые движок отменяет на первом тике» (союз без записи
 * отношений, соперничество выше порога примирения) — он требует парных порогов
 * от идеологической дистанции, и воспроизводить их здесь значило бы завести
 * копию калибровки. Здесь — только форма записи, верная при любых
 * координатах. Схема, а не только пайплайн: пайплайн стоит до запуска игры,
 * схема — на загрузке (тот же довод, что у `countryGovernmentSchema`).
 *
 * Границы шкалы читаются из `shared/src/defines/diplomacy.ts` — числа не
 * дублируются, иначе рекалибровка шкалы разошлась бы с проверкой молча.
 */
const countryPairSchema = z.tuple([z.string().min(1), z.string().min(1)]);

/** Ключ пары без направления — им же ловятся дубли в обоих порядках. */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}
/** Читаемая форма того же ключа для текста ошибки. */
function pairLabel(key: string): string {
  return key.replace("|", "—");
}

export const relationEntrySchema = z.object({
  pair: countryPairSchema,
  value: z.number().min(RELATION_SCALE_MIN).max(RELATION_SCALE_MAX),
});
export const diplomacyPairSchema = z.object({ pair: countryPairSchema });
export const guaranteeEntrySchema = z.object({
  guarantor: z.string().min(1),
  protected: z.string().min(1),
});

/**
 * Общая часть разбора списка пар: самопара и дубль в любом порядке. Возвращает
 * множество ключей, чтобы вызывающий мог сверить списки между собой.
 */
function collectPairs(
  entries: { pair: [string, string] }[],
  label: string,
  ctx: z.RefinementCtx
): Set<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    const [a, b] = entry.pair;
    if (a === b) {
      ctx.addIssue({ code: "custom", message: `${label}: пара "${a}" сама с собой` });
      continue;
    }
    const key = pairKey(a, b);
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: `${label}: пара ${pairLabel(key)} встречается дважды` });
    }
    seen.add(key);
  }
  return seen;
}

/**
 * Все четыре ключа опциональны: слой наполняется по частям, и требовать
 * `"guarantees": []` ради формы значило бы держать в данных пустышку. Файла нет
 * вовсе — тоже штатное состояние, это решает `readOptionalJsonFile`.
 */
export const diplomacyFileSchema = z.object({
  relations: z.array(relationEntrySchema).optional(),
  alliances: z.array(diplomacyPairSchema).optional(),
  rivalries: z.array(diplomacyPairSchema).optional(),
  guarantees: z.array(guaranteeEntrySchema).optional(),
}).superRefine((file, ctx) => {
  collectPairs(file.relations ?? [], "relations", ctx);
  const alliances = collectPairs(file.alliances ?? [], "alliances", ctx);
  const rivalries = collectPairs(file.rivalries ?? [], "rivalries", ctx);

  // Не порог и не калибровка, поэтому проверяется здесь, а не в Python:
  // пара, стоящая в обоих списках, попала бы у обеих сторон разом в `allies` и
  // в `rivals`, то есть загрузка построила бы состояние, невыразимое в мире.
  for (const key of alliances) {
    if (rivalries.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `пара ${pairLabel(key)} одновременно в alliances и rivalries`,
      });
    }
  }

  const seenGuarantees = new Set<string>();
  for (const entry of file.guarantees ?? []) {
    if (entry.guarantor === entry.protected) {
      ctx.addIssue({
        code: "custom",
        message: `guarantees: "${entry.guarantor}" гарантирует сама себе`,
      });
      continue;
    }
    // Направленный дубль: гарантия одна, а `guarantees` — массив, поэтому
    // вторая запись дала бы тот же код в списке дважды.
    const key = `${entry.guarantor}->${entry.protected}`;
    if (seenGuarantees.has(key)) {
      ctx.addIssue({ code: "custom", message: `guarantees: гарантия ${key} встречается дважды` });
    }
    seenGuarantees.add(key);
  }
});
export type DiplomacyFile = z.infer<typeof diplomacyFileSchema>;

/** region_id (geoJsonId) → имя. Частичное покрытие допустимо (см. getText fallback). */
export const namesFileSchema = z.record(z.string(), z.string());
export type NamesFile = z.infer<typeof namesFileSchema>;

/**
 * Авторская страна countries.json (docs/plans/05_DATA_LAYOUT.md, Срез 2) — только
 * реально ненулевые/содержательные поля, зеркалит CountryInput
 * (server/src/data/countries/templates/CreateCountry.ts). Нулевые рантайм-блоки
 * (technology/military/stockpile/researchedTechnologyIds/goals/population,
 * пустая diplomacy) в файле отсутствуют — их дефолтит createCountry на загрузке.
 */
const economyProfileOverrideSchema = z.object({
  taxRate: z.number().optional(),
  spending: z.object({
    military: z.number(),
    research: z.number(),
    education: z.number(),
    infrastructure: z.number(),
    welfare: z.number(),
    other: z.number(),
  }).partial().optional(),
  treasuryShare: z.number().optional(),
  exportShare: z.number().optional(),
  stateEnterpriseShare: z.number().optional(),
  otherIncomeShare: z.number().optional(),
  inflation: z.number().optional(),
  unemployment: z.number().optional(),
  tradeBalance: z.number().optional(),
  debtInterestShare: z.number().optional(),
});

const authoredDiplomacySchema = z.object({
  allies: z.array(z.string()).optional(),
  rivals: z.array(z.string()).optional(),
  puppets: z.array(z.string()).optional(),
  sphereOfInfluence: z.array(z.string()).optional(),
  relations: z.record(z.string(), z.number()).optional(),
  influence: z.record(z.string(), z.number()).optional(),
  guarantees: z.array(z.string()).optional(),
  sanctions: z.record(z.string(), z.array(z.string())).optional(),
});

const authoredTechnologySchema = z.object({
  domains: z.record(z.string(), z.number()).optional(),
  researchAllocation: z.record(z.string(), z.number()).optional(),
});

const authoredMilitarySchema = z.object({
  manpower: z.number().optional(),
  activePersonnel: z.number().optional(),
  reservePersonnel: z.number().optional(),
  militaryBudget: z.number().optional(),
  armyStrength: z.number().optional(),
  navyStrength: z.number().optional(),
  airStrength: z.number().optional(),
  nuclearWarheads: z.number().optional(),
  equipment: z.record(z.string(), z.number()).optional(),
});

export const authoredCountrySchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  shortName: localizedTextSchema,
  color: z.string().min(1),
  capitalRegionId: z.number().int().nonnegative(),
  economyType: z.enum(["planned", "mixed", "market"]),
  economyProfile: economyProfileOverrideSchema.optional(),
  population: z.number().nonnegative().optional(),
  technology: authoredTechnologySchema.optional(),
  researchedTechnologyIds: z.array(z.string()).optional(),
  military: authoredMilitarySchema.optional(),
  diplomacy: authoredDiplomacySchema.optional(),
  politics: z.object({
    ideology: z.string().min(1),
    stability: z.number().optional(),
    legitimacy: z.number().optional(),
    corruption: z.number().optional(),
    governmentSupport: z.number().optional(),
  }),
  stockpile: z.record(z.string(), z.number()).optional(),
  goals: z.array(z.unknown()).optional(),
  // Валютные зоны (docs/plans/10_CURRENCY_ZONES.md) — id страны-якоря.
  currencyZoneAnchor: z.string().min(1).optional(),
});
export type AuthoredCountry = z.infer<typeof authoredCountrySchema>;
export const authoredCountryFileSchema = z.array(authoredCountrySchema);
