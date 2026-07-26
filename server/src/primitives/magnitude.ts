import { type Country } from "@shared/types/Country";
import { type GroupImpactMemory } from "@shared/types/politics/Demographics";
import { type PrimitiveIntensity } from "@shared/types/politics/PrimitiveIntensity";
import {
  PRIMITIVE_INTENSITY_POSITION,
  COUNTRY_POLITICS_SCALE_MAX,
  REPRESS_COERCION_STABILITY_WEIGHT,
  REPRESS_COERCION_LEGITIMACY_WEIGHT,
  REPRESS_MAJORITY_RESISTANCE,
  REPRESS_ALIENATION_SHARE_BASE,
  REPRESS_ALIENATION_LEGITIMACY_RELIEF,
  GRANT_AUTONOMY_SHARE_BASE,
  GRANT_AUTONOMY_ALIENATION_DISCOUNT,
  GRANT_AUTONOMY_LEGITIMACY_WEIGHT,
  GRANT_AUTONOMY_CONCESSION_MAX,
  GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MIN,
  GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MAX,
  INCITE_UNREST_MIN_DISTANCE,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
} from "@shared/defines/discontent";

/**
 * Величина эффекта примитива — **коридор от состояния, позиция от хинта**
 * (docs/PRIMITIVES.md §1: «magnitude — величину эффекта считает движок из
 * состояния + params, хинт клампится»; §3: «LLM не влияет на число никогда»).
 *
 * До 2026-07-26 магнитуда была `КОНСТАНТА × множитель_хинта`: состояние в ней
 * не участвовало вовсе, и модель, написав `severe`, получала ровно тройной
 * эффект против `mild` в любом мире. Здесь это исправлено одной формулой на
 * все глаголы:
 *
 *     magnitude = MIN + (MAX − MIN) × stateFactor × intensityPosition
 *
 * Свойства, ради которых формула выбрана именно такой:
 *   - результат всегда лежит в `[MIN, MAX]` — жёсткий кламп, модель не может
 *     вытолкнуть эффект за коридор ничем;
 *   - `stateFactor` (0..1) целиком выводится из состояния мира и задаёт ПОТОЛОК
 *     коридора; хинт двигает магнитуду только внутри того, что состояние
 *     разрешило;
 *   - при `stateFactor → 0` коридор схлопывается в `MIN`, и `severe` перестаёт
 *     отличаться от `mild` — хинт клампится состоянием буквально, а не на
 *     словах. Отношение `severe/mild` перестаёт быть константой.
 *
 * Последнее свойство — не риторика: оно обязано быть ДОСТИЖИМО у каждого
 * канала, иначе модель в любом мире гарантированно владеет фиксированной долей
 * коридора. Условия схлопывания поканально (все шесть проверяет
 * `__tests__/magnitude.test.ts`):
 *
 *   | канал                     | `stateFactor = 0` при                        |
 *   |---------------------------|----------------------------------------------|
 *   | repress · suppression     | `stability = legitimacy = 0`                 |
 *   | repress · alienation      | `legitimacy = COUNTRY_POLITICS_SCALE_MAX`    |
 *   | grant_autonomy·concession | `legitimacy = 0` либо `alienation = 1`       |
 *   | incite_unrest             | дистанция ровно на пороге предпосылки        |
 *   | spawn_incident            | недовольство ровно на пороге предпосылки     |
 *   | enact_reform              | поддержка ровно на пороге предпосылки        |
 *
 * До калибровки 2026-07-26 таблица была неполной: у канала отчуждения
 * `stateFactor` был функцией одной только доли группы с жёстким полом 0.35, а
 * `share = 0` схема демографии не допускает — то есть схлопывание было
 * недостижимо ни в каком мире, и утверждение выше для него было ложным.
 * Легитимность власти введена как второй вход именно поэтому (и заодно потому,
 * что размеченные регионы среза — сплошь титульные доминанты, на которых
 * множитель доли не отличим от константы).
 *
 * Числовые коэффициенты здесь не живут — только в `shared/src/defines/`
 * (fitness-правило 4, server/src/__tests__/architecture.test.ts).
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Базовая свёртка. `stateFactor` вне 0..1 клампится: подающий его код может
 * считать «запас над порогом», и отрицательный запас должен означать «ноль
 * свободы», а не отрицательный эффект.
 */
export function magnitudeFromState(
  min: number,
  max: number,
  stateFactor: number,
  intensity: PrimitiveIntensity
): number {
  const ceilingShare = clamp01(stateFactor);
  return min + (max - min) * ceilingShare * PRIMITIVE_INTENSITY_POSITION[intensity];
}

/**
 * Способность государства реально применить силу: стабильность + легитимность
 * (docs/CONCEPT.md §5.2 — политика страны живёт на этих осях). Разваливающийся
 * режим подавляет хуже, чем уверенный в себе, при том же приказе.
 *
 * Военная сила намеренно НЕ входит: в сценарии 1946 блок `military` у
 * загружаемых стран нулевой (`createEmptyMilitaryState`), и член формулы был бы
 * мёртвым — то есть ровно тем, чего эта правка избегает.
 */
export function coerciveCapacity(country: Country | undefined): number {
  if (!country) return 0;
  const stability = politicsShare(country.politics.stability);
  const legitimacy = politicsShare(country.politics.legitimacy);
  return clamp01(
    REPRESS_COERCION_STABILITY_WEIGHT * stability +
    REPRESS_COERCION_LEGITIMACY_WEIGHT * legitimacy
  );
}

/**
 * Значение страновой политики (0..100) как доля 0..1. Факторы ниже принимают
 * сырое значение шкалы, а не `Country`: так их можно проверить на достижимость
 * схлопывания напрямую, без сборки мира вокруг одного числа.
 */
function politicsShare(value: number): number {
  return clamp01(value / COUNTRY_POLITICS_SCALE_MAX);
}

/**
 * `repress`, подавление: способность власти × сопротивление массы. Доминанта
 * региона подавить труднее, чем малое меньшинство, при одинаковом приказе.
 */
export function repressSuppressionFactor(capacity: number, share: number): number {
  return clamp01(capacity) * clamp01(1 - REPRESS_MAJORITY_RESISTANCE * clamp01(share));
}

/**
 * `repress`, отчуждение: охват (доля группы) × дефицит мандата у власти.
 *
 * Умелость силовиков сюда НЕ входит (обидеть получается и у слабого
 * государства), а вот право приказывать — входит: репрессия от легитимного
 * режима читается как применение закона, от режима без мандата — как насилие
 * чужаков. Легитимность работает в этом канале ПРОТИВОПОЛОЖНО тому, как она
 * работает в `coerciveCapacity`: мандат делает подавление и сильнее, и дешевле
 * по долгосрочной цене. Это и есть развилка, ради которой два канала одного
 * глагола считаются раздельно.
 */
export function repressAlienationFactor(share: number, legitimacy: number): number {
  const reach = REPRESS_ALIENATION_SHARE_BASE + (1 - REPRESS_ALIENATION_SHARE_BASE) * clamp01(share);
  const mandateDeficit = clamp01(
    1 - REPRESS_ALIENATION_LEGITIMACY_RELIEF * politicsShare(legitimacy)
  );
  return clamp01(reach * mandateDeficit);
}

/**
 * `grant_autonomy`: охват уступки (доля группы в регионе) × остаток доверия ×
 * правдоподобность обещания.
 *
 * Накопленное отчуждение обесценивает жест — уступка глубоко отчуждённой группе
 * работает слабее, чем той же группе до репрессий. Легитимность добавлена
 * третьим множителем 2026-07-26: в свежем мире `alienation` равна нулю везде,
 * поэтому без неё фактор был чистой функцией доли группы, а срез размечен
 * титульными доминантами — «состояние», не отличимое от константы. Смысл: обещание
 * автономии стоит ровно столько, сколько шансов, что дающий его режим доживёт
 * до исполнения.
 */
export function concessionFactor(
  share: number,
  memory: GroupImpactMemory | undefined,
  legitimacy: number
): number {
  const reach = GRANT_AUTONOMY_SHARE_BASE + (1 - GRANT_AUTONOMY_SHARE_BASE) * clamp01(share);
  const trust = clamp01(1 - GRANT_AUTONOMY_ALIENATION_DISCOUNT * clamp01(memory?.alienation ?? 0));
  const credibility = clamp01(
    1 - GRANT_AUTONOMY_LEGITIMACY_WEIGHT * (1 - politicsShare(legitimacy))
  );
  return clamp01(reach * trust * credibility);
}

/**
 * Отклик соседей на уступку. Считается от ФАКТИЧЕСКОЙ величины уступки, а не от
 * хинта: соседи видят, что реально дали, а не каким прилагательным это назвали.
 */
export function neighbourEmboldenment(concession: number): number {
  const signal = clamp01(concession / GRANT_AUTONOMY_CONCESSION_MAX);
  return (
    GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MIN +
    (GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MAX - GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MIN) * signal
  );
}

/**
 * Общая форма «запас над предпосылкой»: сколько свободы осталось между порогом,
 * который примитив уже прошёл на фазе validate, и максимумом шкалы. Ровно на
 * пороге запас нулевой — эффект минимальный при любом хинте.
 */
function headroomAbove(value: number, threshold: number): number {
  if (threshold >= 1) return 0;
  return clamp01((value - threshold) / (1 - threshold));
}

/** `incite_unrest`: чем шире идеологический разрыв, тем горючее материал. */
export function inciteFactor(distance: number): number {
  return headroomAbove(distance, INCITE_UNREST_MIN_DISTANCE);
}

/** `spawn_incident`: чем сильнее уже кипит регион, тем крупнее событие. */
export function incidentFactor(discontent: number): number {
  return headroomAbove(discontent, SPAWN_INCIDENT_MIN_DISCONTENT);
}

/**
 * `enact_reform`: политический мандат сверх минимума, при котором реформа
 * вообще проходит. Правительство с широкой поддержкой продавливает более
 * глубокий сдвиг за ту же фиксированную цену.
 */
export function reformMandateFactor(governmentSupport: number): number {
  const span = COUNTRY_POLITICS_SCALE_MAX - ENACT_REFORM_MIN_GOVERNMENT_SUPPORT;
  if (span <= 0) return 0;
  return clamp01((governmentSupport - ENACT_REFORM_MIN_GOVERNMENT_SUPPORT) / span);
}

/** Средняя по долям величина — «фактическое число» для нарратива по группам. */
export function shareWeightedMean(values: readonly { share: number; value: number }[]): number {
  const totalShare = values.reduce((sum, v) => sum + v.share, 0);
  if (totalShare <= 0) return 0;
  return values.reduce((sum, v) => sum + v.share * v.value, 0) / totalShare;
}
