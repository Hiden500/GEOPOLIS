import { describe, it, expect } from "vitest";
import { economyTick } from "./EconomyTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

describe("economyTick", () => {
  it("computes budgetBalance as income minus expenses and applies it to treasury", () => {
    const country = createTestCountry();
    const treasuryBefore = country.economy.treasury;
    const income =
      country.economy.taxRevenue +
      country.economy.exportIncome +
      country.economy.stateEnterpriseIncome +
      country.economy.otherIncome;

    economyTick(country, []);

    // debtInterest пересчитывается из долга (debt=0 → 0), не берётся статичным
    // фикстурным значением (план 08 Шаг 4) — читаем после тика.
    expect(country.economy.debtInterest).toBe(0);
    const expenses =
      country.economy.militarySpending +
      country.economy.researchSpending +
      country.economy.educationSpending +
      country.economy.infrastructureSpending +
      country.economy.welfareSpending +
      country.economy.debtInterest +
      country.economy.otherExpenses +
      country.economy.importSpending;

    expect(country.economy.budgetBalance).toBe(income - expenses);
    expect(country.economy.treasury).toBe(treasuryBefore + (income - expenses));
  });

  it("importSpending (докупка дефицита ресурсов, TradeTick.ts) учитывается как расход бюджета", () => {
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, importSpending: 1_000_000_000 },
    });
    const treasuryBefore = country.economy.treasury;

    economyTick(country, []);

    // debtInterest пересчитан из долга (debt=0 → 0) — не фикстурный (план 08 Шаг 4).
    const expensesWithoutImport =
      country.economy.militarySpending +
      country.economy.researchSpending +
      country.economy.educationSpending +
      country.economy.infrastructureSpending +
      country.economy.welfareSpending +
      country.economy.debtInterest +
      country.economy.otherExpenses;

    const expectedBudgetBalance =
      country.economy.taxRevenue +
      country.economy.exportIncome +
      country.economy.stateEnterpriseIncome +
      country.economy.otherIncome -
      (expensesWithoutImport + 1_000_000_000);
    expect(country.economy.budgetBalance).toBe(expectedBudgetBalance);
    expect(country.economy.treasury).toBe(treasuryBefore + expectedBudgetBalance);
  });

  it("recomputes taxRevenue from gdp × taxRate (доход следует за ВВП)", () => {
    // Свежий ВВП выше, taxRevenue устарел — тик должен пересчитать его по ставке.
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, gdp: 1_000_000_000_000, taxRate: 0.25, taxRevenue: 1 },
    });

    economyTick(country, []);

    expect(country.economy.taxRevenue).toBe(1_000_000_000_000 * 0.25);
  });

  it("leaves taxRevenue untouched when taxRate is undefined", () => {
    const economy = createTestCountry().economy;
    delete economy.taxRate;
    const country = createTestCountry({ economy: { ...economy, taxRevenue: 42 } });

    economyTick(country, []);

    expect(country.economy.taxRevenue).toBe(42);
  });

  it("пересчитывает *Spending из spendingShares × income каждый тик (тот же паттерн, что taxRate → taxRevenue)", () => {
    const country = createTestCountry({
      economy: {
        ...createTestCountry().economy,
        spendingShares: { military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.05, welfare: 0.05 },
      },
    });
    const income =
      country.economy.taxRevenue +
      country.economy.exportIncome +
      country.economy.stateEnterpriseIncome +
      country.economy.otherIncome;

    economyTick(country, []);

    expect(country.economy.militarySpending).toBe(income * 0.2);
    expect(country.economy.researchSpending).toBe(income * 0.1);
    expect(country.economy.educationSpending).toBe(income * 0.1);
    expect(country.economy.infrastructureSpending).toBe(income * 0.05);
    expect(country.economy.welfareSpending).toBe(income * 0.05);
  });

  it("не трогает *Spending, когда spendingShares не задан (ИИ-страны — AiBehaviorTick двигает абсолюты напрямую)", () => {
    const country = createTestCountry(); // spendingShares по умолчанию undefined
    const militaryBefore = country.economy.militarySpending;

    economyTick(country, []);

    expect(country.economy.militarySpending).toBe(militaryBefore);
  });

  it("spendingShares масштабируется с income при росте ВВП (та же эргономика, что taxRevenue)", () => {
    const country = createTestCountry({
      economy: {
        ...createTestCountry().economy,
        gdp: 1_000_000_000_000,
        taxRate: 0.2,
        exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
        spendingShares: { military: 0.3, research: 0, education: 0, infrastructure: 0, welfare: 0 },
      },
    });

    economyTick(country, []);

    // income = gdp × taxRate = 1_000_000_000_000 × 0.2 = 200_000_000_000
    expect(country.economy.militarySpending).toBe(200_000_000_000 * 0.3);
  });

  it("is deterministic for identical inputs", () => {
    const countryA = createTestCountry();
    const countryB = createTestCountry();
    const regionsA = [createTestRegion()];
    const regionsB = [createTestRegion()];

    economyTick(countryA, regionsA);
    economyTick(countryB, regionsB);

    expect(countryA.economy).toEqual(countryB.economy);
    expect(regionsA[0]!.gdp).toBe(regionsB[0]!.gdp);
  });

  it("grows region GDP when infrastructure and development are positive", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, infrastructure: 0.8, development: 0.8 });
    const gdpBefore = region.gdp;

    economyTick(country, [region]);

    expect(region.gdp).toBeGreaterThan(gdpBefore);
  });

  it("ignores regions owned by other countries", () => {
    const country = createTestCountry();
    const foreignRegion = createTestRegion({ ownerCountryId: "OTHER" });
    const gdpBefore = foreignRegion.gdp;

    economyTick(country, [foreignRegion]);

    expect(foreignRegion.gdp).toBe(gdpBefore);
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => economyTick(country, [])).not.toThrow();
  });

  describe("госдолг (план 08, Шаг 4)", () => {
    /** Страна с глубоким дефицитом: расходы кратно больше дохода. */
    function deficitCountry(overrides = {}) {
      return createTestCountry({
        economy: {
          ...createTestCountry().economy,
          gdp: 1_000_000_000_000,
          taxRate: 0.001, taxRevenue: 1_000_000_000, // мизерный доход
          exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0, importSpending: 0,
          // Расход — ДОЛЯ дохода (2026-08-01): 50 × 1B = 50B, как раньше задавалось суммой.
          spendingShares: { military: 50, research: 0, education: 0, infrastructure: 0, welfare: 0 },
          researchSpending: 0, educationSpending: 0,
          infrastructureSpending: 0, welfareSpending: 0, otherExpenses: 0,
          treasury: 0, debt: 0,
          ...overrides,
        },
      });
    }

    it("дефицит при нулевой казне конвертируется в долг, казна не уходит в минус", () => {
      const country = deficitCountry();
      economyTick(country, []);

      expect(country.economy.treasury).toBe(0);
      expect(country.economy.debt).toBeGreaterThan(0);
      // Дефицит ≈ 49B (доход 1B − расход 50B) → долг ≈ 49B.
      expect(country.economy.debt).toBeCloseTo(49_000_000_000, -6);
    });

    it("debtInterest = долг × ставка, ставка выше при низком здоровье государства", () => {
      const healthy = createTestCountry({
        economy: { ...createTestCountry().economy, debt: 100_000_000_000, treasury: 0,
          taxRevenue: 0, exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
          militarySpending: 0, researchSpending: 0, educationSpending: 0,
          infrastructureSpending: 0, welfareSpending: 0, otherExpenses: 0, importSpending: 0 },
        politics: { ...createTestCountry().politics, legitimacy: 100, stability: 100 },
      });
      const weak = createTestCountry({
        economy: { ...createTestCountry().economy, debt: 100_000_000_000, treasury: 0,
          taxRevenue: 0, exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
          militarySpending: 0, researchSpending: 0, educationSpending: 0,
          infrastructureSpending: 0, welfareSpending: 0, otherExpenses: 0, importSpending: 0 },
        politics: { ...createTestCountry().politics, legitimacy: 0, stability: 0 },
      });

      economyTick(healthy, []);
      economyTick(weak, []);

      // Ставка здорового = base (0.003); слабого = base + premium (0.016).
      expect(healthy.economy.debtInterest).toBeCloseTo(100_000_000_000 * 0.003, -3);
      expect(weak.economy.debtInterest).toBeGreaterThan(healthy.economy.debtInterest);
    });

    it("профицит гасит долг прежде, чем пополнять казну", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          debt: 10_000_000_000, treasury: 0,
          // Профицит ≈ 80B (доход 180B − расход 100B), долг 10B < профицита.
        },
      });
      economyTick(country, []);

      expect(country.economy.debt).toBe(0); // долг погашен целиком
      expect(country.economy.treasury).toBeGreaterThan(0); // остаток профицита в казну
    });

    it("высокий долг/ВВП штрафует рост ВВП", () => {
      const region = () => createTestRegion({ ownerCountryId: "TEST", infrastructure: 0.8, development: 0.8 });
      const lowDebt = createTestCountry({ economy: { ...createTestCountry().economy, gdp: 1_000_000_000_000, debt: 0 } });
      const highDebt = createTestCountry({ economy: { ...createTestCountry().economy, gdp: 1_000_000_000_000, debt: 2_000_000_000_000 } }); // долг/ВВП = 2.0

      const rLow = region();
      const rHigh = region();
      economyTick(lowDebt, [rLow]);
      economyTick(highDebt, [rHigh]);

      // Оба растут, но обременённый долгом — медленнее.
      expect(rHigh.gdp).toBeLessThan(rLow.gdp);
    });
  });
});
