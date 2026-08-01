/**
 * Масштаб-свободное описание экономики страны: доли от ВВП, не абсолюты.
 * Авторится на страну (вручную или через архетип economyArchetypes.ts);
 * createGame выводит из него реальные денежные поля EconomyState как
 * profile × gdp (gdp известен только после агрегации регионов).
 * См. docs/ECONOMY.md ("Модель единиц") и docs/DECISIONS.md (2026-06-26, Q9).
 */
export interface EconomyProfile {
  /** Доход как доля ВВП. taxRevenue = gdp × taxRate. */
  taxRate: number;

  /**
   * Доли бюджетного дохода (income), не ВВП. Σ может быть <1 (профицит) или
   * >1 (структурный дефицит) — это сознательный игровой параметр страны, не
   * ошибка ввода.
   */
  spending: {
    military: number;
    research: number;
    education: number;
    infrastructure: number;
    welfare: number;
    other: number;
  };

  /** Стартовая казна как доля ВВП. Дефолт см. economyArchetypes.ts. */
  treasuryShare?: number;

  /** Неналоговый доход как доли ВВП. Статичны в первом проходе (см. ECONOMY.md). */
  // Доля ВВП, которую даёт вся внешняя торговля страны. Читается КАЖДЫЙ тик
  // (`TradeTick.ts`) как база экспортного дохода, а не только при создании
  // партии: производная величина не хранится отдельным полем, чтобы ей негде
  // было разойтись с источником.
  exportShare?: number;
  stateEnterpriseShare?: number;
  otherIncomeShare?: number;

  /** Стартовые инфляция/безработица — не масштабные величины, проценты как есть. */
  inflation?: number;
  unemployment?: number;
  tradeBalance?: number;
  debtInterestShare?: number;
}
