import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { WarService } from "../services/WarService";
import { effectiveController } from "@shared/utils/regionControl";
import { MAX_RESEARCH_SHARE, WAR_RESEARCH_SHARE_PENALTY, MIN_RESEARCH_SHARE_CAP } from "@shared/defines/llmActionCaps";

/**
 * Семантическая применимость LLM-действия к текущему состоянию партии —
 * страна существует, война действительно идёт, нет дублей и т.п. Структурная
 * и магнитудная валидация формы (типы полей, статические капы) — Zod-схемы
 * в server/src/llm/actionSchemas.ts (docs/plans/02_LLM_CONTRACT.md), эта
 * проверка идёт ПОСЛЕ них в LLMService.processResponse и знает о конкретной
 * партии (game.countries/game.wars), которую схема знать не может. Также
 * держит единственную магнитуду, которая физически не выражается в
 * контекст-независимой схеме — военно-скорректированный потолок
 * research_shift.share (getResearchShareCap).
 */
export class LLMResponseValidator {
  private game: GameState;
  private warService: WarService;

  constructor(game: GameState) {
    this.game = game;
    this.warService = new WarService(game);
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
   * Валидирует, что действие применимо в текущем состоянии игры. Вызывается
   * на уже структурно/магнитудно провалидированном actionSchemas.ts действии
   * (LLMService.processResponse) — не проверяет форму данных заново.
   */
  validateActionApplicability(action: LLMAction): { valid: boolean; error?: string } {
    // Ветки отказа для `annex`/`puppet` здесь больше нет: с 2026-07-27 этих
    // типов нет в контракте вовсе (`actionSchemas.ts`), и запись с таким `type`
    // отклоняется на схеме — раньше и с более точной причиной. Год их
    // существования как «типизировано, но не реализовано» стоил одной дыры в
    // защите №2 (ответ считался применившим изменение) и одного абзаца
    // инструкции промта, объясняющего, почему их не надо предлагать.

    const source = this.game.countries.find(c => c.id === action.sourceCountryId);
    if (!source) {
      return { valid: false, error: 'Source country not found' };
    }

    if (action.type === 'research_shift') {
      if (!(action.data.domain in source.technology.domains)) {
        return { valid: false, error: `Unknown technology domain: ${action.data.domain}` };
      }

      const cap = this.getResearchShareCap(action.sourceCountryId);
      if (action.data.share > cap) {
        return {
          valid: false,
          error: `research_shift share ${action.data.share} exceeds admin capacity cap ${cap}`,
        };
      }
    }

    if (action.type === 'production_shift') {
      if (!(action.data.equipmentType in source.military.equipment)) {
        return { valid: false, error: `Unknown equipment type: ${action.data.equipmentType}` };
      }
    }

    if (action.type === 'build_extraction') {
      const region = this.game.regions.find(r => r.id === action.data.regionId);
      if (!region) {
        return { valid: false, error: `Unknown region: ${action.data.regionId}` };
      }

      // Наращивание требует контроля над регионом и наличия депозита
      // (docs/plans/04_RESOURCES.md); сворачивание (delta<0) — нет, страна
      // вправе свернуть свою же добычу на потерянной/оккупированной территории.
      if (action.data.delta > 0) {
        if (effectiveController(region) !== action.sourceCountryId) {
          return { valid: false, error: `Country does not control region ${action.data.regionId}` };
        }
        if (!region.deposits[action.data.resource]) {
          return { valid: false, error: `No ${action.data.resource} deposit in region ${action.data.regionId}` };
        }
      }
    }

    if ('targetCountryId' in action) {
      const target = this.game.countries.find(c => c.id === action.targetCountryId);
      if (!target) {
        return { valid: false, error: 'Target country not found' };
      }

      // Правила для `peace`/`war`/`sanction` переехали в предпосылки движка
      // примитивов вместе со своими глаголами (Милстоун 1,
      // `PrimitiveEngine.validate`): «нет активной войны», «уже воюем», «война
      // с союзником», «санкция уже наложена». Там они выражены структурными
      // кодами отказа, а не английскими строками, и потому доезжают до игрока
      // по-русски.

      if (action.type === 'guarantee') {
        // Нельзя гарантировать независимость если уже есть гарантия
        if (source.diplomacy.guarantees.includes(action.targetCountryId)) {
          return { valid: false, error: 'Guarantee already exists' };
        }
      }
    }

    return { valid: true };
  }
}
