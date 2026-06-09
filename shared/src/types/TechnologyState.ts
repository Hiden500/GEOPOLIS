import { type ResearchProject } from "./research/ResearchProject";

export interface TechnologyState {

  domains: Record<string, number>;

  projects: ResearchProject[];
}