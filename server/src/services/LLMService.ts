import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { DiplomacyService } from "./DiplomacyService";

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
   * Получает информацию о крупных державах.
   */
  private getMajorPowersInfo(): string {
    // Копируем перед сортировкой: .sort() мутирует на месте, а generatePrompt
    // не должен переупорядочивать game.countries как побочный эффект.
    const topCountries = [...this.game.countries]
      .sort((a, b) => b.economy.gdp - a.economy.gdp)
      .slice(0, 5);

    return topCountries.map(c => 
      `- ${c.name}: GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, Military ${c.military.manpower.toLocaleString()}`
    ).join('\n');
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
