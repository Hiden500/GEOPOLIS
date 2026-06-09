import { type Country } from "@shared/types/Country";

export function processResearch(
  country: Country
): void {

  for (
    const project
    of country.technology.projects
  ) {

    project.progress +=
      country.economy.researchSpending
      / 100;

    if (
      project.progress >=
      project.requiredProgress
    ) {

      const currentLevel =
        country.technology.domains[
          project.domain
        ];

      // If domain level is undefined, treat as 0 before incrementing
      country.technology.domains[
        project.domain
      ] = (currentLevel ?? 0) + 1;

      project.completed = true;
    }
  }

  country.technology.projects =
    country.technology.projects
      .filter(
        p => !p.completed
      );
}