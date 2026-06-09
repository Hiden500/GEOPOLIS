export interface DiplomacyState {
  allies: string[];

  rivals: string[];

  puppets: string[];

  sphereOfInfluence: string[];

  relations: Record<string, number>;
}