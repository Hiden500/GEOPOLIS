import { type PrimitiveVerb } from "./types";

/**
 * Палитра эффектов — декларативный whitelist путей состояния, которые вправе
 * менять каждый verb (docs/PRIMITIVES.md §1 «Что держит движок» и §3 защита №3).
 *
 * Пути — в нормализованной форме `server/src/primitives/statePaths.ts`
 * (индексы массивов схлопнуты в `[*]`). Всё, что примитив изменил вне своей
 * палитры, откатывается вместе с самим примитивом — LLM не может дописать
 * побочный эффект, даже если очень хочет.
 *
 * Записи `groupImpactMemory[*].regionId` / `.groupId` есть у каждого verb,
 * работающего с памятью воздействий: первое касание пары (регион, группа)
 * создаёт запись, и её идентификаторы — законная часть эффекта. Нулевые поля
 * новой записи в диф не попадают (см. leavesEqual в statePaths.ts), поэтому
 * палитра остаётся точной: verb, объявивший только `emboldenment`, не сможет
 * незаметно тронуть `alienation`.
 */
export const PRIMITIVE_PALETTE: Record<PrimitiveVerb, readonly string[]> = {
  // Подстрекательство: чужая рука делает группу смелее. Ни репрессий, ни
  // уступок, ни координат — только смелость.
  incite_unrest: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].emboldenment",
  ],

  // Репрессии: недовольство вниз сейчас (suppression), отчуждение вверх
  // надолго (alienation) — цена, из-за которой «загнал вглубь» работает.
  repress: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].suppression",
    "groupImpactMemory[*].alienation",
  ],

  // Уступка: недовольство вниз у адресата (concession), но та же группа в
  // соседних регионах осмелела (emboldenment) — цена уступки.
  grant_autonomy: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].concession",
    "groupImpactMemory[*].emboldenment",
  ],

  // Реформа: медленный сдвиг координат власти + политическая цена. Память
  // воздействий не трогает вовсе — эффект приходит через геометрию дистанции.
  enact_reform: [
    "countries[*].politics.ideologyCoordinates.economic",
    "countries[*].politics.ideologyCoordinates.political",
    "countries[*].politics.governmentSupport",
  ],

  // Инцидент: объект на карте + небольшой толчок смелости. Экономику,
  // население и владение регионом не трогает.
  spawn_incident: [
    "mapFeatures[*].id",
    "mapFeatures[*].type",
    "mapFeatures[*].tags[*]",
    "mapFeatures[*].createdAt",
    "mapFeatures[*].regionId",
    "mapFeatures[*].ownerId",
    "mapFeatures[*].name",
    "nextFeatureId",
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].emboldenment",
  ],
};

/** Пути, изменённые примитивом, но не объявленные в его палитре. */
export function findPaletteViolations(verb: PrimitiveVerb, changedPaths: readonly string[]): string[] {
  const allowed = new Set(PRIMITIVE_PALETTE[verb]);
  return changedPaths.filter(p => !allowed.has(p));
}
