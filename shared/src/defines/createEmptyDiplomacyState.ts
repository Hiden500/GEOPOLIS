import { type DiplomacyState } from "../types/DiplomacyState";

/**
 * Placeholder DiplomacyState — все связи пустые. Авторские puppets/sphereOfInfluence
 * (реально ненулевые у сюзеренов) передаются оверрайдом, см. CreateCountry.ts.
 */
export function createEmptyDiplomacyState(): DiplomacyState {
  return {
    allies: [],
    rivals: [],
    puppets: [],
    sphereOfInfluence: [],
    relations: {},
    influence: {},
    guarantees: [],
    sanctions: {},
  };
}
