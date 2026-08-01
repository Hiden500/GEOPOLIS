import { describe, it, expect } from "vitest";
import * as commands from "../economy";
import { createTestGameState, createTestCountry } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";
import { type UpdateBudgetInput } from "../../validation/schemas";

function gameWithUsa(overrides: Parameters<typeof createTestCountry>[0] = {}): GameState {
  return createTestGameState({
    countries: [createTestCountry({ id: "USA", ...overrides })],
  });
}

describe("commands/economy", () => {
  describe("setResearchAllocation", () => {
    it("задаёт долю researchSpending для известного домена", () => {
      const game = gameWithUsa({ technology: { domains: { industry: 0.5 } } });
      const result = commands.setResearchAllocation(game, "USA", "industry", 0.6);

      expect(result).toEqual({ success: true });
      expect(game.countries[0]!.technology.researchAllocation).toEqual({ industry: 0.6 });
    });

    it("отклоняет неизвестный домен", () => {
      const game = gameWithUsa({ technology: { domains: {} } });
      const result = commands.setResearchAllocation(game, "USA", "ghost", 0.6);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.setResearchAllocation(game, "GHOST", "industry", 0.6);
      expect(result.success).toBe(false);
    });
  });

  describe("setProductionAllocation", () => {
    it("задаёт долю militarySpending для известной категории техники", () => {
      const game = gameWithUsa();
      const result = commands.setProductionAllocation(game, "USA", "tanks", 0.4);

      expect(result).toEqual({ success: true });
      expect(game.countries[0]!.military.productionAllocation).toEqual({ tanks: 0.4 });
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.setProductionAllocation(game, "GHOST", "tanks", 0.4);
      expect(result.success).toBe(false);
    });
  });

  describe("setBudgetShares", () => {
    it("пересчитывает *Spending и budgetBalance из долей", () => {
      const game = gameWithUsa();
      const budgetUpdate: UpdateBudgetInput = {
        military: 0.3,
        research: 0.2,
        education: 0.2,
        infrastructure: 0.1,
        welfare: 0.15,
      };

      const result = commands.setBudgetShares(game, "USA", budgetUpdate);
      expect(result).toEqual({ success: true });
      expect(game.countries[0]!.economy.spendingShares).toEqual(budgetUpdate);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.setBudgetShares(game, "GHOST", {
        military: 0.3, research: 0.2, education: 0.2, infrastructure: 0.1, welfare: 0.15,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("applyDeficitAusterityCut", () => {
    it("урезает перечисленные статьи, не ниже пола", () => {
      // Режется ДОЛЯ дохода (2026-08-01): абсолютное урезание стиралось бы
      // следующим тиком, который пересчитывает суммы из долей.
      const game = gameWithUsa();
      const country = game.countries[0]!;
      country.economy.spendingShares!.military = 0.20;
      country.economy.spendingFloor!.militarySpending = 0.198;

      const result = commands.applyDeficitAusterityCut(game, "USA", 0.95, ["militarySpending"]);
      expect(result).toEqual({ success: true });
      expect(country.economy.spendingShares!.military).toBeCloseTo(0.198, 6);
    });

    it("не режет ниже пола", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      country.economy.spendingShares!.military = 0.10;
      country.economy.spendingFloor!.militarySpending = 0.095;

      commands.applyDeficitAusterityCut(game, "USA", 0.5, ["militarySpending"]);
      expect(country.economy.spendingShares!.military).toBeCloseTo(0.095, 6);
    });

    it("no-op без spendingFloor", () => {
      const game = gameWithUsa({ economy: { ...createTestCountry().economy, spendingFloor: undefined as never } });
      const result = commands.applyDeficitAusterityCut(game, "USA", 0.5, ["militarySpending"]);
      expect(result).toEqual({ success: true });
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.applyDeficitAusterityCut(game, "GHOST", 0.5, ["militarySpending"]);
      expect(result.success).toBe(false);
    });
  });

  describe("setMilitaryShare", () => {
    it("задаёт долю военных расходов и сразу приводит сумму", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      const income = country.economy.taxRevenue + country.economy.exportIncome
        + country.economy.stateEnterpriseIncome + country.economy.otherIncome;

      commands.setMilitaryShare(game, "USA", 0.25);

      expect(country.economy.spendingShares!.military).toBe(0.25);
      // Сумма обязана быть согласована с долей в тот же момент: читатель внутри
      // хода не должен видеть долю и сумму, говорящие разное.
      expect(country.economy.militarySpending).toBeCloseTo(income * 0.25, 3);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.setMilitaryShare(game, "GHOST", 0.25);
      expect(result.success).toBe(false);
    });
  });

  describe("shiftMilitaryToWelfare", () => {
    it("сдвигает ровно amount между статьями", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      const before = {
        military: country.economy.spendingShares!.military,
        welfare: country.economy.spendingShares!.welfare,
      };

      commands.shiftMilitaryToWelfare(game, "USA", 0.02);
      expect(country.economy.spendingShares!.military).toBeCloseTo(before.military - 0.02, 6);
      expect(country.economy.spendingShares!.welfare).toBeCloseTo(before.welfare + 0.02, 6);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.shiftMilitaryToWelfare(game, "GHOST", 0.02);
      expect(result.success).toBe(false);
    });
  });

  describe("shiftWelfareToMilitary", () => {
    it("сдвигает ровно amount в обратную сторону и приводит суммы", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      const income = country.economy.taxRevenue + country.economy.exportIncome
        + country.economy.stateEnterpriseIncome + country.economy.otherIncome;
      const before = {
        military: country.economy.spendingShares!.military,
        welfare: country.economy.spendingShares!.welfare,
      };

      commands.shiftWelfareToMilitary(game, "USA", 0.02);
      expect(country.economy.spendingShares!.military).toBeCloseTo(before.military + 0.02, 6);
      expect(country.economy.spendingShares!.welfare).toBeCloseTo(before.welfare - 0.02, 6);
      // Суммы обязаны согласоваться с долями сразу, а не к следующему тику.
      expect(country.economy.militarySpending).toBeCloseTo(income * (before.military + 0.02), 4);
      expect(country.economy.welfareSpending).toBeCloseTo(income * (before.welfare - 0.02), 4);
    });

    it("возвращает ровно то, что забрал сдвиг в кризис", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      const before = {
        military: country.economy.spendingShares!.military,
        welfare: country.economy.spendingShares!.welfare,
      };

      commands.shiftMilitaryToWelfare(game, "USA", 0.02);
      commands.shiftWelfareToMilitary(game, "USA", 0.02);

      expect(country.economy.spendingShares!.military).toBeCloseTo(before.military, 9);
      expect(country.economy.spendingShares!.welfare).toBeCloseTo(before.welfare, 9);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.shiftWelfareToMilitary(game, "GHOST", 0.02);
      expect(result.success).toBe(false);
    });
  });
});
