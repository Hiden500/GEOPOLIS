import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { DiplomacyService } from "./DiplomacyService";
import { WarService } from "./WarService";
import { ResearchService } from "./ResearchService";
import { getDomainTier } from "@shared/utils/technology";
import { getGdpPerCapita, getLivingStandardIndex } from "@shared/utils/countryMetrics";
import {
  LLMResponseValidator,
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RELATION_CHANGE,
  MAX_INFLUENCE_CHANGE,
  MAX_RESEARCH_SHARE,
} from "../llm/LLMResponseValidator";

/**
 * Сколько не-major стран попадают в "## Spotlight Countries" за один цикл.
 * Тюнингуемая константа (как THREAT-пороги в AiBehaviorTick) — балансировать
 * на симуляции. При ~117 не-major странах (10 major/25 regional из
 * TierTick.ts, остальное minor) и этом значении полный оборот ротации —
 * ~24 месяца (см. docs/DECISIONS.md, 2026-07-04, вопрос 11).
 */
const LLM_SPOTLIGHT_COUNT = 5;

/**
 * Полные имена языков для секции "## Language" промта — сама инструкция
 * промта всегда на английском, меняется только язык генерируемого текста
 * LLM (docs/DECISIONS.md, 2026-07-05: язык фиксируется на старте игры).
 */
const LANGUAGE_NAMES: Record<Locale, string> = {
  ru: "Russian",
  en: "English",
};

/**
 * Окно "памяти страны" между вызовами LLM (docs/DECISIONS.md, 2026-07-05,
 * вопрос 7): движок берёт последние N заголовков (Event.title) из уже
 * существующего eventHistory по стране — LLM ничего дополнительно не пишет
 * (title она и так производит каждый цикл), только форматирование. Решает
 * проблему Spotlight-ротации (страна выпадает из промта на ~24 хода и теряет
 * контекст) без лишних выходных токенов. Размер окна по тиру — тот же
 * принцип тюнинга, что LLM_SPOTLIGHT_COUNT.
 */
const PLAYER_RECENT_TITLES_COUNT = 5;
const MAJOR_RECENT_TITLES_COUNT = 3;
const SPOTLIGHT_RECENT_TITLES_COUNT = 2;

/**
 * Итог одного прохода LLM-цикла: что применено, что отклонено и почему.
 */
export interface LlmCycleResult {
  success: boolean;
  error?: string;
  title?: string;
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
  private warService: WarService;
  private researchService: ResearchService;

  constructor(game: GameState) {
    this.game = game;
    this.diplomacyService = new DiplomacyService();
    this.warService = new WarService(game);
    this.researchService = new ResearchService();
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

    const { title, descriptions, actions } = validation.parsedData;
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
    this.advanceSpotlightCursor();
    this.game.playerIntent = "";
    this.game.llmRespondedThisTurn = true;

    const eventTitle = title?.trim() || `Мировые события (LLM, ход ${this.game.llmTurn})`;

    this.game.eventHistory.push({
      id: `llm-turn-${this.game.llmTurn}`,
      date: this.game.currentDate,
      title: eventTitle,
      description: descriptions,
      countries: [
        ...new Set(
          appliedActions.flatMap(a =>
            a.targetCountryId ? [a.sourceCountryId, a.targetCountryId] : [a.sourceCountryId]
          )
        ),
      ],
    });

    return { success: true, title: eventTitle, descriptions, appliedActions, rejectedActions };
  }

  /**
   * Генерирует промт для LLM на основе текущего состояния игры.
   */
  generatePrompt(): string {
    const prompt = `
# Geopolis - World Simulation

## Current Date
${this.game.currentDate}

## Language
Write "title", "descriptions", and any other free-text narrative you generate
in ${LANGUAGE_NAMES[this.game.locale]}. This applies only to the prose you write —
country ids, region ids, and other identifiers elsewhere in this prompt are
never translated, copy them verbatim.

## Player Country
${this.getPlayerCountryInfo()}

## Major Powers
${this.getMajorPowersInfo()}

## Spotlight Countries
Not major powers, but on stage this cycle. You MUST give at least 2 of them a
concrete narrative beat in "descriptions" this cycle (a development, decision,
or event specific to that country) — not just a passing mention.
${this.getSpotlightInfo()}

## Active Wars
${this.getActiveWarsInfo()}

## Recent Events
${this.getRecentEventsInfo()}

## Diplomatic Situation
${this.getDiplomaticSituation()}

## Player Intent
${this.getPlayerIntentInfo()}

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

Narrative requirements (strict):
- "descriptions" MUST be at least 3 distinct paragraphs: (1) what happened
  this month among the Major Powers, (2) what happened in at least 2 of the
  Spotlight Countries specifically (name them, give each a concrete beat —
  not a vague aggregate sentence), (3) a forward-looking read of where
  tensions/opportunities are heading next month.
- You MUST NOT mention, narrate about, or take action for any country that
  is not listed in the "## Country IDs" section above. If a country is not
  in that list, it does not exist in this simulation right now — do not
  invent events for it.
- Where applicable, ground the narrative in concrete real historical events
  of this specific month/year rather than generic statements (e.g. prefer a
  real, dated development over a vague "tensions continue to rise").
  Deviations from real history caused by earlier player/LLM actions take
  priority over this — follow the world's own logic, don't force events back
  to the historical outcome.
- Avoid a direct "war" action between two nuclear-armed Major Powers unless
  strongly, explicitly grounded in real historical events — prefer narrating
  proxy support (a patron backing a client state's own conflict) over direct
  war between such powers.
- You may direct a Major Power's research focus via a "research_shift" action
  (data.domain, data.share) — there is no fixed catalog of named technologies;
  a domain's "tier" is just accumulated investment. When a country's domain
  tier crosses a meaningful new threshold, narrate what this represents in
  concrete terms (what got invented/achieved) — you invent the specific
  breakthrough, the engine only tracks the number.

Return your response in JSON format with the following structure:
{
  "title": "Short one-line headline for this cycle's single most important development",
  "descriptions": "Narrative description of world events",
  "actions": [
    {
      "type": "diplomacy|war|peace|annex|puppet|sanction|guarantee|influence|research_shift",
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
- research_shift: data.domain must be a real domain of the source country
  (see its Technology line); data.share within 0-${MAX_RESEARCH_SHARE}.
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
        case 'research_shift':
          this.applyResearchShiftAction(action);
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

    const warGoal = typeof action.data?.warGoal === "string" ? action.data.warGoal : undefined;
    this.warService.declareWar(action.sourceCountryId, action.targetCountryId, warGoal);

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

    const war = this.warService.getActiveWarBetween(action.sourceCountryId, action.targetCountryId);
    if (war) {
      this.warService.makePeace(war.id);
    }

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
   * Применяет сдвиг фокуса исследований (docs/DECISIONS.md, 2026-07-06) —
   * без каталога именных технологий, только доля researchSpending на домен.
   * Доступно и игроку, и топ-державам через LLM (sourceCountryId — любая
   * страна ростера, тот же паттерн, что объявление войны).
   */
  private applyResearchShiftAction(action: LLMAction): void {
    const domain = action.data?.domain;
    const share = action.data?.share;
    if (typeof domain !== 'string' || typeof share !== 'number') return;

    const country = this.game.countries.find(c => c.id === action.sourceCountryId);
    if (!country) return;

    this.researchService.setAllocation(country, domain, share);
  }

  /**
   * Получает информацию о стране игрока.
   */
  private getPlayerCountryInfo(): string {
    const player = this.game.countries.find(c => c.id === this.game.playerCountryId);
    if (!player) return 'Unknown';

    return `
- Name: ${player.name}
- GDP: $${(player.economy.gdp / 1e9).toFixed(2)}B (per capita: $${Math.round(getGdpPerCapita(player)).toLocaleString()})
- Population: ${(player.population / 1e6).toFixed(2)}M
- Living standard index: ${Math.round(getLivingStandardIndex(player, this.game.regions))}/100
- Military: ${player.military.manpower.toLocaleString()}
- Technology: ${this.getTechTierSummary(player)}
- Allies: ${player.diplomacy.allies.join(', ') || 'None'}
- Rivals: ${player.diplomacy.rivals.join(', ') || 'None'}${this.getRecentTitlesLine(player.id, PLAYER_RECENT_TITLES_COUNT)}
`;
  }

  /**
   * Компактная сводка тиров доменов технологий (docs/DECISIONS.md,
   * 2026-07-06) — только домены с тиром > 0, чтобы не перечислять все ~14
   * доменов эры каждый цикл. Тир — не именная технология, декоративное имя
   * прорыва при пересечении порога придумывает сам LLM в нарративе.
   */
  private getTechTierSummary(country: Country): string {
    const entries = Object.entries(country.technology.domains)
      .map(([domain, progress]) => [domain, getDomainTier(progress)] as const)
      .filter(([, tier]) => tier > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return 'no notable tech progress yet';
    return entries.map(([domain, tier]) => `${domain} T${tier}`).join(', ');
  }

  /**
   * "Память страны" без записи от LLM: последние `limit` заголовков её
   * событий из eventHistory, самые свежие первыми. Пустая строка, если по
   * стране ещё не было событий (не засорять промт для новой партии).
   */
  private getRecentTitlesLine(countryId: string, limit: number): string {
    const relevant = this.game.eventHistory.filter(e => e.countries.includes(countryId));
    if (relevant.length === 0) return '';

    const recent = relevant.slice(-limit).reverse();
    const formatted = recent.map(e => `${e.title} (${e.date})`).join('; ');
    return `\n  Recent: ${formatted}`;
  }

  /**
   * Страны с tier === 'major' (TierTick.ts — 10 стран, пересчитывается раз в
   * год по составному скору ВВП/военной/влияния). До 2026-07-04 здесь был
   * top-5 по ВВП — ad-hoc метрика, не знавшая о существующем поле `tier`; см.
   * docs/DECISIONS.md, вопрос 11. Отсортировано по ВВП только для порядка
   * отображения — на выбор набора не влияет.
   */
  private getMajorPowers(): Country[] {
    return this.game.countries
      .filter(c => c.tier === 'major')
      .sort((a, b) => b.economy.gdp - a.economy.gdp);
  }

  /**
   * Получает информацию о крупных державах.
   */
  private getMajorPowersInfo(): string {
    const majors = this.getMajorPowers();
    if (majors.length === 0) return 'No major powers';
    return majors.map(c =>
      `- ${c.name}: GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, Military ${c.military.manpower.toLocaleString()}, Tech: ${this.getTechTierSummary(c)}` +
      this.getRecentTitlesLine(c.id, MAJOR_RECENT_TITLES_COUNT)
    ).join('\n');
  }

  /**
   * Пул кандидатов на ротацию — все не-major страны, отсортированные по id.
   * Сортировка по id (не по ВВП/скору) намеренно: эти поля меняются каждый
   * тик и сдвигали бы порядок ротации непредсказуемо — id страны стабилен
   * всю партию, гарантируя, что полный оборот действительно проходит по
   * всем странам без пропусков/повторов.
   */
  private getSpotlightPool(): Country[] {
    return [...this.game.countries]
      .filter(c => c.tier !== 'major')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Следующие LLM_SPOTLIGHT_COUNT стран пула начиная с llmSpotlightCursor
   * (round-robin с оборачиванием). Не двигает курсор — генерация промта
   * должна быть идемпотентной; курсор двигает только advanceSpotlightCursor
   * (вызывается из processResponse при успешном проходе цикла).
   */
  private getSpotlightCountries(): Country[] {
    const pool = this.getSpotlightPool();
    if (pool.length === 0) return [];

    const cursor = (this.game.llmSpotlightCursor ?? 0) % pool.length;
    const count = Math.min(LLM_SPOTLIGHT_COUNT, pool.length);
    return Array.from({ length: count }, (_, i) => pool[(cursor + i) % pool.length]!);
  }

  /** Продвигает курсор ротации на LLM_SPOTLIGHT_COUNT, с оборачиванием. */
  private advanceSpotlightCursor(): void {
    const pool = this.getSpotlightPool();
    if (pool.length === 0) return;

    const cursor = (this.game.llmSpotlightCursor ?? 0) % pool.length;
    this.game.llmSpotlightCursor = (cursor + LLM_SPOTLIGHT_COUNT) % pool.length;
  }

  /**
   * Получает информацию о странах в ротации ("Spotlight Countries").
   */
  private getSpotlightInfo(): string {
    const spotlight = this.getSpotlightCountries();
    if (spotlight.length === 0) return 'No spotlight countries this cycle';
    return spotlight.map(c =>
      `- ${c.name} (${c.tier}): GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, stability ${Math.round(c.politics.stability)}` +
      this.getRecentTitlesLine(c.id, SPOTLIGHT_RECENT_TITLES_COUNT)
    ).join('\n');
  }

  /**
   * Собирает id→name всех стран, упомянутых по имени где-либо в промте
   * (игрок, крупные державы, ротация, стороны напряжённостей, союзники/
   * соперники игрока). LLM должна использовать эти id как есть — никогда не
   * угадывать код из имени (регрессия 2026-07-04: ChatGPT вернул "SOV"/"ROM"
   * вместо реальных "SUN"/"ROU", потому что промт до этого фикса не давал id
   * вообще).
   */
  private getReferencedCountries(): Map<string, string> {
    const referenced = new Map<string, string>();
    const add = (id: string | undefined) => {
      if (!id) return;
      const country = this.game.countries.find(c => c.id === id);
      if (country) referenced.set(country.id, country.name);
    };

    add(this.game.playerCountryId);
    for (const c of this.getMajorPowers()) add(c.id);
    for (const c of this.getSpotlightCountries()) add(c.id);

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
    const activeWars = this.game.wars.filter(w => w.active);
    if (activeWars.length === 0) return 'No active wars';

    const nameOf = (id: string) => this.game.countries.find(c => c.id === id)?.name ?? id;

    return activeWars.map(w => {
      const attackerNames = w.attackers.map(nameOf).join(', ');
      const defenderNames = w.defenders.map(nameOf).join(', ');
      const { toAttackers, toDefenders } = w.territoryFlips;
      const front =
        toAttackers > toDefenders ? 'attackers advancing' :
        toDefenders > toAttackers ? 'defenders advancing' :
        'front stable';
      const goal = w.warGoal ? `, goal: ${w.warGoal}` : '';
      return `- ${attackerNames} vs ${defenderNames}: ${front}${goal}`;
    }).join('\n');
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
   * Получает намерение игрока на текущий ход (свободный текст).
   */
  private getPlayerIntentInfo(): string {
    const intent = this.game.playerIntent?.trim();
    if (!intent) return 'No player intent this cycle';
    return intent;
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
