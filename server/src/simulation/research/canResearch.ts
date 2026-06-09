import { type Country } from "@shared/types/Country";
import { type TechnologyDefinition } from "@shared/types/research/TechnologyDefinition";

export function canResearch(
    country: Country,
    technology: TechnologyDefinition
): boolean {

    for (
        const prerequisite
        of technology.prerequisites
    ) {

        if (
            !country.researchedTechnologyIds
                .includes(prerequisite)
        ) {

            return false;
        }
    }

    return true;
}