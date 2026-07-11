/**
 * Состояние войны (docs/WAR.md, docs/DECISIONS.md 2026-07-06, Phase 1).
 * Фронт — модель контактных границ регионов (AI_RULES.md, "не посекундная
 * симуляция"), не именные передвигаемые армии (это следующий заход).
 */
export interface War {
  id: string;

  // [0] — инициатор войны (агрессор). Остальные — коалиция, автоматически
  // втянутая через allies/guarantees/puppets инициатора (один уровень,
  // без транзитивного замыкания — WarService.declareWar).
  attackers: string[];

  // [0] — цель войны. Остальные — коалиция цели, тем же правилом.
  defenders: string[];

  // Прокси-поддержка от sphereOfInfluence (Phase 3) — не боевой участник,
  // не подставляет свою территорию. Пусто в Phase 1, поле заведено заранее.
  supporters: { countryId: string; side: 'attackers' | 'defenders' }[];

  startDate: string;

  warGoal?: string;

  active: boolean;

  // Счётчик флипов ownerCountryId на контактных границах (WarTick) — вход
  // для формулы легитимности при WarService.makePeace (исход + масштаб).
  territoryFlips: { toAttackers: number; toDefenders: number };

  // Накопленные людские потери по странам (WarTick, docs/plans/08_WAR_WAVE1.md,
  // Шаг 3). Ключ — id страны, значение — суммарные потери за войну (военные +
  // гражданские). Вход для warScore (Шаг 2a) и мирового факта в промте LLM
  // («X потеряла N человек»). Пусто на старте войны.
  casualties: Record<string, number>;
}
