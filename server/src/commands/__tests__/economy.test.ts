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
      const game = gameWithUsa();
      const country = game.countries[0]!;
      country.economy.militarySpending = 10_000_000_000;
      country.economy.spendingFloor!.militarySpending = 9_900_000_000;

      const result = commands.applyDeficitAusterityCut(game, "USA", 0.95, ["militarySpending"]);
      expect(result).toEqual({ success: true });
      expect(country.economy.militarySpending).toBe(9_900_000_000);
    });

    it("не режет ниже пола", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      country.economy.militarySpending = 100;
      country.economy.spendingFloor!.militarySpending = 95;

      commands.applyDeficitAusterityCut(game, "USA", 0.5, ["militarySpending"]);
      expect(country.economy.militarySpending).toBe(95);
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

  describe("shiftMilitaryToWelfare", () => {
    it("сдвигает ровно amount между статьями", () => {
      const game = gameWithUsa();
      const country = game.countries[0]!;
      const before = { military: country.economy.militarySpending, welfare: country.economy.welfareSpending };

      commands.shiftMilitaryToWelfare(game, "USA", 1_000_000);
      expect(country.economy.militarySpending).toBe(before.military - 1_000_000);
      expect(country.economy.welfareSpending).toBe(before.welfare + 1_000_000);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsa();
      const result = commands.shiftMilitaryToWelfare(game, "GHOST", 1_000_000);
      expect(result.success).toBe(false);
    });
  });
});
