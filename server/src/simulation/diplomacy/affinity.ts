import {
  RELATION_SCALE_MIN,
  RELATION_SCALE_MAX,
  RELATION_DRIFT_RATE,
  RELATION_DRIFT_CAP,
  ALLY_RELATION_THRESHOLD,
  ALLY_BREAK_THRESHOLD,
  ALLY_IDEOLOGY_THRESHOLD_SPAN,
  ALLY_COMMON_ENEMY_RELIEF,
  ALLY_BREAK_IDEOLOGY_SPAN,
  IDEOLOGY_INDIFFERENCE_DISTANCE,
  IDEOLOGY_AFFINITY_SPAN,
  CONTACTLESS_IDEOLOGY_SALIENCE,
  COMMON_ENEMY_AFFINITY,
  DEPENDENCY_AFFINITY,
  AT_WAR_AFFINITY,
} from "@shared/defines/diplomacy";

/**
 * Куда пару ТЯНЕТ её собственное положение в мире — и на чём эта пара готова
 * договориться о союзе.
 *
 * Модуль про арифметику, а не про состояние: на вход идут нормированные
 * величины и флаги, а не `GameState`. Правило то же, что у
 * `server/src/primitives/magnitude.ts`: фактор, требующий сборки мира вокруг
 * себя, нельзя проверить на крайних значениях — а здесь ровно крайние значения
 * и есть предмет проверки (см. четыре инварианта в
 * `shared/src/defines/diplomacy.ts`). Разбор состояния — работа тика.
 *
 * ЧТО ИМЕННО ЗАМЕНЕНО. Идеология перестала быть пропуском к союзу
 * (`areIdeologicallyCompatible`, булев гейт по подстрокам ярлыка) и стала
 * одним голосом из нескольких: она двигает ЦЕЛЬ, к которой дрейфуют отношения,
 * и двигает ПОРОГ, на котором пара соглашается на союз. Ни то, ни другое не
 * запрет: `allianceThreshold` по построению не достаёт до края шкалы, поэтому
 * достаточные отношения открывают союз ЛЮБОЙ паре.
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampRelation(value: number): number {
  return Math.max(RELATION_SCALE_MIN, Math.min(RELATION_SCALE_MAX, value));
}

/**
 * Положение пары друг относительно друга — вход всех формул модуля.
 *
 * `contact`, `dependency` и `commonEnemyPressure` нормированы в 0..1 самим
 * тиком: он один знает, что «влияние 40 из 100» и «вассалитет» — величины
 * одной шкалы, а `affinity.ts` знает только, что это доли.
 */
export interface PairStanding {
  /** Идеологическая дистанция 0..1 — та же, что считает недовольство. */
  ideologyDistance: number;
  /** Сила живого канала связи: общая граница, зависимость, общая война. */
  contact: number;
  /** Формальная зависимость: вассалитет, гарантия, сфера, влияние. */
  dependency: number;
  /** Давление общего врага 0..1. */
  commonEnemyPressure: number;
  /** Стороны воюют друг против друга. */
  atWarWithEachOther: boolean;
}

/**
 * Насколько идеология вообще важна ЭТОЙ паре.
 *
 * Соседство входит в модель здесь, множителем важности, а не отдельным
 * слагаемым дружбы: общая граница делает чужой режим угрозой, а свой — опорой,
 * то есть усиливает и притяжение, и отталкивание. Слагаемым «+N за соседство»
 * получилось бы, что граница улучшает отношения сама по себе, чего история не
 * подтверждает.
 */
function ideologySalience(contact: number): number {
  return (
    CONTACTLESS_IDEOLOGY_SALIENCE +
    (1 - CONTACTLESS_IDEOLOGY_SALIENCE) * clamp01(contact)
  );
}

/**
 * Идеологический член тяготения: от `+SPAN/2` у совпадающих режимов до
 * `−SPAN/2` у антиподов, с нулём в точке безразличия.
 */
export function ideologyAffinity(ideologyDistance: number, contact: number): number {
  const pull = IDEOLOGY_INDIFFERENCE_DISTANCE - clamp01(ideologyDistance);
  return IDEOLOGY_AFFINITY_SPAN * pull * ideologySalience(contact);
}

/**
 * Куда тянет отношения пары само её положение в мире — ЦЕЛЬ дрейфа, а не
 * текущее значение.
 *
 * Слагаемые, а не максимум (в отличие от `diplomaticGrip`, где канал связи
 * либо есть, либо нет): здесь причины дружить и враждовать накапливаются.
 * Общий враг и вассалитет складываются с идеологией, а не заменяют её, —
 * поэтому союз антиподов против общего врага возможен, но всё равно холоднее,
 * чем союз единомышленников против того же врага.
 */
export function structuralAffinity(standing: PairStanding): number {
  const raw =
    ideologyAffinity(standing.ideologyDistance, standing.contact) +
    COMMON_ENEMY_AFFINITY * clamp01(standing.commonEnemyPressure) +
    DEPENDENCY_AFFINITY * clamp01(standing.dependency) +
    (standing.atWarWithEachOther ? AT_WAR_AFFINITY : 0);
  return clampRelation(raw);
}

/** Смещение порога по дистанции вокруг его пивота. */
function ideologyOffset(ideologyDistance: number, span: number): number {
  return span * (clamp01(ideologyDistance) - IDEOLOGY_INDIFFERENCE_DISTANCE);
}

/**
 * Порог согласия на союз ДЛЯ ЭТОЙ ПАРЫ вместо общих 70 для всех.
 *
 * Растёт с идеологической дистанцией и падает от общего врага. Верх диапазона
 * (`ALLY_RELATION_THRESHOLD + ALLY_IDEOLOGY_THRESHOLD_SPAN / 2` = 80) строго
 * ниже `RELATION_SCALE_MAX`, и это не случайность калибровки, а инвариант 1:
 * порог, достающий до края шкалы, был бы тем же запретом, только выраженным
 * числом.
 */
export function allianceThreshold(
  ideologyDistance: number,
  commonEnemyPressure: number
): number {
  return (
    ALLY_RELATION_THRESHOLD +
    ideologyOffset(ideologyDistance, ALLY_IDEOLOGY_THRESHOLD_SPAN) -
    ALLY_COMMON_ENEMY_RELIEF * clamp01(commonEnemyPressure)
  );
}

/**
 * Порог распада союза для этой пары.
 *
 * Общий враг сюда НЕ входит намеренно. Скидку от врага получает тяготение, а не
 * порог, — поэтому исчезновение врага роняет само отношение, и союз антиподов
 * рассыпается сам, без отдельного механизма «проверить, жив ли повод».
 */
export function allianceBreakThreshold(ideologyDistance: number): number {
  return ALLY_BREAK_THRESHOLD + ideologyOffset(ideologyDistance, ALLY_BREAK_IDEOLOGY_SPAN);
}

/**
 * Шаг дрейфа отношений к цели за один тик.
 *
 * Доля оставшегося разрыва с потолком: разрыв в 60 пунктов закрывается не
 * рывком, а годами, и по мере приближения дрейф замедляется. Потолок нужен
 * ровно затем, чтобы обвал −100 от объявления войны не отыгрывался обратно за
 * один месяц.
 */
export function relationDriftStep(current: number, target: number): number {
  const gap = target - current;
  const step = gap * RELATION_DRIFT_RATE;
  return Math.max(-RELATION_DRIFT_CAP, Math.min(RELATION_DRIFT_CAP, step));
}

/** Новое значение отношений после одного шага дрейфа, уже в пределах шкалы. */
export function driftedRelation(current: number, target: number): number {
  return clampRelation(current + relationDriftStep(current, target));
}
