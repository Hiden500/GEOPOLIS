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
    // Действие БЕЗ реализации не может быть «применённым» (2026-07-26, повторная
    // верификация внешнего аудита). `annex`/`puppet` типизированы контрактом, но
    // apply у них — пустая ветка с логом (`LLMService.applyLlmActions`,
    // docs/plans/02_LLM_CONTRACT.md: «контракт типизирован, apply остаётся no-op»).
    // Проходя валидацию, они попадали в `appliedActions`, и этого хватало, чтобы
    // ответ считался ПРИМЕНИВШИМ изменение: `appliedChange === true` канонизировал
    // текст «Эльзас присоединён» при полностью неизменившемся мире — то есть дыра
    // ровно в той защите, которую ставили от этого же (docs/PRIMITIVES.md §3,
    // защита №2).
    //
    // Отказ сделан ЗДЕСЬ, а не фильтром `appliedActions` по результату команды,
    // по двум проверенным причинам. Первая: команды этих двух глаголов не
    // существует вовсе — спрашивать о результате не у кого. Вторая: у остальных
    // девяти `CommandResult.success` означает «команда отработала без ошибки», а
    // не «мир изменился» (`setRelation` с delta 0 успешен и не меняет ничего),
    // поэтому фильтр по нему НЕ реализовал бы правило «не изменившее мир не
    // считается применённым», а лишь создал бы его видимость. Отказ валидатором
    // при этом даёт то, чего фильтр не даёт вовсе, — ПРИЧИНУ: она уходит в
    // `rejectedActions`, оттуда игроку в панель LLM.
    //
    // Проверка стоит первой и не зависит от состояния партии: причина «этого нет
    // в движке» полезнее для читателя, чем «страна не найдена», и верна при любом
    // состоянии мира.
    if (action.type === 'annex' || action.type === 'puppet') {
      return {
        valid: false,
        error:
          `Action "${action.type}" is declared in the contract but has no apply logic in the ` +
          `engine yet: applying it would change nothing, so it is refused instead of being ` +
          `reported as applied. Narrate the takeover, or use war/peace, which do change the world`,
      };
    }

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
}
