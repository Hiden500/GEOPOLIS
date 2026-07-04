import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { DiplomacyService } from "./DiplomacyService";
import {
  LLMResponseValidator,
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RELATION_CHANGE,
  MAX_INFLUENCE_CHANGE,
} from "../llm/LLMResponseValidator";

/**
 * Итог одного прохода LLM-цикла: что применено, что отклонено и почему.
 */
export interface LlmCycleResult {
  success: boolean;
  error?: string;
  descriptions?: string;
  appliedActions: LLMAction[];
  rejectedActions: { action: LLMAction; reason: string }[];
}

/**
 * Сервис для работы с LLM симуляцией.
 * Управляет генерацией промтов, применением ответов LLM и валидацией действий.
 */
export class LLMService {
  private game: GameState;
  private diplomacyService: DiplomacyService;

  constructor(game: GameState) {
    this.game = game;
    this.diplomacyService = new DiplomacyService();
  }

  /**
   * Полный проход цикла по сырому ответу LLM: структурная валидация →
   * фильтрация неприменимых действий → применение → журнал в eventHistory.
   * Невалидная структура/JSON отклоняет ответ целиком (ничего не применяется);
   * неприменимое отдельное действие отклоняется точечно с причиной.
   */
  processResponse(rawResponse: string): LlmCycleResult {
    const validator = new LLMResponseValidator(this.game);
    const validation = validator.validateResponse(rawResponse);
    if (!validation.valid || !validation.parsedData) {
      return {
        success: false,
        error: validation.error ?? "Unknown validation error",
        appliedActions: [],
        rejectedActions: [],
      };
    }

    const { descriptions, actions } = validation.parsedData;
    const appliedActions: LLMAction[] = [];
    const rejectedActions: { action: LLMAction; reason: string }[] = [];

    for (const action of actions) {
      const applicability = validator.validateActionApplicability(action);
      if (!applicability.valid) {
        rejectedActions.push({ action, reason: applicability.error ?? "Not applicable" });
        continue;
      }

      const magnitude = validator.validateActionMagnitude(action);
      if (!magnitude.valid) {
        rejectedActions.push({ action, reason: magnitude.error ?? "Magnitude out of bounds" });
        continue;
      }

      appliedActions.push(action);
    }

    this.applyLlmActions(appliedActions);
    this.saveResponse(rawResponse);
    this.incrementLlmTurn();

    this.game.eventHistory.push({
      id: `llm-turn-${this.game.llmTurn}`,
      date: this.game.currentDate,
      title: `Мировые события (LLM, ход ${this.game.llmTurn})`,
      description: descriptions,
      countries: [
        ...new Set(
          appliedActions.flatMap(a =>
            a.targetCountryId ? [a.sourceCountryId, a.targetCountryId] : [a.sourceCountryId]
          )
        ),
      ],
    });

    return { success: true, descriptions, appliedActions, rejectedActions };
  }

  /**
   * Генерирует промт для LLM на основе текущего состояния игры.
   */
  generatePrompt(): string {
    const prompt = `
# Geopolis - World Simulation

## Current Date
${this.game.currentDate}

## Player Country
${this.getPlayerCountryInfo()}

## Major Powers
${this.getMajorPowersInfo()}

## Active Wars
${this.getActiveWarsInfo()}

## Recent Events
${this.getRecentEventsInfo()}

## Diplomatic Situation
${this.getDiplomaticSituation()}

## Player Actions
${this.getPlayerActionsInfo()}

## Country IDs
Every country mentioned above by name, mapped to its real id. Country names
are for readability only — actions are matched by id, not by name or guess.
${this.getCountryIdsSection()}

## Instructions
Simulate the world for the next month. Consider:
- All countries continue their development
- Diplomatic relationships evolve naturally
- Economic changes affect international relations
- Military movements and tensions
- Historical context of the current year

Return your response in JSON format with the following structure:
{
  "descriptions": "Narrative description of world events",
  "actions": [
    {
      "type": "diplomacy|war|peace|annex|puppet|sanction|guarantee|influence",
      "sourceCountryId": "country_id",
      "targetCountryId": "country_id",
      "data": {}
    }
  ]
}

Hard limits (actions violating them are rejected):
- Max ${MAX_ACTIONS_PER_RESPONSE} actions per response.
- data.relationChange: number within ±${MAX_RELATION_CHANGE}.
- data.influenceChange: number within ±${MAX_INFLUENCE_CHANGE}.
- sourceCountryId and targetCountryId MUST be ids copied verbatim from the
  ## Country IDs section. Never invent, abbreviate, or guess an id from a
  country's name (e.g. do not turn "Soviet Union" into "SOV" or "USSR",
  or "Romania" into "ROM" — look up the real id in ## Country IDs).
- sourceCountryId and targetCountryId must differ.
`;
    return prompt;
  }

  /**
   * Применяет действия от LLM к игровому состоянию.
   */
  applyLlmActions(actions: LLMAction[]): void {
    for (const action of actions) {
      switch (action.type) {
        case 'diplomacy':
          this.applyDiplomacyAction(action);
          break;
        case 'war':
          this.applyWarAction(action);
          break;
        case 'peace':
          this.applyPeaceAction(action);
          break;
        case 'sanction':
          this.applySanctionAction(action);
          break;
        case 'guarantee':
          this.applyGuaranteeAction(action);
          break;
        case 'influence':
          this.applyInfluenceAction(action);
          break;
        case 'annex':
        case 'puppet':
          // Эти действия требуют дополнительной логики
          console.log(`Action ${action.type} not yet implemented`);
          break;
      }
    }
  }

  /**
   * Применяет дипломатическое действие.
   */
  private applyDiplomacyAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    const relationChange = action.data?.relationChange || 0;
    this.diplomacyService.changeRelation(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId,
      relationChange
    );
  }

  /**
   * Применяет действие войны.
   */
  private applyWarAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    // В будущем это должно создавать объект War
    console.log(`War declared: ${action.sourceCountryId} vs ${action.targetCountryId}`);

    // Ухудшаем отношения
    this.diplomacyService.changeRelation(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId,
      -100
    );
  }

  /**
   * Применяет действие мира.
   */
  private applyPeaceAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    // В будущем это должно заканчивать войну
    console.log(`Peace treaty: ${action.sourceCountryId} and ${action.targetCountryId}`);

    // Улучшаем отношения
    this.diplomacyService.changeRelation(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId,
      50
    );
  }

  /**
   * Применяет действие санкций.
   */
  private applySanctionAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    const sanctionType = action.data?.sanctionType || 'economic_sanctions';
    this.diplomacyService.addSanction(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId,
      sanctionType
    );
  }

  /**
   * Применяет действие гарантии.
   */
  private applyGuaranteeAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    this.diplomacyService.addGuarantee(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId
    );
  }

  /**
   * Применяет действие влияния.
   */
  private applyInfluenceAction(action: LLMAction): void {
    if (!action.targetCountryId) return;

    const influenceChange = action.data?.influenceChange || 10;
    this.diplomacyService.changeInfluence(
      this.game.countries,
      action.sourceCountryId,
      action.targetCountryId,
      influenceChange
    );
  }

  /**
   * Получает информацию о стране игрока.
   */
  private getPlayerCountryInfo(): string {
    const player = this.game.countries.find(c => c.id === this.game.playerCountryId);
    if (!player) return 'Unknown';

    return `
- Name: ${player.name}
- GDP: $${(player.economy.gdp / 1e9).toFixed(2)}B
- Population: ${(player.population / 1e6).toFixed(2)}M
- Military: ${player.military.manpower.toLocaleString()}
- Allies: ${player.diplomacy.allies.join(', ') || 'None'}
- Rivals: ${player.diplomacy.rivals.join(', ') || 'None'}
`;
  }

  /**
   * Топ-5 держав по ВВП. Копия перед сортировкой: .sort() мутирует на месте,
   * а generatePrompt не должен переупорядочивать game.countries как побочный
   * эффект. Общий источник для getMajorPowersInfo и getReferencedCountries —
   * список "видимых" LLM держав не должен расходиться между секциями промта.
   */
  private getTopMajorPowers() {
    return [...this.game.countries]
      .sort((a, b) => b.economy.gdp - a.economy.gdp)
      .slice(0, 5);
  }

  /**
   * Получает информацию о крупных державах.
   */
  private getMajorPowersInfo(): string {
    return this.getTopMajorPowers().map(c =>
      `- ${c.name}: GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, Military ${c.military.manpower.toLocaleString()}`
    ).join('\n');
  }

  /**
   * Собирает id→name всех стран, упомянутых по имени где-либо в промте
   * (игрок, топ-державы, стороны напряжённостей, союзники/соперники игрока).
   * LLM должна использовать эти id как есть — никогда не угадывать код из
   * имени (регрессия 2026-07-04: ChatGPT вернул "SOV"/"ROM" вместо реальных
   * "SUN"/"ROU", потому что промт до этого фикса не давал id вообще).
   */
  private getReferencedCountries(): Map<string, string> {
    const referenced = new Map<string, string>();
    const add = (id: string | undefined) => {
      if (!id) return;
      const country = this.game.countries.find(c => c.id === id);
      if (country) referenced.set(country.id, country.name);
    };

    add(this.game.playerCountryId);
    for (const c of this.getTopMajorPowers()) add(c.id);

    const player = this.game.countries.find(c => c.id === this.game.playerCountryId);
    if (player) {
      for (const id of player.diplomacy.allies) add(id);
      for (const id of player.diplomacy.rivals) add(id);
    }

    for (const country of this.game.countries) {
      for (const rivalId of country.diplomacy.rivals) {
        if (this.game.countries.some(c => c.id === rivalId)) {
          add(country.id);
          add(rivalId);
        }
      }
    }

    return referenced;
  }

  /**
   * Форматирует секцию "## Country IDs" — id стран, отсортированные для
   * детерминированности промта (не порядок обхода Map).
   */
  private getCountryIdsSection(): string {
    const referenced = this.getReferencedCountries();
    if (referenced.size === 0) return 'No countries referenced';

    return [...referenced.entries()]
      .sort(([idA], [idB]) => idA.localeCompare(idB))
      .map(([id, name]) => `- ${id}: ${name}`)
      .join('\n');
  }

  /**
   * Получает информацию об активных войнах.
   */
  private getActiveWarsInfo(): string {
    // В будущем это должно возвращать реальные данные о войнах
    return 'No active wars (war system not yet implemented)';
  }

  /**
   * Получает информацию о последних событиях.
   */
  private getRecentEventsInfo(): string {
    const recentEvents = this.game.eventHistory.slice(-5);
    if (recentEvents.length === 0) return 'No recent events';

    return recentEvents.map(e => 
      `- ${e.date}: ${e.title}`
    ).join('\n');
  }

  /**
   * Получает информацию о дипломатической ситуации.
   */
  private getDiplomaticSituation(): string {
    const tensions: string[] = [];

    for (const country of this.game.countries) {
      for (const rivalId of country.diplomacy.rivals) {
        const rival = this.game.countries.find(c => c.id === rivalId);
        if (rival) {
          const relation = country.diplomacy.relations[rivalId] || 0;
          tensions.push(`${country.name} - ${rival.name}: ${relation}`);
        }
      }
    }

    if (tensions.length === 0) return 'No major diplomatic tensions';

    return tensions.join('\n');
  }

  /**
   * Получает информацию о действиях игрока.
   */
  private getPlayerActionsInfo(): string {
    const recentActions = this.game.playerActions.slice(-3);
    if (recentActions.length === 0) return 'No recent player actions';

    return recentActions.map(a => 
      `- ${a.type}: ${JSON.stringify(a.parameters)}`
    ).join('\n');
  }

  /**
   * Сохраняет промт в gameState.
   */
  savePrompt(prompt: string): void {
    this.game.llmContext = prompt;
  }

  /**
   * Сохраняет ответ LLM в gameState.
   */
  saveResponse(response: string): void {
    this.game.llmResponse = response;
  }

  /**
   * Увеличивает номер хода LLM.
   */
  incrementLlmTurn(): void {
    this.game.llmTurn = (this.game.llmTurn || 0) + 1;
  }

  /**
   * Сохраняет ожидающие действия от LLM.
   */
  savePendingActions(actions: LLMAction[]): void {
    this.game.pendingLlmActions = actions;
  }

  /**
   * Получает ожидающие действия от LLM.
   */
  getPendingActions(): LLMAction[] {
    return this.game.pendingLlmActions || [];
  }

  /**
   * Очищает ожидающие действия.
   */
  clearPendingActions(): void {
    this.game.pendingLlmActions = [];
  }
}
