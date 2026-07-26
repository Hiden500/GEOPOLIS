import { type GameState } from "@shared/types/GameState";
import { type GroupImpactMemory } from "@shared/types/politics/Demographics";
import { IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX } from "@shared/types/politics/Ideology";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { type CommandResult } from "./types";

/**
 * Команды политического слоя (docs/plans/03_MODIFIERS_COMMANDS.md, правило 2:
 * мутации состояния — только здесь, не в вызывающем коде). Ими пользуется
 * движок примитивов (server/src/primitives/), а в будущем — LLM-путь и роуты
 * игрока.
 *
 * Каждая команда возвращает CommandResult и НЕ бросает исключений: вызывающий
 * обязан проверить результат. Разрыв «применил и не посмотрел на результат»,
 * который есть в существующих apply*Action (LLMService.ts), сюда не наследуется —
 * PrimitiveEngine валит примитив целиком, если команда вернула success: false.
 */

/** Виды следа в памяти воздействий — те же поля, что у GroupImpactMemory. */
export type ImpactField = "suppression" | "alienation" | "concession" | "emboldenment";

/** Фактически принятые полем дельты — по полю на каждую запрошенную дельту. */
export type AppliedImpact = Partial<Record<ImpactField, number>>;

const IMPACT_MIN = 0;
const IMPACT_MAX = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Прибавляет след воздействия к паре (регион, группа), создавая запись памяти
 * при первом касании. Все поля клампятся в 0..1: примитив не может накачать
 * отчуждение выше потолка повторными вызовами.
 *
 * Требует, чтобы группа реально жила в этом регионе — иначе движок молча
 * копил бы память для несуществующего населения.
 *
 * Возвращает ФАКТИЧЕСКИ принятую дельту по каждому полю. У насыщенного поля она
 * меньше запрошенной (а на потолке — ноль), и именно это число обязано уйти в
 * нарратив: движок не вправе отчитываться намерением.
 */
export function addGroupImpact(
  game: GameState,
  regionId: number,
  groupId: string,
  deltas: Partial<Record<ImpactField, number>>
): CommandResult<AppliedImpact> {
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };

  if (!region.demographics?.some(d => d.groupId === groupId)) {
    return { success: false, error: `Group ${groupId} does not live in region ${regionId}` };
  }

  // Дельта проверяется ДО первой записи: тип `Partial<Record<...>>` допускает
  // `undefined` (и вызывающий на JS-границе — что угодно), а `память + undefined`
  // даёт NaN. NaN-недовольство ядовито тихо: `clamp01(NaN) === NaN`, обе ветки
  // кризисного латча (DiscontentTick.ts) становятся ложными, и регион перестаёт
  // и входить в кризис, и выходить из него — без единой жалобы. Поэтому отказ
  // команды, а не санитайзинг: испорченный вход должен быть виден.
  const sanitized: [ImpactField, number][] = [];
  for (const [field, delta] of Object.entries(deltas) as [ImpactField, number | undefined][]) {
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      return {
        success: false,
        error: `Impact delta for '${field}' is not a finite number: ${String(delta)}`,
      };
    }
    sanitized.push([field, delta]);
  }

  let memory = game.groupImpactMemory.find(m => m.regionId === regionId && m.groupId === groupId);
  if (!memory) {
    memory = {
      regionId,
      groupId,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    } satisfies GroupImpactMemory;
    game.groupImpactMemory.push(memory);
  }

  // Фактическая дельта — разница ПОСЛЕ клампа, а не запрошенное число. У поля
  // на 0.98 запрос 0.41 принимается ровно на 0.02, а на потолке — на ноль.
  const applied: AppliedImpact = {};
  for (const [field, delta] of sanitized) {
    const before = memory[field];
    memory[field] = clamp(before + delta, IMPACT_MIN, IMPACT_MAX);
    applied[field] = memory[field] - before;
  }

  return { success: true, applied };
}

/** Фактически принятый сдвиг по каждой оси идеологии (после клампа в [-1, +1]). */
export interface AppliedIdeologyShift {
  economic: number;
  political: number;
}

/**
 * Сдвигает координаты идеологии страны (docs/CONCEPT.md §4.2 — «плавный дрейф»,
 * без скачков «ярлык А → ярлык Б»). Страна без явных координат получает их из
 * фолбэка по ярлыку: сдвиг обязан стартовать с той же точки, которую движок
 * уже использовал в расчёте недовольства, иначе реформа дала бы разрыв.
 * Ярлык `politics.ideology` при этом не переписывается — зоны спектра поверх
 * координат вводятся отдельно, вне этого среза.
 *
 * Возвращает ФАКТИЧЕСКИЙ сдвиг по каждой оси: у власти на краю спектра
 * (`political = -1`) авторитарная реформа не двигает ничего, и отчитываться она
 * обязана нулём, а не запрошенным шагом.
 */
export function shiftCountryIdeology(
  game: GameState,
  countryId: string,
  deltaEconomic: number,
  deltaPolitical: number
): CommandResult<AppliedIdeologyShift> {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  // Тот же санитарный контроль, что и у памяти воздействий, и по той же
  // причине: NaN-координата власти делает NaN дистанцию «власть ↔ группа», то
  // есть недовольство ВСЕХ регионов страны, и кризисный латч глохнет молча
  // (обе его ветки сравнивают с NaN и обе ложны). Живой путь сюда —
  // `governmentSupport = NaN`: предпосылка реформы (`NaN < 25` → false) его
  // пропускает, и NaN доезжает до координат через шаг реформы.
  for (const [axis, delta] of [["economic", deltaEconomic], ["political", deltaPolitical]] as const) {
    if (!Number.isFinite(delta)) {
      return { success: false, error: `Ideology shift for '${axis}' is not a finite number: ${String(delta)}` };
    }
  }

  const current = resolveIdeologyCoordinates(country.politics);
  if (!Number.isFinite(current.economic) || !Number.isFinite(current.political)) {
    return {
      success: false,
      error:
        `Ideology coordinates of ${countryId} are already non-finite ` +
        `(economic: ${String(current.economic)}, political: ${String(current.political)})`,
    };
  }

  const shifted = {
    economic: clamp(current.economic + deltaEconomic, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX),
    political: clamp(current.political + deltaPolitical, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX),
  };
  country.politics.ideologyCoordinates = shifted;

  return {
    success: true,
    applied: {
      economic: shifted.economic - current.economic,
      political: shifted.political - current.political,
    },
  };
}

const GOVERNMENT_SUPPORT_MIN = 0;
const GOVERNMENT_SUPPORT_MAX = 100;

/**
 * Списывает политическую цену с поддержки правительства (шкала 0..100, как и
 * остальная политика страны). Отказывает, если платить нечем — цена реформы
 * должна быть настоящей, а не уходить в минус с клампом.
 *
 * Возвращает ФАКТИЧЕСКИ списанное. Сегодня оно равно запрошенному (иначе
 * команда отказывает), но вызывающий не обязан это знать: правило «отчитываться
 * применённым, а не намеренным» одно на весь командный слой.
 */
export function spendGovernmentSupport(
  game: GameState,
  countryId: string,
  amount: number
): CommandResult<number> {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  // Отрицательная «цена» тихо ДОБАВИЛА бы поддержку, а неконечная — отравила бы
  // шкалу: `NaN < amount` ложно, проверка платёжеспособности ниже пропустила бы
  // NaN, и `reformMandateFactor(NaN)` увёз бы NaN в координаты идеологии, а
  // оттуда — в недовольство каждого региона страны.
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, error: `Political cost must be a finite non-negative number: ${String(amount)}` };
  }
  if (!Number.isFinite(country.politics.governmentSupport)) {
    return {
      success: false,
      error: `Government support of ${countryId} is not a finite number: ${String(country.politics.governmentSupport)}`,
    };
  }

  if (country.politics.governmentSupport < amount) {
    return {
      success: false,
      error: `Not enough government support: need ${amount}, have ${country.politics.governmentSupport.toFixed(1)}`,
    };
  }

  const before = country.politics.governmentSupport;
  country.politics.governmentSupport = clamp(
    before - amount,
    GOVERNMENT_SUPPORT_MIN,
    GOVERNMENT_SUPPORT_MAX
  );

  return { success: true, applied: before - country.politics.governmentSupport };
}
