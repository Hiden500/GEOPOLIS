import { type GameState } from "@shared/types/GameState";
import { type War } from "@shared/types/War";
import { revertOccupationForWar, transferRegion } from "../simulation/war/occupation";
import { computeWarScore } from "../simulation/war/warScore";
import {
  WARSCORE_ANNEXATION_THRESHOLD,
  WARSCORE_COST_PER_ANNEXED_REGION,
} from "@shared/defines/war";

/**
 * Штраф легитимности/governmentSupport проигравшей стороне при заключении
 * мира (docs/DECISIONS.md, 2026-07-06). Обычный проигравший.
 */
const WAR_LOSER_PENALTY = -15;

/**
 * Проигравший агрессор (инициатор войны, attackers[0]) — штраф жёстче,
 * компенсация примера Аргентина/Фолкленды из обсуждения дизайна.
 */
const WAR_AGGRESSOR_LOSER_PENALTY = -25;

/**
 * Ничья короче этого порога (месяцев) не считается изматывающей — штрафа нет.
 */
const STALEMATE_WEARINESS_THRESHOLD_MONTHS = 24;

/**
 * За каждый год сверх порога при ничьей — штраф военной усталости обеим
 * сторонам (Вьетнам/Афганистан-эффект: долгая безрезультатная война бьёт
 * по легитимности независимо от исхода по условиям мира).
 */
const STALEMATE_WEARINESS_PER_EXTRA_YEAR = -3;
const STALEMATE_WEARINESS_CAP = -15;

/**
 * Градуированный мир (независимый гейм-дизайн разбор, 2026-07-06) —
 * денежное измерение исхода войны поверх легитимности. Не путать с
 * FLIP_THRESHOLD_RATIO=1.5 в WarTick.ts (тот — про флип региона на фронте,
 * этот — про решительность исхода всей войны при заключении мира).
 * Обычная (не решительная) победа — только легитимность, как раньше, без
 * репараций; ничья — тоже без репараций (только усталость, если применимо).
 */
const DECISIVE_FLIP_RATIO = 2;

/** Доля treasury проигравшего, переходящая победителю при решительной победе. */
const REPARATIONS_SHARE = 0.1;

function isDecisiveVictory(winnerFlips: number, loserFlips: number): boolean {
  if (winnerFlips <= 0) return false;
  if (loserFlips === 0) return true;
  return winnerFlips >= loserFlips * DECISIVE_FLIP_RATIO;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function monthsBetween(startDate: string, endDate: string): number {
  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [endYear, endMonth] = endDate.split("-").map(Number);
  return (endYear! - startYear!) * 12 + (endMonth! - startMonth!);
}

/**
 * Сервис войны (docs/WAR.md, Phase 1): объявление с авто-втягиванием
 * коалиций, мир с детерминированным последствием для легитимности.
 * Фронт/бой — отдельно, WarTick.ts.
 */
export class WarService {
  constructor(private game: GameState) {}

  /**
   * Все страны, которые должны присоединиться к стороне вместе с primaryId:
   * союзники (симметрично, читаем напрямую), собственные пуппеты primaryId
   * (свои марионетки следуют за сюзереном), сюзерен primaryId (если сам
   * primaryId — чей-то пуппет) и гаранты независимости primaryId (кто дал
   * гарантию — вступается). Один уровень, без транзитивного замыкания —
   * осознанное упрощение Phase 1 (не тянем союзников союзников).
   */
  private findCoalitionFor(primaryId: string): string[] {
    const primary = this.game.countries.find(c => c.id === primaryId);
    if (!primary) return [];

    const dragIns = new Set<string>();

    for (const allyId of primary.diplomacy.allies) dragIns.add(allyId);
    for (const puppetId of primary.diplomacy.puppets) dragIns.add(puppetId);

    for (const other of this.game.countries) {
      if (other.id === primaryId) continue;
      if (other.diplomacy.guarantees.includes(primaryId)) dragIns.add(other.id);
      if (other.diplomacy.puppets.includes(primaryId)) dragIns.add(other.id);
    }

    dragIns.delete(primaryId);
    return [...dragIns];
  }

  /**
   * Объявляет войну. Идемпотентно: если между инициатором и целью уже есть
   * активная война, возвращает её, не создавая дубликат.
   */
  declareWar(initiatorId: string, targetId: string, warGoal?: string): War {
    const existing = this.getActiveWarBetween(initiatorId, targetId);
    if (existing) return existing;

    const attackerDragIns = this.findCoalitionFor(initiatorId).filter(id => id !== targetId);
    const defenderDragIns = this.findCoalitionFor(targetId).filter(id => id !== initiatorId);

    const war: War = {
      id: `war-${this.game.wars.length + 1}-${initiatorId}-${targetId}`,
      attackers: [initiatorId, ...attackerDragIns.filter(id => !defenderDragIns.includes(id))],
      defenders: [targetId, ...defenderDragIns.filter(id => !attackerDragIns.includes(id))],
      supporters: [],
      startDate: this.game.currentDate,
      active: true,
      territoryFlips: { toAttackers: 0, toDefenders: 0 },
      casualties: {},
      ...(warGoal !== undefined ? { warGoal } : {}),
    };

    this.game.wars.push(war);
    return war;
  }

  /**
   * Ищет активную войну, где countryIdA и countryIdB — противоборствующие
   * стороны (не проверяет supporters — те не боевой участник).
   */
  getActiveWarBetween(countryIdA: string, countryIdB: string): War | undefined {
    return this.game.wars.find(
      w =>
        w.active &&
        ((w.attackers.includes(countryIdA) && w.defenders.includes(countryIdB)) ||
          (w.defenders.includes(countryIdA) && w.attackers.includes(countryIdB)))
    );
  }

  /**
   * Завершает войну миром: считает легитимность по исходу
   * (territoryFlips) + длительности + роли агрессора, применяет только к
   * attackers[0]/defenders[0] (не ко всем коалиционерам — упрощение Phase 1),
   * убирает battalion MapFeature этой войны.
   */
  makePeace(warId: string): void {
    const war = this.game.wars.find(w => w.id === warId);
    if (!war || !war.active) return;

    war.active = false;

    // Детерминированные условия мира по warScore (docs/plans/08_WAR_WAVE1.md,
    // Шаг 2b): победитель аннексирует оккупированное по бюджету очков, остальная
    // оккупация снимается. Ниже порога — белый мир (вся оккупация снята).
    this.applyPeaceTerms(war);

    const durationMonths = monthsBetween(war.startDate, this.game.currentDate);
    const { toAttackers, toDefenders } = war.territoryFlips;

    const attackerPrimaryId = war.attackers[0]!;
    const defenderPrimaryId = war.defenders[0]!;

    if (toAttackers > toDefenders) {
      // Атакующие продвинулись — обороняющиеся проиграли.
      this.applyLegitimacyPenalty(defenderPrimaryId, WAR_LOSER_PENALTY);
      if (isDecisiveVictory(toAttackers, toDefenders)) {
        this.applyReparations(attackerPrimaryId, defenderPrimaryId);
      }
    } else if (toDefenders > toAttackers) {
      // Обороняющиеся отбились и продвинулись — агрессор проиграл (жёстче).
      this.applyLegitimacyPenalty(attackerPrimaryId, WAR_AGGRESSOR_LOSER_PENALTY);
      if (isDecisiveVictory(toDefenders, toAttackers)) {
        this.applyReparations(defenderPrimaryId, attackerPrimaryId);
      }
    } else if (durationMonths > STALEMATE_WEARINESS_THRESHOLD_MONTHS) {
      // Ничья, но затянутая — военная усталость обеим сторонам.
      const extraYears = Math.floor((durationMonths - STALEMATE_WEARINESS_THRESHOLD_MONTHS) / 12);
      const penalty = Math.max(
        STALEMATE_WEARINESS_CAP,
        extraYears * STALEMATE_WEARINESS_PER_EXTRA_YEAR
      );
      if (penalty < 0) {
        this.applyLegitimacyPenalty(attackerPrimaryId, penalty);
        this.applyLegitimacyPenalty(defenderPrimaryId, penalty);
      }
    }

    const warTag = `war:${war.id}`;
    this.game.mapFeatures = this.game.mapFeatures.filter(
      f => !(f.type === "battalion" && f.tags.includes(warTag))
    );
  }

  /**
   * Детерминированные условия мира по warScore (docs/plans/08_WAR_WAVE1.md,
   * Шаг 2b). |warScore| ниже порога аннексии → белый мир (вся оккупация войны
   * снята). Иначе победитель аннексирует оккупированные им регионы проигравшего
   * (по возрастанию id, для детерминизма) в пределах бюджета очков; остальная
   * оккупация снимается. Границу двигает только договор — не сама война.
   */
  private applyPeaceTerms(war: War): void {
    const score = computeWarScore(war);

    const winnerSide =
      score >= WARSCORE_ANNEXATION_THRESHOLD ? war.attackers :
      score <= -WARSCORE_ANNEXATION_THRESHOLD ? war.defenders :
      null;

    if (winnerSide === null) {
      // Белый мир — граница не меняется, вся оккупация войны снимается.
      revertOccupationForWar(this.game, war);
      return;
    }

    const loserSide = winnerSide === war.attackers ? war.defenders : war.attackers;
    const winnerSet = new Set(winnerSide);
    const loserSet = new Set(loserSide);
    const maxAnnexations = Math.floor(Math.abs(score) / WARSCORE_COST_PER_ANNEXED_REGION);

    // Кандидаты на аннексию: регионы, которые победитель оккупирует и которые
    // легально принадлежат проигравшему. По возрастанию id — детерминированный
    // выбор, не зависящий от порядка обхода.
    const annexable = this.game.regions
      .filter(r => r.occupiedBy !== undefined && winnerSet.has(r.occupiedBy) && loserSet.has(r.ownerCountryId))
      .sort((a, b) => a.id - b.id);

    for (const region of annexable.slice(0, maxAnnexations)) {
      transferRegion(this.game, region, region.occupiedBy!);
    }

    // Что не аннексировано (сверх бюджета или другой стороны) — оккупация снята.
    revertOccupationForWar(this.game, war);
  }

  private applyLegitimacyPenalty(countryId: string, delta: number): void {
    const country = this.game.countries.find(c => c.id === countryId);
    if (!country) return;

    country.politics.legitimacy = clampPercent(country.politics.legitimacy + delta);
    country.politics.governmentSupport = clampPercent(country.politics.governmentSupport + delta);
  }

  /**
   * Репарации из казны проигравшего победителю (только решительная победа,
   * см. isDecisiveVictory). Не переводит, если казна проигравшего уже в
   * минусе — не тянем победителя в чужой долг.
   */
  private applyReparations(winnerId: string, loserId: string): void {
    const winner = this.game.countries.find(c => c.id === winnerId);
    const loser = this.game.countries.find(c => c.id === loserId);
    if (!winner || !loser) return;

    const amount = loser.economy.treasury * REPARATIONS_SHARE;
    if (amount <= 0) return;

    loser.economy.treasury -= amount;
    winner.economy.treasury += amount;
  }
}
