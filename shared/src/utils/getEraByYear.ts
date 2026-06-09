import { ERAS } from "../data/eras";


export function getEraByYear(
  year: number
) {

  return ERAS.find(
    era =>
      year >= era.startYear &&
      year <= era.endYear
  );
}