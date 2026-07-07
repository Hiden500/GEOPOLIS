import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { WarService } from "../services/WarService";

/**
 * Пределы магнитуды последствий (тюнингуемые константы — балансировать на
 * симуляции, как THREAT-пороги в AiBehaviorTick). Движок выставляет пределы,
 * LLM работает внутри них (docs/LLM_RULES.md): ответ с выходом за предел —
 * ошибка данных LLM, а не «сильное событие».
 */
export const MAX_ACTIONS_PER_RESPONSE = 20;
export const MAX_RELATION_CHANGE = 40;
export const MAX_INFLUENCE_CHANGE = 20;

/**
 * Потолок доли researchSpending на один домен за один сдвиг фокуса
 * (docs/DECISIONS.md, 2026-07-06) — остаток делят поровну домены без явной
 * доли (ResearchTick.ts). Не 1.0 — сфокусированность не бесплатна, остальные
 * направления всё равно получают что-то. Это потолок мирного времени —
 * см. WAR_RESEARCH_SHARE_PENALTY ниже про снижение на активную войну.
 */
export const MAX_RESEARCH_SHARE = 0.7;

/**
 * Admin capacity (независимый гейм-дизайн разбор, 2026-07-06): правительство,
 * воюющее на нескольких фронтах, отвлечено — потолок доли research_shift
 * снижается на эту величину за каждую активную войну страны (не только
 * инициированную ею — оборона тоже отвлекает). Применяется одинаково ко
 * всем странам, включая игрока — не спец-правило для ИИ.
 */
export const WAR_RESEARCH_SHARE_PENALTY = 0.1;

/** Пол потолка research_shift — даже страна на нескольких фронтах не теряет фокус целиком. */
export const MIN_RESEARCH_SHARE_CAP = 0.3;

/**
 * Валидатор ответов от LLM.
 * Проверяет структуру и корректность данных в ответе LLM.
 */
export class LLMResponseValidator {
  private game: GameState;
  private warService: WarService;

  constructor(game: GameState) {
    this.game = game;
    this.warService = new WarService(game);
  }

  /**
   * Валидирует полный ответ от LLM.
   */
  validateResponse(response: string): {
    valid: boolean;
    error?: string;
    parsedData?: {
      title?: string;
      descriptions: string;
      actions: LLMAction[];
    };
  } {
    try {
      const parsed = JSON.parse(response);

      // Проверяем наличие обязательных полей
      if (!parsed.descriptions) {
        return { valid: false, error: 'Missing descriptions field' };
      }

      if (!parsed.actions || !Array.isArray(parsed.actions)) {
        return { valid: false, error: 'Missing or invalid actions field' };
      }

      if (parsed.actions.length > MAX_ACTIONS_PER_RESPONSE) {
        return {
          valid: false,
          error: `Too many actions: ${parsed.actions.length} (max ${MAX_ACTIONS_PER_RESPONSE})`,
        };
      }

      // Валидируем каждое действие
      for (const action of parsed.actions) {
        const actionValidation = this.validateAction(action);
        if (!actionValidation.valid) {
          return { valid: false, error: `Invalid action: ${actionValidation.error}` };
        }
      }

      return {
        valid: true,
        parsedData: {
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          descriptions: parsed.descriptions,
          actions: parsed.actions,
        },
      };
    } catch (error) {
      return { valid: false, error: 'Invalid JSON format' };
    }
  }

  /**
   * Валидирует отдельное действие.
   */
  validateAction(action: any): { valid: boolean; error?: string } {
    if (!action.type) {
      return { valid: false, error: 'Missing type field' };
    }

    const validTypes = ['diplomacy', 'war', 'peace', 'annex', 'puppet', 'sanction', 'guarantee', 'influence', 'research_shift'];
    if (!validTypes.includes(action.type)) {
      return { valid: false, error: `Invalid type: ${action.type}` };
    }

    if (!action.sourceCountryId) {
      return { valid: false, error: 'Missing sourceCountryId field' };
    }

    // Проверяем, что страна-источник существует
    const sourceCountry = this.game.countries.find(c => c.id === action.sourceCountryId);
    if (!sourceCountry) {
      return { valid: false, error: `Source country not found: ${action.sourceCountryId}` };
    }

    // Для некоторых типов действий нужна целевая страна
    if (['diplomacy', 'war', 'peace', 'sanction', 'guarantee', 'influence', 'annex', 'puppet'].includes(action.type)) {
      if (!action.targetCountryId) {
        return { valid: false, error: `Missing targetCountryId for action type: ${action.type}` };
      }

      const targetCountry = this.game.countries.find(c => c.id === action.targetCountryId);
      if (!targetCountry) {
        return { valid: false, error: `Target country not found: ${action.targetCountryId}` };
      }

      if (action.targetCountryId === action.sourceCountryId) {
        return { valid: false, error: `Source and target country are the same: ${action.sourceCountryId}` };
      }
    }

    return { valid: true };
  }

  /**
   * Потолок доли research_shift для страны сейчас (admin capacity,
   * 2026-07-06) — MAX_RESEARCH_SHARE минус штраф за каждую активную войну
   * страны (атакующей или обороняющейся), не ниже MIN_RESEARCH_SHARE_CAP.
   */
  private getResearchShareCap(countryId: string): number {
    const activeWarCount = this.game.wars.filter(
      w => w.active && (w.attackers.includes(countryId) || w.defenders.includes(countryId))
    ).length;
    return Math.max(
      MAX_RESEARCH_SHARE - activeWarCount * WAR_RESEARCH_SHARE_PENALTY,
      MIN_RESEARCH_SHARE_CAP
    );
  }

  /**
   * Валидирует магнитуду последствий действия — движок выставляет пределы,
   * выход за них означает ошибку данных LLM, действие отклоняется точечно.
   */
  validateActionMagnitude(action: LLMAction): { valid: boolean; error?: string } {
    const data = action.data;
    if (!data) return { valid: true };

    const numericLimits: Record<string, number> = {
      relationChange: MAX_RELATION_CHANGE,
      influenceChange: MAX_INFLUENCE_CHANGE,
    };

    if (action.type === 'research_shift' && 'share' in data) {
      numericLimits.share = this.getResearchShareCap(action.sourceCountryId);
    }

    for (const [field, limit] of Object.entries(numericLimits)) {
      if (!(field in data)) continue;
      const value = data[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { valid: false, error: `${field} must be a finite number, got: ${String(value)}` };
      }
      if (Math.abs(value) > limit) {
        return { valid: false, error: `${field} out of range: ${value} (max ±${limit})` };
      }
    }

    return { valid: true };
  }

  /**
   * Валидирует, что действие применимо в текущем состоянии игры.
   */
  validateActionApplicability(action: LLMAction): { valid: boolean; error?: string } {
    const source = this.game.countries.find(c => c.id === action.sourceCountryId);
    if (!source) {
      return { valid: false, error: 'Source country not found' };
    }

    if (action.type === 'research_shift') {
      const domain = action.data?.domain;
      if (typeof domain !== 'string' || !(domain in source.technology.domains)) {
        return { valid: false, error: `Unknown technology domain: ${String(domain)}` };
      }
    }

    if (action.targetCountryId) {
      const target = this.game.countries.find(c => c.id === action.targetCountryId);
      if (!target) {
        return { valid: false, error: 'Target country not found' };
      }

      // Проверяем логические ограничения
      if (action.type === 'peace') {
        // Нельзя заключить мир, если между сторонами нет активной войны.
        if (!this.warService.getActiveWarBetween(action.sourceCountryId, action.targetCountryId)) {
          return { valid: false, error: 'No active war between these countries' };
        }
      }

      if (action.type === 'war') {
        // Нельзя объявить войну стороне, с которой уже воюешь, или союзнику
        // (docs/WAR.md, Phase 1 — упрощение, не моделируем разрыв союза).
        if (this.warService.getActiveWarBetween(action.sourceCountryId, action.targetCountryId)) {
          return { valid: false, error: 'Already at war with this country' };
        }
        if (source.diplomacy.allies.includes(action.targetCountryId)) {
          return { valid: false, error: 'Cannot declare war on an ally' };
        }
      }

      if (action.type === 'sanction') {
        // Нельзя наложить санкции если уже есть
        const existingSanctions = source.diplomacy.sanctions[action.targetCountryId];
        if (existingSanctions && existingSanctions.length > 0) {
          return { valid: false, error: 'Sanctions already exist' };
        }
      }

      if (action.type === 'guarantee') {
        // Нельзя гарантировать независимость если уже есть гарантия
        if (source.diplomacy.guarantees.includes(action.targetCountryId)) {
          return { valid: false, error: 'Guarantee already exists' };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Фильтрует валидные действия из списка.
   */
  filterValidActions(actions: LLMAction[]): LLMAction[] {
    const validActions: LLMAction[] = [];

    for (const action of actions) {
      const validation = this.validateAction(action);
      if (!validation.valid) {
        console.warn(`Invalid action: ${validation.error}`);
        continue;
      }

      const applicability = this.validateActionApplicability(action);
      if (!applicability.valid) {
        console.warn(`Action not applicable: ${applicability.error}`);
        continue;
      }

      const magnitude = this.validateActionMagnitude(action);
      if (!magnitude.valid) {
        console.warn(`Action magnitude out of bounds: ${magnitude.error}`);
        continue;
      }

      validActions.push(action);
    }

    return validActions;
  }
}
