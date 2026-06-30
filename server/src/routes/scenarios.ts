import express from "express";
import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type ScenarioInfo } from "@shared/types/ScenarioInfo";
import { assignInitialTiers } from "../simulation/tier/TierTick";

const router = express.Router();

router.get("/list", (_req, res) => {
  const scenarios: ScenarioInfo[] = Object.values(ScenarioRegistry)
    .filter(scenario => scenario.countries.length > 0)
    .map(scenario => {
      // Применяем тиры без мутации оригинала сценария
      const countries = structuredClone(scenario.countries);
      assignInitialTiers(countries, scenario.id);

      return {
        id: scenario.id,
        name: scenario.name,
        startDate: scenario.startDate,
        endDate: scenario.endDate,
        description: scenario.description,
        era: scenario.technologyEra.name,
        featuredCountries: countries.map(c => ({
          id: c.id,
          name: c.name,
          tier: c.tier,
        })),
      };
    });

  res.json(scenarios);
});

export default router;
