export interface SimulationResponse {
  events: SimulationEvent[];
}

export interface SimulationEvent {

  title: string;

  description: string;

  effects: string[];
}