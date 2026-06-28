/**
 * Каталог ресурсов — единый источник истины по сырьевым ресурсам мира.
 *
 * Модель: **только добыча сырья** (переделы вроде стали/алюминия — выход
 * промышленности страны, не ресурс региона). Один суперсет на все сценарии;
 * сценарий видит ресурсы с `eraIntroduced <= startYear` (плюс опц. `techGate`).
 *
 * Ключи каталога — канонические id ресурсов. `ResourceType`
 * (shared/src/types/resources/ResourcesType.ts) приводится к этому списку:
 * каждый ключ здесь обязан иметь член enum и наоборот. `eraIntroduced`/`techGate`
 * — стартовые ориентиры, уточняются по docs/HISTORICAL_ACCURACY.md.
 *
 * Aluminum намеренно отсутствует (передел боксита). Импорт MAP мапит `grain`→`food`.
 */

export type ResourceCategory = "energy" | "metal" | "agricultural" | "strategic";

export interface ResourceMeta {
  /** Группа для UI/баланса. */
  category: ResourceCategory;
  /** Год, с которого ресурс релевантен (нижняя граница активного набора сценария). */
  eraIntroduced: number;
  /** Опц. id технологии из tech-дерева, без которой ресурс не используется. */
  techGate?: string;
}

export const RESOURCE_CATALOG = {
  // --- энергоносители ---
  coal: { category: "energy", eraIntroduced: 1836 },
  oil: { category: "energy", eraIntroduced: 1860 },
  gas: { category: "energy", eraIntroduced: 1900 },

  // --- металлы / руды ---
  iron: { category: "metal", eraIntroduced: 1836 },
  copper: { category: "metal", eraIntroduced: 1836 },
  gold: { category: "metal", eraIntroduced: 1836 },
  tin: { category: "metal", eraIntroduced: 1836 },
  nickel: { category: "metal", eraIntroduced: 1860 },
  bauxite: { category: "metal", eraIntroduced: 1900 },
  tungsten: { category: "metal", eraIntroduced: 1900 },
  manganese: { category: "metal", eraIntroduced: 1900 },
  chromium: { category: "metal", eraIntroduced: 1900 },
  uranium: { category: "metal", eraIntroduced: 1945, techGate: "nuclear_fission" },
  rareEarths: { category: "metal", eraIntroduced: 1980, techGate: "electronics" },
  lithium: { category: "metal", eraIntroduced: 1980, techGate: "electronics" },

  // --- аграрные / биоресурсы ---
  food: { category: "agricultural", eraIntroduced: 1836 },
  timber: { category: "agricultural", eraIntroduced: 1836 },
  cotton: { category: "agricultural", eraIntroduced: 1836 },
  rubber: { category: "agricultural", eraIntroduced: 1900 },

  // --- стратегическое химсырьё ---
  nitrates: { category: "strategic", eraIntroduced: 1836 },
} as const satisfies Record<string, ResourceMeta>;

/** Канонический id ресурса (ключ каталога). */
export type ResourceId = keyof typeof RESOURCE_CATALOG;

/** Все id ресурсов суперсета. */
export const RESOURCE_IDS = Object.keys(RESOURCE_CATALOG) as ResourceId[];

/**
 * Активный набор ресурсов для года старта сценария: те, чей `eraIntroduced`
 * не позже года. `techGate` фильтрует доступность по технологиям отдельно (в рантайме).
 */
export function activeResourcesForYear(startYear: number): ResourceId[] {
  return RESOURCE_IDS.filter((id) => RESOURCE_CATALOG[id].eraIntroduced <= startYear);
}
