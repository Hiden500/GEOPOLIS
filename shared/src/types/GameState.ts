import { type Country } from "../types/Country";
import { type Region } from "./map/Region";
import { type Event } from "../types/Event";
import { type EraDefinition } from "../types/research/EraDefinition";
import { type MapFeature } from "./map/MapFeature";
import { type Locale } from "./i18n/LocalizedText";
import { type War } from "./War";

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

  // Активные и завершённые войны (docs/WAR.md, Phase 1) — состояние живёт
  // здесь, не в отдельной подсистеме (AI_RULES.md принцип: числа у движка).
  wars: War[];

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

  // Гейт хода (docs/DECISIONS.md, 2026-07-06): true после успешного
  // processResponse текущего цикла, сбрасывается в false при каждом
  // успешном advanceMonth. GameService.advanceMonth() отказывает, если
  // false — ход не продвигается без ответа LLM ("LLM — главный двигатель",
  // docs/LLM_RULES.md).
  llmRespondedThisTurn: boolean;
}

export interface LLMAction {
  type: 'diplomacy' | 'war' | 'peace' | 'annex' | 'puppet' | 'sanction' | 'guarantee' | 'influence' | 'research_shift';
  sourceCountryId: string;
  targetCountryId?: string;
  data?: Record<string, any>;
}