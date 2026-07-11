import { describe, it, expect, beforeEach } from 'vitest';
import { RegionEconomyService } from '../RegionEconomyService';
import { type Region } from '@shared/types/map/Region';
import { type Country } from '@shared/types/Country';
import { ResourceType } from '@shared/types/resources/ResourcesType';
import { EquipmentType } from '@shared/types/military/EquipmentType';

describe('RegionEconomyService', () => {
  let service: RegionEconomyService;
  let region: Region;
  let country: Country;

  beforeEach(() => {
    service = new RegionEconomyService();

    region = {
      id: 1,
      geoJsonId: 'TEST-1',
      names: { ru: 'Test Region', en: 'Test Region' },
      ownerCountryId: 'TEST',
      population: 1000000,
      area: 100000,
      urbanization: 0.5,
      stability: 0.7,
      infrastructure: 0.6,
      development: 0.5,
      gdp: 50000000000,
      deposits: {
        oil: 100000,
        coal: 200000,
      } as Partial<Record<ResourceType, number>>,
      extraction: {} as Partial<Record<ResourceType, number>>,
      neighboringRegionIds: [2],
    };

    country = {
      id: 'TEST',
      name: 'Test Country',
      shortName: 'TEST',
      color: '#FF0000',
      tier: 'minor' as const,
      capitalRegionId: 1,
      population: 10000000,
      // Не используется этим тестом (RegionEconomyService не читает economyProfile) —
      // нужен только для валидности типа Country.
      economyProfile: {
        taxRate: 0.2,
        spending: { military: 0.3, research: 0.2, education: 0.2, infrastructure: 0.1, welfare: 0.15, other: 0.05 },
      },
      economy: {
        gdp: 500000000000,
        treasury: 100000000000,
        taxRevenue: 100000000000,
        exportIncome: 50000000000,
        importSpending: 0,
        stateEnterpriseIncome: 20000000000,
        otherIncome: 10000000000,
        militarySpending: 30000000000,
        researchSpending: 20000000000,
        educationSpending: 20000000000,
        infrastructureSpending: 10000000000,
        welfareSpending: 15000000000,
        debtInterest: 5000000000,
        otherExpenses: 5000000000,
        inflation: 2.0,
        unemployment: 5.0,
        tradeBalance: -10000000000,
        budgetBalance: -5000000000,
      },
      economyType: 'market',
      technology: {
        domains: {},
      },
      researchedTechnologyIds: [],
      military: {
        manpower: 1000000,
        activePersonnel: 500000,
        reservePersonnel: 500000,
        militaryBudget: 30000000000,
        armyStrength: 0.7,
        navyStrength: 0.6,
        airStrength: 0.5,
        nuclearWarheads: 0,
        units: [],
        equipment: {
          rifles: 500000,
          trucks: 25000,
          tanks: 2500,
          fighters: 1000,
          bombers: 500,
          ships: 250,
          artillery: 1500,
          destroyers: 100,
          submarines: 75,
        } as Record<EquipmentType, number>,
      },
      diplomacy: {
        allies: [],
        rivals: [],
        puppets: [],
        sphereOfInfluence: [],
        relations: {},
        influence: {},
        guarantees: [],
        sanctions: {},
      },
      politics: {
        ideology: 'democracy',
        governmentType: 'republic',
        stability: 0.7,
        legitimacy: 0.6,
        corruption: 0.3,
        governmentSupport: 0.5,
      },
      stockpile: { oil: 500000, coal: 1000000, gas: 1500000, iron: 500000, copper: 500000, gold: 250000, tin: 0, nickel: 0, bauxite: 500000, tungsten: 0, manganese: 0, chromium: 0, uranium: 10000, rareEarths: 50000, lithium: 100000, food: 5000000, timber: 1000000, cotton: 0, rubber: 0, nitrates: 0 } as Record<ResourceType, number>,
      goals: [],
      aiTraits: { aggressiveness: 1, riskTolerance: 1 },
    };
  });

  describe('initializeRegionEconomy', () => {
    it('should initialize economy sectors for a region', () => {
      const result = service.initializeRegionEconomy(region);

      expect(result.economy).toBeDefined();
      expect(result.economy).toHaveProperty('agriculture');
      expect(result.economy).toHaveProperty('industry');
      expect(result.economy).toHaveProperty('mining');
      expect(result.economy).toHaveProperty('services');
    });

    it('should not reinitialize if economy already exists', () => {
      region.economy = {
        agriculture: 0.25,
        industry: 0.25,
        mining: 0.25,
        services: 0.25,
      };

      const result = service.initializeRegionEconomy(region);

      if (result.economy) {
        expect(result.economy.agriculture).toBe(0.25);
        expect(result.economy.industry).toBe(0.25);
      }
    });

    it('should normalize sectors to sum to 1.0', () => {
      const result = service.initializeRegionEconomy(region);

      if (result.economy) {
        const sum = result.economy.agriculture + result.economy.industry + result.economy.mining + result.economy.services;
        expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);
      }
    });

    it('should give higher services for urbanized regions', () => {
      region.urbanization = 0.9;
      const result = service.initializeRegionEconomy(region);

      if (result.economy) {
        expect(result.economy.services).toBeGreaterThan(0.4);
      }
    });

    it('should give higher agriculture for rural regions', () => {
      region.urbanization = 0.2;
      const result = service.initializeRegionEconomy(region);

      if (result.economy) {
        expect(result.economy.agriculture).toBeGreaterThan(0.4);
      }
    });

    it('should give higher mining for regions with resources', () => {
      region.deposits = {
        oil: 1000000,
        coal: 2000000,
        iron: 500000,
      } as Partial<Record<ResourceType, number>>;

      const result = service.initializeRegionEconomy(region);

      if (result.economy) {
        expect(result.economy.mining).toBeGreaterThan(0.15);
      }
    });
  });

  describe('calculateRegionalProduction', () => {
    it('should calculate production for a region', () => {
      service.initializeRegionEconomy(region);
      const production = service.calculateRegionalProduction(region);

      expect(production).toBeDefined();
      expect(production).toHaveProperty('food');
      expect(production).toHaveProperty('industrialOutput');
      expect(production).toHaveProperty('resourceExtraction');
      expect(production).toHaveProperty('taxIncome');
    });

    it('should produce food based on agriculture sector', () => {
      region.economy = {
        agriculture: 0.5,
        industry: 0.2,
        mining: 0.1,
        services: 0.2,
      };

      const production = service.calculateRegionalProduction(region);

      expect(production.food).toBeGreaterThan(0);
    });

    it('should produce industrial output based on industry sector', () => {
      region.economy = {
        agriculture: 0.2,
        industry: 0.5,
        mining: 0.1,
        services: 0.2,
      };

      const production = service.calculateRegionalProduction(region);

      expect(production.industrialOutput).toBeGreaterThan(0);
    });

    it('should extract resources based on mining sector', () => {
      region.economy = {
        agriculture: 0.2,
        industry: 0.2,
        mining: 0.4,
        services: 0.2,
      };

      const production = service.calculateRegionalProduction(region);

      expect(Object.keys(production.resourceExtraction).length).toBeGreaterThan(0);
    });

    it('should produce tax income based on services sector', () => {
      region.economy = {
        agriculture: 0.2,
        industry: 0.2,
        mining: 0.1,
        services: 0.5,
      };

      const production = service.calculateRegionalProduction(region);

      expect(production.taxIncome).toBeGreaterThan(0);
    });
  });

  describe('aggregateRegionEconomy', () => {
    it('should aggregate regional economy to country', () => {
      const regions: Region[] = [
        { ...region, id: 1 },
        { ...region, id: 2, ownerCountryId: 'TEST' },
      ];

      regions.forEach(r => service.initializeRegionEconomy(r));

      const aggregated = service.aggregateRegionEconomy(country, regions);

      expect(aggregated).toBeDefined();
      expect(aggregated).toHaveProperty('totalFood');
      expect(aggregated).toHaveProperty('totalIndustrialOutput');
      expect(aggregated).toHaveProperty('totalResourceExtraction');
      expect(aggregated).toHaveProperty('totalTaxIncome');
      expect(aggregated).toHaveProperty('averageSectors');
    });

    it('should sum production from all regions', () => {
      const regions: Region[] = [
        { ...region, id: 1 },
        { ...region, id: 2, ownerCountryId: 'TEST' },
      ];

      regions.forEach(r => service.initializeRegionEconomy(r));

      const aggregated = service.aggregateRegionEconomy(country, regions);

      expect(aggregated.totalFood).toBeGreaterThan(0);
      expect(aggregated.totalIndustrialOutput).toBeGreaterThan(0);
    });

    it('should calculate average sectors', () => {
      const regions: Region[] = [
        { ...region, id: 1 },
        { ...region, id: 2, ownerCountryId: 'TEST' },
      ];

      regions.forEach(r => service.initializeRegionEconomy(r));

      const aggregated = service.aggregateRegionEconomy(country, regions);

      expect(aggregated.averageSectors).toBeDefined();
      expect(aggregated.averageSectors).toHaveProperty('agriculture');
      expect(aggregated.averageSectors).toHaveProperty('industry');
      expect(aggregated.averageSectors).toHaveProperty('mining');
      expect(aggregated.averageSectors).toHaveProperty('services');
    });
  });

  describe('updateRegionalSectors', () => {
    it('should update sectors based on investment', () => {
      service.initializeRegionEconomy(region);
      const industryBefore = region.economy!.industry;

      const result = service.updateRegionalSectors(region, {
        industry: 100,
      });

      expect(result.economy!.industry).not.toBe(industryBefore);
    });

    it('should normalize sectors after update', () => {
      service.initializeRegionEconomy(region);

      const result = service.updateRegionalSectors(region, {
        agriculture: 50,
        industry: 50,
      });

      if (result.economy) {
        const sum = result.economy.agriculture + result.economy.industry + result.economy.mining + result.economy.services;
        expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);
      }
    });
  });
});
