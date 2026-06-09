import { TechnologyState } from "../types/TechnologyState";

export function createTechnologyState(
  domains: string[]
): TechnologyState {

  const technologyDomains:
    Record<string, number> = {};

  for (const domain of domains) {

    technologyDomains[domain] = 0;
  }

  return {

    domains: technologyDomains,

    projects: []
  };
}