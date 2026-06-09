import { type Country } from "../types/Country";
import { type Region } from "./map/Region";
import { type Event } from "../types/Event";
import { type PlayerAction } from "../types/actions/PlayerAction";
import { type EraDefinition } from "../types/research/EraDefinition";

export interface GameState {
  currentDate: string;

  playerCountryId: string;

  countries: Country[];

  era: EraDefinition;

  regions: Region[];

  playerActions: PlayerAction[];

  eventHistory: Event[];
}