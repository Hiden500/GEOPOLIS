import { type Country } from "@shared/types/Country";
import { type SanctionType } from "@shared/types/DiplomacyState";
import {
  RIVAL_ENTRY_RELATION_SHIFT,
  RIVAL_EXIT_RELATION_SHIFT,
} from "@shared/defines/diplomacy";

/**
 * Сервис для управления дипломатическими отношениями между странами.
 */
export class DiplomacyService {
  /**
   * Изменяет отношение между странами.
   * @param fromId ID страны, от которой идёт изменение
   * @param toId ID страны, к которой идёт изменение
   * @param delta Изменение отношения (-100 до 100)
   */
  changeRelation(
    countries: Country[],
    fromId: string,
    toId: string,
    delta: number
  ): void {
    const fromCountry = countries.find(c => c.id === fromId);
    if (!fromCountry) return;

    const currentRelation = fromCountry.diplomacy.relations[toId] || 0;
    const newRelation = Math.max(-100, Math.min(100, currentRelation + delta));
    fromCountry.diplomacy.relations[toId] = newRelation;

    // Симметричное изменение отношений (опционально)
    const toCountry = countries.find(c => c.id === toId);
    if (toCountry) {
      const toCurrentRelation = toCountry.diplomacy.relations[fromId] || 0;
      const toNewRelation = Math.max(-100, Math.min(100, toCurrentRelation + delta * 0.5));
      toCountry.diplomacy.relations[fromId] = toNewRelation;
    }
  }

  /**
   * Добавляет страну в список союзников.
   */
  addAlly(
    countries: Country[],
    countryId: string,
    allyId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    if (!country.diplomacy.allies.includes(allyId)) {
      country.diplomacy.allies.push(allyId);
    }

    // Взаимное добавление
    const ally = countries.find(c => c.id === allyId);
    if (ally && !ally.diplomacy.allies.includes(countryId)) {
      ally.diplomacy.allies.push(countryId);
    }

    // Улучшаем отношения
    this.changeRelation(countries, countryId, allyId, 20);
  }

  /**
   * Удаляет страну из списка союзников.
   */
  removeAlly(
    countries: Country[],
    countryId: string,
    allyId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    country.diplomacy.allies = country.diplomacy.allies.filter(id => id !== allyId);

    // Взаимное удаление
    const ally = countries.find(c => c.id === allyId);
    if (ally) {
      ally.diplomacy.allies = ally.diplomacy.allies.filter(id => id !== countryId);
    }

    // Ухудшаем отношения
    this.changeRelation(countries, countryId, allyId, -30);
  }

  /**
   * Добавляет страну в список соперников.
   *
   * Величина сдвига — константа `RIVAL_ENTRY_RELATION_SHIFT`, а не литерал: она
   * откалибрована вместе с порогом перехода, который её вызывает, и обязана
   * меняться вместе с ним. Литерал −40 пережил опускание порога −70 → −2,5
   * именно потому, что жил здесь, вдали от своей пары.
   */
  addRival(
    countries: Country[],
    countryId: string,
    rivalId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    if (!country.diplomacy.rivals.includes(rivalId)) {
      country.diplomacy.rivals.push(rivalId);
    }

    // Ухудшаем отношения
    this.changeRelation(countries, countryId, rivalId, RIVAL_ENTRY_RELATION_SHIFT);
  }

  /**
   * Удаляет страну из списка соперников.
   *
   * Сдвиг зеркален входному: полный цикл «поссорились → помирились» не должен
   * оставлять паре отношений ниоткуда (см. `RIVAL_EXIT_RELATION_SHIFT`).
   */
  removeRival(
    countries: Country[],
    countryId: string,
    rivalId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    country.diplomacy.rivals = country.diplomacy.rivals.filter(id => id !== rivalId);

    // Улучшаем отношения
    this.changeRelation(countries, countryId, rivalId, RIVAL_EXIT_RELATION_SHIFT);
  }

  /**
   * Добавляет страну в сферу влияния.
   */
  addToSphereOfInfluence(
    countries: Country[],
    countryId: string,
    targetId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    if (!country.diplomacy.sphereOfInfluence.includes(targetId)) {
      country.diplomacy.sphereOfInfluence.push(targetId);
    }

    // Увеличиваем влияние
    this.changeInfluence(countries, countryId, targetId, 10);
  }

  /**
   * Удаляет страну из сферы влияния.
   */
  removeFromSphereOfInfluence(
    countries: Country[],
    countryId: string,
    targetId: string
  ): void {
    const country = countries.find(c => c.id === countryId);
    if (!country) return;

    country.diplomacy.sphereOfInfluence = country.diplomacy.sphereOfInfluence.filter(id => id !== targetId);

    // Уменьшаем влияние
    this.changeInfluence(countries, countryId, targetId, -20);
  }

  /**
   * Изменяет влияние на страну.
   * @param fromId ID страны, оказывающей влияние
   * @param toId ID страны, на которую оказывается влияние
   * @param delta Изменение влияния
   */
  changeInfluence(
    countries: Country[],
    fromId: string,
    toId: string,
    delta: number
  ): void {
    const fromCountry = countries.find(c => c.id === fromId);
    if (!fromCountry) return;

    const currentInfluence = fromCountry.diplomacy.influence[toId] || 0;
    const newInfluence = Math.max(0, Math.min(100, currentInfluence + delta));
    fromCountry.diplomacy.influence[toId] = newInfluence;
  }

  /**
   * Добавляет гарантию независимости.
   */
  addGuarantee(
    countries: Country[],
    guarantorId: string,
    guaranteedId: string
  ): void {
    const guarantor = countries.find(c => c.id === guarantorId);
    if (!guarantor) return;

    if (!guarantor.diplomacy.guarantees.includes(guaranteedId)) {
      guarantor.diplomacy.guarantees.push(guaranteedId);
    }

    // Улучшаем отношения
    this.changeRelation(countries, guarantorId, guaranteedId, 15);
  }

  /**
   * Удаляет гарантию независимости.
   */
  removeGuarantee(
    countries: Country[],
    guarantorId: string,
    guaranteedId: string
  ): void {
    const guarantor = countries.find(c => c.id === guarantorId);
    if (!guarantor) return;

    guarantor.diplomacy.guarantees = guarantor.diplomacy.guarantees.filter(id => id !== guaranteedId);

    // Ухудшаем отношения
    this.changeRelation(countries, guarantorId, guaranteedId, -20);
  }

  /**
   * Записывает режим санкций в состояние — И БОЛЬШЕ НИЧЕГО.
   *
   * Отделено от `addSanction` Милстоуном 1 (дипломатический блок алфавита).
   * Причина: у примитива `sanction` величину удара по отношениям считает
   * коридор магнитуды из состояния пары (`magnitude.ts`), а `addSanction`
   * вшивает в тот же вызов фиксированные −25. Позвать его значило бы получить
   * константу поверх коридора, то есть обойти собственную защиту глагола.
   *
   * Возвращает `true`, если режим действительно появился. Ложь здесь — не
   * удобство, а требование правила «действие без реализации не считается
   * применённым» (docs/PRIMITIVES.md §3): повторное наложение уже
   * действующей санкции состояние не меняет, и вызывающий обязан это узнать.
   */
  recordSanction(
    countries: Country[],
    sanctionerId: string,
    targetId: string,
    sanctionType: SanctionType
  ): boolean {
    const sanctioner = countries.find(c => c.id === sanctionerId);
    if (!sanctioner) return false;

    const existing = sanctioner.diplomacy.sanctions[targetId];
    if (existing?.includes(sanctionType)) return false;

    if (existing) existing.push(sanctionType);
    else sanctioner.diplomacy.sanctions[targetId] = [sanctionType];
    return true;
  }

  /**
   * Санкция вместе с фиксированной дипломатической ценой — парная к
   * `removeSanction`. Цену задаёт сервис, поэтому примитив алфавита её НЕ
   * использует (см. `recordSanction`).
   */
  addSanction(
    countries: Country[],
    sanctionerId: string,
    targetId: string,
    sanctionType: SanctionType
  ): void {
    this.recordSanction(countries, sanctionerId, targetId, sanctionType);

    // Ухудшаем отношения
    this.changeRelation(countries, sanctionerId, targetId, -25);
  }

  /**
   * Удаляет санкции против страны.
   */
  removeSanction(
    countries: Country[],
    sanctionerId: string,
    targetId: string,
    sanctionType: SanctionType
  ): void {
    const sanctioner = countries.find(c => c.id === sanctionerId);
    if (!sanctioner) return;

    if (sanctioner.diplomacy.sanctions[targetId]) {
      sanctioner.diplomacy.sanctions[targetId] = sanctioner.diplomacy.sanctions[targetId].filter(
        type => type !== sanctionType
      );

      // Удаляем запись если нет санкций
      if (sanctioner.diplomacy.sanctions[targetId].length === 0) {
        delete sanctioner.diplomacy.sanctions[targetId];
      }
    }

    // Улучшаем отношения
    this.changeRelation(countries, sanctionerId, targetId, 15);
  }
}
