export interface DiplomacyState {
  allies: string[];

  rivals: string[];

  puppets: string[];

  sphereOfInfluence: string[];

  relations: Record<string, number>;

  // Новые поля для дипломатии
  influence: Record<string, number>; // влияние на другие страны (0-100)

  guarantees: string[]; // гарантии независимости стран

  sanctions: Record<string, SanctionType[]>; // санкции против стран
}

/**
 * Виды санкций — `as const` МАССИВ, а не голый union типа.
 *
 * Форма изменена Милстоуном 1 (дипломатический блок алфавита) по той же
 * причине, по которой `PRIMITIVE_INTENSITIES` живёт массивом: `z.enum()` не
 * умеет вывести литералы из голого TS-union'а рантаймово, поэтому рядом со
 * схемой заводилась ВТОРАЯ копия списка, а синхронность держал компайл-тайм
 * `Equals`. Копия существовала ради одного потребителя; с появлением второго
 * (схема примитива `sanction`) их стало бы две. Список первичен, тип выводится
 * из него — разойтись больше нечему.
 *
 * ЦЕНА, НАЗВАННАЯ ПРЯМО: механические последствия сегодня есть только у
 * `trade_embargo` (`server/src/simulation/trade/TradeTick.ts` режет экспорт
 * цели). Остальные три — репутационные: они меняют отношения и попадают в
 * состояние, но ни одна подсистема их не читает (`docs/DIPLOMACY.md`,
 * «Санкции без эффекта»; `docs/TODO.md`).
 */
export const SANCTION_TYPES = [
  'trade_embargo',
  'economic_sanctions',
  'military_sanctions',
  'diplomatic_sanctions',
] as const;

export type SanctionType = (typeof SANCTION_TYPES)[number];

/** Единственный вид санкции, реально режущий торговлю (см. выше). */
export const TRADE_CUTTING_SANCTION: SanctionType = 'trade_embargo';