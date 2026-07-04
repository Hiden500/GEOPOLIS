import { type Country } from "../types/Country";
import { type Region } from "./map/Region";
import { type Event } from "../types/Event";
import { type PlayerAction } from "../types/actions/PlayerAction";
import { type EraDefinition } from "../types/research/EraDefinition";
import { type MapFeature } from "./map/MapFeature";

export interface GameState {
  currentDate: string;

  playerCountryId: string;

  countries: Country[];

  era: EraDefinition;

  regions: Region[];

  regionIndex: Map<string, number[]>;

  playerActions: PlayerAction[];

  eventHistory: Event[];

  mapFeatures: MapFeature[];

  // LLM Simulation fields
  llmContext?: string; // контекст для LLM (промт)
  llmResponse?: string; // последний ответ LLM
  llmTurn?: number; // номер хода для LLM симуляции
  pendingLlmActions?: LLMAction[]; // действия от LLM ожидающие применения
  // Индекс ротации "Spotlight Countries" (детерминированный round-robin по
  // не-major странам, id-sort) — расширение круга стран, реально ощущающих
  // LLM (docs/DECISIONS.md, 2026-07-04, вопрос 11). Двигается только при
  // успешном processResponse, не при простом generatePrompt.
  llmSpotlightCursor?: number;
}

export interface LLMAction {
  type: 'diplomacy' | 'war' | 'peace' | 'annex' | 'puppet' | 'sanction' | 'guarantee' | 'influence';
  sourceCountryId: string;
  targetCountryId?: string;
  data?: Record<string, any>;
}