import { describe, it, expect, beforeEach } from 'vitest';
import { MapFeatureService } from '../MapFeatureService';
import { type GameState } from '@shared/types/GameState';
import { type Country } from '@shared/types/Country';
import { type Region } from '@shared/types/map/Region';
import { ResourceType } from '@shared/types/resources/ResourcesType';
import { EquipmentType } from '@shared/types/military/EquipmentType';

describe('MapFeatureService', () => {
  let game: GameState;
  let service: MapFeatureService;

  beforeEach(() => {
    const countries: Country[] = [
      {
        id: 'USA',
        name: 'United States',
        shortName: 'USA',
        color: '#3C3B6E',
        tier: 'major' as const,
        capitalRegionId: 1,
        population: 330000000,
        // Не используется этим тестом (MapFeatureService не читает экономику) —
        // нужен только для валидности типа Country.
        economyProfile: {
          taxRate: 0.1,
          spending: { military: 0.15, research: 0.1, education: 0.15, infrastructure: 0.15, welfare: 0.3, other: 0.1 },
        },
        economy: {
          gdp: 21000000000000,
          treasury: 1000000000000,
          taxRevenue: 3000000000000,
          exportIncome: 2000000000000,
          importSpending: 0,
          stateEnterpriseIncome: 500000000000,
          otherIncome: 100000000000,
          militarySpending: 700000000000,
          researchSpending: 500000000000,
          educationSpending: 400000000000,
          infrastructureSpending: 300000000000,
          welfareSpending: 600000000000,
          debtInterest: 200000000000,
          otherExpenses: 100000000000,
          inflation: 2.0,
          unemployment: 5.0,
          tradeBalance: -500000000000,
          budgetBalance: -300000000000,
        },
        economyType: 'market',
        technology: {
          domains: {},
        },
        researchedTechnologyIds: [],
        military: {
          manpower: 2000000,
          activePersonnel: 1000000,
          reservePersonnel: 1000000,
          militaryBudget: 700000000000,
          armyStrength: 0.8,
          navyStrength: 0.7,
          airStrength: 0.6,
          nuclearWarheads: 0,
          units: [],
          equipment: {
            rifles: 1000000,
            trucks: 50000,
            tanks: 5000,
            fighters: 2000,
            bombers: 1000,
            ships: 500,
            artillery: 3000,
            destroyers: 200,
            submarines: 150,
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
          stability: 0.8,
          legitimacy: 0.7,
          corruption: 0.2,
          governmentSupport: 0.6,
        },
        stockpile: { oil: 1000000, coal: 5000000, gas: 3000000, iron: 2000000, copper: 1000000, gold: 500000, tin: 0, nickel: 0, bauxite: 2500000, tungsten: 0, manganese: 0, chromium: 0, uranium: 50000, rareEarths: 100000, lithium: 200000, food: 10000000, timber: 2000000, cotton: 0, rubber: 0, nitrates: 0 } as Record<ResourceType, number>,
        goals: [],
      },
    ];

    const regions: Region[] = [
      {
        id: 1,
        geoJsonId: 'USA-1',
        names: { ru: 'California', en: 'California' },
        ownerCountryId: 'USA',
        population: 40000000,
        area: 423970,
        urbanization: 0.9,
        stability: 0.8,
        infrastructure: 0.8,
        development: 0.9,
        gdp: 3000000000000,
        deposits: {},
        extraction: {},
        neighboringRegionIds: [2],
      },
      {
        id: 2,
        geoJsonId: 'USA-2',
        names: { ru: 'Texas', en: 'Texas' },
        ownerCountryId: 'USA',
        population: 29000000,
        area: 695662,
        urbanization: 0.8,
        stability: 0.7,
        infrastructure: 0.7,
        development: 0.8,
        gdp: 2000000000000,
        deposits: {},
        extraction: {},
        neighboringRegionIds: [1],
      },
    ];

    game = {
      currentDate: '1946-01-01',
      playerCountryId: 'USA',
      era: {
        id: 'cold_war',
        name: 'Cold War',
        startYear: 1946,
        endYear: 1991,
        technologyDomains: ['industry', 'nuclear', 'computing'],
      },
      countries,
      regions,
      rngState: 1,
      nextFeatureId: 0,
      locale: "ru",
      playerIntent: "",
      eventHistory: [],
      chronicle: [],
      mapFeatures: [],
      wars: [],
      modifiers: [],
      pendingWorldFacts: [],
      hingePointShowCount: {},
      llmRespondedThisTurn: true,
    };

    service = new MapFeatureService(game);
  });

  describe('createMapFeature', () => {
    it('should create a new map feature', () => {
      const feature = service.createMapFeature({
        type: 'capital',
        regionId: 1,
        ownerId: 'USA',
        name: 'Washington D.C.',
        tags: ['capital', 'settlement'],
        visibleAtZoom: 0,
      });

      expect(feature).toBeDefined();
      expect(feature.id).toBeDefined();
      expect(feature.type).toBe('capital');
      expect(feature.regionId).toBe(1);
      expect(feature.ownerId).toBe('USA');
      expect(feature.name).toBe('Washington D.C.');
      expect(feature.tags).toEqual(['capital', 'settlement']);
      expect(feature.visibleAtZoom).toBe(0);
      expect(game.mapFeatures).toHaveLength(1);
    });

    it('should generate unique IDs for each feature', () => {
      const feature1 = service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'City 1',
        tags: ['settlement'],
      });

      const feature2 = service.createMapFeature({
        type: 'city',
        regionId: 2,
        ownerId: 'USA',
        name: 'City 2',
        tags: ['settlement'],
      });

      expect(feature1.id).not.toBe(feature2.id);
    });

    it('should set createdAt to the current game date if not provided (docs/plans/01_PERSISTENCE_STATE.md: игровое время, не wall-clock)', () => {
      const feature = service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Test City',
        tags: ['settlement'],
      });

      expect(feature.createdAt).toBe(game.currentDate);
    });
  });

  describe('updateMapFeature', () => {
    it('should update an existing map feature', () => {
      const feature = service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Old Name',
        tags: ['settlement'],
      });

      const updated = service.updateMapFeature(feature.id, {
        name: 'New Name',
        visibleAtZoom: 5,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.visibleAtZoom).toBe(5);
      expect(updated!.type).toBe('city'); // unchanged
    });

    it('should return null for non-existent feature', () => {
      const result = service.updateMapFeature('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteMapFeature', () => {
    it('should delete an existing map feature', () => {
      const feature = service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Test City',
        tags: ['settlement'],
      });

      expect(game.mapFeatures).toHaveLength(1);

      const result = service.deleteMapFeature(feature.id);

      expect(result).toBe(true);
      expect(game.mapFeatures).toHaveLength(0);
    });

    it('should return false for non-existent feature', () => {
      const result = service.deleteMapFeature('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('getMapFeaturesByRegion', () => {
    it('should return features for a specific region', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'City 1',
        tags: ['settlement'],
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 1,
        ownerId: 'USA',
        name: 'Factory 1',
        tags: ['industry'],
      });

      service.createMapFeature({
        type: 'city',
        regionId: 2,
        ownerId: 'USA',
        name: 'City 2',
        tags: ['settlement'],
      });

      const region1Features = service.getMapFeaturesByRegion(1);

      expect(region1Features).toHaveLength(2);
      expect(region1Features.every(f => f.regionId === 1)).toBe(true);
    });

    it('should return empty array for region with no features', () => {
      const features = service.getMapFeaturesByRegion(999);

      expect(features).toHaveLength(0);
    });
  });

  describe('getMapFeaturesByOwner', () => {
    it('should return features for a specific owner', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'US City',
        tags: ['settlement'],
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 2,
        ownerId: 'USA',
        name: 'US Factory',
        tags: ['industry'],
      });

      const usaFeatures = service.getMapFeaturesByOwner('USA');

      expect(usaFeatures).toHaveLength(2);
      expect(usaFeatures.every(f => f.ownerId === 'USA')).toBe(true);
    });
  });

  describe('getMapFeaturesByType', () => {
    it('should return features of a specific type', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'City 1',
        tags: ['settlement'],
      });

      service.createMapFeature({
        type: 'city',
        regionId: 2,
        ownerId: 'USA',
        name: 'City 2',
        tags: ['settlement'],
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 1,
        ownerId: 'USA',
        name: 'Factory 1',
        tags: ['industry'],
      });

      const cities = service.getMapFeaturesByType('city');

      expect(cities).toHaveLength(2);
      expect(cities.every(f => f.type === 'city')).toBe(true);
    });
  });

  describe('getVisibleFeatures', () => {
    it('should return features visible at current zoom level', () => {
      service.createMapFeature({
        type: 'capital',
        regionId: 1,
        ownerId: 'USA',
        name: 'Capital',
        tags: ['capital'],
        visibleAtZoom: 0,
      });

      service.createMapFeature({
        type: 'city',
        regionId: 2,
        ownerId: 'USA',
        name: 'City',
        tags: ['settlement'],
        visibleAtZoom: 5,
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 1,
        ownerId: 'USA',
        name: 'Factory',
        tags: ['industry'],
        visibleAtZoom: 10,
      });

      const visibleAtZoom3 = service.getVisibleFeatures(3);
      expect(visibleAtZoom3).toHaveLength(1); // only capital (zoom 3 < city's visibleAtZoom 5)

      const visibleAtZoom7 = service.getVisibleFeatures(7);
      expect(visibleAtZoom7).toHaveLength(2); // capital and city (zoom 7 < factory's visibleAtZoom 10)
    });

    it('should return features without visibleAtZoom at any zoom', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Always Visible City',
        tags: ['settlement'],
        // no visibleAtZoom
      });

      const visibleAtZoom0 = service.getVisibleFeatures(0);
      expect(visibleAtZoom0).toHaveLength(1);
    });
  });

  describe('removeExpiredFeatures', () => {
    it('should remove features with expired expiresAt', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000000); // 1 second ago
      const future = new Date(now.getTime() + 1000000); // 1 second in future

      service.createMapFeature({
        type: 'protest',
        regionId: 1,
        ownerId: 'USA',
        name: 'Expired Protest',
        tags: ['event'],
        expiresAt: past.toISOString(),
      });

      service.createMapFeature({
        type: 'protest',
        regionId: 2,
        ownerId: 'USA',
        name: 'Active Protest',
        tags: ['event'],
        expiresAt: future.toISOString(),
      });

      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Permanent City',
        tags: ['settlement'],
        // no expiresAt
      });

      expect(game.mapFeatures).toHaveLength(3);

      service.removeExpiredFeatures();

      expect(game.mapFeatures).toHaveLength(2);
      expect(game.mapFeatures.some(f => f.name === 'Expired Protest')).toBe(false);
      expect(game.mapFeatures.some(f => f.name === 'Active Protest')).toBe(true);
      expect(game.mapFeatures.some(f => f.name === 'Permanent City')).toBe(true);
    });
  });

  describe('getMapFeatureById', () => {
    it('should return feature by ID', () => {
      const feature = service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'Test City',
        tags: ['settlement'],
      });

      const found = service.getMapFeatureById(feature.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(feature.id);
    });

    it('should return null for non-existent ID', () => {
      const found = service.getMapFeatureById('non-existent-id');

      expect(found).toBeNull();
    });
  });

  describe('getMapFeaturesByTag', () => {
    it('should return features with specific tag', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'City 1',
        tags: ['settlement', 'urban'],
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 2,
        ownerId: 'USA',
        name: 'Factory 1',
        tags: ['industry', 'urban'],
      });

      service.createMapFeature({
        type: 'mine',
        regionId: 1,
        ownerId: 'USA',
        name: 'Mine 1',
        tags: ['industry', 'rural'],
      });

      const urbanFeatures = service.getMapFeaturesByTag('urban');

      expect(urbanFeatures).toHaveLength(2);
      expect(urbanFeatures.every(f => f.tags.includes('urban'))).toBe(true);
    });
  });

  describe('getAllMapFeatures', () => {
    it('should return all map features', () => {
      service.createMapFeature({
        type: 'city',
        regionId: 1,
        ownerId: 'USA',
        name: 'City 1',
        tags: ['settlement'],
      });

      service.createMapFeature({
        type: 'factory',
        regionId: 2,
        ownerId: 'USA',
        name: 'Factory 1',
        tags: ['industry'],
      });

      const allFeatures = service.getAllMapFeatures();

      expect(allFeatures).toHaveLength(2);
      expect(allFeatures).toEqual(game.mapFeatures);
    });
  });
});
