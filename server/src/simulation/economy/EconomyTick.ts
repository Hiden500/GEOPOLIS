import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { RegionEconomyService } from "../../services/RegionEconomyService";

/**
 * Обновлённый EconomyTick с использованием регионов и региональной экономики.
 * Рост ВВП на основе промышленности регионов, инфраструктуры и ресурсов.
 */
export function economyTick(
  country: Country,
  regions: Region[]
): void {
  const economy = country.economy;
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  // Налоговый доход следует за ВВП: taxRevenue = gdp × ставка (выведена в createGame).
  // taxRate опционально (рантайм-поле): если не задано — taxRevenue остаётся как есть.
  // Остальные компоненты дохода (export/stateEnterprise/other) пока статичны. См. docs/DECISIONS.md.
  if (economy.taxRate !== undefined) {
    economy.taxRevenue = economy.gdp * economy.taxRate;
  }

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

  // Инициализируем региональную экономику если нужно
  const regionEconomyService = new RegionEconomyService();
  for (const region of countryRegions) {
    if (!region.economy) {
      regionEconomyService.initializeRegionEconomy(region);
    }
  }

  // Расчёт роста ВВП на основе регионов
  let avgInfrastructure = 0;
  let avgDevelopment = 0;

  if (countryRegions.length > 0) {
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

  // Применяем рост к ВВП регионов с учётом экономических секторов
  for (const region of countryRegions) {
    // Регионы с сильной промышленностью растут быстрее
    let sectorBonus = 0;
    if (region.economy) {
      sectorBonus = region.economy.industry * 0.002 + region.economy.services * 0.001;
    }
    region.gdp *= (1 + growthRate + sectorBonus);
  }

  // ВВП страны обновится через агрегацию в SimulationEngine

  // Инфляция на основе дефицита бюджета и денежной массы
  economy.inflation += 0.1 * (expenses - income) / economy.gdp;

  // Безработица на основе экономического роста
  economy.unemployment += 0.05 * (expenses - income) / economy.gdp;
  economy.unemployment = Math.max(0, economy.unemployment);
}