import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type ResearchProject } from "@shared/types/research/ResearchProject";
import { ResourceType } from "@shared/types/resources/ResourcesType";

/**
 * Улучшенный ResearchTick с учётом исследовательских центров и образования.
 */
export function researchTick(
  country: Country,
  regions: Region[]
): void {
  const economy = country.economy;
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  // Подсчёт исследовательских центров (упрощённо: регионы с высоким development)
  const researchCenters = countryRegions.filter(r => r.development > 0.7).length;
  const researchCenterBonus = 1 + (researchCenters * 0.1);

  // Бонус от образования
  const educationRatio = economy.educationSpending / economy.gdp;
  const educationBonus = 1 + (educationRatio * 2);

  // Общий бонус к исследованиям
  const totalResearchBonus = researchCenterBonus * educationBonus;

  for (const project of country.technology.projects) {
    const techSatisfied = project.requiredTechnologyIds.every(
      id => country.researchedTechnologyIds.includes(id)
    );

    const resourcesSatisfied = Object.entries(project.requiredResources).every(
      ([resourceType, amount]) =>
        country.stockpile[resourceType as ResourceType] >= amount
    );

    if (!techSatisfied || !resourcesSatisfied) {
      continue;
    }

    // Прогресс с учётом бонусов
    project.progress +=
      project.progressPerMonth *
      (country.economy.researchSpending / project.cost) *
      totalResearchBonus;

    if (project.progress >= project.requiredProgress) {
      project.completed = true;

      const currentLevel = country.technology.domains[project.domain] ?? 0;
      country.technology.domains[project.domain] = currentLevel + 1;

      // Добавляем технологию в список исследованных (используем id проекта)
      country.researchedTechnologyIds.push(project.id);
    }
  }

  country.technology.projects = country.technology.projects.filter(p => !p.completed);
}