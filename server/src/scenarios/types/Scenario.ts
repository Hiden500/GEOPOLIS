import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type EraDefinition } from "@shared/types/research/EraDefinition";
import { type EthnicGroupDefinition } from "@shared/types/politics/Demographics";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";

export interface Scenario {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  technologyEra: EraDefinition;
  countries: Country[];
  regions: Region[];
  description: string;

  /**
   * Каталог демо-групп сценария (docs/CONCEPT.md §4.1). Опционален: сценарии
   * 1836/2000 — заглушки без демо-состава, и это не ошибка (createGame
   * подставит пустой каталог, движок не выведет недовольство ни для одного
   * их региона).
   */
  ethnicGroups?: EthnicGroupDefinition[];

  /**
   * Именованные точки спектра идеологии эпохи (docs/CONCEPT.md §4.2).
   * Опционален по той же причине, что и `ethnicGroups`: без каталога игрок
   * видит склейку ступеней шкалы, которая покрывает спектр целиком.
   */
  ideologyAnchors?: IdeologyAnchor[];
}