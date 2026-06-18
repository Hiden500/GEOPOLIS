import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import { RESOURCE_WEIGHTS as resourceWeights } from "@shared/constants/resourceWeights";

/**
 * Обновлённый EconomyTick с использованием регионов.
 * Рост ВВП на основе промышленности регионов, инфраструктуры и ресурсов.
 */
export function economyTick(
  country: Country,
  regions: Region[]
): void {
  const economy = country.economy;
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  const income =
    economy.taxRevenue +
    economy.exportIncome +
    economy.stateEnterpriseIncome +
    economy.otherIncome;

  const expenses =
    economy.militarySpending +
    economy.researchSpending +
    economy.educationSpending +
    economy.infrastructureSpending +
    economy.welfareSpending +
    economy.debtInterest +
    economy.otherExpenses;

  economy.budgetBalance = income - expenses;
  economy.treasury += economy.budgetBalance;

  // Расчёт роста ВВП на основе регионов
  let totalRegionGdp = 0;
  let avgInfrastructure = 0;
  let avgDevelopment = 0;

  if (countryRegions.length > 0) {
    totalRegionGdp = countryRegions.reduce((sum, r) => sum + r.gdp, 0);
    avgInfrastructure = countryRegions.reduce((sum, r) => sum + r.infrastructure, 0) / countryRegions.length;
    avgDevelopment = countryRegions.reduce((sum, r) => sum + r.development, 0) / countryRegions.length;
  }

  // Базовый рост на основе среднего развития и инфраструктуры
  const baseGrowthRate = 0.001 + (avgDevelopment * 0.002) + (avgInfrastructure * 0.001);

  // Бонус от инвестиций в инфраструктуру
  const infrastructureBonus = economy.infrastructureSpending / economy.gdp * 0.5;

  // Штраф от дефицита бюджета
  const deficitPenalty = economy.budgetBalance < 0 ? Math.abs(economy.budgetBalance) / economy.gdp * 0.3 : 0;

  // Итоговый рост
  const growthRate = Math.max(0, baseGrowthRate + infrastructureBonus - deficitPenalty);

  // Применяем рост к ВВП регионов
  for (const region of countryRegions) {
    region.gdp *= (1 + growthRate);
  }

  // ВВП страны обновится через агрегацию в SimulationEngine

  // Инфляция на основе дефицита бюджета и денежной массы
  economy.inflation += 0.1 * (expenses - income) / economy.gdp;

  // Безработица на основе экономического роста
  economy.unemployment += 0.05 * (expenses - income) / economy.gdp;
  economy.unemployment = Math.max(0, economy.unemployment);

  // Ресурсный бонус (для будущего использования)
  let resourceBonus = 0;
  for (const resource of Object.values(ResourceType)) {
    const amount = country.stockpile[resource];
    const weight = resourceWeights[resource] ?? 0;
    resourceBonus += amount * weight;
  }
}