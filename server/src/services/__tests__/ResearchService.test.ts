import { describe, it, expect, beforeEach } from "vitest";
import { ResearchService } from "../ResearchService";
import { createTestCountry, createTestResearchProject } from "../../test-utils/fixtures";
import { ValidationError, GameError } from "../../errors/AppError";

describe("ResearchService", () => {
  let service: ResearchService;

  beforeEach(() => {
    service = new ResearchService();
  });

  describe("startProject", () => {
    it("создаёт новый проект и добавляет его в technology.projects", () => {
      const country = createTestCountry();
      const project = service.startProject(country, "radar");

      expect(project.technologyId).toBe("radar");
      expect(project.progress).toBe(0);
      expect(project.completed).toBe(false);
      expect(country.technology.projects).toContain(project);
    });

    it("берёт cost из economy.researchSpending страны", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, researchSpending: 777 },
      });
      const project = service.startProject(country, "radar");
      expect(project.cost).toBe(777);
    });

    it("бросает ValidationError, если технология уже исследуется", () => {
      const country = createTestCountry({
        technology: {
          domains: {},
          projects: [createTestResearchProject({ technologyId: "radar" })],
        },
      });
      expect(() => service.startProject(country, "radar")).toThrow(ValidationError);
      // не добавляет дубликат
      expect(country.technology.projects).toHaveLength(1);
    });

    it("бросает ValidationError, если технология уже исследована", () => {
      const country = createTestCountry({ researchedTechnologyIds: ["radar"] });
      expect(() => service.startProject(country, "radar")).toThrow(ValidationError);
    });
  });

  describe("stopProject", () => {
    it("удаляет проект по id", () => {
      const project = createTestResearchProject({ id: "p-1" });
      const country = createTestCountry({
        technology: { domains: {}, projects: [project] },
      });
      service.stopProject(country, "p-1");
      expect(country.technology.projects).toHaveLength(0);
    });

    it("удаляет только указанный проект, остальные сохраняет", () => {
      const country = createTestCountry({
        technology: {
          domains: {},
          projects: [
            createTestResearchProject({ id: "p-1" }),
            createTestResearchProject({ id: "p-2" }),
          ],
        },
      });
      service.stopProject(country, "p-1");
      expect(country.technology.projects.map(p => p.id)).toEqual(["p-2"]);
    });

    it("бросает GameError для несуществующего проекта", () => {
      const country = createTestCountry();
      expect(() => service.stopProject(country, "missing")).toThrow(GameError);
    });
  });

  describe("getActiveProjects", () => {
    it("возвращает текущий список проектов страны", () => {
      const projects = [createTestResearchProject({ id: "p-1" })];
      const country = createTestCountry({ technology: { domains: {}, projects } });
      expect(service.getActiveProjects(country)).toBe(projects);
    });
  });

  describe("getTechnologyState", () => {
    it("возвращает domains, researchedIds и projects страны", () => {
      const projects = [createTestResearchProject({ id: "p-1" })];
      const country = createTestCountry({
        technology: { domains: { Industry: 3 }, projects },
        researchedTechnologyIds: ["radar"],
      });
      const state = service.getTechnologyState(country);
      expect(state.domains).toEqual({ Industry: 3 });
      expect(state.researchedIds).toEqual(["radar"]);
      expect(state.projects).toBe(projects);
    });
  });
});
