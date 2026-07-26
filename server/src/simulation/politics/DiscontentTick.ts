import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type GroupImpactMemory } from "@shared/types/politics/Demographics";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  SUPPRESSION_DECAY_RATE,
  ALIENATION_DECAY_RATE,
  CONCESSION_DECAY_RATE,
  EMBOLDENMENT_DECAY_RATE,
  IMPACT_MEMORY_EPSILON,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  REGION_CRISIS_RELEASE_HYSTERESIS,
} from "@shared/defines/discontent";

/**
 * Тик недовольства (docs/CONCEPT.md §4.1/§4.2, docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md).
 *
 * Само недовольство НЕ хранится — оно выводится из состояния каждый раз
 * (shared/src/utils/discontent.ts). Тик делает ровно две вещи:
 *
 *   1. Гасит память воздействий (репрессии/уступки/подстрекательство) с разной
 *      скоростью по видам следа — здесь живёт разница характеров ответов
 *      игрока: `suppression` выдыхается за месяцы, `alienation` остаётся на годы.
 *   2. Следит за пересечением кризисного порога и выдаёт типизированный факт
 *      «кризис в регионе X» в pendingWorldFacts.
 *
 * Латч (game.regionCrisisLatch), а не сравнение «до/после» внутри тика: регион
 * с большой идеологической дистанцией стоит выше порога с первого месяца
 * партии, никакого пересечения не происходит, и факт не выстрелил бы никогда.
 * Латч + гистерезис даёт правильную петлю: подавили → недовольство упало →
 * латч снят → отчуждение вернуло недовольство вверх → НОВЫЙ кризис.
 *
 * Порядок внутри тика: сначала затухание, потом оценка — факт описывает
 * состояние на конец месяца, то самое, которое увидит игрок.
 */

const DECAY_RATES: Record<keyof Omit<GroupImpactMemory, "regionId" | "groupId">, number> = {
  suppression: SUPPRESSION_DECAY_RATE,
  alienation: ALIENATION_DECAY_RATE,
  concession: CONCESSION_DECAY_RATE,
  emboldenment: EMBOLDENMENT_DECAY_RATE,
};

/**
 * Гасит все следы и выбрасывает записи, где не осталось ничего значимого —
 * иначе память воздействий растёт монотонно и раздувает сейв за долгую
 * кампанию (бюджет SAVE, docs/CONCEPT.md §7.5).
 */
function decayImpactMemory(game: GameState): void {
  const surviving: GroupImpactMemory[] = [];

  for (const memory of game.groupImpactMemory) {
    let anyAlive = false;

    for (const [field, rate] of Object.entries(DECAY_RATES) as [keyof typeof DECAY_RATES, number][]) {
      const decayed = memory[field] * (1 - rate);
      memory[field] = decayed < IMPACT_MEMORY_EPSILON ? 0 : decayed;
      if (memory[field] > 0) anyAlive = true;
    }

    if (anyAlive) surviving.push(memory);
  }

  game.groupImpactMemory = surviving;
}

/** Человекочитаемое имя региона для факта — на языке промта, как остальные факты. */
function regionLabel(region: Region): string {
  return getText(region.names, LLM_LOCALE) || `region ${region.id}`;
}

/**
 * Обновляет латч кризисов и пишет факты. Возвращать ничего не нужно: и латч, и
 * факты — поля game.
 */
function updateCrisisLatch(game: GameState): void {
  const latched = new Set(game.regionCrisisLatch);
  const releaseThreshold = REGION_CRISIS_DISCONTENT_THRESHOLD - REGION_CRISIS_RELEASE_HYSTERESIS;

  for (const region of game.regions) {
    // Неразмеченные демографией регионы (подавляющее большинство при частичном
    // покрытии данных) пропускаем без вычислений.
    if (!region.demographics || region.demographics.length === 0) continue;

    const discontent = regionDiscontent(game, region);
    if (discontent === undefined) continue;

    const wasLatched = latched.has(region.id);

    if (!wasLatched && discontent >= REGION_CRISIS_DISCONTENT_THRESHOLD) {
      latched.add(region.id);
      const controllerId = effectiveController(region);
      game.pendingWorldFacts.push({
        countryId: controllerId,
        kind: "region_crisis",
        regionId: region.id,
        // Величина названа тем, что она есть. До 2026-07-26 факт писал
        // «N% of the local population», хотя `regionDiscontent` — не доля
        // недовольных жителей, а взвешенный ИНДЕКС 0..1 из идеологической
        // дистанции, экономического отставания и памяти воздействий
        // (shared/src/utils/discontent.ts). Факт уходит прямо в промт: модель
        // повторила бы «55 % населения» как утверждение о людях, и цифра в
        // нарративе оказалась бы ложной (docs/PRIMITIVES.md §4).
        text:
          `Unrest crisis in ${regionLabel(region)}: discontent index ` +
          `${discontent.toFixed(2)} of 1.00 (population-share-weighted across the region's ` +
          `groups; not a headcount of protesters)`,
      });
    } else if (wasLatched && discontent < releaseThreshold) {
      latched.delete(region.id);
    }
  }

  // Сортировка — детерминированный порядок в сейве независимо от порядка
  // обхода (JSON round-trip обязан быть стабильным, fitness-правило 1).
  game.regionCrisisLatch = [...latched].sort((a, b) => a - b);
}

export function discontentTick(game: GameState): void {
  decayImpactMemory(game);
  updateCrisisLatch(game);
}
