import { type IdeologyCoordinates } from "./politics/Ideology";

export interface PoliticsState {

  ideology: string;

  /**
   * Позиция власти на двух осях спектра (docs/CONCEPT.md §4.2). Опционально:
   * покрытие сценарных данных частичное (server/data/scenarios/1946/ideology.json),
   * страна без координат получает фолбэк по ярлыку `ideology`
   * (shared/src/defines/discontent.ts::IDEOLOGY_LABEL_COORDINATES) — это штатное
   * поведение, а не ошибка данных.
   */
  ideologyCoordinates?: IdeologyCoordinates | undefined;

  governmentType: string;

  stability: number;

  legitimacy: number;

  corruption: number;

  governmentSupport: number;
}