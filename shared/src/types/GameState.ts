import { type Country } from "../types/Country";
import { type Region } from "./map/Region";
import { type Event } from "../types/Event";
import { type EraDefinition } from "../types/research/EraDefinition";
import { type MapFeature } from "./map/MapFeature";
import { type Locale } from "./i18n/LocalizedText";

export interface GameState {
  currentDate: string;

  playerCountryId: string;

  countries: Country[];

  era: EraDefinition;

  regions: Region[];

  regionIndex: Map<string, number[]>;

  // Язык генерируемого LLM текста (title/descriptions), зафиксирован при
  // создании игры (docs/DECISIONS.md, 2026-07-05) — не переключается на
  // лету. Не влияет на язык статичной UI-обвязки (остаётся русской) и не
  // влияет на имена стран/регионов в промте (те используют LLM_LOCALE).
  locale: Locale;

  // Намерение игрока на текущий ход свободным текстом (docs/DECISIONS.md,
  // 2026-07-04) — уходит в LLM-промт, LLM интерпретирует его в LLMAction[].
  // Одноразовое: очищается после успешного processResponse, не история.
  playerIntent: string;

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