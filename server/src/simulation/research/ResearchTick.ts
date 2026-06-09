import { type Country } from "@shared/types/Country";
import { type ResearchProject } from "@shared/types/research/ResearchProject";
import { ResourceType } from "@shared/types/resources/ResourcesType";

export function researchTick(
  country: Country
): void {

  for (
    const project of
    country.technology.projects
  ) {

    const techSatisfied =
      project.requiredTechnologyIds.every(
        id =>
          country.researchedTechnologyIds.includes(id)
      );

    const resourcesSatisfied =
      Object.entries(
        project.requiredResources
      ).every(
        ([resourceType, amount]) =>
          country.stockpile[
          resourceType as ResourceType
          ] >= amount
      );

    if (
      !techSatisfied ||
      !resourcesSatisfied
    ) {
      continue;
    }

    project.progress +=
      project.progressPerMonth *
      (
        country.economy.researchSpending
        / project.cost
      );

    if (
      project.progress >=
      project.requiredProgress
    ) {

      project.completed = true;

      const currentLevel =
        country.technology.domains[
        project.domain
        ] ?? 0;

      country.technology.domains[
        project.domain
      ] = currentLevel + 1;
    }
  }

  country.technology.projects =
    country.technology.projects.filter(
      p => !p.completed
    );
}